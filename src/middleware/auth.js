const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const auth = async (req, res, next) => {
  try {
    // Panel/Admin bypass: X-Panel-Secret (preferred), x-admin-key, or trusted Origin
    try {
      const panelSecret = req.header('X-Panel-Secret') || req.header('x-panel-secret');
      const expectedPanel = process.env.PANEL_PROXY_SECRET;
      const adminKey = req.header('x-admin-key') || req.header('x-api-key');
      const expectedAdminKey = process.env.ADMIN_API_KEY;
      const origin = req.header('Origin') || '';
      const referer = req.header('Referer') || '';
      const allowedOrigins = (process.env.PANEL_ALLOWED_ORIGINS || 'https://zenithpaineladm.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
      const originTrusted = (!!origin && allowedOrigins.some(o => origin.startsWith(o))) || (!!referer && allowedOrigins.some(o => referer.startsWith(o)));

      if ((expectedPanel && panelSecret && panelSecret === expectedPanel) ||
          (expectedAdminKey && adminKey && adminKey === expectedAdminKey) ||
          originTrusted) {
        req.isAdminPanel = true;
        const impersonate = req.header('x-admin-user-id') || req.header('x-impersonate-user-id') || 'panel_admin';
        req.user = { _id: impersonate, id: impersonate, name: 'Panel Admin' };
        req.userId = impersonate;
        req.token = null;
        return next();
      }
    } catch (_) {}

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

module.exports = { auth };
