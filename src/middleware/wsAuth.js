const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authenticateWebSocket = (token) => {
  try {
    if (!token) {
      throw new Error('No token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    return {
      success: true,
      userId: decoded.id || decoded._id,
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
