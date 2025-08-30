const routeCache = require('../services/RouteAwareConversationCache');
const logger = require('../utils/logger');

/**
 * Middleware para rastrear rotas dos usuários
 * Registra quando usuários entram/saem de rotas relacionadas ao chat
 */
const routeTrackingMiddleware = (req, res, next) => {
  try {
    // Só rastrear se usuário estiver autenticado
    if (req.user && req.user.id) {
      const userId = req.user.id;
      const route = req.originalUrl || req.url;
      
      // Registrar rota atual do usuário
      routeCache.setUserRoute(userId, route);
      
      // Log apenas para rotas importantes
      if (routeCache.isChatRoute(route)) {
        logger.debug(`👤 User ${userId} entered chat route: ${route}`);
      }
    }
    
    next();
  } catch (error) {
    logger.error('Error in route tracking middleware:', error);
    next(); // Continuar mesmo com erro para não quebrar a aplicação
  }
};

/**
 * Middleware específico para WebSocket connections
 * Registra quando usuário se conecta via WebSocket
 */
const websocketRouteTracker = (userId, route = '/ws') => {
  try {
    routeCache.setUserRoute(userId, route);
    logger.debug(`🔌 WebSocket user ${userId} connected to: ${route}`);
  } catch (error) {
    logger.error('Error tracking WebSocket route:', error);
  }
};

/**
 * Função para notificar quando usuário sai da aplicação
 */
const trackUserDisconnect = (userId) => {
  try {
    routeCache.setUserRoute(userId, '/offline');
    logger.debug(`👋 User ${userId} disconnected`);
  } catch (error) {
    logger.error('Error tracking user disconnect:', error);
  }
};

module.exports = {
  routeTrackingMiddleware,
  websocketRouteTracker,
  trackUserDisconnect
};
