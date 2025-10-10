const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * ✅ Middleware para verificar se usuário está banido
 * Bloqueia TODAS as requisições de usuários banidos
 */
const checkBanned = async (req, res, next) => {
  try {
    // Pular verificação se não houver usuário autenticado
    if (!req.user && !req.userId) {
      return next();
    }

    const userId = req.user?._id || req.user?.id || req.userId;
    
    if (!userId) {
      return next();
    }

    // Buscar usuário no banco
    const user = await User.findById(userId).select('banned bannedAt bannedReason bannedUntil');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        banned: false
      });
    }

    // Verificar se está banido
    if (user.isBanned()) {
      const banInfo = {
        banned: true,
        bannedAt: user.bannedAt,
        bannedReason: user.bannedReason || 'Violação dos termos de uso',
        bannedUntil: user.bannedUntil,
        isPermanent: !user.bannedUntil
      };

      logger.warn(`🚫 Tentativa de acesso de usuário banido: ${userId}`, {
        userId,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        ...banInfo
      });

      return res.status(403).json({
        success: false,
        error: 'Account banned',
        message: 'Sua conta foi banida e não pode acessar este recurso.',
        ...banInfo,
        forceLogout: true // ✅ Sinal para frontend deslogar
      });
    }

    // Usuário não está banido, continuar
    next();
    
  } catch (error) {
    logger.error('Erro ao verificar banimento:', error);
    // Em caso de erro, permitir requisição (fail-open para não quebrar sistema)
    next();
  }
};

module.exports = checkBanned;
