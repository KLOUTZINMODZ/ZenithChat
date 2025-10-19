const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * Webhook para receber notificações de novas propostas da API Vercel
 * Emite eventos WebSocket em tempo real para todos os usuários inscritos
 */
router.post('/new-proposal', async (req, res) => {
  try {
    const { boostingId, proposal, secret } = req.body;
    
    // Validar secret para segurança
    if (secret !== process.env.WEBHOOK_SECRET) {
      logger.warn('❌ [Proposal Webhook] Invalid secret');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }
    
    if (!boostingId || !proposal) {
      return res.status(400).json({
        success: false,
        message: 'boostingId and proposal are required'
      });
    }
    
    logger.info(`📢 [Proposal Webhook] New proposal received for boosting: ${boostingId}`);
    logger.info(`📢 [Proposal Webhook] Proposal ID: ${proposal._id}`);
    
    // Obter WebSocket server
    const webSocketServer = req.app.get('webSocketServer');
    
    if (!webSocketServer) {
      logger.warn('⚠️ [Proposal Webhook] WebSocket server not available');
      return res.status(503).json({
        success: false,
        message: 'WebSocket server not available'
      });
    }
    
    // Obter ProposalHandler e emitir evento
    const proposalHandler = webSocketServer.getProposalHandler();
    
    if (!proposalHandler) {
      logger.warn('⚠️ [Proposal Webhook] ProposalHandler not available');
      return res.status(503).json({
        success: false,
        message: 'ProposalHandler not available'
      });
    }
    
    // Notificar todos os usuários inscritos neste boosting
    proposalHandler.notifyNewProposal(boostingId, proposal);
    
    logger.info(`✅ [Proposal Webhook] Notification sent for boosting: ${boostingId}`);
    
    return res.json({
      success: true,
      message: 'Proposal notification sent',
      boostingId,
      proposalId: proposal._id
    });
    
  } catch (error) {
    logger.error('❌ [Proposal Webhook] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * Webhook para atualização de proposta
 */
router.post('/update-proposal', async (req, res) => {
  try {
    const { boostingId, proposal, secret } = req.body;
    
    // Validar secret
    if (secret !== process.env.WEBHOOK_SECRET) {
      logger.warn('❌ [Proposal Update Webhook] Invalid secret');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }
    
    if (!boostingId || !proposal) {
      return res.status(400).json({
        success: false,
        message: 'boostingId and proposal are required'
      });
    }
    
    logger.info(`🔄 [Proposal Update Webhook] Proposal updated for boosting: ${boostingId}`);
    
    const webSocketServer = req.app.get('webSocketServer');
    
    if (!webSocketServer) {
      return res.status(503).json({
        success: false,
        message: 'WebSocket server not available'
      });
    }
    
    const proposalHandler = webSocketServer.getProposalHandler();
    
    if (!proposalHandler) {
      return res.status(503).json({
        success: false,
        message: 'ProposalHandler not available'
      });
    }
    
    // Notificar sobre atualização
    proposalHandler.notifyProposalUpdate(boostingId, proposal);
    
    logger.info(`✅ [Proposal Update Webhook] Update notification sent for boosting: ${boostingId}`);
    
    return res.json({
      success: true,
      message: 'Proposal update notification sent',
      boostingId,
      proposalId: proposal._id
    });
    
  } catch (error) {
    logger.error('❌ [Proposal Update Webhook] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
