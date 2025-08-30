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
    const { userIds, notification, options = {} } = req.body;

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
