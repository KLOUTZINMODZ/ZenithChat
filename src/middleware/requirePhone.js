const logger = require('../utils/logger');

/**
 * Middleware que bloqueia acesso se usuário não completou setup de telefone
 * Deve ser usado após middleware de autenticação (auth.js)
 */
const requirePhone = (req, res, next) => {
  try {
    // Verifica se usuário está autenticado
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticação necessária'
      });
    }

    // Verifica se requer setup de telefone
    if (req.user.requiresPhoneSetup) {
      logger.warn('Access blocked - phone setup required', {
        userId: req.user._id,
        email: req.user.email,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        message: 'Complete o cadastro adicionando seu telefone',
        requiresPhoneSetup: true,
        setupUrl: '/auth/setup-phone'
      });
    }

    // Verifica se tem telefone configurado
    if (!req.user.phone && !req.user.phoneNumber) {
      logger.warn('Access blocked - phone not configured', {
        userId: req.user._id,
        email: req.user.email,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        message: 'Telefone não configurado',
        requiresPhoneSetup: true
      });
    }

    // Tudo OK, permite acesso
    next();
  } catch (error) {
    logger.error('Error in requirePhone middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao validar requisitos',
      error: error.message
    });
  }
};

module.exports = requirePhone;
