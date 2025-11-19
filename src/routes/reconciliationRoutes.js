/**
 * Rotas para reconciliação de dados
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const ReconciliationService = require('../services/ReconciliationService');
const RetryQueue = require('../services/RetryQueue');

// Todas as rotas requerem autenticação
router.use(authMiddleware);

/**
 * @route GET /api/reconciliation
 * @description Informações sobre o serviço de reconciliação
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Serviço de reconciliação de dados',
    endpoints: {
      checkConsistency: 'GET /check',
      reconcileProposals: 'POST /proposals',
      findByPrice: 'GET /find-by-price/:price',
      processQueue: 'POST /process-queue'
    }
  });
});

/**
 * @route GET /api/reconciliation/check
 * @description Verificar consistência de dados sem realizar alterações
 */
router.get('/check', async (req, res) => {
  try {
    // Verificar se o usuário é admin ou superadmin
    if (!req.user.isAdmin && !req.user.isSuperadmin) {
      return res.status(403).json({
        success: false,
        message: 'Permissão negada'
      });
    }
    
    // Contagens
    const AcceptedProposal = require('../models/AcceptedProposal');
    const Agreement = require('../models/Agreement');
    const BoostingOrder = require('../models/BoostingOrder');
    const Conversation = require('../models/Conversation');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Propostas aceitas nos últimos 30 dias
    const proposalsCount = await AcceptedProposal.countDocuments({
      acceptedAt: { $gte: thirtyDaysAgo }
    });
    
    // Agreements nos últimos 30 dias
    const agreementsCount = await Agreement.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    // BoostingOrders nos últimos 30 dias
    const boostingOrdersCount = await BoostingOrder.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    // Conversas aceitas nos últimos 30 dias
    const acceptedConversationsCount = await Conversation.countDocuments({
      status: 'accepted',
      updatedAt: { $gte: thirtyDaysAgo }
    });
    
    // Tarefas pendentes na fila de retry
    const RetryTask = mongoose.model('RetryTask');
    const pendingTasks = await RetryTask.countDocuments({ status: 'pending' });
    
    res.json({
      success: true,
      data: {
        counts: {
          acceptedProposals: proposalsCount,
          agreements: agreementsCount,
          boostingOrders: boostingOrdersCount,
          acceptedConversations: acceptedConversationsCount,
          pendingRetryTasks: pendingTasks
        },
        consistency: {
          proposalsVsAgreements: proposalsCount === agreementsCount,
          agreementsVsBoostingOrders: agreementsCount === boostingOrdersCount,
          conversationsVsAgreements: acceptedConversationsCount === agreementsCount
        }
      }
    });
  } catch (error) {
    console.error('Erro ao verificar consistência:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

/**
 * @route POST /api/reconciliation/proposals
 * @description Reconciliar propostas aceitas sem agreements
 */
router.post('/proposals', async (req, res) => {
  try {
    // Verificar se o usuário é admin ou superadmin
    if (!req.user.isAdmin && !req.user.isSuperadmin) {
      return res.status(403).json({
        success: false,
        message: 'Permissão negada'
      });
    }
    
    const result = await ReconciliationService.reconcileProposalsWithoutAgreements();
    
    res.json({
      success: true,
      message: 'Reconciliação de propostas concluída',
      data: result
    });
  } catch (error) {
    console.error('Erro na reconciliação de propostas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

/**
 * @route GET /api/reconciliation/find-by-price/:price
 * @description Buscar proposta específica por preço
 */
router.get('/find-by-price/:price', async (req, res) => {
  try {
    const { price } = req.params;
    
    if (!price || isNaN(Number(price))) {
      return res.status(400).json({
        success: false,
        message: 'Preço inválido'
      });
    }
    
    const result = await ReconciliationService.findProposalByPrice(Number(price));
    
    res.json({
      success: true,
      message: result.found 
        ? `Proposta(s) encontrada(s) com preço R$ ${Number(price).toFixed(2)}` 
        : `Nenhuma proposta encontrada com preço R$ ${Number(price).toFixed(2)}`,
      data: result
    });
  } catch (error) {
    console.error('Erro ao buscar proposta por preço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

/**
 * @route POST /api/reconciliation/process-queue
 * @description Processar fila de retentativas
 */
router.post('/process-queue', async (req, res) => {
  try {
    // Verificar se o usuário é admin ou superadmin
    if (!req.user.isAdmin && !req.user.isSuperadmin) {
      return res.status(403).json({
        success: false,
        message: 'Permissão negada'
      });
    }
    
    const processed = await RetryQueue.processPendingTasks();
    
    res.json({
      success: true,
      message: `Processamento da fila concluído: ${processed} tarefas processadas`,
      data: { processed }
    });
  } catch (error) {
    console.error('Erro ao processar fila de retry:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

module.exports = router;
