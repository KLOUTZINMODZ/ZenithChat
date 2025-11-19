const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const { encryptMessage, decryptMessage } = require('../../utils/encryption');
const cache = require('../../services/GlobalCache');
const crypto = require('crypto');
const { validateMessage } = require('../../utils/messageValidation');
const {
  sanitizeMessage,
  sanitizeMessages,
  sanitizeWebSocketPayload,
  validateConversationAccess
} = require('../../utils/dataSanitizer');

const messageBuffer = new Map();
const deliveryTimeouts = new Map();

class MessageHandler {
  constructor(connectionManager, conversationHandler = null) {
    this.connectionManager = connectionManager;
    this.conversationHandler = conversationHandler;
    this.activeConversations = new Map();
    this.typingTimeouts = new Map();
    this.unreadCounts = new Map();
    this.messageRetryQueue = new Map();
    
    this.maxRetryAttempts = 5;
    this.retryInterval = 2000;
    this.maxRetryInterval = 30000;
    
    this.setupCleanupInterval();

    // Feature flags and replay limits
    this.enableCompactUpdates = String(process.env.WS_CONV_UPDATE_COMPACT || 'true').toLowerCase() === 'true';
    this.typingNoDb = String(process.env.WS_TYPING_NO_DB || 'true').toLowerCase() === 'true';
    this.pendingStrategy = String(process.env.WS_PENDING_FETCH_STRATEGY || 'indexed'); // 'indexed' | 'legacy'
    this.pendingReplayConversationsLimit = parseInt(process.env.WS_PENDING_REPLAY_MAX_CONV || '5');
    this.pendingReplayMessagesLimit = parseInt(process.env.WS_PENDING_REPLAY_MAX_MSG || '100');
  }

  setupCleanupInterval() {
    setInterval(() => this.cleanupOldMessages(), 60000);
  }

  async handleSendMessage(userId, payload) {
    try {
      // VERIFICAR BANIMENTO ANTES DE PROCESSAR MENSAGEM
      const user = await User.findById(userId).select('banned bannedAt bannedReason bannedUntil');
      
      if (user && user.isBanned()) {
        logger.warn(`🚫 Usuário banido tentou enviar mensagem: ${userId}`);
        
        // Desconectar usuário imediatamente
        const connections = this.connectionManager.getUserConnections(userId);
        if (connections) {
          connections.forEach(ws => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'error',
                error: 'Account banned',
                banned: true,
                bannedReason: user.bannedReason || 'Violação dos termos de uso',
                timestamp: new Date().toISOString()
              }));
              ws.close(1008, 'Account banned');
            }
          });
        }
        
        throw new Error('Account banned');
      }
      
      const { conversationId, content, type, messageType, attachments = [], tempId } = payload.data;
      const finalType = type || messageType || 'text';

      if (content && content.length > 10000) {
        logger.warn(`User ${userId} attempted to send message with ${content.length} characters (limit: 10,000). Banning user for exploit.`);
        await this.banUserForExploit(userId);
        throw new Error('Message exceeds character limit. User has been banned for exploit attempt.');
      }

      // Validar conteúdo restrito (URLs e números de telefone)
      // ✅ Apenas validar mensagens de texto (imagens/arquivos não precisam validação de conteúdo)
      if (finalType === 'text' && content && content.trim()) {
        const validation = validateMessage(content);
        if (!validation.isValid) {
          logger.warn(`User ${userId} attempted to send restricted content: ${validation.detectedContent || 'unknown'}`);
          throw new Error(validation.reason || 'Conteúdo não permitido detectado');
        }
      }


      const [conversation] = await Promise.all([
        Conversation.findById(conversationId).populate('participants', 'name avatar'),
      ]);

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const isParticipant = conversation.participants.some(
        p => p._id.toString() === userId
      );

      if (!isParticipant) {
        throw new Error('User is not a participant in this conversation');
      }


      const canReceive = typeof conversation.canReceiveMessages === 'function'
        ? conversation.canReceiveMessages()
        : (conversation.isActive && conversation.status !== 'expired');
      const deletedFor = conversation.metadata && (conversation.metadata.get 
        ? conversation.metadata.get('deletedFor') 
        : conversation.metadata?.deletedFor);
      if (!canReceive) {
        throw new Error('Conversation is blocked or finalized');
      }
      if (Array.isArray(deletedFor) && deletedFor.map(id => id.toString()).includes(userId.toString())) {
        throw new Error('Conversation not available');
      }

      const encryptedContent = encryptMessage(content);
      const now = new Date();

      const message = new Message({
        conversation: conversationId,
        sender: userId,
        content: encryptedContent,
        type: finalType,
        attachments,
        readBy: [{ user: userId, readAt: now }]
      });


      conversation.lastMessage = message._id;
      conversation.lastMessageAt = now;
      conversation.unreadCount = conversation.unreadCount || {};
      
      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== userId) {
          conversation.unreadCount[participant._id] = 
            (conversation.unreadCount[participant._id] || 0) + 1;
        }
      });


      await Promise.all([
        message.save(),
        conversation.save()
      ]);


      if (this.conversationHandler) {
        await this.conversationHandler.onNewMessage(conversationId);
      }


      await message.populate('sender', 'name avatar');

      // Sanitizar mensagem antes de enviar (protege dados sensíveis)
      const messageObj = message.toObject();
      const messageToSend = sanitizeMessage({
        ...messageObj,
        content: content,
        attachments: messageObj.attachments || attachments  // ✅ Garantir attachments
      }, userId);


      const broadcastMessage = {
        type: 'message:new',
        data: {
          message: messageToSend,
          conversationId
        },
        timestamp: now.toISOString()
      };


      this.sendToUser(userId, {
        type: 'message:sent',
        data: {
          message: messageToSend,
          tempId: tempId,
        },
        timestamp: now.toISOString()
      });


      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== userId) {
          this.sendToUser(participant._id.toString(), broadcastMessage);
        }
      });

      // Emit compact conversation updates instead of forcing a full-list refresh
      try {
        if (this.enableCompactUpdates && this.conversationHandler && typeof this.conversationHandler.sendCompactUpdateToParticipants === 'function') {
          await this.conversationHandler.sendCompactUpdateToParticipants(conversation, { content }, userId);
        }
      } catch (e) {
        logger.warn('sendCompactUpdateToParticipants failed from MessageHandler', { error: e?.message });
      }


      setImmediate(() => {
        const participantIds = conversation.participants.map(p => p._id.toString());
        cache.invalidateConversationCache(conversationId, participantIds);
        cache.cacheMessage(conversationId, messageToSend);
      });


    } catch (error) {
      logger.error('Error handling send message:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleTypingIndicator(userId, payload) {
    try {
      const { conversationId, isTyping } = payload;
      const typingMessage = {
        type: 'message:typing',
        data: {
          userId,
          conversationId,
          isTyping
        },
        timestamp: new Date().toISOString()
      };

      if (this.typingNoDb) {
        // Broadcast only to users who have this conversation active (reduces load)
        try { this.connectionManager.broadcastToConversation(conversationId, typingMessage, userId); } catch (_) {}
      } else {
        const conversation = await Conversation.findById(conversationId).select('participants').lean();
        if (!conversation) {
          throw new Error('Conversation not found');
        }
        (conversation.participants || []).forEach(participant => {
          const pid = participant?.toString?.() || participant?._id?.toString?.();
          if (pid && pid !== userId) {
            this.sendToUser(pid, typingMessage);
          }
        });
      }

    } catch (error) {
      logger.error('Error handling typing indicator:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleMarkAsRead(userId, payload) {
    try {
      const { messageIds, conversationId } = payload;


      await Message.updateMany(
        {
          _id: { $in: messageIds },
          conversation: conversationId,
          'readBy.user': { $ne: userId }
        },
        {
          $push: {
            readBy: {
              user: userId,
              readAt: new Date()
            }
          }
        }
      );


      const conversation = await Conversation.findById(conversationId);
      if (conversation && conversation.unreadCount) {
        conversation.unreadCount[userId] = 0;
        await conversation.save();
      }


      const readReceipt = {
        type: 'message:read',
        data: {
          messageIds,
          conversationId,
          userId
        },
        timestamp: new Date().toISOString()
      };

      if (conversation) {
        conversation.participants.forEach(participant => {
          if (participant.toString() !== userId) {
            this.sendToUser(participant.toString(), readReceipt);
          }
        });
      }


    } catch (error) {
      logger.error('Error marking messages as read:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleOpenConversation(userId, payload) {
    try {
      const { conversationId } = payload;


      this.connectionManager.setActiveConversation(userId, conversationId);


      await this.handleMarkAsRead(userId, { 
        conversationId,
        messageIds: await this.getUnreadMessageIds(userId, conversationId)
      });


      this.sendToUser(userId, {
        type: 'conversation:opened',
        data: { conversationId },
        timestamp: new Date().toISOString()
      });


    } catch (error) {
      logger.error('Error opening conversation:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleCloseConversation(userId, payload) {
    try {
      const { conversationId } = payload;


      this.connectionManager.removeActiveConversation(userId);


      this.sendToUser(userId, {
        type: 'conversation:closed',
        data: { conversationId },
        timestamp: new Date().toISOString()
      });


    } catch (error) {
      logger.error('Error closing conversation:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleListConversations(userId, ws) {
    try {
      // Delegate to ConversationHandler's optimized query (lean + unreadCount map)
      const data = await (this.conversationHandler?.getConversationsData(userId).catch(() => ({ conversations: [] })) || { conversations: [] });
      this.sendToUser(userId, {
        type: 'conversation:list',
        data: Array.isArray(data.conversations) ? data.conversations : [],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error listing conversations:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleGetMessageHistory(userId, payload, ws) {
    try {
      const { conversationId, limit = 50, before = null } = payload;
      const cacheKey = `messages:${conversationId}:history:${limit}:${before || 'latest'}`;


      let cachedMessages = cache.get(cacheKey);
      if (cachedMessages) {
        this.sendToUser(userId, {
          type: 'message:history',
          data: {
            messages: cachedMessages,
            conversationId,
            cached: true
          },
          timestamp: new Date().toISOString()
        });
        return;
      }


      const conversation = await Conversation.findById(conversationId).select('_id participants').lean();
      const partIds = Array.isArray(conversation?.participants) ? conversation.participants.map(p => p?.toString?.()) : [];
      if (!conversation || !partIds.includes(userId?.toString?.())) {
        throw new Error('Conversation not found or access denied');
      }


      const query = { conversation: conversationId };
      if (before) {
        query.createdAt = { $lt: before };
      }

      const messages = await Message.find(query)
        .populate('sender', 'name avatar')
        .sort('-createdAt')
        .limit(limit)
        .lean();


      const decryptedMessages = messages.map(msg => ({
        ...msg,
        content: decryptMessage(msg.content)
      }));
      
      const sanitizedMessages = sanitizeMessages(decryptedMessages, userId);

      cache.set(cacheKey, decryptedMessages, 600);

      this.sendToUser(userId, {
        type: 'message:history',
        data: {
          conversationId,
          messages: sanitizedMessages.reverse()
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error getting message history:', error);
      this.sendError(userId, error.message);
    }
  }

  async sendPendingMessages(userId, ws) {
    try {
      logger.info(`🔄 CACHE: Sending pending messages for user ${userId}`);


      const offlineMessages = cache.getOfflineMessages(userId);
      if (offlineMessages.length > 0) {
        logger.info(`📤 CACHE: Found ${offlineMessages.length} cached offline messages for user ${userId}`);
        

        const messagesByConversation = new Map();
        offlineMessages.forEach(msg => {
          const convId = msg.data?.conversationId || msg.data?.message?.conversation;
          if (convId) {
            if (!messagesByConversation.has(convId)) {
              messagesByConversation.set(convId, []);
            }
            messagesByConversation.get(convId).push(msg);
          }
        });


        for (const [conversationId, messages] of messagesByConversation) {
          const sanitizedMessages = sanitizeMessages(messages, userId);
          this.sendToUser(userId, {
            type: 'message:offline_recovery',
            data: {
              conversationId,
              messages: sanitizedMessages,
              cached: true,
              recovery: true
            },
            timestamp: new Date().toISOString()
          });
        }
        

        setTimeout(() => {
          cache.clearOfflineMessages(userId);
          logger.info(`🧹 CACHE: Cleared offline messages cache for user ${userId}`);
        }, 30000);
      }


      // Additional server-side replay using indexed strategy (limited) to avoid dynamic map key queries
      if (this.pendingStrategy === 'indexed') {
        const MAX_CONV = this.pendingReplayConversationsLimit;
        const MAX_MSG = this.pendingReplayMessagesLimit;
        const recentConvs = await Conversation.find({ participants: userId })
          .select('_id participants unreadCount updatedAt isTemporary status client booster marketplace')
          .sort({ updatedAt: -1 })
          .limit(MAX_CONV)
          .lean();

        for (const conv of recentConvs) {
          const msgs = await Message.find({
            conversation: conv._id,
            sender: { $ne: userId },
            'readBy.user': { $ne: userId }
          })
            .populate('sender', 'name avatar')
            .sort('createdAt')
            .limit(MAX_MSG)
            .lean();

          if (msgs.length > 0) {
            const decrypted = msgs.map(m => ({ ...m, content: decryptMessage(m.content) }));
            const sanitized = sanitizeMessages(decrypted, userId);
            this.sendToUser(userId, {
              type: 'message:pending',
              data: {
                conversationId: conv._id,
                messages: sanitized,
                requiresAck: true
              },
              timestamp: new Date().toISOString()
            });
          }
        }
      } else {
        // Legacy behavior (may be heavy)
        const conversations = await Conversation.find({
          participants: userId,
          [`unreadCount.${userId}`]: { $gt: 0 }
        }).select('_id').lean();

        for (const conversation of conversations) {
          const messages = await Message.find({
            conversation: conversation._id,
            sender: { $ne: userId },
            'readBy.user': { $ne: userId }
          })
            .populate('sender', 'name avatar')
            .sort('createdAt')
            .limit(this.pendingReplayMessagesLimit)
            .lean();
  
          if (messages.length > 0) {
            const decryptedMessages = messages.map(msg => ({
              ...msg,
              content: decryptMessage(msg.content)
            }));
            const sanitized = sanitizeMessages(decryptedMessages, userId);
  
            this.sendToUser(userId, {
              type: 'message:pending',
              data: {
                conversationId: conversation._id,
                messages: sanitized,
                requiresAck: true
              },
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      // Log de sucesso removido para evitar consumo excessivo de memória

    } catch (error) {
      logger.error('Error sending pending messages:', error);
    }
  }

  async getUnreadMessageIds(userId, conversationId) {
    const messages = await Message.find({
      conversation: conversationId,
      sender: { $ne: userId },
      'readBy.user': { $ne: userId }
    }).select('_id');

    return messages.map(m => m._id);
  }

  sendToUser(userId, message) {
    // Sanitizar payload antes de enviar (camada extra de proteção)
    const sanitizedMessage = sanitizeWebSocketPayload(message, userId);
    
    const isUserOnline = this.connectionManager.isUserOnline(userId);
    
    if (isUserOnline) {
      const connections = this.connectionManager.getUserConnections(userId);
      let messageSent = false;
      
      connections.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(sanitizedMessage));
          messageSent = true;
        }
      });
      

      if (!messageSent) {
        logger.info(`🔄 CACHE: User ${userId} online but send failed - caching message`);
        cache.cacheOfflineMessage(userId, {
          ...sanitizedMessage,
          cached_reason: 'send_failed',
          cached_at: new Date().toISOString()
        });
      }
    } else {

      logger.info(`📦 CACHE: User ${userId} is offline - caching message type: ${message.type}`);
      cache.cacheOfflineMessage(userId, {
        ...sanitizedMessage,
        cached_reason: 'user_offline',
        cached_at: new Date().toISOString()
      });
    }
  }

  sendError(userId, error) {
    this.sendToUser(userId, {
      type: 'error',
      error: error,
      timestamp: new Date().toISOString()
    });
  }





  /**
   * Send message with WhatsApp-like delivery confirmation
   * Stores message in buffer until delivery is confirmed
   */
  async sendMessageWithDelivery(userId, message, recipients) {
    const messageId = message._id || crypto.randomUUID();
    const timestamp = Date.now();


    messageBuffer.set(messageId, {
      message,
      recipients: recipients.filter(r => r !== userId),
      attempts: 0,
      timestamp,
      senderId: userId
    });


    await this.attemptDelivery(messageId);

    return messageId;
  }

  /**
   * Attempt to deliver message to recipients
   */
  async attemptDelivery(messageId) {
    const bufferData = messageBuffer.get(messageId);
    if (!bufferData) return;

    const { message, recipients, attempts, senderId } = bufferData;
    const onlineRecipients = [];
    const offlineRecipients = [];


    recipients.forEach(recipientId => {
      if (this.connectionManager.isUserOnline(recipientId)) {
        onlineRecipients.push(recipientId);
      } else {
        offlineRecipients.push(recipientId);
      }
    });


    const deliveryPromises = onlineRecipients.map(recipientId => {
      return new Promise((resolve) => {
        const deliveryMessage = {
          type: 'message:new',
          data: {
            message,
            messageId,
            requiresAck: true
          },
          timestamp: new Date().toISOString()
        };

        this.sendToUser(recipientId, deliveryMessage);


        const ackTimeout = setTimeout(() => {
          resolve({ recipientId, delivered: false });
        }, 5000);


        deliveryTimeouts.set(`${messageId}_${recipientId}`, ackTimeout);
        resolve({ recipientId, delivered: true });
      });
    });

    const deliveryResults = await Promise.all(deliveryPromises);
    const failedDeliveries = deliveryResults.filter(r => !r.delivered);


    if (failedDeliveries.length > 0 || offlineRecipients.length > 0) {
      const allFailedRecipients = [
        ...failedDeliveries.map(f => f.recipientId),
        ...offlineRecipients
      ];

      bufferData.recipients = allFailedRecipients;
      bufferData.attempts += 1;


      if (bufferData.attempts < this.maxRetryAttempts) {
        const retryDelay = Math.min(
          this.retryInterval * Math.pow(2, bufferData.attempts),
          this.maxRetryInterval
        );

        setTimeout(() => {
          this.attemptDelivery(messageId);
        }, retryDelay);

        logger.info(`Scheduled retry ${bufferData.attempts}/${this.maxRetryAttempts} for message ${messageId} in ${retryDelay}ms`);
      } else {

        logger.warn(`Message ${messageId} failed to deliver after ${this.maxRetryAttempts} attempts`);
        this.handleDeliveryFailure(messageId, allFailedRecipients);
      }
    } else {

      this.handleDeliverySuccess(messageId);
    }


    this.sendDeliveryStatus(senderId, messageId, onlineRecipients, offlineRecipients.concat(failedDeliveries.map(f => f.recipientId)));
  }

  /**
   * Handle delivery acknowledgment from recipient
   */
  async handleDeliveryAck(messageId, recipientId) {
    const bufferData = messageBuffer.get(messageId);
    if (!bufferData) return;


    const timeoutKey = `${messageId}_${recipientId}`;
    const timeout = deliveryTimeouts.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      deliveryTimeouts.delete(timeoutKey);
    }


    bufferData.recipients = bufferData.recipients.filter(r => r !== recipientId);


    this.sendToUser(bufferData.senderId, {
      type: 'message:delivered',
      data: {
        messageId,
        recipientId,
        timestamp: new Date().toISOString()
      }
    });


    if (bufferData.recipients.length === 0) {
      this.handleDeliverySuccess(messageId);
    }

    logger.info(`Delivery ACK received for message ${messageId} from user ${recipientId}`);
  }

  /**
   * Handle read acknowledgment from recipient
   */
  async handleReadAck(messageId, recipientId) {

    const bufferData = messageBuffer.get(messageId);
    if (bufferData) {
      this.sendToUser(bufferData.senderId, {
        type: 'message:read',
        data: {
          messageId,
          recipientId,
          timestamp: new Date().toISOString()
        }
      });
    }

    logger.info(`Read ACK received for message ${messageId} from user ${recipientId}`);
  }

  /**
   * Handle successful delivery
   */
  handleDeliverySuccess(messageId) {
    messageBuffer.delete(messageId);
    

    for (const [key, timeout] of deliveryTimeouts.entries()) {
      if (key.startsWith(messageId)) {
        clearTimeout(timeout);
        deliveryTimeouts.delete(key);
      }
    }

    logger.info(`Message ${messageId} delivered successfully to all recipients`);
  }

  /**
   * Send aggregated delivery status to sender
   */
  sendDeliveryStatus(senderId, messageId, delivered, pending) {
    try {
      const deliveredCount = Array.isArray(delivered) ? delivered.length : (delivered || 0);
      const pendingCount = Array.isArray(pending) ? pending.length : (pending || 0);
      this.sendToUser(senderId, {
        type: 'message:delivery_status',
        data: {
          messageId,
          delivered: deliveredCount,
          pending: pendingCount,
          status: pendingCount === 0 ? 'delivered' : 'pending',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error sending delivery status:', error);
    }
  }

  /**
   * Store message as pending for offline recipients
   */
  async storePendingMessage(messageId, recipients) {
    try {

      const bufferData = messageBuffer.get(messageId);
      let conversationId = null;
      let messagePayload = null;

      if (bufferData && bufferData.message) {
        const msgObj = bufferData.message;
        conversationId = (msgObj.conversation && msgObj.conversation.toString) 
          ? msgObj.conversation.toString() 
          : (msgObj.conversation || null);
        messagePayload = { ...msgObj };
      } else {

        const dbMsg = await Message.findById(messageId).populate('sender', 'name avatar');
        if (dbMsg) {
          conversationId = dbMsg.conversation?.toString() || null;
          messagePayload = {
            ...dbMsg.toObject(),
            content: decryptMessage(dbMsg.content)
          };
        }
      }

      if (!messagePayload) {
        logger.warn(`storePendingMessage: unable to resolve message payload for ${messageId}`);
        return;
      }


      const wsMessage = {
        type: 'message:new',
        data: {
          message: messagePayload,
          conversationId: conversationId || messagePayload.conversation,
          requiresAck: true
        },
        timestamp: new Date().toISOString(),
        persistedOffline: true,
        messageId
      };


      recipients.forEach((recipientId) => {
        cache.cacheOfflineMessage(recipientId, {
          ...wsMessage,
          cached_reason: 'undelivered_after_retries',
          cached_at: new Date().toISOString()
        });
      });


      try {
        await Message.findByIdAndUpdate(
          messageId,
          {
            $set: {
              'metadata.pendingRecipients': recipients,
              'metadata.pendingStoredAt': new Date(),
              'metadata.deliveryAttempts': bufferData?.attempts ?? null
            }
          }
        );
      } catch (metaErr) {
        logger.warn(`storePendingMessage: could not persist pending metadata for ${messageId}: ${metaErr.message}`);
      }

      logger.info(`Storing message ${messageId} as pending for offline recipients (${recipients.length})`);
    } catch (error) {
      logger.error('Error storing pending message:', error);
    }
  }

  /**
   * Handle delivery failure after max retries
   */
  handleDeliveryFailure(messageId, failedRecipients) {
    const bufferData = messageBuffer.get(messageId);
    if (!bufferData) return;


    this.sendToUser(bufferData.senderId, {
      type: 'message:delivery_failed',
      data: {
        messageId,
        failedRecipients,
        timestamp: new Date().toISOString()
      }
    });


    this.storePendingMessage(messageId, failedRecipients);
  }

  /**
   * Clean up old messages from buffer (older than 1 hour)
   */
  cleanupOldMessages() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const [messageId, bufferData] of messageBuffer.entries()) {
      if (bufferData.timestamp < oneHourAgo) {
        logger.info(`Cleaning up old buffered message: ${messageId}`);
        this.handleDeliveryFailure(messageId, bufferData.recipients);
      }
    }
  }

  /**
   * Get pending message count for debugging
   */
  getPendingMessageCount() {
    return messageBuffer.size;
  }

  /**
   * Ban user for exploit attempt (message length > 10,000 characters)
   */
  async banUserForExploit(userId) {
    try {

      await User.findByIdAndUpdate(userId, { banned: true });


      const BanRecord = require('../../models/BanRecord');
      
      const banRecord = new BanRecord({
        userId: userId,
        userDetails: await User.findById(userId).select('name email userid'),
        banType: 'combined_ban',
        reason: 'banido por uso de exploit',
        banDetails: {
          exploitType: 'message_length_exceeded',
          messageLength: 'exceeded_10000_chars',
          detectedAt: new Date()
        },
        bannedBy: userId,
        bannedAt: new Date(),
        expiresAt: null,
        isActive: true,
        accessAttempts: [],
        actionsExecuted: {
          userBanned: true,
          recordCreated: true
        },
        relatedAccounts: []
      });

      await banRecord.save();

      logger.warn(`User ${userId} banned for exploit attempt: message length exceeded 10,000 characters`);


      if (this.connectionManager.isUserOnline(userId)) {
        const connections = this.connectionManager.getUserConnections(userId);
        connections.forEach(ws => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Account banned for exploit attempt',
              banned: true,
              timestamp: new Date().toISOString()
            }));
            ws.close(1008, 'Account banned');
          }
        });
        this.connectionManager.removeUser(userId);
      }

    } catch (error) {
      logger.error(`Error banning user ${userId} for exploit:`, error);
    }
  }
}

module.exports = MessageHandler;
