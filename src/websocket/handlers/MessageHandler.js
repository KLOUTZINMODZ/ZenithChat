const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const { encryptMessage, decryptMessage } = require('../../utils/encryption');
const cache = require('../../services/GlobalCache');
const { v4: uuidv4 } = require('uuid');

// WhatsApp-like message buffer for pending deliveries
const messageBuffer = new Map(); // messageId -> { message, recipients, attempts, timestamp }
const deliveryTimeouts = new Map(); // messageId -> timeoutId

class MessageHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    
    // WhatsApp-like delivery system
    this.maxRetryAttempts = 5;
    this.retryInterval = 2000; // 2 seconds
    this.maxRetryInterval = 30000; // 30 seconds
    
    // Start cleanup interval for old buffered messages
    setInterval(() => this.cleanupOldMessages(), 60000); // Every minute
  }

  async handleSendMessage(userId, payload) {
    try {
      const { conversationId, content, type = 'text', attachments = [] } = payload;

      // SECURITY: Check message length limit (10,000 characters)
      if (content && content.length > 10000) {
        logger.warn(`User ${userId} attempted to send message with ${content.length} characters (limit: 10,000). Banning user for exploit.`);
        
        // Ban user for exploit attempt
        await this.banUserForExploit(userId);
        
        throw new Error('Message exceeds character limit. User has been banned for exploit attempt.');
      }

      // Validate conversation and participants
      const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'name email');

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Check if user is participant
      const isParticipant = conversation.participants.some(
        p => p._id.toString() === userId
      );

      if (!isParticipant) {
        throw new Error('User is not a participant in this conversation');
      }

      // Encrypt message content
      const encryptedContent = encryptMessage(content);

      // Create message
      const message = new Message({
        conversation: conversationId,
        sender: userId,
        content: encryptedContent,
        type,
        attachments,
        readBy: [{ user: userId, readAt: new Date() }]
      });

      await message.save();

      // Update conversation
      conversation.lastMessage = message._id;
      conversation.lastMessageAt = new Date();
      conversation.unreadCount = conversation.unreadCount || {};
      
      // Update unread count for other participants
      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== userId) {
          conversation.unreadCount[participant._id] = 
            (conversation.unreadCount[participant._id] || 0) + 1;
        }
      });

      await conversation.save();

      // Invalidate conversation cache for all participants
      const participantIds = conversation.participants.map(p => p._id.toString());
      cache.invalidateConversationCache(conversationId, participantIds);

      // Populate sender info
      await message.populate('sender', 'name email avatar');

      // Cache the new message
      cache.cacheMessage(conversationId, {
        ...message.toObject(),
        content: content // Store unencrypted in cache
      });

      // Decrypt for sending
      const messageToSend = {
        ...message.toObject(),
        content: content // Send unencrypted to connected clients
      };

      // Send to all participants in the conversation
      const broadcastMessage = {
        type: 'message:new',
        data: {
          message: messageToSend,
          conversationId
        },
        timestamp: new Date().toISOString()
      };

      // Send to sender (confirmation)
      this.sendToUser(userId, {
        ...broadcastMessage,
        type: 'message:sent'
      });

      // Send to other participants
      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== userId) {
          this.sendToUser(participant._id.toString(), broadcastMessage);
        }
      });

      // Cache the message
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

      // Broadcast to other participants
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

      // Update messages as read
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

      // Reset unread count for user
      const conversation = await Conversation.findById(conversationId);
      if (conversation && conversation.unreadCount) {
        conversation.unreadCount[userId] = 0;
        await conversation.save();
      }

      // Send read receipt to other participants
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

  async handleOpenConversation(userId, payload) {
    try {
      const { conversationId } = payload;

      // Set active conversation
      this.connectionManager.setActiveConversation(userId, conversationId);

      // Mark messages as read
      await this.handleMarkAsRead(userId, { 
        conversationId,
        messageIds: await this.getUnreadMessageIds(userId, conversationId)
      });

      // Send conversation opened confirmation
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

      // Remove active conversation
      this.connectionManager.removeActiveConversation(userId);

      // Send confirmation
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
          // Garantir que campos de chat temporário sejam incluídos
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

      // Try cache first
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

      // Check if user is participant
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.participants.includes(userId)) {
        throw new Error('Conversation not found or access denied');
      }

      // Fetch from database
      const query = { conversation: conversationId };
      if (before) {
        query.createdAt = { $lt: before };
      }

      const messages = await Message.find(query)
        .populate('sender', 'name email avatar')
        .sort('-createdAt')
        .limit(limit);

      // Decrypt messages
      const decryptedMessages = messages.map(msg => ({
        ...msg.toObject(),
        content: decryptMessage(msg.content)
      }));

      // Cache the messages for 10 minutes
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
      // Get unread messages for user
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
    if (this.connectionManager.isUserOnline(userId)) {
      const connections = this.connectionManager.getUserConnections(userId);
      connections.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify(message));
        }
      });
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

  // ========================================
  // WHATSAPP-LIKE DELIVERY SYSTEM
  // ========================================

  /**
   * Send message with WhatsApp-like delivery confirmation
   * Stores message in buffer until delivery is confirmed
   */
  async sendMessageWithDelivery(userId, message, recipients) {
    const messageId = message._id || uuidv4();
    const timestamp = Date.now();

    // Store in buffer for retry logic
    messageBuffer.set(messageId, {
      message,
      recipients: recipients.filter(r => r !== userId), // Don't send to sender
      attempts: 0,
      timestamp,
      senderId: userId
    });

    // Try to deliver immediately
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

    // Check which recipients are online
    recipients.forEach(recipientId => {
      if (this.connectionManager.isUserOnline(recipientId)) {
        onlineRecipients.push(recipientId);
      } else {
        offlineRecipients.push(recipientId);
      }
    });

    // Send to online recipients
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

        // Set timeout for ACK
        const ackTimeout = setTimeout(() => {
          resolve({ recipientId, delivered: false });
        }, 5000); // 5 seconds timeout

        // Store timeout for cleanup
        deliveryTimeouts.set(`${messageId}_${recipientId}`, ackTimeout);
        resolve({ recipientId, delivered: true });
      });
    });

    const deliveryResults = await Promise.all(deliveryPromises);
    const failedDeliveries = deliveryResults.filter(r => !r.delivered);

    // Update buffer with failed recipients
    if (failedDeliveries.length > 0 || offlineRecipients.length > 0) {
      const allFailedRecipients = [
        ...failedDeliveries.map(f => f.recipientId),
        ...offlineRecipients
      ];

      bufferData.recipients = allFailedRecipients;
      bufferData.attempts += 1;

      // Schedule retry if under max attempts
      if (bufferData.attempts < this.maxRetryAttempts) {
        const retryDelay = Math.min(
          this.retryInterval * Math.pow(2, bufferData.attempts), // Exponential backoff
          this.maxRetryInterval
        );

        setTimeout(() => {
          this.attemptDelivery(messageId);
        }, retryDelay);

        logger.info(`Scheduled retry ${bufferData.attempts}/${this.maxRetryAttempts} for message ${messageId} in ${retryDelay}ms`);
      } else {
        // Max retries reached, mark as failed
        logger.warn(`Message ${messageId} failed to deliver after ${this.maxRetryAttempts} attempts`);
        this.handleDeliveryFailure(messageId, allFailedRecipients);
      }
    } else {
      // All delivered successfully
      this.handleDeliverySuccess(messageId);
    }

    // Send delivery status to sender
    this.sendDeliveryStatus(senderId, messageId, onlineRecipients, offlineRecipients.concat(failedDeliveries.map(f => f.recipientId)));
  }

  /**
   * Handle delivery acknowledgment from recipient
   */
  async handleDeliveryAck(messageId, recipientId) {
    const bufferData = messageBuffer.get(messageId);
    if (!bufferData) return;

    // Clear timeout
    const timeoutKey = `${messageId}_${recipientId}`;
    const timeout = deliveryTimeouts.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      deliveryTimeouts.delete(timeoutKey);
    }

    // Remove recipient from pending list
    bufferData.recipients = bufferData.recipients.filter(r => r !== recipientId);

    // Send delivery confirmation to sender
    this.sendToUser(bufferData.senderId, {
      type: 'message:delivered',
      data: {
        messageId,
        recipientId,
        timestamp: new Date().toISOString()
      }
    });

    // If all recipients confirmed, remove from buffer
    if (bufferData.recipients.length === 0) {
      this.handleDeliverySuccess(messageId);
    }

    logger.info(`Delivery ACK received for message ${messageId} from user ${recipientId}`);
  }

  /**
   * Handle read acknowledgment from recipient
   */
  async handleReadAck(messageId, recipientId) {
    // Send read confirmation to sender
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
    
    // Clear any remaining timeouts
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

    // Notify sender of delivery failure
    this.sendToUser(bufferData.senderId, {
      type: 'message:delivery_failed',
      data: {
        messageId,
        failedRecipients,
        timestamp: new Date().toISOString()
      }
    });

    // Store as pending for when recipients come online
    this.storePendingMessage(messageId, failedRecipients);
    
    // Remove from active buffer
    messageBuffer.delete(messageId);

    logger.warn(`Message ${messageId} delivery failed for recipients: ${failedRecipients.join(', ')}`);
  }

  /**
   * Store message as pending for offline recipients
   */
  async storePendingMessage(messageId, recipients) {
    // Implementation would store in database for when users come online
    // This is a placeholder for the actual implementation
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
      // Update user banned status
      await User.findByIdAndUpdate(userId, { banned: true });

      // Create ban record in banished collection
      const BanRecord = require('../../models/BanRecord'); // Assuming this model exists
      
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
        bannedBy: userId, // Self-ban due to exploit
        bannedAt: new Date(),
        expiresAt: null, // Permanent ban
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

      // Disconnect user immediately
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
