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

  logger.info(`[Internal Boosting Cancel] Iniciando cancelamento: conversationId=${conversationId}, reason=${reason}, adminId=${adminId}`);

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  let boostingId = conversation.metadata?.get?.('boostingId') || conversation.proposal || conversation.marketplaceItem;
  logger.info(`[Internal Boosting Cancel] Conversation encontrada, boostingId=${boostingId}`);

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

  if (boostingId && proposalHandler?.broadcastBoostingCancelled) {
    proposalHandler.broadcastBoostingCancelled(boostingId.toString());
  }

  // ✅ TRANSAÇÃO ÚNICA PARA ATUALIZAR TODAS AS 4 COLLECTIONS
  let refundedClientId = null;
  let boostingOrderSnapshot = null;
  const cancellationDate = new Date();
  const normalizedConversationId = normalizeObjectId(conversationId);
  const normalizedBoostingId = boostingId ? normalizeObjectId(boostingId) : null;
  const cancellationReason = reason || 'Serviço cancelado';
  const proposalIdFromConversation = conversation.metadata?.get?.('proposalId') || conversation.proposal || conversation.metadata?.proposalId;
  const normalizedProposalId = proposalIdFromConversation ? normalizeObjectId(proposalIdFromConversation) : null;

  try {
    await runTx(async (session) => {
      // 1️⃣ ATUALIZAR CONVERSATION (sem depender de validação de enum antiga)
      const conversationUpdate = await Conversation.updateOne(
        { _id: conversationId },
        {
          $set: {
            isActive: false,
            boostingStatus: 'cancelled',
            status: 'cancelled',
            isFinalized: true,
            lastMessage: systemMessage._id,
            lastMessageAt: cancellationDate,
            'metadata.status': 'cancelled',
            'metadata.cancelledAt': cancellationDate,
            'metadata.cancelledBy': adminId,
            'metadata.cancelReason': cancellationReason
          }
        },
        { session }
      );

      if (!conversationUpdate.matchedCount) {
        throw new Error(`Conversation ${conversationId} not found during transaction`);
      }

      // 2️⃣ ATUALIZAR AGREEMENT
      const agreement = await Agreement.findOne({ conversationId }).session(session).sort({ createdAt: -1 });
      if (agreement) {
        const idemKey = `internal_cancel_${agreement._id}_${Date.now()}`;
        
        if (!['pending', 'active'].includes(agreement.status)) {
          throw new Error(`Cannot cancel agreement in status: ${agreement.status}`);
        }
        
        agreement.status = 'cancelled';
        agreement.cancelledAt = new Date();
        agreement.addAction('cancelled', adminId, { reason: cancellationReason }, idemKey);
        await agreement.save({ session });

        // Processar escrow
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
                  cancelReason: cancellationReason,
                  originalEscrowId: escrow._id.toString(),
                  type: 'escrow_refund'
                }
              }
            ], { session });

            refundedClientId = formattedClientId;
          }
        }

        await WalletLedger.updateMany(
          {
            reason: 'boosting_escrow',
            'metadata.agreementId': agreement._id.toString(),
          },
          {
            $set: {
              'metadata.status': 'refunded',
              'metadata.refundedAt': new Date(),
              'metadata.refundReason': cancellationReason
            }
          },
          { session }
        );
      }

      // 3️⃣ ATUALIZAR ACCEPTEDPROPOSAL
      await AcceptedProposal.updateMany(
        { conversationId },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: cancellationReason,
            cancelledBy: adminId
          }
        },
        { session }
      );

      // 4️⃣ ATUALIZAR BOOSTINGREQUESTS
      if (boostingId) {
        await BoostingRequest.updateOne(
          { _id: boostingId },
          {
            $set: {
              status: 'cancelled',
              updatedAt: cancellationDate,
              cancelReason: cancellationReason,
              cancelledBy: adminId,
              cancelledAt: cancellationDate
            }
          },
          { session }
        );
      }

      // 5️⃣ ATUALIZAR BOOSTINGORDER
      const boostingOrderDoc = await BoostingOrder.findOne({ conversationId }).session(session);
      if (boostingOrderDoc) {
        boostingOrderDoc.status = 'cancelled';
        boostingOrderDoc.cancelledAt = cancellationDate;
        boostingOrderDoc.cancellationDetails = {
          cancelledBy: normalizeObjectId(adminId),
          cancelReason: cancellationReason,
          refundAmount: Number(refundedClientId ? (escrow?.amount || 0) : (escrow?.amount || 0))
        };
        await boostingOrderDoc.save({ session });
        boostingOrderSnapshot = boostingOrderDoc.toObject();
      }
    });
  } catch (txError) {
    logger.error('[Internal Boosting Cancel] Transaction failed:', txError.message);
    throw txError;
  }

  const webSocketServer = app?.get('webSocketServer');

  // ✅ Recarregar conversation para ter os dados atualizados
  const conversationUpdated = await Conversation.findById(conversationId);
  const conversationPayload = conversationUpdated ? {
    _id: conversationUpdated._id,
    status: conversationUpdated.status,
    boostingStatus: conversationUpdated.boostingStatus,
    isActive: conversationUpdated.isActive,
    isFinalized: conversationUpdated.isFinalized,
    isTemporary: conversationUpdated.isTemporary,
    metadata: conversationUpdated.metadata
  } : null;

  if (conversationUpdated?.participants?.length && webSocketServer?.sendToUser) {
    const participantIds = conversationUpdated.participants.map((participant) =>
      normalizeObjectId(participant?._id || participant)
    ).filter(Boolean);

    const cancellationEvent = {
      type: 'service:cancelled',
      data: {
        conversationId: normalizedConversationId,
        reason: cancellationReason,
        cancelledBy: adminId,
        boostingStatus: 'cancelled',
        isActive: false,
        timestamp: new Date().toISOString(),
        source: 'internal-api'
      }
    };
    const conversationUpdatedEvent = {
      type: 'conversation:updated',
      data: {
        conversationId: normalizedConversationId,
        status: 'cancelled',
        boostingStatus: 'cancelled',
        isActive: false,
        isFinalized: true,
        updatedAt: new Date().toISOString(),
        source: 'internal-api',
        cancelledAt: new Date().toISOString(),
        cancelledBy: adminId,
        reason: cancellationReason,
        action: 'status_updated',
        conversation: conversationPayload
      }
    };
    const proposalStatusEvent = normalizedProposalId ? {
      type: 'proposal:status_updated',
      data: {
        proposalId: normalizedProposalId,
        conversationId: normalizedConversationId,
        status: 'cancelled',
        boostingId: normalizedBoostingId,
        timestamp: new Date().toISOString()
      }
    } : null;

    participantIds.forEach((participantId) => {
      webSocketServer.sendToUser(participantId, cancellationEvent);
      webSocketServer.sendToUser(participantId, conversationUpdatedEvent);
      if (proposalStatusEvent) {
        webSocketServer.sendToUser(participantId, proposalStatusEvent);
      }
      webSocketServer.sendToUser(participantId, {
        type: 'message:new',
        data: { message: systemMessage.toObject(), conversationId: normalizedConversationId },
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
    } else if (conversationPayload) {
      await emitBoostingStatusChanged(app, {
        conversationId: normalizedConversationId,
        clientId: normalizeObjectId(conversationUpdated.participants?.[0]),
        boosterId: normalizeObjectId(conversationUpdated.participants?.[1]),
        price: null,
        orderNumber: null,
        boostingRequestId: normalizedBoostingId
      }, 'cancelled');
    }
  }

  if (refundedClientId) {
    logger.info(`[Internal Boosting Cancel] Enviando atualização de saldo para clientId=${refundedClientId}`);
    await sendBalanceUpdate(app, refundedClientId);
    await calculateAndSendEscrowUpdate(app, refundedClientId);
    logger.info(`[Internal Boosting Cancel] Atualização de saldo enviada com sucesso`);
  }

  // Ticket resolution
  const ticket = await Report.findOne({ conversationId });
  if (ticket) {
    logger.info(`[Internal Boosting Cancel] Resolvendo ticket: ${ticket._id}`);
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

  logger.info(`[Internal Boosting Cancel] ✅ Cancelamento concluído com sucesso: conversationId=${conversationId}`);

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
