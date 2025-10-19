/**
 * Internal Routes - Rotas internas para comunicação entre APIs
 * Usado para HackLoteAPI notificar HackloteChatApi sobre eventos
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * Middleware de autenticação interna
 * Valida chave secreta compartilhada entre APIs
 */
const internalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  
  const internalKey = process.env.INTERNAL_API_KEY;
  
  if (!internalKey) {
    logger.error('[Internal Auth] INTERNAL_API_KEY not configured in .env');
    return res.status(500).json({ 
      success: false, 
    });
  }
  
  if (!token) {
    logger.warn('[Internal Auth] No token provided');
    return res.status(401).json({ 
      success: false, 
    });
  }
  
  if (token !== internalKey) {
    logger.warn('[Internal Auth] Invalid token provided');
    return res.status(403).json({ 
      success: false, 
    });
  }
  
  logger.info('[Internal Auth] Authentication successful');
  next();
};

/**
 * POST /api/internal/proposal/broadcast
 * Endpoint para broadcast de eventos de propostas
 * 
 * Body:
 * {
 *   type: 'new' | 'updated' | 'rejected' | 'cancelled' | 'boosting_cancelled',
 *   boostingId: string,
 *   proposal?: object,
 *   proposalId?: string
 * }
 */
router.post('/proposal/broadcast', internalAuth, async (req, res) => {
  try {
    const { type, boostingId, proposal, proposalId } = req.body;
    
    // Validações
    if (!type) {
      return res.status(400).json({ 
        success: false, 
      });
    }
    
    if (!boostingId) {
      return res.status(400).json({ 
        success: false, 
      });
    }
    
    // Obter ProposalHandler
    const proposalHandler = req.app.get('proposalHandler');
    
    if (!proposalHandler) {
      logger.error('[Internal Broadcast] ProposalHandler not available');
      return res.status(500).json({ 
        success: false, 
      });
    }
    
    logger.info(`[Internal Broadcast] Type: ${type}, BoostingId: ${boostingId}`);
    
    // Executar broadcast baseado no tipo
    switch (type) {
      case 'new':
        if (!proposal) {
          return res.status(400).json({ 
            success: false, 
          });
        }
        proposalHandler.broadcastNewProposal(boostingId, proposal);
        logger.info(`✅ [Internal Broadcast] New proposal broadcasted for boosting ${boostingId}`);
        break;
        
      case 'updated':
        if (!proposal) {
          return res.status(400).json({ 
            success: false, 
          });
        }
        proposalHandler.broadcastProposalUpdated(boostingId, proposal);
        logger.info(`✅ [Internal Broadcast] Updated proposal broadcasted for boosting ${boostingId}`);
        break;
        
      case 'rejected':
        if (!proposalId) {
          return res.status(400).json({ 
            success: false, 
          });
        }
        proposalHandler.broadcastProposalRejected(boostingId, proposalId);
        logger.info(`✅ [Internal Broadcast] Rejected proposal ${proposalId} broadcasted`);
        break;
        
      case 'cancelled':
        if (!proposalId) {
          return res.status(400).json({ 
            success: false, 
          });
        }
        proposalHandler.broadcastProposalCancelled(boostingId, proposalId);
        logger.info(`✅ [Internal Broadcast] Cancelled proposal ${proposalId} broadcasted`);
        break;
        
      case 'boosting_cancelled':
        proposalHandler.broadcastBoostingCancelled(boostingId);
        logger.info(`✅ [Internal Broadcast] Boosting ${boostingId} cancellation broadcasted`);
        break;
        
      default:
        return res.status(400).json({ 
          success: false, 
          message: `Invalid broadcast type: ${type}`,
          validTypes: ['new', 'updated', 'rejected', 'cancelled', 'boosting_cancelled']
        });
    }
    
    // Obter estatísticas para logging
    const stats = proposalHandler.getStats();
    logger.info(`[Internal Broadcast] Current stats:`, stats);
    
    res.json({ 
      success: true,
      message: `Broadcast type "${type}" executed successfully`,
      stats: {
        totalBoostings: stats.totalBoostings,
        thisBoostingSubscribers: stats.boostings.find(b => b.boostingId === boostingId)?.subscribers || 0
      }
    });
    
  } catch (error) {
    logger.error('[Internal Broadcast] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error during broadcast',
    });
  }
});

/**
 * GET /api/internal/proposal/stats
 * Obter estatísticas de inscrições ativas
 */
router.get('/proposal/stats', internalAuth, (req, res) => {
  try {
    const proposalHandler = req.app.get('proposalHandler');
    
    if (!proposalHandler) {
      return res.status(500).json({ 
        success: false, 
      });
    }
    
    const stats = proposalHandler.getStats();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    logger.error('[Internal Stats] Error:', error);
    res.status(500).json({ 
      success: false, 
    });
  }
});

/**
 * GET /api/internal/health
 * Health check para monitoramento
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'HackloteChatApi - Internal Endpoints',
    timestamp: new Date().toISOString(),
    endpoints: {
      broadcast: 'POST /api/internal/proposal/broadcast',
      stats: 'GET /api/internal/proposal/stats',
      health: 'GET /api/internal/health'
    }
  });
});

module.exports = router;
