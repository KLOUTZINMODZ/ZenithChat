const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * POST /api/notifications/send
 * Body: {
 *   userIds: string[] | string,
 *   notification: {...},
 *   options?: {...}
 * }
 *
 * Requires that server.js has set app.locals.notificationService
 */
router.post('/send', async (req, res) => {
  try {
    const { userIds, notification, options = {}, type, conversationId, recipients, data } = req.body;

    // Handle conversation update events
    if (type === 'conversation_updated' && conversationId && recipients && data) {
      logger.info(`🔄 [Notification] Handling conversation update for ${conversationId}`, { recipients, data });
      
      const notificationService = req.app.locals.notificationService;
      if (!notificationService) {
        logger.error('Notification service not initialized in app.locals');
        return res.status(500).json({ success: false, message: 'Notification service unavailable' });
      }

      // Send WebSocket event to all recipients
      const results = [];
      for (const userId of recipients) {
        try {
          const result = await notificationService.sendWebSocketEvent(userId, 'conversation:updated', {
            conversationId,
            data
          });
          results.push({ userId, success: true, result });
          logger.info(`✅ [Notification] Conversation update sent to ${userId}`);
        } catch (error) {
          logger.error(`❌ [Notification] Failed to send conversation update to ${userId}:`, error);
          results.push({ userId, success: false, error: error.message });
        }
      }

      return res.json({ success: true, results });
    }

    // Handle regular notifications
    if (!userIds || !notification) {
      return res.status(400).json({ success: false, message: 'userIds and notification are required' });
    }

    const idsArray = Array.isArray(userIds) ? userIds : [userIds];

    const notificationService = req.app.locals.notificationService;
    if (!notificationService) {
      logger.error('Notification service not initialized in app.locals');
      return res.status(500).json({ success: false, message: 'Notification service unavailable' });
    }

    const results = await notificationService.broadcastNotification(idsArray, notification, options);
    res.json({ success: true, results });
  } catch (error) {
    logger.error('Error in /api/notifications/send:', error);
    res.status(500).json({ success: false, message: 'Internal error' });
  }
});

module.exports = router;
