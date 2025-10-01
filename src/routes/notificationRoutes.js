const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const User = require('../models/User');

function requireAdminKey(req, res, next) {
  try {
    const normalize = (v) => (v == null ? '' : String(v).trim());
    const headerPanel = normalize(req.headers['x-panel-proxy-secret']);
    const headerAdmin = normalize(req.headers['x-admin-key'] || req.headers['x-api-key']);
    const panelSecret = normalize(process.env.PANEL_PROXY_SECRET || '');
    const adminKey = normalize(process.env.ADMIN_API_KEY || '');
    const origin = normalize(req.headers.origin || req.headers.referer || '');
    const TRUSTED_ORIGINS = ['https://zenithpaineladm.vercel.app'];
    if (TRUSTED_ORIGINS.some((o) => origin.startsWith(o))) {
      return next();
    }
    if (panelSecret && headerPanel && headerPanel === panelSecret) {
      return next();
    }
    if (adminKey && headerAdmin && headerAdmin === adminKey) {
      return next();
    }
    try { require('../utils/logger').warn('[NOTIF][AUTH] Access denied: panelHeaderPresent=%s adminHeaderPresent=%s', !!headerPanel, !!headerAdmin); } catch (_) {}
    return res.status(403).json({ success: false, message: 'Acesso negado' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Erro na verificação de chave de admin', error: e?.message });
  }
}

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
router.post('/send', requireAdminKey, async (req, res) => {
  try {
    const { userIds, notification, options = {} } = req.body;

    if (!notification) {
      return res.status(400).json({ success: false, message: 'notification is required' });
    }

    let idsArray = [];
    const broadcastAll = options?.broadcastAll === true || userIds === '__all__';
    if (broadcastAll) {
      const users = await User.find({}).select('_id').lean();
      idsArray = users.map(u => String(u._id));
      if (!idsArray.length) {
        return res.status(404).json({ success: false, message: 'No users found to broadcast' });
      }
    } else {
      if (!userIds) {
        return res.status(400).json({ success: false, message: 'userIds is required when not broadcasting to all' });
      }
      idsArray = (Array.isArray(userIds) ? userIds : [userIds]).map(String);
    }

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
