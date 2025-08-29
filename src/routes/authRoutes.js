const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

// Validate token endpoint (for testing WebSocket connection)
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

// Get WebSocket connection info
router.get('/ws-token', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Validate token
    jwt.verify(token, process.env.JWT_SECRET);

    // Prefer public base URL (e.g., ngrok) when provided
    const base = process.env.CHAT_PUBLIC_BASE_URL
      ? process.env.CHAT_PUBLIC_BASE_URL.replace(/\/$/, '')
      : `${req.secure ? 'wss' : 'ws'}://${req.get('host')}`;
    const wsUrl = `${base}/ws`;

    res.json({
      success: true,
      data: {
        url: wsUrl,
        token: token,
        connectionString: `${wsUrl}?token=${token}`
      }
    });
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
