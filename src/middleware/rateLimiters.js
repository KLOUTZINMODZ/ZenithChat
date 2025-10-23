const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Rate limiter genérico para APIs (300 req/min)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: parseInt(process.env.RATE_LIMIT_API_MAX) || 300,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}, endpoint: ${req.originalUrl}`);
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// Rate limiter para autenticação (5 tentativas a cada 15 minutos)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 5,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// Rate limiter para mensagens (60 mensagens/minuto por usuário)
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: parseInt(process.env.RATE_LIMIT_MESSAGE_MAX) || 60,
  keyGenerator: (req) => {
    // Rate limit por usuário autenticado, não por IP
    return req.user?.id || req.userId || req.ip;
  },
  message: {
    success: false,
    message: 'Too many messages sent. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const userId = req.user?.id || req.userId || 'unknown';
    logger.warn(`Message rate limit exceeded for user: ${userId}`);
    res.status(429).json({
      success: false,
      message: 'You are sending messages too quickly. Please wait a moment.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// Rate limiter para uploads (10 uploads/minuto)
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX) || 10,
  keyGenerator: (req) => {
    return req.user?.id || req.userId || req.ip;
  },
  message: {
    success: false,
    message: 'Too many upload attempts. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  handler: (req, res) => {
    const userId = req.user?.id || req.userId || 'unknown';
    logger.warn(`Upload rate limit exceeded for user: ${userId}`);
    res.status(429).json({
      success: false,
      message: 'Too many uploads. Please wait before uploading again.',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

// Rate limiter para ações administrativas (100 req/min)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_ADMIN_MAX) || 100,
  keyGenerator: (req) => {
    return req.user?.id || req.userId || req.ip;
  },
  message: {
    success: false,
    message: 'Too many admin requests.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter para webhooks externos (1000 req/min - mais permissivo)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX) || 1000,
  message: {
    success: false,
    message: 'Webhook rate limit exceeded.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  authLimiter,
  messageLimiter,
  uploadLimiter,
  adminLimiter,
  webhookLimiter
};
