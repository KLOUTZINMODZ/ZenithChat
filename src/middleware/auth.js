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
    
    // Try to find user in our database first
    let user = await User.findById(decoded.id || decoded._id);
    
    // If user doesn't exist in our database, create a minimal user record
    // This allows compatibility with the main API's users
    if (!user && decoded.id) {
      user = await User.findOneAndUpdate(
        { _id: decoded.id },
        {
          _id: decoded.id,
          name: decoded.name || 'User',
          email: decoded.email || `user${decoded.id}@hacklote.com`,
          lastSeen: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
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
      error: error.message
    });
  }
};

module.exports = auth;
