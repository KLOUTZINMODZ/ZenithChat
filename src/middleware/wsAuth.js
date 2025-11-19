const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const User = require('../models/User');

const authenticateWebSocket = async (token) => {
  try {
    if (!token) {
      throw new Error('No token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id || decoded._id;
    
    // VERIFICAR SE USUÁRIO ESTÁ BANIDO
    const user = await User.findById(userId).select('banned bannedAt bannedReason bannedUntil');
    
    if (!user) {
      throw new Error('User not found');
    }
    
    if (user.isBanned()) {
      logger.warn(`🚫 Usuário banido tentou conectar via WebSocket: ${userId}`);
      return {
        success: false,
        error: 'Account banned',
        banned: true,
        bannedReason: user.bannedReason || 'Violação dos termos de uso',
        bannedAt: user.bannedAt,
        bannedUntil: user.bannedUntil,
        forceLogout: true
      };
    }
    
    return {
      success: true,
      userId,
      user: decoded
    };
  } catch (error) {
    logger.error('WebSocket authentication failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  authenticateWebSocket
};
