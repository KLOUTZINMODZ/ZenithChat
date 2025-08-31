const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const User = require('../../models/User');
const WhatsAppMessageHandler = require('./WhatsAppMessageHandler');
const SystemMessageService = require('../../services/SystemMessageService');
const logger = require('../../utils/logger');
const { encryptMessage, decryptMessage } = require('../../utils/encryption');
const cache = require('../../services/GlobalCache');
const { v4: uuidv4 } = require('uuid');


const messageBuffer = new Map();
const deliveryTimeouts = new Map();

class MessageHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.systemMessageService = new SystemMessageService(connectionManager);
    
    // Configurações de retry
    this.maxRetryAttempts = 5;
    this.retryInterval = 2000;
    this.maxRetryInterval = 30000;
    
    // Limpeza automática de mensagens antigas
    setInterval(() => this.cleanupOldMessages(), 60000);
  }

  async handleSendMessage(userId, payload) {
    try {
      const { conversationId, content, type = 'text', attachments = [] } = payload;


      if (content && content.length > 10000) {
        logger.warn(`User ${userId} attempted to send message with ${content.length} characters (limit: 10,000). Banning user for exploit.`);
        

        await this.banUserForExploit(userId);
        
        throw new Error('Message exceeds character limit. User has been banned for exploit attempt.');
      }


      const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'name email');

      if (!conversation) {
        throw new Error('Conversation not found');
      }


      const isParticipant = conversation.participants.some(
        p => p._id.toString() === userId
      );

      if (!isParticipant) {
        throw new Error('User is not a participant in this conversation');
      }


      const encryptedContent = encryptMessage(content);


      const message = new Message({
        conversation: conversationId,
        sender: userId,
        content: encryptedContent,
        type,
        attachments,
        readBy: [{ user: userId, readAt: new Date() }]
      });

      await message.save();


      conversation.lastMessage = message._id;
      conversation.lastMessageAt = new Date();
      conversation.unreadCount = conversation.unreadCount || {};
      

      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== userId) {
          conversation.unreadCount[participant._id] = 
            (conversation.unreadCount[participant._id] || 0) + 1;
        }
      });

      await conversation.save();


      const participantIds = conversation.participants.map(p => p._id.toString());
      cache.invalidateConversationCache(conversationId, participantIds);


      await message.populate('sender', 'name email avatar');


      cache.cacheMessage(conversationId, {
        ...message.toObject(),
        content: content
      });


      const messageToSend = {
        ...message.toObject(),
        content: content
      };


      const broadcastMessage = {
        type: 'message:new',
        data: {
          message: messageToSend,
          conversationId
        },
        timestamp: new Date().toISOString()
      };


      this.sendToUser(userId, {
        ...broadcastMessage,
        type: 'message:sent'
      });


      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== userId) {
          this.sendToUser(participant._id.toString(), broadcastMessage);
        }
      });


      cache.cacheMessage(conversationId, messageToSend);

      logger.info(`Message sent in conversation ${conversationId} by user ${userId}`);

    } catch (error) {
      logger.error('Error handling send message:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleTypingIndicator(userId, payload) {
    try {
      const { conversationId, isTyping } = payload;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const typingMessage = {
        type: 'message:typing',
        data: {
          userId,
          conversationId,
          isTyping
        },
        timestamp: new Date().toISOString()
      };


      conversation.participants.forEach(participant => {
        if (participant.toString() !== userId) {
          this.sendToUser(participant.toString(), typingMessage);
        }
      });

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

      logger.info(`Messages marked as read in conversation ${conversationId} by user ${userId}`);

    } catch (error) {
      logger.error('Error marking messages as read:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleSystemMessageDeliveryAck(userId, payload) {
    try {
      const { messageId, conversationId } = payload;
      
      if (!messageId) {
        throw new Error('MessageId is required for system message delivery ack');
      }

      // Processar confirmação via SystemMessageService
      await this.systemMessageService.handleDeliveryConfirmation(messageId, userId);

      logger.info(`System message delivery ack received: ${messageId} from user ${userId}`);

    } catch (error) {
      logger.error('Error handling system message delivery ack:', error);
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

      logger.info(`User ${userId} opened conversation ${conversationId}`);

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

      logger.info(`User ${userId} closed conversation ${conversationId}`);

    } catch (error) {
      logger.error('Error closing conversation:', error);
      this.sendError(userId, error.message);
    }
  }

  async handleListConversations(userId, ws) {
    try {
      const conversations = await Conversation.find({
        participants: userId
      })
        .populate('participants', 'name email avatar')
        .populate('lastMessage')
        .sort('-lastMessageAt')
        .limit(50);

      const conversationData = conversations.map(conv => {
        const convObj = conv.toObject();
        return {
          ...convObj,
          unreadCount: conv.unreadCount?.[userId] || 0,
          isOnline: conv.participants.some(p => 
            p._id.toString() !== userId && 
            this.connectionManager.isUserOnline(p._id.toString())
          ),

          isTemporary: convObj.isTemporary || false,
          expiresAt: convObj.expiresAt || null,
          status: convObj.status || null,
          client: convObj.client || null,
          booster: convObj.booster || null,
          metadata: convObj.metadata || null
        };
      });

      this.sendToUser(userId, {
        type: 'conversation:list',
        data: conversationData,
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
        logger.debug(`Cache hit for message history conversation ${conversationId}`);
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


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.participants.includes(userId)) {
        throw new Error('Conversation not found or access denied');
      }


      const query = { conversation: conversationId };
      if (before) {
        query.createdAt = { $lt: before };
      }

      const messages = await Message.find(query)
        .populate('sender', 'name email avatar')
        .sort('-createdAt')
        .limit(limit);


      const decryptedMessages = messages.map(msg => ({
        ...msg.toObject(),
        content: decryptMessage(msg.content)
      }));


      cache.set(cacheKey, decryptedMessages, 600);
      logger.debug(`Cached message history for conversation ${conversationId}`);

      this.sendToUser(userId, {
        type: 'message:history',
        data: {
          conversationId,
          messages: decryptedMessages.reverse()
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

      const conversations = await Conversation.find({
        participants: userId,
        [`unreadCount.${userId}`]: { $gt: 0 }
      });

      for (const conversation of conversations) {
        const messages = await Message.find({
          conversation: conversation._id,
          sender: { $ne: userId },
          'readBy.user': { $ne: userId }
        })
          .populate('sender', 'name email avatar')
          .sort('createdAt')
          .limit(100);

        if (messages.length > 0) {
          const decryptedMessages = messages.map(msg => ({
            ...msg.toObject(),
            content: decryptMessage(msg.content)
          }));

          this.sendToUser(userId, {
            type: 'message:pending',
            data: {
              conversationId: conversation._id,
              messages: decryptedMessages
            },
            timestamp: new Date().toISOString()
          });
        }
      }

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
    const isUserOnline = this.connectionManager.isUserOnline(userId);
    const isInActiveChat = this.connectionManager.getActiveConversation(userId) === message.data?.conversationId;
    
    if (isUserOnline) {
      const connections = this.connectionManager.getUserConnections(userId);
      let messageSent = false;
      
      connections.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(message));
          messageSent = true;
        }
      });
      

      if (messageSent && !isInActiveChat && message.type === 'message:new') {
        logger.info(`User ${userId} is online but not in active chat. Caching message for sync.`);
        cache.cacheOfflineMessage(userId, {
          ...message,
          cached_reason: 'user_not_in_active_chat',
          cached_at: new Date().toISOString()
        });
      }
    } else {
      logger.info(`User ${userId} is offline. Caching message.`);
      cache.cacheOfflineMessage(userId, message);
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
    const messageId = message._id || uuidv4();
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
    

    messageBuffer.delete(messageId);

    logger.warn(`Message ${messageId} delivery failed for recipients: ${failedRecipients.join(', ')}`);
  }

  /**
   * Store message as pending for offline recipients
   */
  async storePendingMessage(messageId, recipients) {


    logger.info(`Storing message ${messageId} as pending for offline recipients`);
  }

  /**
   * Send delivery status to sender
   */
  sendDeliveryStatus(senderId, messageId, delivered, pending) {
    this.sendToUser(senderId, {
      type: 'message:delivery_status',
      data: {
        messageId,
        delivered: delivered.length,
        pending: pending.length,
        status: pending.length === 0 ? 'delivered' : 'pending',
        timestamp: new Date().toISOString()
      }
    });
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
