const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new Error('No authentication token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    

    let user = await User.findById(decoded.id || decoded._id);
    

    if (!user && decoded.id) {
      user = await User.findOneAndUpdate(
        { _id: decoded.id },
        {
          _id: decoded.id,
          name: decoded.name || 'User',
          email: decoded.email || `user${decoded.id}@zenith.com`,
          lastSeen: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }

    }

    if (!user) {
      throw new Error('User not found');
    }

    req.user = user;
    req.token = token;
    req.userId = user._id.toString();

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({
      success: false,
      message: 'Please authenticate',
    });
  }
};

// Optional auth - não bloqueia se não houver token, apenas adiciona user se existir
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      // Sem token, mas permite continuar
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id || decoded._id);

    if (user) {
      req.user = user;
      req.token = token;
      req.userId = user._id.toString();
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    // Token inválido, mas permite continuar sem usuário
    req.user = null;
    next();
  }
};

module.exports = { auth, optionalAuth };
