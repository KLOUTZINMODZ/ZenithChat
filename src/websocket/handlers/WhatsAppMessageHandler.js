const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const { encryptMessage, decryptMessage } = require('../../utils/encryption');
const cache = require('../../services/GlobalCache');
const { v4: uuidv4 } = require('uuid');

class WhatsAppMessageHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    

    this.messageBuffer = new Map();
    this.deliveryTimeouts = new Map();
    this.typingTimeouts = new Map();
    

    this.maxRetryAttempts = 5;
    this.baseRetryInterval = 2000;
    this.maxRetryInterval = 30000;
    this.messageBufferTTL = 24 * 60 * 60 * 1000;
    

    this.startCleanupIntervals();
    
  }

  startCleanupIntervals() {

    setInterval(() => this.cleanupExpiredMessages(), 5 * 60 * 1000);
    

    setInterval(() => this.cleanupTypingIndicators(), 30 * 1000);
  }

  /**
   * Handle sending a new message with WhatsApp-like delivery guarantees
   */
  async handleSendMessage(userId, payload) {
    try {
      const { conversationId, content, type = 'text', attachments = [] } = payload;


      const conversation = await this.validateConversation(conversationId, userId);
      if (!conversation) {
        throw new Error('Invalid conversation or user not authorized');
      }


      const message = await this.createMessage({
        conversationId,
        userId,
        content,
        type,
        attachments
      });


      await this.updateConversationMetadata(conversation, message);


      const deliveryMessage = await this.prepareMessageForDelivery(message);


      const recipients = conversation.participants
        .filter(p => p._id.toString() !== userId)
        .map(p => p._id.toString());


      this.sendToUser(userId, {
        type: 'message:sent',
        data: { message: deliveryMessage, conversationId },
        timestamp: new Date().toISOString()
      });


      await this.deliverMessage(message._id.toString(), deliveryMessage, recipients, conversationId);

      return { success: true, messageId: message._id };

    } catch (error) {
      logger.error('Error handling send message:', error);
      throw error;
    }
  }

  /**
   * WhatsApp-like message delivery with buffering and retry
   */
  async deliverMessage(messageId, message, recipients, conversationId) {
    const onlineRecipients = [];
    const offlineRecipients = [];


    recipients.forEach(recipientId => {
      if (this.connectionManager.isUserOnline(recipientId)) {
        onlineRecipients.push(recipientId);
      } else {
        offlineRecipients.push(recipientId);
      }
    });


    const deliveryPromises = onlineRecipients.map(async (recipientId) => {
      try {
        const delivered = this.sendToUser(recipientId, {
          type: 'message:new',
          data: { message, conversationId },
          timestamp: new Date().toISOString()
        });

        if (delivered) {

          await this.markMessageAsDelivered(messageId, recipientId);
          return { recipientId, status: 'delivered' };
        } else {
          return { recipientId, status: 'failed' };
        }
      } catch (error) {
        logger.error(`Failed to deliver message ${messageId} to ${recipientId}:`, error);
        return { recipientId, status: 'failed' };
      }
    });

    const deliveryResults = await Promise.allSettled(deliveryPromises);
    const failedDeliveries = [];

    deliveryResults.forEach((result, index) => {
      if (result.status === 'rejected' || result.value?.status === 'failed') {
        failedDeliveries.push(onlineRecipients[index]);
      }
    });


    const recipientsToBuffer = [...offlineRecipients, ...failedDeliveries];
    
    if (recipientsToBuffer.length > 0) {
      this.bufferMessage(messageId, message, recipientsToBuffer, conversationId);
    }

    logger.info(`Message ${messageId} delivery: ${onlineRecipients.length - failedDeliveries.length} delivered, ${recipientsToBuffer.length} buffered`);
  }

  /**
   * Buffer message for later delivery (WhatsApp-like offline message handling)
   */
  bufferMessage(messageId, message, recipients, conversationId, attempt = 1) {

    const existingTimeout = this.deliveryTimeouts.get(messageId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }


    this.messageBuffer.set(messageId, {
      message,
      recipients: [...recipients],
      conversationId,
      attempts: attempt,
      timestamp: Date.now(),
      timeoutId: null
    });


    const delay = Math.min(
      this.baseRetryInterval * Math.pow(2, attempt - 1),
      this.maxRetryInterval
    );


    const timeoutId = setTimeout(() => {
      this.retryMessageDelivery(messageId);
    }, delay);


    const bufferedMessage = this.messageBuffer.get(messageId);
    if (bufferedMessage) {
      bufferedMessage.timeoutId = timeoutId;
      this.deliveryTimeouts.set(messageId, timeoutId);
    }

    logger.info(`Message ${messageId} buffered for ${recipients.length} recipients, retry in ${delay}ms (attempt ${attempt})`);
  }

  /**
   * Retry message delivery for buffered messages
   */
  async retryMessageDelivery(messageId) {
    const bufferedMessage = this.messageBuffer.get(messageId);
    if (!bufferedMessage) return;

    const { message, recipients, conversationId, attempts } = bufferedMessage;


    if (attempts >= this.maxRetryAttempts) {
      logger.warn(`Message ${messageId} exceeded max retry attempts, removing from buffer`);
      this.removeFromBuffer(messageId);
      return;
    }


    const recipientsToRetry = recipients.filter(recipientId => {

      if (this.connectionManager.isUserOnline(recipientId)) {

        const delivered = this.sendToUser(recipientId, {
          type: 'message:new',
          data: { message, conversationId },
          timestamp: new Date().toISOString()
        });

        if (delivered) {

          this.markMessageAsDelivered(messageId, recipientId);
          return false;
        }
      }
      return true;
    });

    if (recipientsToRetry.length === 0) {

      logger.info(`Message ${messageId} delivered to all recipients, removing from buffer`);
      this.removeFromBuffer(messageId);
      return;
    }


    this.bufferMessage(messageId, message, recipientsToRetry, conversationId, attempts + 1);
  }

  /**
   * Handle delivery confirmation from client
   */
  async handleDeliveryConfirmation(userId, payload) {
    try {
      const { messageId } = payload;
      
      await this.markMessageAsDelivered(messageId, userId);
      

      const bufferedMessage = this.messageBuffer.get(messageId);
      if (bufferedMessage) {
        bufferedMessage.recipients = bufferedMessage.recipients.filter(id => id !== userId);
        

        if (bufferedMessage.recipients.length === 0) {
          this.removeFromBuffer(messageId);
        }
      }


      const message = await Message.findById(messageId).populate('sender', '_id');
      if (message && message.sender._id.toString() !== userId) {
        this.sendToUser(message.sender._id.toString(), {
          type: 'message:delivered',
          data: { messageId, userId, conversationId: message.conversation },
          timestamp: new Date().toISOString()
        });
      }

      logger.debug(`Delivery confirmation received for message ${messageId} from user ${userId}`);
      
    } catch (error) {
      logger.error('Error handling delivery confirmation:', error);
    }
  }

  /**
   * Handle read confirmation from client
   */
  async handleReadConfirmation(userId, payload) {
    try {
      const { messageIds } = payload;
      
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;


      await Message.updateMany(
        { 
          _id: { $in: messageIds },
          'readBy.user': { $ne: userId }
        },
        {
          $push: { readBy: { user: userId, readAt: new Date() } }
        }
      );


      const messages = await Message.find({ _id: { $in: messageIds } })
        .populate('sender', '_id')
        .select('_id sender conversation');

      const readConfirmations = new Map();
      
      messages.forEach(message => {
        const senderId = message.sender._id.toString();
        if (senderId !== userId) {
          if (!readConfirmations.has(senderId)) {
            readConfirmations.set(senderId, []);
          }
          readConfirmations.get(senderId).push(message._id.toString());
        }
      });


      readConfirmations.forEach((messageIds, senderId) => {
        this.sendToUser(senderId, {
          type: 'message:read',
          data: { messageIds, userId },
          timestamp: new Date().toISOString()
        });
      });

      logger.debug(`Read confirmation received for ${messageIds.length} messages from user ${userId}`);
      
    } catch (error) {
      logger.error('Error handling read confirmation:', error);
    }
  }

  /**
   * Handle typing indicator
   */
  handleTyping(userId, payload) {
    try {
      const { conversationId, isTyping } = payload;
      

      const existingTimeout = this.typingTimeouts.get(userId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.typingTimeouts.delete(userId);
      }

      if (isTyping) {

        const timeoutId = setTimeout(() => {
          this.broadcastTyping(userId, conversationId, false);
          this.typingTimeouts.delete(userId);
        }, 5000);
        
        this.typingTimeouts.set(userId, timeoutId);
      }


      this.broadcastTyping(userId, conversationId, isTyping);
      
    } catch (error) {
      logger.error('Error handling typing indicator:', error);
    }
  }

  /**
   * Broadcast typing indicator to conversation participants
   */
  async broadcastTyping(userId, conversationId, isTyping) {
    try {
      const conversation = await Conversation.findById(conversationId)
        .populate('participants', '_id');
      
      if (!conversation) return;

      const recipients = conversation.participants
        .filter(p => p._id.toString() !== userId)
        .map(p => p._id.toString());

      recipients.forEach(recipientId => {
        this.sendToUser(recipientId, {
          type: 'user:typing',
          data: { userId, conversationId, isTyping },
          timestamp: new Date().toISOString()
        });
      });
      
    } catch (error) {
      logger.error('Error broadcasting typing indicator:', error);
    }
  }

  /**
   * Send pending messages when user comes online
   */
  async sendPendingMessages(userId) {
    const pendingMessages = [];
    

    this.messageBuffer.forEach((bufferedMessage, messageId) => {
      if (bufferedMessage.recipients.includes(userId)) {
        pendingMessages.push({ messageId, ...bufferedMessage });
      }
    });

    if (pendingMessages.length === 0) return;

    logger.info(`Sending ${pendingMessages.length} pending messages to user ${userId}`);


    for (const pending of pendingMessages) {
      try {
        const delivered = this.sendToUser(userId, {
          type: 'message:new',
          data: { 
            message: pending.message, 
            conversationId: pending.conversationId 
          },
          timestamp: new Date().toISOString()
        });

        if (delivered) {

          await this.markMessageAsDelivered(pending.messageId, userId);
          

          const bufferedMessage = this.messageBuffer.get(pending.messageId);
          if (bufferedMessage) {
            bufferedMessage.recipients = bufferedMessage.recipients.filter(id => id !== userId);
            

            if (bufferedMessage.recipients.length === 0) {
              this.removeFromBuffer(pending.messageId);
            }
          }
        }
      } catch (error) {
        logger.error(`Error sending pending message ${pending.messageId} to user ${userId}:`, error);
      }
    }
  }



  async validateConversation(conversationId, userId) {
    const conversation = await Conversation.findById(conversationId)
      .populate('participants', '_id name avatar');

    if (!conversation) return null;

    const isParticipant = conversation.participants.some(
      p => p._id.toString() === userId
    );

    return isParticipant ? conversation : null;
  }

  async createMessage({ conversationId, userId, content, type, attachments }) {
    const encryptedContent = encryptMessage(content);

    const message = new Message({
      conversation: conversationId,
      sender: userId,
      content: encryptedContent,
      type,
      attachments,
      readBy: [{ user: userId, readAt: new Date() }],
      deliveredTo: []
    });

    await message.save();
    return message;
  }

  async updateConversationMetadata(conversation, message) {
    conversation.lastMessage = message._id;
    conversation.lastMessageAt = new Date();
    

    conversation.participants.forEach(participant => {
      const participantId = participant._id.toString();
      if (participantId !== message.sender.toString()) {
        conversation.unreadCount = conversation.unreadCount || {};
        conversation.unreadCount[participantId] = 
          (conversation.unreadCount[participantId] || 0) + 1;
      }
    });

    await conversation.save();
  }

  async prepareMessageForDelivery(message) {
    await message.populate('sender', 'name avatar');
    
    return {
      ...message.toObject(),
      content: decryptMessage(message.content)
    };
  }

  async markMessageAsDelivered(messageId, userId) {
    await Message.findByIdAndUpdate(
      messageId,
      {
        $addToSet: { deliveredTo: { user: userId, deliveredAt: new Date() } }
      }
    );
  }

  sendToUser(userId, message) {
    return this.connectionManager.sendToUser(userId, message);
  }

  removeFromBuffer(messageId) {
    const bufferedMessage = this.messageBuffer.get(messageId);
    if (bufferedMessage && bufferedMessage.timeoutId) {
      clearTimeout(bufferedMessage.timeoutId);
    }
    
    this.messageBuffer.delete(messageId);
    this.deliveryTimeouts.delete(messageId);
  }

  cleanupExpiredMessages() {
    const now = Date.now();
    const expiredMessages = [];

    this.messageBuffer.forEach((bufferedMessage, messageId) => {
      if (now - bufferedMessage.timestamp > this.messageBufferTTL) {
        expiredMessages.push(messageId);
      }
    });

    expiredMessages.forEach(messageId => {
      logger.info(`Cleaning up expired buffered message: ${messageId}`);
      this.removeFromBuffer(messageId);
    });

    if (expiredMessages.length > 0) {
      logger.info(`Cleaned up ${expiredMessages.length} expired buffered messages`);
    }
  }

  cleanupTypingIndicators() {

    const activeTypingUsers = this.typingTimeouts.size;
    if (activeTypingUsers > 0) {
      logger.debug(`${activeTypingUsers} users currently typing`);
    }
  }


  getStats() {
    return {
      bufferedMessages: this.messageBuffer.size,
      activeTypingUsers: this.typingTimeouts.size,
      pendingDeliveries: this.deliveryTimeouts.size
    };
  }
}

module.exports = WhatsAppMessageHandler;
