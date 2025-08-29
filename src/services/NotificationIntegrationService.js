const logger = require('../utils/logger');
const cache = require('./GlobalCache');

class NotificationIntegrationService {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.maxRetryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds
    this.retryMultiplier = 1.5; // Exponential backoff multiplier
    this.maxRetryDelay = 60000; // Max 1 minute delay
    
    // Initialize delivery attempts tracker
    this.deliveryAttempts = new Map();
    
    // Cache TTL settings
    this.cacheTTL = {
      notifications: 604800, // 7 days
      unreadCount: 604800, // 7 days  
      userPreferences: 86400, // 24 hours
      deliveryStatus: 3600 // 1 hour
    };
    
    logger.info('🔔 Notification Integration Service initialized with optimized cache');
  }

  /**
   * Send real-time notification to user
   * @param {string} userId - Target user ID
   * @param {Object} notification - Notification data
   * @param {Object} options - Delivery options
   */
  async sendNotification(userId, notification, options = {}) {
    try {
      const {
        priority = 'normal', // normal, high, urgent
        persistent = true, // Store in cache if user offline
        retryOnFailure = true
      } = options;

      // Add metadata
      const enrichedNotification = {
        ...notification,
        id: notification._id || notification.id,
        timestamp: new Date().toISOString(),
        priority,
        delivered: false
      };

      // Cache notification for persistence and offline delivery
      if (persistent) {
        this.cacheNotification(userId, enrichedNotification);
      }

      // Try immediate delivery
      const delivered = await this.attemptDelivery(userId, enrichedNotification);

      if (!delivered && retryOnFailure) {
        this.scheduleRetry(userId, enrichedNotification);
      }

      logger.info(`Notification ${enrichedNotification.id} ${delivered ? 'delivered' : 'queued'} for user ${userId}`);
      return { delivered, notification: enrichedNotification };

    } catch (error) {
      logger.error('Error sending notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to multiple users
   * @param {string[]} userIds - Array of user IDs
   * @param {Object} notification - Notification data
   * @param {Object} options - Delivery options
   */
  async broadcastNotification(userIds, notification, options = {}) {
    try {
      const results = [];
      
      for (const userId of userIds) {
        const result = await this.sendNotification(userId, notification, options);
        results.push({ userId, ...result });
      }

      const deliveredCount = results.filter(r => r.delivered).length;
      const queuedCount = results.length - deliveredCount;

      logger.info(`Broadcast notification: ${deliveredCount} delivered, ${queuedCount} queued`);
      return results;

    } catch (error) {
      logger.error('Error broadcasting notification:', error);
      throw error;
    }
  }

  /**
   * Send notification count update to user
   * @param {string} userId - Target user ID
   * @param {number} unreadCount - Number of unread notifications
   */
  async sendUnreadCount(userId, unreadCount) {
    const countMessage = {
      type: 'notification:unread_count',
      data: {
        count: unreadCount,
        timestamp: new Date().toISOString()
      }
    };

    return this.sendToUser(userId, countMessage);
  }

  /**
   * Send notification read status update
   * @param {string} userId - Target user ID
   * @param {string} notificationId - Notification ID that was read
   */
  async sendNotificationRead(userId, notificationId) {
    const readMessage = {
      type: 'notification:read',
      data: {
        notificationId,
        timestamp: new Date().toISOString()
      }
    };

    return this.sendToUser(userId, readMessage);
  }

  /**
   * Attempt to deliver notification to user
   * @param {string} userId - Target user ID
   * @param {Object} notification - Notification data
   */
  async attemptDelivery(userId, notification) {
    try {
      if (!this.connectionManager.isUserOnline(userId)) {
        logger.debug(`User ${userId} is offline, queueing notification`);
        return false;
      }

      const message = {
        type: 'notification:new',
        data: {
          notification,
          timestamp: new Date().toISOString()
        }
      };

      const sent = this.sendToUser(userId, message);
      
      if (sent) {
        // Mark as delivered in cache
        this.markAsDelivered(userId, notification.id);
        return true;
      }

      return false;

    } catch (error) {
      logger.error(`Error attempting delivery to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Send message to user via WebSocket
   * @param {string} userId - Target user ID
   * @param {Object} message - Message to send
   */
  sendToUser(userId, message) {
    try {
      if (this.connectionManager.isUserOnline(userId)) {
        const connections = this.connectionManager.getUserConnections(userId);
        let sent = false;

        connections.forEach(ws => {
          if (ws.readyState === 1) { // WebSocket.OPEN
            // Send notification directly via WebSocket
            ws.send(JSON.stringify(message));
            sent = true;
            logger.debug(`Sent notification to user ${userId}: ${message.type}`);
          }
        });

        return sent;
      }

      // Cache notification for offline delivery (separate from chat messages)
      const offlineKey = `notifications:offline:${userId}`;
      const offlineNotifications = cache.get(offlineKey) || [];
      offlineNotifications.unshift(message);
      cache.set(offlineKey, offlineNotifications.slice(0, 50), this.cacheTTL.notifications);
      logger.debug(`Cached notification for offline user ${userId}: ${message.type}`);
      return false;

    } catch (error) {
      logger.error(`Error sending notification to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Cache notification for persistence and offline delivery
   * @param {string} userId - Target user ID
   * @param {Object} notification - Notification data
   */
  cacheNotification(userId, notification) {
    try {
      const cacheKey = `notifications:${userId}`;
      let userNotifications = cache.get(cacheKey) || [];

      // Add to beginning of array (newest first)
      userNotifications.unshift(notification);

      // Keep only last 100 notifications
      if (userNotifications.length > 100) {
        userNotifications = userNotifications.slice(0, 100);
      }

      // Cache for 7 days
      cache.set(cacheKey, userNotifications, this.cacheTTL.notifications);
      
      // Update unread count cache
      const unreadCount = userNotifications.filter(n => !n.isRead).length;
      cache.set(`notifications:${userId}:unread`, unreadCount, this.cacheTTL.unreadCount);

      logger.debug(`Cached notification for user ${userId}`);

    } catch (error) {
      logger.error('Error caching notification:', error);
    }
  }

  /**
   * Get cached notifications for user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   */
  getCachedNotifications(userId, options = {}) {
    try {
      const { limit = 20, unreadOnly = false } = options;
      const cacheKey = `notifications:${userId}`;
      let notifications = cache.get(cacheKey) || [];

      if (unreadOnly) {
        notifications = notifications.filter(n => !n.isRead);
      }

      return notifications.slice(0, limit);

    } catch (error) {
      logger.error('Error getting cached notifications:', error);
      return [];
    }
  }

  /**
   * Mark notification as delivered in cache
   * @param {string} userId - User ID
   * @param {string} notificationId - Notification ID
   */
  markAsDelivered(userId, notificationId) {
    try {
      const cacheKey = `notifications:${userId}`;
      let notifications = cache.get(cacheKey) || [];

      notifications = notifications.map(n => 
        n.id === notificationId || n._id === notificationId
          ? { ...n, delivered: true, deliveredAt: new Date().toISOString() }
          : n
      );

      cache.set(cacheKey, notifications, this.cacheTTL.notifications);

    } catch (error) {
      logger.error('Error marking notification as delivered:', error);
    }
  }

  /**
   * Schedule retry for failed notification delivery
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   */
  scheduleRetry(userId, notification) {
    try {
      const attemptKey = `${userId}:${notification.id}`;
      const currentAttempts = this.deliveryAttempts.get(attemptKey) || 0;

      if (currentAttempts >= this.maxRetryAttempts) {
        logger.warn(`Max retry attempts reached for notification ${notification.id} to user ${userId}`);
        return;
      }

      this.deliveryAttempts.set(attemptKey, currentAttempts + 1);

      const delay = this.retryDelay * Math.pow(2, currentAttempts); // Exponential backoff

      setTimeout(async () => {
        logger.debug(`Retrying notification delivery (attempt ${currentAttempts + 1}/${this.maxRetryAttempts})`);
        
        const delivered = await this.attemptDelivery(userId, notification);
        
        if (!delivered && currentAttempts + 1 < this.maxRetryAttempts) {
          this.scheduleRetry(userId, notification);
        } else if (delivered) {
          this.deliveryAttempts.delete(attemptKey);
        }
      }, delay);

    } catch (error) {
      logger.error('Error scheduling retry:', error);
    }
  }

  /**
   * Send pending notifications when user comes online
   * @param {string} userId - User ID
   */
  async sendPendingNotifications(userId) {
    try {
      const pendingNotifications = this.getCachedNotifications(userId)
        .filter(n => !n.delivered && !n.isRead)
        .slice(0, 20); // Limit to 20 most recent

      if (pendingNotifications.length === 0) {
        return;
      }

      logger.info(`Sending ${pendingNotifications.length} pending notifications to user ${userId}`);

      // Send notifications with delay to avoid overwhelming
      for (let i = 0; i < pendingNotifications.length; i++) {
        setTimeout(() => {
          this.attemptDelivery(userId, pendingNotifications[i]);
        }, i * 500); // 500ms delay between notifications
      }

      // Send unread count
      const unreadCount = cache.get(`notifications:${userId}:unread`) || 0;
      setTimeout(() => {
        this.sendUnreadCount(userId, unreadCount);
      }, pendingNotifications.length * 500 + 1000);

    } catch (error) {
      logger.error('Error sending pending notifications:', error);
    }
  }

  /**
   * Handle user connection event
   * @param {string} userId - User ID
   */
  async handleUserConnected(userId) {
    try {
      logger.debug(`User ${userId} connected - checking for pending notifications`);
      await this.sendPendingNotifications(userId);

    } catch (error) {
      logger.error('Error handling user connected:', error);
    }
  }

  /**
   * Clear notifications cache for user
   * @param {string} userId - User ID
   */
  clearUserNotifications(userId) {
    try {
      cache.delete(`notifications:${userId}`);
      cache.delete(`notifications:${userId}:unread`);
      logger.debug(`Cleared notification cache for user ${userId}`);

    } catch (error) {
      logger.error('Error clearing user notifications:', error);
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      pendingRetries: this.deliveryAttempts.size,
      cacheStats: cache.getStats()
    };
  }
}

module.exports = NotificationIntegrationService;
