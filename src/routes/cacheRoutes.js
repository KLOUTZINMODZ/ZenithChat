const express = require('express');
const logger = require('../utils/logger');
const paymentCacheService = require('../services/paymentCacheService');
const router = express.Router();

/**
 * Middleware de autenticação simples para cache endpoints
 */
const authenticateCache = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const source = req.headers['x-cache-source'];
  

  if (source !== 'ZenithAPI') {
    return res.status(401).json({
      success: false,
    });
  }
  

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    if (token !== process.env.VERCEL_API_SECRET && token !== process.env.JWT_SECRET) {
      return res.status(401).json({
        success: false,
      });
    }
  }
  
  next();
};

/**
 * @route   POST /api/cache/marketplace-items
 * @desc    Cache items do marketplace antes do pagamento
 * @access  Internal
 */
router.post('/marketplace-items', authenticateCache, async (req, res) => {
  try {
    logger.info('📥 Recebendo itens para cache:', {
      externalReference: req.body.externalReference,
      itemsCount: req.body.items?.length || 0
    });
    
    const { externalReference, items, timestamp } = req.body;
    

    if (!externalReference || !items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
      });
    }
    

    const cached = paymentCacheService.storeMarketplaceItems(externalReference, items);
    
    logger.info('Itens armazenados no cache com sucesso:', {
      externalReference: cached.externalReference,
      itemsCount: cached.items.length,
      userId: cached.userId
    });
    
    return res.status(200).json({
      success: true,
      message: 'Itens armazenados no cache com sucesso',
      data: {
        externalReference: cached.externalReference,
        itemsCount: cached.items.length,
        userId: cached.userId,
        timestamp: cached.timestamp
      }
    });
    
  } catch (error) {
    logger.error('❌ Erro ao armazenar itens no cache:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao armazenar cache',
    });
  }
});

/**
 * @route   GET /api/cache/marketplace-items/:externalReference
 * @desc    Buscar itens do marketplace no cache
 * @access  Internal
 */
router.get('/marketplace-items/:externalReference', authenticateCache, async (req, res) => {
  try {
    const { externalReference } = req.params;
    
    logger.info('🔍 Buscando itens no cache:', { externalReference });
    
    const cached = paymentCacheService.getMarketplaceItems(externalReference);
    
    if (!cached) {
      logger.warn('⚠️ Itens não encontrados no cache:', { externalReference });
      return res.status(404).json({
        success: false,
      });
    }
    
    logger.info('Itens encontrados no cache:', {
      externalReference: cached.externalReference,
      itemsCount: cached.items.length
    });
    
    return res.status(200).json({
      success: true,
      message: 'Itens encontrados no cache',
      data: cached
    });
    
  } catch (error) {
    logger.error('❌ Erro ao buscar itens no cache:', error);
    return res.status(500).json({
      success: false,
    });
  }
});

/**
 * @route   GET /api/cache/stats
 * @desc    Estatísticas do sistema de cache
 * @access  Internal
 */
router.get('/stats', authenticateCache, async (req, res) => {
  try {
    const stats = paymentCacheService.getStats();
    
    return res.status(200).json({
      success: true,
      message: 'Estatísticas do cache obtidas com sucesso',
      data: stats
    });
    
  } catch (error) {
    logger.error('❌ Erro ao obter estatísticas do cache:', error);
    return res.status(500).json({
      success: false,
    });
  }
});

/**
 * @route   POST /api/cache/retry-highlights
 * @desc    Forçar retry de highlights pendentes
 * @access  Internal
 */
router.post('/retry-highlights', authenticateCache, async (req, res) => {
  try {
    const { paymentId } = req.body;
    
    if (paymentId) {

      const highlightRetryService = require('../services/highlightRetryService');
      const success = await highlightRetryService.forceRetry(paymentId);
      
      return res.status(200).json({
        success: true,
        message: success ? 'Retry executado com sucesso' : 'Falha no retry',
        data: { paymentId, retrySuccess: success }
      });
    } else {

      const highlightRetryService = require('../services/highlightRetryService');
      await highlightRetryService.processRetries();
      
      return res.status(200).json({
        success: true,
      });
    }
    
  } catch (error) {
    logger.error('❌ Erro ao processar retries:', error);
    return res.status(500).json({
      success: false,
    });
  }
});

/**
 * @route   GET /api/cache/user/:userId
 * @desc    Buscar todos os dados de cache por usuário
 * @access  Internal
 */
router.get('/user/:userId', authenticateCache, async (req, res) => {
  try {
    const { userId } = req.params;
    
    logger.info('🔍 Buscando dados de cache por usuário:', { userId });
    
    const results = paymentCacheService.searchByUserId(userId);
    
    return res.status(200).json({
      success: true,
      message: 'Dados do usuário obtidos com sucesso',
      data: results
    });
    
  } catch (error) {
    logger.error('❌ Erro ao buscar dados por usuário:', error);
    return res.status(500).json({
      success: false,
    });
  }
});

module.exports = router;
