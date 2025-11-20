/**
 * Boosting Cancel Routes - Rotas específicas para cancelamento de boosting
 * Cada rota é responsável por atualizar uma entidade específica
 * Vinculadas ao painel administrativo para cancelamento organizado
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// ✅ Rotas públicas - sem autenticação necessária
// Chamadas diretamente do painel administrativo

/**
 * POST /api/boosting-cancel/:boostingId/cancel
 * Cancelar BoostingRequest
 */
router.post('/:boostingId/cancel', async (req, res) => {
  try {
    const { boostingId } = req.params;
    const { reason, cancelledBy } = req.body;

    if (!mongoose.Types.ObjectId.isValid(boostingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid boostingId format'
      });
    }

    const BoostingRequest = require('../models/BoostingRequest');
    
    logger.info(`[CANCEL-BOOSTING] Cancelando BoostingRequest: ${boostingId}`);

    const updated = await BoostingRequest.findByIdAndUpdate(
      boostingId,
      {
        $set: {
          status: 'cancelled',
          isActive: false,
          cancelledAt: new Date(),
          cancelledBy: cancelledBy || 'admin',
          cancelReason: reason || 'Cancelado pelo administrador',
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'BoostingRequest not found'
      });
    }

    logger.info(`[CANCEL-BOOSTING] BoostingRequest cancelado com sucesso: ${boostingId}`);

    res.json({
      success: true,
      message: 'BoostingRequest cancelled successfully',
      data: {
        boostingId: updated._id,
        status: updated.status,
        isActive: updated.isActive,
        cancelledAt: updated.cancelledAt
      }
    });
  } catch (error) {
    logger.error(`[CANCEL-BOOSTING] Erro ao cancelar BoostingRequest:`, error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling BoostingRequest',
      error: error.message
    });
  }
});

/**
 * POST /api/boosting-cancel/:boostingId/cancel/agreements
 * Cancelar Agreement relacionado ao BoostingRequest
 */
router.post('/:boostingId/cancel/agreements', async (req, res) => {
  try {
    const { boostingId } = req.params;
    const { reason, cancelledBy } = req.body;

    if (!mongoose.Types.ObjectId.isValid(boostingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid boostingId format'
      });
    }

    const Agreement = require('../models/Agreement');
    
    logger.info(`[CANCEL-AGREEMENT] Procurando Agreement para boostingRequestId: ${boostingId}`);

    const agreement = await Agreement.findOne({ boostingRequestId: boostingId });

    if (!agreement) {
      logger.warn(`[CANCEL-AGREEMENT] Nenhum Agreement encontrado para boostingId: ${boostingId}`);
      return res.status(404).json({
        success: false,
        message: 'Agreement not found for this boosting request'
      });
    }

    logger.info(`[CANCEL-AGREEMENT] Agreement encontrado: ${agreement._id}`);

    const updated = await Agreement.findByIdAndUpdate(
      agreement._id,
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: cancelledBy || 'admin',
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    logger.info(`[CANCEL-AGREEMENT] Agreement cancelado com sucesso: ${agreement._id}`);

    res.json({
      success: true,
      message: 'Agreement cancelled successfully',
      data: {
        agreementId: updated._id,
        boostingRequestId: updated.boostingRequestId,
        conversationId: updated.conversationId,
        status: updated.status,
        cancelledAt: updated.cancelledAt
      }
    });
  } catch (error) {
    logger.error(`[CANCEL-AGREEMENT] Erro ao cancelar Agreement:`, error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling Agreement',
      error: error.message
    });
  }
});

/**
 * POST /api/boosting-cancel/:boostingId/cancel/conversations
 * Cancelar Conversation relacionada ao BoostingRequest
 */
router.post('/:boostingId/cancel/conversations', async (req, res) => {
  try {
    const { boostingId } = req.params;
    const { reason, cancelledBy } = req.body;

    if (!mongoose.Types.ObjectId.isValid(boostingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid boostingId format'
      });
    }

    const Conversation = require('../models/Conversation');
    
    logger.info(`[CANCEL-CONVERSATION] Procurando Conversation para boostingId: ${boostingId}`);

    const conversation = await Conversation.findOne({
      'metadata.boostingId': boostingId
    });

    if (!conversation) {
      logger.warn(`[CANCEL-CONVERSATION] Nenhuma Conversation encontrada para boostingId: ${boostingId}`);
      return res.status(404).json({
        success: false,
        message: 'Conversation not found for this boosting request'
      });
    }

    logger.info(`[CANCEL-CONVERSATION] Conversation encontrada: ${conversation._id}`);

    const updated = await Conversation.findByIdAndUpdate(
      conversation._id,
      {
        $set: {
          isActive: false,
          boostingStatus: 'cancelled',
          status: 'cancelled',
          cancelledAt: new Date(),
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    logger.info(`[CANCEL-CONVERSATION] Conversation cancelada com sucesso: ${conversation._id}`);

    res.json({
      success: true,
      message: 'Conversation cancelled successfully',
      data: {
        conversationId: updated._id,
        boostingId: boostingId,
        isActive: updated.isActive,
        boostingStatus: updated.boostingStatus,
        cancelledAt: updated.cancelledAt,
        participants: updated.participants
      }
    });
  } catch (error) {
    logger.error(`[CANCEL-CONVERSATION] Erro ao cancelar Conversation:`, error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling Conversation',
      error: error.message
    });
  }
});

/**
 * POST /api/boosting-cancel/:boostingId/cancel/broadcast
 * Fazer broadcast via WebSocket para notificar clientes em tempo real
 * Usa ProposalHandler para manter consistência com aceitação de propostas
 */
router.post('/:boostingId/cancel/broadcast', async (req, res) => {
  try {
    const { boostingId } = req.params;
    const { reason, cancelledBy } = req.body;

    if (!mongoose.Types.ObjectId.isValid(boostingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid boostingId format'
      });
    }

    const Conversation = require('../models/Conversation');
    const BoostingRequest = require('../models/BoostingRequest');
    
    logger.info(`[CANCEL-BROADCAST] Procurando Conversation para broadcast: ${boostingId}`);

    const [conversation, boostingRequest] = await Promise.all([
      Conversation.findOne({ 'metadata.boostingId': boostingId }),
      BoostingRequest.findById(boostingId)
    ]);

    if (!conversation) {
      logger.warn(`[CANCEL-BROADCAST] Nenhuma Conversation encontrada para broadcast: ${boostingId}`);
      return res.status(404).json({
        success: false,
        message: 'Conversation not found for this boosting request'
      });
    }

    logger.info(`[CANCEL-BROADCAST] Conversation encontrada: ${conversation._id}`);

    // ✅ Usar ProposalHandler para broadcast (igual a aceitação)
    const proposalHandler = req.app?.get('proposalHandler');
    const webSocketServer = req.app?.get('webSocketServer');
    
    if (proposalHandler) {
      logger.info(`[CANCEL-BROADCAST] Usando ProposalHandler para broadcast`);
      
      // Chamar método de broadcast de cancelamento de boosting
      proposalHandler.broadcastBoostingCancelled(boostingId);
      
      logger.info(`[CANCEL-BROADCAST] ProposalHandler broadcast enviado`);
    }

    // ✅ Enviar eventos estruturados via WebSocket (igual a aceitação)
    if (webSocketServer && conversation) {
      const participants = conversation.participants || [];
      
      logger.info(`[CANCEL-BROADCAST] Enviando eventos estruturados para ${participants.length} participantes`);
      
      // Evento 1: boosting:cancelled com dados completos
      const boostingCancelledEvent = {
        type: 'boosting:cancelled',
        data: {
          boostingId: boostingId,
          conversationId: conversation._id.toString(),
          message: 'Atendimento cancelado pelo administrador',
          reason: reason || 'Cancelado pelo administrador',
          cancelledBy: cancelledBy || 'admin',
          timestamp: new Date().toISOString(),
          // Dados adicionais para reidratar UI
          clientId: boostingRequest?.clientId?.toString(),
          boosterId: boostingRequest?.boosterId?.toString(),
          game: boostingRequest?.game,
          category: boostingRequest?.category,
          price: boostingRequest?.price
        }
      };

      // Evento 2: conversation:updated para refletir cancelamento
      const conversationUpdateEvent = {
        type: 'conversation:updated',
        data: {
          conversationId: conversation._id.toString(),
          status: 'cancelled',
          isActive: false,
          boostingStatus: 'cancelled',
          action: 'cancelled',
          updatedAt: new Date().toISOString(),
          conversation: {
            _id: conversation._id,
            status: 'cancelled',
            isActive: false,
            boostingStatus: 'cancelled'
          }
        }
      };

      // Enviar para todos os participantes
      participants.forEach(participantId => {
        try {
          webSocketServer.sendToUser(participantId.toString(), boostingCancelledEvent);
          webSocketServer.sendToUser(participantId.toString(), conversationUpdateEvent);
          
          logger.debug(`[CANCEL-BROADCAST] Eventos enviados para participante: ${participantId}`);
        } catch (notifyErr) {
          logger.error(`[CANCEL-BROADCAST] Erro ao notificar participante ${participantId}:`, notifyErr);
        }
      });
    }

    logger.info(`[CANCEL-BROADCAST] Broadcast concluído para boostingId: ${boostingId}`);

    res.json({
      success: true,
      message: 'Broadcast sent successfully',
      data: {
        conversationId: conversation._id,
        boostingId: boostingId,
        participantsNotified: conversation.participants?.length || 0,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error(`[CANCEL-BROADCAST] Erro ao fazer broadcast:`, error);
    res.status(500).json({
      success: false,
      message: 'Error sending broadcast',
      error: error.message
    });
  }
});

/**
 * GET /api/boosting-cancel/:boostingId/status
 * Verificar status de cancelamento
 */
router.get('/:boostingId/status', async (req, res) => {
  try {
    const { boostingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(boostingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid boostingId format'
      });
    }

    const BoostingRequest = require('../models/BoostingRequest');
    const Agreement = require('../models/Agreement');
    const Conversation = require('../models/Conversation');

    logger.info(`[CANCEL-STATUS] Verificando status de cancelamento para: ${boostingId}`);

    const [boosting, agreement, conversation] = await Promise.all([
      BoostingRequest.findById(boostingId).select('status isActive cancelledAt').lean(),
      Agreement.findOne({ boostingRequestId: boostingId }).select('status cancelledAt').lean(),
      Conversation.findOne({ 'metadata.boostingId': boostingId }).select('isActive boostingStatus status cancelledAt').lean()
    ]);

    res.json({
      success: true,
      data: {
        boostingId,
        boosting: boosting ? {
          status: boosting.status,
          isActive: boosting.isActive,
          cancelledAt: boosting.cancelledAt
        } : null,
        agreement: agreement ? {
          status: agreement.status,
          cancelledAt: agreement.cancelledAt
        } : null,
        conversation: conversation ? {
          isActive: conversation.isActive,
          boostingStatus: conversation.boostingStatus,
          status: conversation.status,
          cancelledAt: conversation.cancelledAt
        } : null,
        allCancelled: boosting?.status === 'cancelled' && 
                     agreement?.status === 'cancelled' && 
                     conversation?.isActive === false
      }
    });
  } catch (error) {
    logger.error(`[CANCEL-STATUS] Erro ao verificar status:`, error);
    res.status(500).json({
      success: false,
      message: 'Error checking cancellation status',
      error: error.message
    });
  }
});

module.exports = router;
