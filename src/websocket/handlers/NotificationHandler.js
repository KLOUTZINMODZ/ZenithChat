const logger = require('../../utils/logger');
const cache = require('../../services/GlobalCache');

class NotificationHandler {
  constructor(connectionManager, notificationService) {
    this.connectionManager = connectionManager;
    this.notificationService = notificationService;
    
    logger.info('🔔 Notification WebSocket Handler initialized');
  }

  /**
   * Handle notification subscription request
   * @param {string} userId - User ID
   * @param {Object} payload - Subscription data
   */
  async handleSubscribe(userId, payload) {
    try {
      const { types = [], games = [] } = payload;

      // Cache user's notification preferences
      const preferencesKey = `notification_prefs:${userId}`;
      const preferences = {
        types,
        games,
        subscribedAt: new Date().toISOString()
      };

      cache.set(preferencesKey, preferences, 86400); // 24 hours

      // Send confirmation
      this.sendToUser(userId, {
        type: 'notification:subscribed',
        data: {
          types,
          games,
          timestamp: new Date().toISOString()
        }
      });

      // Send any pending notifications
      await this.notificationService.sendPendingNotifications(userId);

      logger.debug(`User ${userId} subscribed to notifications: types=${types.join(',')} games=${games.join(',')}`);

    } catch (error) {
      logger.error('Error handling notification subscription:', error);
      this.sendError(userId, 'Failed to subscribe to notifications');
    }
  }

  /**
   * Handle notification unsubscribe request
   * @param {string} userId - User ID
   * @param {Object} payload - Unsubscribe data
   */
  async handleUnsubscribe(userId, payload) {
    try {
      const { types = [], games = [] } = payload;

      // Update cached preferences
      const preferencesKey = `notification_prefs:${userId}`;
      let preferences = cache.get(preferencesKey) || { types: [], games: [] };

      // Remove specified types and games
      preferences.types = preferences.types.filter(t => !types.includes(t));
      preferences.games = preferences.games.filter(g => !games.includes(g));

      cache.set(preferencesKey, preferences, 86400);

      // Send confirmation
      this.sendToUser(userId, {
        type: 'notification:unsubscribed',
        data: {
          types,
          games,
          timestamp: new Date().toISOString()
        }
      });

      logger.debug(`User ${userId} unsubscribed from notifications: types=${types.join(',')} games=${games.join(',')}`);

    } catch (error) {
      logger.error('Error handling notification unsubscribe:', error);
      this.sendError(userId, 'Failed to unsubscribe from notifications');
    }
  }

  /**
   * Handle notification acknowledgment
   * @param {string} userId - User ID
   * @param {Object} payload - Acknowledgment data
   */
  async handleAcknowledge(userId, payload) {
    try {
      const { notificationId, action = 'received' } = payload;

      // Mark notification as acknowledged in cache
      this.notificationService.markAsDelivered(userId, notificationId);

      // Send confirmation
      this.sendToUser(userId, {
        type: 'notification:acknowledged',
        data: {
          notificationId,
          action,
          timestamp: new Date().toISOString()
        }
      });

      logger.debug(`User ${userId} acknowledged notification ${notificationId} with action: ${action}`);

    } catch (error) {
      logger.error('Error handling notification acknowledgment:', error);
      this.sendError(userId, 'Failed to acknowledge notification');
    }
  }

  /**
   * Handle get notification history request
   * @param {string} userId - User ID
   * @param {Object} payload - Request data
   */
  async handleGetHistory(userId, payload) {
    try {
      const { limit = 20, unreadOnly = false, types = [] } = payload;

      // Get cached notifications
      let notifications = this.notificationService.getCachedNotifications(userId, { limit: 100, unreadOnly });

      // Filter by types if specified
      if (types.length > 0) {
        notifications = notifications.filter(n => types.includes(n.type));
      }

      // Limit results
      notifications = notifications.slice(0, limit);

      // Send response
      this.sendToUser(userId, {
        type: 'notification:history',
        data: {
          notifications,
          count: notifications.length,
          timestamp: new Date().toISOString()
        }
      });

      logger.debug(`Sent ${notifications.length} notification history items to user ${userId}`);

    } catch (error) {
      logger.error('Error handling get notification history:', error);
      this.sendError(userId, 'Failed to get notification history');
    }
  }

  /**
   * Handle mark as read request
   * @param {string} userId - User ID
   * @param {Object} payload - Mark as read data
   */
  async handleMarkAsRead(userId, payload) {
    try {
      const { notificationIds = [] } = payload;

      // Update cached notifications
      const cacheKey = `notifications:${userId}`;
      let notifications = cache.get(cacheKey) || [];

      let updatedCount = 0;
      notifications = notifications.map(n => {
        if (notificationIds.includes(n.id) || notificationIds.includes(n._id)) {
          updatedCount++;
          return { ...n, isRead: true, readAt: new Date().toISOString() };
        }
        return n;
      });

      // Update cache
      cache.set(cacheKey, notifications, 604800);

      // Update unread count
      const unreadCount = notifications.filter(n => !n.isRead).length;
      cache.set(`notifications:${userId}:unread`, unreadCount, 604800);

      // Send response
      this.sendToUser(userId, {
        type: 'notification:marked_read',
        data: {
          notificationIds,
          updatedCount,
          unreadCount,
          timestamp: new Date().toISOString()
        }
      });

      // Send unread count update
      await this.notificationService.sendUnreadCount(userId, unreadCount);

      logger.debug(`Marked ${updatedCount} notifications as read for user ${userId}`);

    } catch (error) {
      logger.error('Error handling mark as read:', error);
      this.sendError(userId, 'Failed to mark notifications as read');
    }
  }

  /**
   * Handle get unread count request
   * @param {string} userId - User ID
   */
  async handleGetUnreadCount(userId) {
    try {
      const unreadCount = cache.get(`notifications:${userId}:unread`) || 0;

      this.sendToUser(userId, {
        type: 'notification:unread_count',
        data: {
          count: unreadCount,
          timestamp: new Date().toISOString()
        }
      });

      logger.debug(`Sent unread count ${unreadCount} to user ${userId}`);

    } catch (error) {
      logger.error('Error handling get unread count:', error);
      this.sendError(userId, 'Failed to get unread count');
    }
  }

  /**
   * Handle notification test request (for debugging)
   * @param {string} userId - User ID
   * @param {Object} payload - Test data
   */
  async handleTestNotification(userId, payload) {
    try {
      const { message = 'Test notification', type = 'info' } = payload;

      const testNotification = {
        id: `test_${Date.now()}`,
        title: 'Test Notification',
        message,
        type,
        priority: 'normal',
        timestamp: new Date().toISOString()
      };

      // Send via notification service
      await this.notificationService.sendNotification(userId, testNotification, { persistent: false });

      logger.debug(`Sent test notification to user ${userId}`);

    } catch (error) {
      logger.error('Error handling test notification:', error);
      this.sendError(userId, 'Failed to send test notification');
    }
  }

  /**
   * Send message to user
   * @param {string} userId - User ID
   * @param {Object} message - Message to send
   */
  sendToUser(userId, message) {
    return this.notificationService.sendToUser(userId, message);
  }

  /**
   * Send error message to user
   * @param {string} userId - User ID
   * @param {string} error - Error message
   */
  sendError(userId, error) {
    this.sendToUser(userId, {
      type: 'notification:error',
      error,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle user connected event
   * @param {string} userId - User ID
   */
  async handleUserConnected(userId) {
    try {
      // Send current unread count
      const unreadCount = cache.get(`notifications:${userId}:unread`) || 0;
      
      if (unreadCount > 0) {
        await this.notificationService.sendUnreadCount(userId, unreadCount);
      }

      // Send pending notifications
      await this.notificationService.handleUserConnected(userId);

      logger.debug(`Notification handler processed user ${userId} connection`);

    } catch (error) {
      logger.error('Error handling user connected in notification handler:', error);
    }
  }

  /**
   * Handle user disconnected event
   * @param {string} userId - User ID
   */
  async handleUserDisconnected(userId) {
    try {
      // Clean up any user-specific notification state if needed
      logger.debug(`User ${userId} disconnected from notifications`);

    } catch (error) {
      logger.error('Error handling user disconnected in notification handler:', error);
    }
  }

  /**
   * Get handler statistics
   */
  getStats() {
    return {
      service: 'NotificationHandler',
      ...this.notificationService.getStats()
    };
  }
}

module.exports = NotificationHandler;
