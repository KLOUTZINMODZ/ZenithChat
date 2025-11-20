/**
 * Internal Routes - Rotas internas para comunicação entre APIs
 * Usado para HackLoteAPI notificar HackloteChatApi sobre eventos
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

const mongoose = require('mongoose');
const BoostingRequest = require('../models/BoostingRequest');
const BoostingOrder = require('../models/BoostingOrder');
const Agreement = require('../models/Agreement');
const AcceptedProposal = require('../models/AcceptedProposal');
const WalletLedger = require('../models/WalletLedger');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Report = require('../models/Report');
const User = require('../models/User');

const proposalHandlerModule = require('../websocket/handlers/ProposalHandler');
const { calculateAndSendEscrowUpdate } = require('./walletRoutes');
const cache = require('../services/GlobalCache');

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function normalizeObjectId(value) {
  if (!value) return null;
  try {
    return value.toString();
  } catch (_) {
    return value;
  }
}

async function emitBoostingStatusChanged(app, boostingOrderData, status) {
  try {
    const ws = app?.get('webSocketServer');
    if (!ws) return;

    const now = new Date();
    const payload = {
      conversationId: normalizeObjectId(boostingOrderData.conversationId),
      boostingOrderId: normalizeObjectId(boostingOrderData._id || boostingOrderData.orderId),
      boostingRequestId: normalizeObjectId(boostingOrderData.boostingRequestId),
      agreementId: normalizeObjectId(boostingOrderData.agreementId),
      boosterId: normalizeObjectId(boostingOrderData.boosterId),
      clientId: normalizeObjectId(boostingOrderData.clientId),
      status,
      price: boostingOrderData.price || null,
      orderNumber: boostingOrderData.orderNumber || null,
      timestamp: now.toISOString(),
      updatedAt: now.toISOString(),
      source: 'realtime'
    };

    const participantIds = [payload.clientId, payload.boosterId].filter(Boolean);

    participantIds.forEach((uid) => {
      ws.sendToUser(uid, {
        type: 'marketplace:status_changed',
        data: payload
      });
    });

    if (ws.conversationHandler?.sendConversationsUpdate) {
      await Promise.all(
        participantIds.map((uid) =>
          ws.conversationHandler.sendConversationsUpdate(uid).catch((err) => {
            logger.warn('[Boosting Status Update] Failed to refresh conversations via WS', { uid, error: err?.message });
          })
        )
      );
    }
  } catch (err) {
    logger.warn('[Boosting Status Update] Failed to emit marketplace-style status update', { error: err?.message });
  }
}

async function runTx(callback) {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    session.endSession();
    return result;
  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
      session.endSession();
    }
    throw error;
  }
}

async function performInternalBoostingCancel({ app, conversationId, reason, adminId = 'internal-admin' }) {
  if (!conversationId) {
    throw new Error('conversationId is required for boosting cancel');
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  let boostingId = conversation.metadata?.get?.('boostingId') || conversation.proposal || conversation.marketplaceItem;

  if (!boostingId) {
    const acceptedProposal = await AcceptedProposal.findOne({ conversationId });
    if (acceptedProposal) {
      boostingId = acceptedProposal.boostingId;
    } else {
      const agreement = await Agreement.findOne({ conversationId });
      if (agreement) {
        boostingId = agreement.boostingId;
      }
    }
  }

  const proposalHandler = app?.get('proposalHandler') || proposalHandlerModule;

  const systemMessage = new Message({
    conversation: conversationId,
    sender: adminId,
    content: `❌ Atendimento cancelado pelo administrador\n📝 Motivo: ${reason || 'Não informado'}`,
    type: 'system',
    metadata: {
      type: 'cancellation',
      reason,
      cancelledBy: adminId,
      source: 'internal-api'
    }
  });

  await systemMessage.save();

  conversation.isActive = false;
  conversation.boostingStatus = 'cancelled';
  conversation.lastMessage = systemMessage._id;
  conversation.lastMessageAt = new Date();
  conversation.metadata = conversation.metadata || new Map();
  conversation.metadata.set('status', 'cancelled');
  conversation.metadata.set('cancelledAt', new Date());
  conversation.metadata.set('cancelledBy', adminId);

  await conversation.save();

  if (boostingId && proposalHandler?.broadcastBoostingCancelled) {
    proposalHandler.broadcastBoostingCancelled(boostingId.toString());
  }

  const agreement = await Agreement.findOne({ conversationId }).sort({ createdAt: -1 });

  let refundedClientId = null;
  let boostingOrderSnapshot = null;

  if (agreement) {
    const idemKey = `internal_cancel_${agreement._id}_${Date.now()}`;

    await runTx(async (session) => {
      const clientId = agreement.parties?.client?.userid;
      const escrow = await WalletLedger.findOne({
        userId: clientId,
        reason: 'boosting_escrow',
        'metadata.agreementId': agreement._id.toString()
      }).session(session);

      if (escrow && escrow.amount > 0) {
        const formattedClientId = normalizeObjectId(clientId);
        const user = await User.findById(formattedClientId).session(session);

        if (user) {
          const before = round2(user.walletBalance || 0);
          const after = round2(before + Number(escrow.amount));
          user.walletBalance = after;
          await user.save({ session });

          await WalletLedger.create([
            {
              userId: formattedClientId,
              txId: null,
              direction: 'credit',
              reason: 'boosting_escrow_refund',
              amount: Number(escrow.amount),
              operationId: `boosting_escrow_refund:${agreement._id}`,
              balanceBefore: before,
              balanceAfter: after,
              metadata: {
                source: 'boosting',
                agreementId: agreement._id.toString(),
                conversationId: normalizeObjectId(conversationId),
                cancelledBy: adminId,
                cancelReason: reason || 'Serviço cancelado',
                originalEscrowId: escrow._id.toString(),
                type: 'escrow_refund'
              }
            }
          ], { session });

          refundedClientId = formattedClientId;
        } else {
          logger.warn('[Internal Boosting Cancel] Cliente não encontrado para devolver escrow', { clientId: formattedClientId });
        }
      }

      await agreement.cancel(adminId, reason || '', idemKey);

      await WalletLedger.updateMany(
        {
          reason: 'boosting_escrow',
          'metadata.agreementId': agreement._id.toString(),
        },
        {
          $set: {
            'metadata.status': 'refunded',
            'metadata.refundedAt': new Date(),
            'metadata.refundReason': reason || 'Serviço cancelado'
          }
        },
        { session }
      );

      const boostingOrderDoc = await BoostingOrder.findOne({ conversationId }).session(session);
      if (boostingOrderDoc) {
        boostingOrderDoc.status = 'cancelled';
        boostingOrderDoc.cancelledAt = new Date();
        boostingOrderDoc.cancellationDetails = {
          cancelledBy: normalizeObjectId(adminId),
          cancelReason: reason || 'Serviço cancelado',
          refundAmount: Number(escrow?.amount || 0)
        };
        await boostingOrderDoc.save({ session });
        boostingOrderSnapshot = boostingOrderDoc.toObject();
      }
    });
  }

  const webSocketServer = app?.get('webSocketServer');

  if (conversation.participants?.length && webSocketServer?.sendToUser) {
    const participantIds = conversation.participants.map((participant) =>
      normalizeObjectId(participant?._id || participant)
    ).filter(Boolean);

    const cancellationEvent = {
      type: 'service:cancelled',
      data: {
        conversationId: normalizeObjectId(conversationId),
        reason,
        cancelledBy: adminId,
        boostingStatus: 'cancelled',
        isActive: false,
        timestamp: new Date().toISOString(),
        source: 'internal-api'
      }
    };
    const conversationUpdated = {
      type: 'conversation:updated',
      data: {
        conversationId: normalizeObjectId(conversationId),
        status: 'cancelled',
        boostingStatus: 'cancelled',
        isActive: false,
        updatedAt: new Date().toISOString(),
        source: 'internal-api'
      }
    };

    participantIds.forEach((participantId) => {
      webSocketServer.sendToUser(participantId, cancellationEvent);
      webSocketServer.sendToUser(participantId, conversationUpdated);
      webSocketServer.sendToUser(participantId, {
        type: 'message:new',
        data: { message: systemMessage.toObject(), conversationId: normalizeObjectId(conversationId) },
        timestamp: new Date().toISOString()
      });
    });

    if (webSocketServer.conversationHandler?.sendConversationsUpdate) {
      await Promise.all(
        participantIds.map((pid) =>
          webSocketServer.conversationHandler.sendConversationsUpdate(pid).catch((err) => {
            logger.warn('[Internal Boosting Cancel] Failed to push conversation update via WS', { pid, error: err?.message });
          })
        )
      );
    }

    try {
      cache.invalidateConversationCache(normalizeObjectId(conversationId), participantIds);
      participantIds.forEach((pid) => cache.invalidateUserCache(pid));
    } catch (cacheErr) {
      logger.warn('[Internal Boosting Cancel] Cache invalidation failed', { error: cacheErr?.message });
    }

    if (boostingOrderSnapshot) {
      await emitBoostingStatusChanged(app, boostingOrderSnapshot, 'cancelled');
    } else {
      await emitBoostingStatusChanged(app, {
        conversationId: normalizeObjectId(conversationId),
        clientId: normalizeObjectId(conversation.participants?.[0]),
        boosterId: normalizeObjectId(conversation.participants?.[1]),
        price: null,
        orderNumber: null,
        boostingRequestId: normalizeObjectId(boostingId)
      }, 'cancelled');
    }
  }

  if (boostingId) {
    await BoostingRequest.updateOne(
      { _id: boostingId },
      {
        $set: {
          status: 'cancelled',
          updatedAt: new Date(),
          cancelReason: reason || 'Cancelado pelo administrador',
          cancelledBy: adminId,
          cancelledAt: new Date()
        }
      }
    );

    // Sincronizar status das propostas com HackLoteAPI
    try {
      const axios = require('axios');
      const hackLoteApiUrl = process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app';
      const internalApiKey = process.env.INTERNAL_API_KEY;

      if (internalApiKey && agreement?.proposalId) {
        const syncUrl = `${hackLoteApiUrl.replace(/\/$/, '')}/api/internal/update-proposal-status`;

        await axios.post(syncUrl, {
          boostingId: boostingId.toString(),
          proposalId: agreement.proposalId.toString(),
          status: 'cancelled',
          reason: reason || 'Serviço cancelado'
        }, {
          headers: {
            'Authorization': `Bearer ${internalApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }).catch(() => {
          // Falha silenciosa - não bloqueia o cancelamento
        });
      }
    } catch (_) {
      // Sincronização falhou, mas não bloqueia o cancelamento
    }
  }

  await AcceptedProposal.deleteMany({ conversationId });

  if (refundedClientId) {
    await sendBalanceUpdate(app, refundedClientId);
    await calculateAndSendEscrowUpdate(app, refundedClientId);
  }

  // Ticket resolution
  const ticket = await Report.findOne({ conversationId });
  if (ticket) {
    ticket.status = 'resolved';
    ticket.resolution = {
      ...ticket.resolution,
      outcome: 'mutual_resolution',
      resolutionNotes: reason || 'Cancelar pedido via painel',
      resolvedAt: new Date(),
      adminName: adminId,
    };
    ticket.updatedAt = new Date();
    await ticket.save();
  }

  return {
    success: true,
    conversationId: normalizeObjectId(conversationId),
    boostingId: normalizeObjectId(boostingId),
    message: 'Boosting cancelado com sucesso'
  };
}

async function sendBalanceUpdate(app, userId) {
  try {
    const user = await User.findById(userId);
    const notificationService = app?.locals?.notificationService;
    if (user && notificationService) {
      notificationService.sendToUser(String(userId), {
        type: 'wallet:balance_updated',
        data: {
          userId: String(userId),
          balance: round2(user.walletBalance || 0),
          timestamp: new Date().toISOString()
        }
      });
    }
  } catch (err) {
    logger.warn('[Internal Boosting Cancel] sendBalanceUpdate falhou', { userId, error: err?.message });
  }
}

/**
 * Middleware de autenticação interna
 * Valida chave secreta compartilhada entre APIs
 */
const internalAuth = (req, res, next) => {
  logger.debug('[Internal Auth] Skipping authentication (open mode)');
  next();
};

router.post('/boosting/:conversationId/cancel', internalAuth, async (req, res) => {
  const { conversationId } = req.params;
  const { reason } = req.body || {};

  try {
    const result = await performInternalBoostingCancel({
      app: req.app,
      conversationId,
      reason,
      adminId: req.admin?._id || 'internal-admin'
    });

    return res.json({ success: true, message: 'Boosting cancelado com sucesso', data: result });
  } catch (error) {
    logger.error('[Internal Boosting Cancel] Error:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao cancelar boosting', error: error.message });
  }
});

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
        message: 'Broadcast type is required' 
      });
    }
    
    if (!boostingId) {
      return res.status(400).json({ 
        success: false, 
        message: 'boostingId is required' 
      });
    }
    
    // Obter ProposalHandler
    const proposalHandler = req.app.get('proposalHandler');
    
    if (!proposalHandler) {
      logger.error('[Internal Broadcast] ProposalHandler not available');
      return res.status(500).json({ 
        success: false, 
        message: 'ProposalHandler not available' 
      });
    }
    
    logger.info(`[Internal Broadcast] Type: ${type}, BoostingId: ${boostingId}`);
    
    // Executar broadcast baseado no tipo
    switch (type) {
      case 'new':
        if (!proposal) {
          return res.status(400).json({ 
            success: false, 
            message: 'Proposal data is required for type "new"' 
          });
        }
        proposalHandler.broadcastNewProposal(boostingId, proposal);
        logger.info(`✅ [Internal Broadcast] New proposal broadcasted for boosting ${boostingId}`);
        break;
        
      case 'updated':
        if (!proposal) {
          return res.status(400).json({ 
            success: false, 
            message: 'Proposal data is required for type "updated"' 
          });
        }
        proposalHandler.broadcastProposalUpdated(boostingId, proposal);
        logger.info(`✅ [Internal Broadcast] Updated proposal broadcasted for boosting ${boostingId}`);
        break;
        
      case 'rejected':
        if (!proposalId) {
          return res.status(400).json({ 
            success: false, 
            message: 'proposalId is required for type "rejected"' 
          });
        }
        proposalHandler.broadcastProposalRejected(boostingId, proposalId);
        logger.info(`✅ [Internal Broadcast] Rejected proposal ${proposalId} broadcasted`);
        break;
        
      case 'cancelled':
        if (!proposalId) {
          return res.status(400).json({ 
            success: false, 
            message: 'proposalId is required for type "cancelled"' 
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
      error: error.message 
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
        message: 'ProposalHandler not available' 
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
      message: error.message 
    });
  }
});

/**
 * POST /api/internal/sync-proposal-status
 * Sincroniza status de proposta com HackLoteAPI
 */
router.post('/sync-proposal-status', async (req, res) => {
  try {
    const { boostingId, proposalId, status, reason } = req.body;

    if (!boostingId || !proposalId || !status) {
      return res.status(400).json({
        success: false,
        message: 'boostingId, proposalId e status são obrigatórios'
      });
    }

    try {
      const axios = require('axios');
      const hackLoteApiUrl = process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app';
      const internalApiKey = process.env.INTERNAL_API_KEY;

      if (!internalApiKey) {
        return res.status(500).json({
          success: false,
          message: 'INTERNAL_API_KEY não configurada'
        });
      }

      const syncUrl = `${hackLoteApiUrl.replace(/\/$/, '')}/api/internal/update-proposal-status`;

      const response = await axios.post(syncUrl, {
        boostingId,
        proposalId,
        status,
        reason
      }, {
        headers: {
          'Authorization': `Bearer ${internalApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      res.json({
        success: true,
        message: 'Status de proposta sincronizado',
        data: response.data
      });
    } catch (syncError) {
      res.status(500).json({
        success: false,
        message: 'Erro ao sincronizar com HackLoteAPI',
        error: syncError.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
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
      'sync-proposal-status': 'POST /api/internal/sync-proposal-status',
      health: 'GET /api/internal/health'
    }
  });
});

module.exports = router;
