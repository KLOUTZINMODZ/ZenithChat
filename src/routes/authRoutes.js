const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const emailVerificationController = require('../controllers/emailVerificationController');

router.post('/validate', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
}
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    res.json({
      success: true,
      data: {
        userId: decoded.id || decoded._id,
        email: decoded.email,
        name: decoded.name
      }
}
  } catch (error) {
    logger.error('Token validation error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
}
  }
});

router.get('/ws-token', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
}
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
}
  } catch (error) {
    logger.error('WebSocket token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
}
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

// ==================== EMAIL VERIFICATION ROUTES ====================

// POST /api/auth/send-verification-code - Enviar código de verificação
router.post('/send-verification-code', emailVerificationController.sendVerificationCode);

// POST /api/auth/verify-email-code - Verificar código de email
router.post('/verify-email-code', emailVerificationController.verifyEmailCode);

// POST /api/auth/resend-verification-code - Reenviar código
router.post('/resend-verification-code', emailVerificationController.resendVerificationCode);

module.exports = router;
