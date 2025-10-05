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
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }


    jwt.verify(token, process.env.JWT_SECRET);


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

// Rotas de recuperação de senha
const passwordResetController = require('../controllers/passwordResetController');

// POST /api/auth/forgot-password - Solicitar código de recuperação
router.post('/forgot-password', passwordResetController.requestPasswordReset);

// POST /api/auth/verify-reset-code - Verificar código de recuperação
router.post('/verify-reset-code', passwordResetController.verifyResetCode);

// POST /api/auth/reset-password - Redefinir senha
router.post('/reset-password', passwordResetController.resetPassword);

module.exports = router;
