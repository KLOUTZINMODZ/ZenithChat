const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');


router.post('/validate', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    res.json({
      success: true,
      data: {
        userId: decoded.id || decoded._id,
        email: decoded.email,
        name: decoded.name
      }
    });
  } catch (error) {
    logger.error('Token validation error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
});


router.get('/ws-token', async (req, res) => {
  try {
    // Panel proxy bypass: mint a service token if X-Panel-Secret is valid
    try {
      const panelSecret = req.header('X-Panel-Secret') || req.header('x-panel-secret');
      const expected = process.env.PANEL_PROXY_SECRET;
      if (expected && panelSecret && panelSecret === expected) {
        const impersonate = req.header('x-admin-user-id') || req.header('x-impersonate-user-id') || 'panel_admin';
        const payload = { id: impersonate, name: 'Panel Admin', email: null, role: 'admin' };
        const serviceToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

        const base = process.env.CHAT_PUBLIC_BASE_URL
          ? process.env.CHAT_PUBLIC_BASE_URL
              .replace(/^http:/, 'ws:')
              .replace(/^https:/, 'wss:')
              .replace(/\/$/, '')
          : `${req.secure ? 'wss' : 'ws'}://${req.get('host')}`;
        const wsUrl = `${base}/ws`;

        return res.json({
          success: true,
          data: {
            url: wsUrl,
            token: serviceToken,
            connectionString: `${wsUrl}?token=${serviceToken}`
          }
        });
      }
    } catch (_) {}

    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    jwt.verify(token, process.env.JWT_SECRET);


    const base = process.env.CHAT_PUBLIC_BASE_URL
      ? process.env.CHAT_PUBLIC_BASE_URL
          .replace(/^http:/, 'ws:')
          .replace(/^https:/, 'wss:')
          .replace(/\/$/, '')
      : `${req.secure ? 'wss' : 'ws'}://${req.get('host')}`;
    const wsUrl = `${base}/ws`;

    res.json({ success: true, data: { url: wsUrl, token: token, connectionString: `${wsUrl}?token=${token}` } });
  } catch (error) {
    logger.error('WebSocket token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
});

module.exports = router;
