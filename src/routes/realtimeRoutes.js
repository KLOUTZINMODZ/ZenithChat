const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();

function requireAdminKey(req, res, next) {
  try {
    const provided = req.headers['x-admin-key'] || req.headers['x-api-key'];
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      return res.status(500).json({ success: false, message: 'ADMIN_API_KEY not configured on server' });
    }
    if (!provided || provided !== expected) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Middleware error', error: e.message });
  }
}

// POST /api/realtime/dashboard
// Broadcast a dashboard event to all connected clients
router.post('/dashboard', requireAdminKey, async (req, res) => {
  try {
    const { type = 'dashboard:update', data = {}, excludeUserId = null } = req.body || {};
    const wsServer = req.app.get('webSocketServer');
    if (!wsServer) {
      logger.error('WebSocket server not found in app context');
      return res.status(500).json({ success: false, message: 'WebSocket server unavailable' });
    }

    const payload = {
      type,
      data,
      source: 'dashboard',
      timestamp: new Date().toISOString(),
    };

    wsServer.broadcast(payload, excludeUserId || null);
    return res.json({ success: true, message: 'Broadcast sent', payload });
  } catch (error) {
    logger.error('Error broadcasting dashboard event:', error);
    return res.status(500).json({ success: false, message: 'Broadcast failed', error: error.message });
  }
});

// GET /api/realtime/info
router.get('/info', (req, res) => {
  try {
    const wsServer = req.app.get('webSocketServer');
    const connections = wsServer?.wss?.clients?.size || 0;
    return res.json({ success: true, connections });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to get info', error: error.message });
  }
});

module.exports = router;
