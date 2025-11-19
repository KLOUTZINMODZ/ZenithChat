const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const emailVerificationController = require('../controllers/emailVerificationController');
const twoFactorAuthController = require('../controllers/twoFactorAuthController');
const authGoogleController = require('../../controllers/authGoogleController');
const { twoFactorLimiter } = require('../middleware/rateLimiters');
const { auth: authMiddleware } = require('../middleware/auth');


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

// ==================== EMAIL VERIFICATION ROUTES ====================

// POST /api/auth/send-verification-code - Enviar código de verificação
router.post('/send-verification-code', emailVerificationController.sendVerificationCode);

// POST /api/auth/verify-email-code - Verificar código de email
router.post('/verify-email-code', emailVerificationController.verifyEmailCode);

// POST /api/auth/resend-verification-code - Reenviar código
router.post('/resend-verification-code', emailVerificationController.resendVerificationCode);

// ==================== TWO-FACTOR AUTHENTICATION ROUTES ====================

// POST /api/auth/verify-2fa-login - Verificar código 2FA para login
// Proteções implementadas:
// - Rate limiting (3 tentativas a cada 5 minutos)
// - Comparação constant-time para prevenir timing attacks
// - Proteção contra replay attacks (tokens de uso único)
// - Bloqueio após 5 tentativas incorretas (15 minutos)
// - Logging seguro sem exposição de dados sensíveis
router.post('/verify-2fa-login', twoFactorLimiter, twoFactorAuthController.verify2FALogin);

// ==================== GOOGLE OAUTH ROUTES ====================

// POST /api/auth/google/callback - Processar callback do Google OAuth
router.post('/google/callback', authGoogleController.googleCallback);

// POST /api/auth/google/complete-registration - Completar registro com telefone
router.post('/google/complete-registration', authGoogleController.completeGoogleRegistration);

// POST /api/auth/google/link-account - Vincular conta existente ao Google (requer autenticação)
router.post('/google/link-account', authMiddleware, authGoogleController.linkGoogleAccount);

module.exports = router;
