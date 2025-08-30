const express = require('express');
const router = express.Router();
const routeCache = require('../services/RouteAwareConversationCache');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Rota para obter atualizações pendentes de conversa
 * GET /api/route-cache/pending-updates
 */
router.get('/pending-updates', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Entregar atualizações pendentes
    const pendingUpdates = await routeCache.deliverPendingConversationUpdates(userId);
    
    res.json({
      success: true,
      data: {
        updates: pendingUpdates,
        count: pendingUpdates.length
      }
    });
    
    logger.debug(`Delivered ${pendingUpdates.length} pending updates to user ${userId}`);
  } catch (error) {
    logger.error('Error getting pending updates:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao obter atualizações pendentes',
      error: error.message
    });
  }
});

/**
 * Rota para confirmar recebimento de atualização
 * POST /api/route-cache/confirm-delivery
 */
router.post('/confirm-delivery', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { updateId } = req.body;
    
    if (!updateId) {
      return res.status(400).json({
        success: false,
        message: 'updateId é obrigatório'
      });
    }
    
    const confirmed = routeCache.confirmDelivery(updateId, userId);
    
    res.json({
      success: true,
      data: {
        confirmed,
        updateId
      }
    });
    
    if (confirmed) {
      logger.debug(`Delivery confirmed for update ${updateId} by user ${userId}`);
    }
  } catch (error) {
    logger.error('Error confirming delivery:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao confirmar entrega',
      error: error.message
    });
  }
});

/**
 * Rota para atualizar rota atual do usuário
 * POST /api/route-cache/update-route
 */
router.post('/update-route', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { route } = req.body;
    
    if (!route) {
      return res.status(400).json({
        success: false,
        message: 'route é obrigatório'
      });
    }
    
    routeCache.setUserRoute(userId, route);
    
    res.json({
      success: true,
      data: {
        route,
        isInChatRoute: routeCache.isUserInChatRoute(userId)
      }
    });
    
    logger.debug(`Route updated for user ${userId}: ${route}`);
  } catch (error) {
    logger.error('Error updating route:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar rota',
      error: error.message
    });
  }
});

/**
 * Rota para obter estatísticas do cache
 * GET /api/route-cache/stats
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const stats = routeCache.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao obter estatísticas',
      error: error.message
    });
  }
});

/**
 * Rota para limpar cache (admin apenas)
 * DELETE /api/route-cache/clear
 */
router.delete('/clear', auth, async (req, res) => {
  try {
    // TODO: Adicionar verificação de admin se necessário
    routeCache.clear();
    
    res.json({
      success: true,
      message: 'Cache limpo com sucesso'
    });
    
    logger.info(`Route-aware cache cleared by user ${req.user.id}`);
  } catch (error) {
    logger.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao limpar cache',
      error: error.message
    });
  }
});

module.exports = router;
