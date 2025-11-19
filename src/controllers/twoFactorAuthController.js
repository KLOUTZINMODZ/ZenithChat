const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const TwoFactorAuth = require('../models/TwoFactorAuth');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Comparação constant-time para prevenir timing attacks
 * @param {string} a - Primeiro valor
 * @param {string} b - Segundo valor
 * @returns {boolean} - true se forem iguais
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  
  // Garantir que ambos tenham o mesmo comprimento para comparação
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  
  // Se comprimentos diferentes, ainda fazemos comparação para evitar timing leak
  if (aBuffer.length !== bBuffer.length) {
    // Compara com hash fixo para manter tempo constante
    crypto.timingSafeEqual(
      crypto.createHash('sha256').update(a).digest(),
      crypto.createHash('sha256').update(b).digest()
    );
    return false;
  }
  
  // Comparação segura contra timing attacks
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Gerar código 2FA
 * @param {string} userId - ID do usuário
 * @returns {Object} - { code, tempToken, expiresAt, record }
 */
exports.generate2FACode = async (userId) => {
  try {
    // Gerar código de 6 dígitos
    const code = crypto.randomInt(100000, 999999).toString();
    
    // Criar tempToken JWT com tipo específico
    const tempToken = jwt.sign(
      {
        userId,
        type: '2fa-pending',
        nonce: crypto.randomBytes(16).toString('hex') // Prevenir reutilização
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' } // 15 minutos de validade
    );
    
    // Hash do código para armazenamento seguro
    const hashedCode = crypto.createHash('sha256').update(code).digest('hex');
    
    // Data de expiração
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    
    // Criar registro no banco
    const twoFactorRecord = await TwoFactorAuth.create({
      userId,
      code: hashedCode,
      tempToken,
      expiresAt,
      attempts: 0,
      maxAttempts: 5
    });
    
    return {
      code, // Retornar código em texto claro apenas para envio (email/SMS)
      tempToken,
      expiresAt,
      record: twoFactorRecord
    };
  } catch (error) {
    logger.error('Error generating 2FA code:', { userId, error: error.message });
    throw new Error('Failed to generate 2FA code');
  }
};

/**
 * Verificar código 2FA - Endpoint principal
 * POST /api/auth/verify-2fa-login
 */
exports.verify2FALogin = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { code, tempToken } = req.body;
    
    // Validação de entrada
    if (!code || !tempToken) {
      // Delay artificial para prevenir timing attacks mesmo em erros
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Validar formato do código (6 dígitos)
    if (!/^\d{6}$/.test(code)) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(400).json({
        success: false,
        message: 'Invalid code format'
      });
    }
    
    // Verificar e decodificar tempToken
    let decoded;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
      
      // Verificar tipo do token
      if (decoded.type !== '2fa-pending') {
        throw new Error('Invalid token type');
      }
    } catch (error) {
      logger.warn('Invalid 2FA temp token attempt', {
        error: error.message,
        ip: req.ip
      });
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    
    // Buscar registro 2FA pelo tempToken
    const twoFactorRecord = await TwoFactorAuth.findOne({
      tempToken,
      userId: decoded.userId
    });
    
    if (!twoFactorRecord) {
      logger.warn('2FA record not found', {
        userId: decoded.userId,
        ip: req.ip
      });
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code'
      });
    }
    
    // Verificar se já foi usado (proteção contra replay attack)
    if (twoFactorRecord.used) {
      logger.warn('2FA code reuse attempt detected', {
        userId: decoded.userId,
        usedAt: twoFactorRecord.usedAt,
        ip: req.ip
      });
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(401).json({
        success: false,
        message: 'Code already used'
      });
    }
    
    // Verificar se o código expirou
    if (twoFactorRecord.isExpired()) {
      logger.info('2FA code expired', {
        userId: decoded.userId,
        expiresAt: twoFactorRecord.expiresAt
      });
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(401).json({
        success: false,
        message: 'Code expired'
      });
    }
    
    // Verificar se está bloqueado por tentativas excessivas
    if (twoFactorRecord.isLocked()) {
      logger.warn('2FA locked due to excessive attempts', {
        userId: decoded.userId,
        attempts: twoFactorRecord.attempts,
        lockedUntil: twoFactorRecord.lockedUntil,
        ip: req.ip
      });
      
      const remainingTime = Math.ceil((twoFactorRecord.lockedUntil - Date.now()) / 1000 / 60);
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Try again in ${remainingTime} minutes`
      });
    }
    
    // Hash do código fornecido para comparação
    const hashedInputCode = crypto.createHash('sha256').update(code).digest('hex');
    
    // Comparação constant-time para evitar timing attacks
    const isValidCode = constantTimeCompare(hashedInputCode, twoFactorRecord.code);
    
    if (!isValidCode) {
      // Incrementar tentativas
      await twoFactorRecord.incrementAttempts();
      
      const remainingAttempts = twoFactorRecord.maxAttempts - twoFactorRecord.attempts;
      
      logger.warn('Invalid 2FA code attempt', {
        userId: decoded.userId,
        attempts: twoFactorRecord.attempts,
        remainingAttempts,
        ip: req.ip
      });
      
      // Delay artificial para prevenir timing attacks
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
      
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code',
        remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0
      });
    }
    
    // Código válido - Marcar como usado
    await twoFactorRecord.markAsUsed();
    
    // Buscar usuário
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      logger.error('User not found after valid 2FA', {
        userId: decoded.userId
      });
      
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Verificar se usuário está banido
    if (user.isBanned()) {
      logger.warn('Banned user attempted 2FA login', {
        userId: user._id,
        bannedReason: user.bannedReason
      });
      
      return res.status(403).json({
        success: false,
        message: 'Account suspended',
        banned: true
      });
    }
    
    // Gerar token JWT de autenticação definitivo
    const authToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Token válido por 7 dias
    );
    
    // Log de sucesso (sem dados sensíveis)
    logger.info('2FA verification successful', {
      userId: user._id,
      duration: Date.now() - startTime
    });
    
    // Retornar token e dados do usuário
    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      data: {
        token: authToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar
        }
      }
    });
    
  } catch (error) {
    logger.error('Error in 2FA verification', {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Delay para prevenir timing attacks mesmo em erros
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 200));
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Invalidar todos os códigos 2FA de um usuário
 * Útil para logout ou reset de segurança
 */
exports.invalidateUserCodes = async (userId) => {
  try {
    await TwoFactorAuth.updateMany(
      { userId, used: false },
      { used: true, usedAt: new Date() }
    );
    
    logger.info('User 2FA codes invalidated', { userId });
  } catch (error) {
    logger.error('Error invalidating 2FA codes', { userId, error: error.message });
  }
};
