const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AcceptedProposal = require('../models/AcceptedProposal');
const Agreement = require('../models/Agreement');
const Report = require('../models/Report');
const User = require('../models/User');
const WalletLedger = require('../models/WalletLedger');
const Mediator = require('../models/Mediator');
const mongoose = require('mongoose');
const axios = require('axios');

const { sendSupportTicketNotification } = require('../services/TelegramService');

// Helper functions
function round2(v) { 
  return Math.round(Number(v) * 100) / 100; 
}

async function sendBalanceUpdate(app, userId) {
  try {
    const u = await User.findById(userId);
    const notificationService = app?.locals?.notificationService;
    if (notificationService) {
      notificationService.sendToUser(String(userId), {
        type: 'wallet:balance_updated',
        data: { 
          userId: String(userId), 
          balance: round2(u?.walletBalance || 0), 
          timestamp: new Date().toISOString() 
        }
      });
    }
  } catch (_) {}
}

async function runTx(executor) {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const res = await executor(session);
    await session.commitTransaction();
    session.endSession();
    return res;
  } catch (err) {
    if (session) { 
      try { await session.abortTransaction(); } catch (_) {} 
      session.endSession(); 
    }
    throw err;
  }
}

class BoostingChatController {

  // ✅ NOVO: Obter conversa individual
  async getConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'name email avatar')
        .populate('lastMessage');

      if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversa não encontrada' });
      }

      if (!conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }

      return res.json({ 
        success: true, 
        conversation: conversation.toObject() 
      });
    } catch (error) {
      console.error('[BoostingChatController] Erro ao obter conversa:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Erro ao buscar conversa',
        error: error.message 
      });
    }
  }

  async getAcceptedProposal(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }


      let agreement = await Agreement.findOne({ conversationId, status: { $in: ['active', 'completed'] } })
        .sort({ createdAt: -1 });


      let acceptedProposal = await AcceptedProposal.findOne({ conversationId });
      

      if (acceptedProposal && !agreement) {
        try {
          const AgreementMigration = require('../middleware/agreementMigrationMiddleware');
          agreement = await AgreementMigration.migrateProposalToAgreement(acceptedProposal);
        } catch (migrationError) {
          console.warn('Falha na migração automática:', migrationError);
        }
      }


      if (!acceptedProposal && !agreement) {
        return res.status(404).json({ 
          success: false, 
          message: 'Nenhuma proposta aceita encontrada para esta conversa' 
        });
      }


      const response = {
        success: true,

        proposal: acceptedProposal || {
          _id: agreement.acceptedProposalId,
          conversationId: agreement.conversationId,
          proposalId: agreement.proposalId,
          game: agreement.proposalSnapshot.game,
          category: agreement.proposalSnapshot.category,
          currentRank: agreement.proposalSnapshot.currentRank,
          desiredRank: agreement.proposalSnapshot.desiredRank,
          description: agreement.proposalSnapshot.description,
          price: agreement.proposalSnapshot.price,
          originalPrice: agreement.proposalSnapshot.originalPrice,
          estimatedTime: agreement.proposalSnapshot.estimatedTime,
          client: agreement.parties.client,
          booster: agreement.parties.booster,
          status: agreement.status,
          acceptedAt: agreement.createdAt,
          completedAt: agreement.completedAt,
          cancelledAt: agreement.cancelledAt
        }
      };


      if (agreement) {
        response.agreement = {
          agreementId: agreement.agreementId,
          status: agreement.status,
          version: agreement.version,
          createdAt: agreement.createdAt,
          renegotiationData: agreement.renegotiationData
        };
      }

      res.json(response);
    } catch (error) {
      console.error('Erro ao obter proposta:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async renegotiateProposal(req, res) {
    try {
      const { conversationId } = req.params;
      const { newPrice, newEstimatedTime, message } = req.body;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }


      const systemMessage = new Message({
        conversation: conversationId,
        sender: userId,
        content: `🔄 Renegociação de proposta solicitada:\n💰 Novo valor: R$ ${newPrice}\n⏱️ Novo prazo: ${newEstimatedTime}\n📝 Observação: ${message || 'Nenhuma'}`,
        type: 'system',
        metadata: {
          type: 'renegotiation',
          newPrice,
          newEstimatedTime,
          originalMessage: message
        }
      });

      await systemMessage.save();


      conversation.lastMessage = systemMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();


      const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
      
      try {
        await axios.post(`${apiUrl}/api/boosting-proposals/${conversation.proposal}/renegotiate`, {
          newPrice,
          newEstimatedTime,
          message,
          conversationId
        }, {
          headers: {
            'Authorization': req.headers.authorization
          }
        });
      } catch (apiError) {
        console.error('Erro ao notificar renegociação:', apiError);
      }

      res.json({
        success: true,
        message: 'Renegociação solicitada com sucesso',
        systemMessage
      });
    } catch (error) {
      console.error('Erro ao renegociar proposta:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async cancelService(req, res) {
    try {
      const { conversationId } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }


      const systemMessage = new Message({
        conversation: conversationId,
        sender: userId,
        content: `❌ Atendimento cancelado\n📝 Motivo: ${reason || 'Não informado'}`,
        type: 'system',
        metadata: {
          type: 'cancellation',
          reason,
          cancelledBy: userId
        }
      });

      await systemMessage.save();



      conversation.isActive = false;
      conversation.boostingStatus = 'cancelled';
      conversation.lastMessage = systemMessage._id;
      conversation.lastMessageAt = new Date();
      conversation.metadata.set('status', 'cancelled');
      conversation.metadata.set('cancelledAt', new Date());
      conversation.metadata.set('cancelledBy', userId);


      try {
        const clientId = (conversation.client?.userid && conversation.client.userid.toString)
          ? conversation.client.userid.toString()
          : (conversation.client?.userid || null);
        if (clientId) {
          let deletedFor = conversation.metadata.get('deletedFor');
          if (!Array.isArray(deletedFor)) deletedFor = [];
          if (!deletedFor.map(id => id.toString()).includes(clientId.toString())) {
            deletedFor.push(clientId.toString());
          }
          conversation.metadata.set('deletedFor', deletedFor);
        }
      } catch (_) {}

      await conversation.save();


      const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
      
      // Tenta notificar a API principal (não-bloqueante)
      try {
        const itemId = conversation.marketplaceItem || conversation.proposal;
        
        if (itemId) {
          console.log(`🔔 Tentando notificar API principal - itemId: ${itemId}`);
          
          // Tenta métodos HTTP diferentes
          let notificationSuccess = false;
          
          // Tentativa 1: PATCH (mais comum para atualizações parciais)
          try {
            await axios.patch(`${apiUrl}/api/boosting-requests/${itemId}/cancel`, {
              reason,
              conversationId,
              cancelledBy: userId
            }, {
              headers: {
                'Authorization': req.headers.authorization
              }
            });
            notificationSuccess = true;
            console.log('✅ API principal notificada com sucesso (PATCH)');
          } catch (patchError) {
            if (patchError.response?.status === 405) {
              // Tentativa 2: PUT
              try {
                await axios.put(`${apiUrl}/api/boosting-requests/${itemId}/cancel`, {
                  reason,
                  conversationId,
                  cancelledBy: userId
                }, {
                  headers: {
                    'Authorization': req.headers.authorization
                  }
                });
                notificationSuccess = true;
                console.log('✅ API principal notificada com sucesso (PUT)');
              } catch (putError) {
                if (putError.response?.status === 405) {
                  // Tentativa 3: DELETE com body (alguns endpoints usam isso)
                  try {
                    await axios.delete(`${apiUrl}/api/boosting-requests/${itemId}/cancel`, {
                      data: {
                        reason,
                        conversationId,
                        cancelledBy: userId
                      },
                      headers: {
                        'Authorization': req.headers.authorization
                      }
                    });
                    notificationSuccess = true;
                    console.log('✅ API principal notificada com sucesso (DELETE)');
                  } catch (deleteError) {
                    throw deleteError; // Se DELETE também falhou, lança erro
                  }
                } else {
                  throw putError;
                }
              }
            } else {
              throw patchError;
            }
          }
          
          if (!notificationSuccess) {
            console.warn('⚠️ Não foi possível notificar a API principal, mas o cancelamento local foi efetuado');
          }
        } else {
          console.log('ℹ️ Nenhum marketplaceItem ou proposal encontrado - notificação ignorada');
        }
      } catch (apiError) {
        // Log detalhado do erro, mas não bloqueia o cancelamento
        console.error('❌ Erro ao notificar API principal (cancelamento local mantido):', {
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          message: apiError.message,
          url: apiError.config?.url,
          method: apiError.config?.method
        });
      }


      try {
        let agreement = await Agreement.findOne({ conversationId }).sort({ createdAt: -1 });
        if (agreement && ['pending', 'active'].includes(agreement.status)) {
          const idemKey = `cancel_${conversationId}_${Date.now()}`;
          await agreement.cancel(userId, reason || '', idemKey);
        }
        let acceptedProposal = await AcceptedProposal.findOne({ conversationId });
        if (acceptedProposal) {
          try { await acceptedProposal.cancel(); } catch (_) {}

          try { await AcceptedProposal.deleteOne({ _id: acceptedProposal._id }); } catch (_) {}
        }

        try {
          conversation.acceptedProposal = undefined;
          conversation.proposal = undefined;
          await conversation.save();
        } catch (_) {}
      } catch (cleanupErr) {
        console.warn('⚠️ Erro ao cancelar/remover proposta/termo:', cleanupErr?.message || cleanupErr);
      }


      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer && typeof webSocketServer.sendToUser === 'function') {
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          const clientId = (conversation.client?.userid && conversation.client.userid.toString)
            ? conversation.client.userid.toString()
            : (conversation.client?.userid || null);
          const cancellationEvent = {
            type: 'service:cancelled',
            data: {
              conversationId,
              reason,
              cancelledBy: userId,
              boostingStatus: 'cancelled',
              isActive: false,
              deletedForClient: clientId || null,
              timestamp: new Date().toISOString()
            }
          };
          const conversationUpdated = {
            type: 'conversation:updated',
            data: {
              conversationId,
              status: 'cancelled',
              boostingStatus: 'cancelled',
              isActive: false,
              updatedAt: new Date().toISOString()
            }
          };
          participants.forEach(participantId => {
            webSocketServer.sendToUser(participantId, cancellationEvent);
            webSocketServer.sendToUser(participantId, conversationUpdated);

            try {
              const messageToSend = { ...systemMessage.toObject(), content: systemMessage.content };
              webSocketServer.sendToUser(participantId, {
                type: 'message:new',
                data: { message: messageToSend, conversationId },
                timestamp: new Date().toISOString()
              });
            } catch (_) {}
          });
        }
      } catch (wsErr) {
        console.error('❌ Erro ao emitir eventos de cancelamento:', wsErr);
      }

      res.json({
        success: true,
        message: 'Atendimento cancelado com sucesso',
        systemMessage
      });
    } catch (error) {
      console.error('Erro ao cancelar atendimento:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async confirmDelivery(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      // Buscar conversa e validar participação
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }

      // Buscar Agreement e AcceptedProposal
      let agreement = await Agreement.findOne({ conversationId });
      let acceptedProposal = await AcceptedProposal.findOne({ conversationId });
      
      // Migração automática se necessário
      if (acceptedProposal && !agreement) {
        try {
          const AgreementMigration = require('../middleware/agreementMigrationMiddleware');
          agreement = await AgreementMigration.migrateProposalToAgreement(acceptedProposal);
        } catch (migrationError) {
          console.warn('Falha na migração durante confirmDelivery:', migrationError);
        }
      }

      // Validar que existe proposta
      if (!agreement && !acceptedProposal) {
        return res.status(404).json({ success: false, message: 'Nenhum acordo encontrado para esta conversa' });
      }

      // Identificar cliente e booster
      const clientUserId = agreement?.parties?.client?.userid || acceptedProposal?.client?.userid;
      const boosterUserId = agreement?.parties?.booster?.userid || acceptedProposal?.booster?.userid;

      // Validar que apenas o cliente pode confirmar
      if (userId.toString() !== clientUserId?.toString()) {
        return res.status(403).json({ success: false, message: 'Apenas o cliente pode confirmar a entrega' });
      }

      // Extrair preço
      const rawPrice = agreement?.proposalSnapshot?.price ?? acceptedProposal?.price ?? null;
      let price = typeof rawPrice === 'string'
        ? parseFloat(rawPrice.replace(/\./g, '').replace(',', '.'))
        : (rawPrice != null ? Number(rawPrice) : null);

      if (!price || isNaN(price) || price <= 0) {
        return res.status(400).json({ success: false, message: 'Preço inválido no acordo' });
      }

      price = round2(price);
      const feePercent = 0.05;
      const feeAmount = round2(price * feePercent);
      const boosterReceives = round2(price - feeAmount);

      const formattedPrice = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
      const formattedBoosterReceives = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(boosterReceives);

      console.log('[BOOSTING] Iniciando confirmação de entrega:', {
        conversationId,
        agreementId: agreement?.agreementId || agreement?._id,
        clientId: clientUserId?.toString(),
        boosterId: boosterUserId?.toString(),
        price,
        feeAmount,
        boosterReceives
      });

      // Idempotência: verificar se já completado
      if (agreement && agreement.status === 'completed') {
        console.log(`✅ Agreement ${agreement.agreementId} já está completado - operação idempotente`);
        return res.json({
          success: true,
          message: 'Entrega já foi confirmada anteriormente',
          blocked: true,
          idempotent: true
        });
      }

      // TRANSAÇÃO ATÔMICA: Transferir saldo
      await runTx(async (session) => {
        // 1. VERIFICAR se cliente já foi debitado (escrow) ao aceitar proposta
        // Se já foi debitado, apenas registrar a liberação do escrow
        // Se não foi (boostings antigos), debitar agora
        
        const existingEscrow = await WalletLedger.findOne({
          userId: clientUserId,
          reason: 'boosting_escrow',
          'metadata.agreementId': agreement?._id?.toString() || acceptedProposal?._id?.toString()
        }).session(session);
        
        let clientBalanceBefore, clientBalanceAfter;
        
        if (existingEscrow) {
          // ✅ Cliente JÁ FOI DEBITADO ao aceitar proposta (novo fluxo)
          console.log('[BOOSTING] Cliente já foi debitado no escrow:', {
            escrowId: existingEscrow._id,
            amount: existingEscrow.amount,
            date: existingEscrow.createdAt
          });
          
          // Apenas registrar a liberação do escrow (não altera saldo)
          const clientUser = await User.findById(clientUserId).session(session);
          clientBalanceBefore = round2(clientUser.walletBalance || 0);
          clientBalanceAfter = clientBalanceBefore; // Saldo não muda
          
          // Criar registro de liberação do escrow
          await WalletLedger.create([{
            userId: clientUserId,
            txId: null,
            direction: 'debit',
            reason: 'boosting_escrow_release',
            amount: 0, // ✅ Zero porque já foi debitado no escrow
            operationId: `boosting_escrow_release:${agreement?._id || acceptedProposal?._id}`,
            balanceBefore: clientBalanceBefore,
            balanceAfter: clientBalanceAfter,
            metadata: {
              source: 'boosting',
              agreementId: agreement?._id?.toString() || null,
              conversationId: conversationId,
              boosterId: boosterUserId?.toString(),
              price: Number(price),
              feeAmount: Number(feeAmount),
              boosterReceives: Number(boosterReceives),
              feePercent: 0.05,
              type: 'boosting_service',
              serviceName: 'Serviço de Boosting',
              providerName: 'Booster',
              status: 'released', // ✅ Escrow liberado
              originalEscrowId: existingEscrow._id.toString()
            }
          }], { session });
          
          console.log('[BOOSTING] Escrow liberado (saldo não alterado)');
        } else {
          // ⚠️ Cliente NÃO FOI DEBITADO no escrow (boostings antigos ou fluxo legado)
          // Debitar agora
          console.warn('[BOOSTING] Cliente NÃO foi debitado no escrow, debitando agora (fluxo legado)');
          
          const clientUser = await User.findById(clientUserId).session(session);
          clientBalanceBefore = round2(clientUser.walletBalance || 0);
          
          // Verificar se cliente tem saldo suficiente
          if (clientBalanceBefore < price) {
            throw new Error(`Saldo insuficiente. Necessário: R$ ${price.toFixed(2)}, Disponível: R$ ${clientBalanceBefore.toFixed(2)}`);
          }
          
          clientBalanceAfter = round2(clientBalanceBefore - price);
          clientUser.walletBalance = clientBalanceAfter;
          await clientUser.save({ session });

          // Criar registro no WalletLedger (cliente - débito)
          await WalletLedger.create([{
            userId: clientUserId,
            txId: null,
            direction: 'debit',
            reason: 'boosting_payment',
            amount: price,
            operationId: `boosting_payment:${agreement?._id || acceptedProposal?._id}`,
            balanceBefore: clientBalanceBefore,
            balanceAfter: clientBalanceAfter,
            metadata: {
              source: 'boosting',
              agreementId: agreement?._id?.toString() || null,
              conversationId: conversationId,
              boosterId: boosterUserId?.toString(),
              price: Number(price),
              feeAmount: Number(feeAmount),
              boosterReceives: Number(boosterReceives),
              feePercent: 0.05,
              type: 'boosting_service',
              serviceName: 'Serviço de Boosting',
              providerName: 'Booster'
            }
          }], { session });

          console.log('[BOOSTING] Cliente debitado (fluxo legado):', {
            clientId: clientUserId?.toString(),
            amount: price,
            balanceBefore: clientBalanceBefore,
            balanceAfter: clientBalanceAfter
          });
        }

        // 2. Transferir 95% ao booster
        const boosterUser = await User.findById(boosterUserId).session(session);
        const boosterBalanceBefore = round2(boosterUser.walletBalance || 0);
        const boosterBalanceAfter = round2(boosterBalanceBefore + boosterReceives);
        boosterUser.walletBalance = boosterBalanceAfter;
        await boosterUser.save({ session });

        // Criar registro no WalletLedger (booster) - Formato idêntico ao marketplace
        const boosterLedger = await WalletLedger.create([{
          userId: boosterUserId,
          txId: null,
          direction: 'credit',
          reason: 'boosting_release',
          amount: boosterReceives,
          operationId: `boosting_release:${agreement?._id || acceptedProposal?._id}`,
          balanceBefore: boosterBalanceBefore,
          balanceAfter: boosterBalanceAfter,
          metadata: {
            source: 'boosting',
            agreementId: agreement?._id?.toString() || null,
            conversationId: conversationId,
            clientId: clientUserId?.toString(),
            price: Number(price),
            feeAmount: Number(feeAmount),
            boosterReceives: Number(boosterReceives),
            // ✅ Adicionar campos extras para compatibilidade com marketplace
            feePercent: 0.05,
            type: 'boosting_service'
          }
        }], { session });

        console.log('[BOOSTING] Saldo transferido ao booster:', {
          boosterId: boosterUserId?.toString(),
          amount: boosterReceives,
          balanceBefore: boosterBalanceBefore,
          balanceAfter: boosterBalanceAfter
        });

        // Criar log no Mediator (release) - Formato idêntico ao marketplace
        try {
          await Mediator.create([{
            eventType: 'release',
            amount: boosterReceives,
            currency: 'BRL',
            operationId: `boosting_release:${agreement?._id || acceptedProposal?._id}`,
            source: 'ZenithChatApi',
            occurredAt: new Date(),
            reference: {
              agreementId: agreement?._id || null,
              conversationId: conversationId,
              walletLedgerId: boosterLedger[0]?._id || null,
              // ✅ Adicionar campos de referência similares ao marketplace
              transactionId: null,
              asaasTransferId: null
            },
            metadata: {
              price: Number(price),
              feeAmount: Number(feeAmount),
              boosterReceives: Number(boosterReceives),
              clientId: clientUserId?.toString(),
              boosterId: boosterUserId?.toString(),
              // ✅ Adicionar campos extras para compatibilidade
              feePercent: 0.05,
              serviceType: 'boosting'
            },
            description: 'Liberação de pagamento ao booster'
          }], { session });
        } catch (_) {}

        // 3. Transferir taxa ao mediador (5%)
        if (feeAmount > 0) {
          // ✅ Buscar mediador apenas por email (igual walletRoutes.js)
          const mediatorEmail = process.env.MEDIATOR_EMAIL || 'mediador@zenith.com';
          1
          try {
            const mediatorUser = await User.findOne({ email: mediatorEmail }).session(session);
            
            if (!mediatorUser) {
              console.warn(`[BOOSTING] Mediador não encontrado (email: ${mediatorEmail}). Taxa não creditada.`);
            }

          if (mediatorUser) {
            const mediatorBalanceBefore = round2(mediatorUser.walletBalance || 0);
            const mediatorBalanceAfter = round2(mediatorBalanceBefore + feeAmount);
            mediatorUser.walletBalance = mediatorBalanceAfter;
            await mediatorUser.save({ session });

            // Criar registro no WalletLedger (mediador) - Formato idêntico ao marketplace
            const mediatorLedger = await WalletLedger.create([{
              userId: mediatorUser._id,
              txId: null,
              direction: 'credit',
              reason: 'boosting_fee',
              amount: feeAmount,
              operationId: `boosting_fee:${agreement?._id || acceptedProposal?._id}`,
              balanceBefore: mediatorBalanceBefore,
              balanceAfter: mediatorBalanceAfter,
              metadata: {
                source: 'boosting',
                agreementId: agreement?._id?.toString() || null,
                conversationId: conversationId,
                boosterId: boosterUserId?.toString(),
                clientId: clientUserId?.toString(),
                price: Number(price),
                feeAmount: Number(feeAmount),
                boosterReceives: Number(boosterReceives),
                // ✅ Adicionar campos extras para compatibilidade com marketplace
                feePercent: 0.05,
                type: 'boosting_service'
              }
            }], { session });

            console.log('[BOOSTING] Taxa transferida ao mediador:', {
              mediatorId: mediatorUser._id?.toString(),
              amount: feeAmount,
              balanceBefore: mediatorBalanceBefore,
              balanceAfter: mediatorBalanceAfter
            });

            // Criar log no Mediator (fee) - Formato idêntico ao marketplace
            try {
              await Mediator.create([{
                eventType: 'fee',
                amount: feeAmount,
                currency: 'BRL',
                operationId: `boosting_fee:${agreement?._id || acceptedProposal?._id}`,
                source: 'ZenithChatApi',
                occurredAt: new Date(),
                reference: {
                  agreementId: agreement?._id || null,
                  conversationId: conversationId,
                  walletLedgerId: mediatorLedger[0]?._id || null,
                  // ✅ Adicionar campos de referência similares ao marketplace
                  transactionId: null,
                  asaasTransferId: null
                },
                metadata: {
                  price: Number(price),
                  feeAmount: Number(feeAmount),
                  boosterReceives: Number(boosterReceives),
                  boosterId: boosterUserId?.toString(),
                  clientId: clientUserId?.toString(),
                  // ✅ Adicionar campos extras para compatibilidade
                  feePercent: 0.05,
                  serviceType: 'boosting'
                },
                description: 'Taxa de mediação (5%) creditada ao mediador - Boosting'
              }], { session });
            } catch (_) {}
          }
          } catch (mediatorError) {
            console.error('[BOOSTING] Erro ao creditar mediador:', mediatorError.message);
          }
        }

        // 4. Atualizar Agreement
        if (agreement) {
          if (agreement.status === 'active') {
            agreement.status = 'completed';
            agreement.completedAt = new Date();
            agreement.addAction('completed', userId, { completedVia: 'confirmDelivery' }, `delivery_${conversationId}_${Date.now()}`);
            await agreement.save({ session });
          }
        } else if (acceptedProposal) {
          if (acceptedProposal.status !== 'completed') {
            await acceptedProposal.complete();
          }
        }

        // 5. Atualizar Conversation
        conversation.lastMessageAt = new Date();
        conversation.boostingStatus = 'completed';
        conversation.metadata.set('status', 'delivery_confirmed');
        conversation.deliveryConfirmedAt = new Date();
        conversation.isBlocked = true;
        conversation.blockedReason = 'pedido_finalizado';
        conversation.blockedAt = new Date();
        conversation.blockedBy = userId;
        await conversation.save({ session });
      });

      // Criar mensagens do sistema (fora da transação)
      const systemMessage = new Message({
        conversation: conversationId,
        sender: userId,
        content: `✅ Entrega confirmada pelo cliente\n💰 Valor total: ${formattedPrice}\n💵 Booster recebeu: ${formattedBoosterReceives} (95%)\n💰 Taxa da plataforma: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(feeAmount)} (5%)\n🔒 Chat finalizado`,
        type: 'system',
        metadata: {
          type: 'delivery_confirmed',
          systemType: 'order_finalized',
          confirmedBy: userId,
          closedAt: new Date(),
          price: price,
          priceFormatted: formattedPrice,
          boosterReceives: boosterReceives,
          feeAmount: feeAmount
        }
      });
      await systemMessage.save();
      conversation.lastMessage = systemMessage._id;
      await conversation.save();

      // Mensagem para o booster
      if (boosterUserId) {
        const boosterMessage = new Message({
          conversation: conversationId,
          sender: userId,
          content: `🎉 Parabéns! O cliente confirmou a entrega do seu serviço.\n\n💰 Você recebeu: ${formattedBoosterReceives}\n💵 Taxa da plataforma: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(feeAmount)} (5%)\n\n🔒 Este chat foi finalizado.\n\nObrigado por usar nossa plataforma!`,
          type: 'system',
          metadata: {
            type: 'booster_notification',
            targetUser: boosterUserId,
            confirmedBy: userId,
            amountReceived: boosterReceives
          }
        });
        await boosterMessage.save();
      }

      // Notificar Main API
      const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
      try {
        const itemId = conversation.marketplaceItem || conversation.proposal;
        if (itemId) {
          await axios.post(`${apiUrl}/api/boosting-proposals/${itemId}/confirm-delivery`, {
            conversationId,
            confirmedBy: userId
          }, {
            headers: { 'Authorization': req.headers.authorization }
          });
        }
      } catch (apiError) {
        console.error('Erro ao notificar Main API:', apiError.message);
        // Não faz rollback pois a transação já foi commitada com sucesso
      }

      // Emitir eventos WebSocket
      const webSocketServer = req.app.get('webSocketServer');
      if (webSocketServer) {
        const participants = conversation.participants?.map?.(p => p.toString ? p.toString() : p) || [];
        participants.forEach(participantId => {
          webSocketServer.sendToUser(participantId, {
            type: 'boosting:delivery_confirmed',
            data: {
              conversationId,
              boostingStatus: 'completed',
              confirmedBy: userId,
              confirmedAt: new Date(),
              blocked: true,
              price: price,
              priceFormatted: formattedPrice,
              boosterReceives: boosterReceives,
              feeAmount: feeAmount
            },
            timestamp: new Date().toISOString()
          });

          // Mensagem nova
          try {
            const messageToSend = { ...systemMessage.toObject(), content: systemMessage.content };
            webSocketServer.sendToUser(participantId, {
              type: 'message:new',
              data: { message: messageToSend, conversationId },
              timestamp: new Date().toISOString()
            });
          } catch (_) {}
        });
      }

      // Atualizar saldos em tempo real via WebSocket (igual ao marketplace)
      await sendBalanceUpdate(req.app, boosterUserId);
      await sendBalanceUpdate(req.app, clientUserId); // Também notificar cliente para atualizar UI
      
      // Enviar atualização ao mediador também (se existir)
      try {
        const envId = process.env.MEDIATOR_USER_ID;
        if (envId) await sendBalanceUpdate(req.app, envId);
      } catch (_) {}
      
      // Notificações de sucesso via WebSocket (igual ao marketplace)
      try {
        const notificationService = req.app?.locals?.notificationService;
        if (notificationService) {
          notificationService.sendNotification(String(boosterUserId), {
            type: 'boosting:completed',
            title: 'Pagamento liberado',
            message: 'O cliente confirmou a entrega. Valor liberado na sua carteira.',
            data: { conversationId, agreementId: agreement?._id || agreement?.agreementId }
          });
          notificationService.sendNotification(String(clientUserId), {
            type: 'boosting:completed',
            title: 'Pedido concluído',
            message: 'Obrigado por confirmar. Pedido concluído com sucesso.',
            data: { conversationId, agreementId: agreement?._id || agreement?.agreementId }
          });
        }
      } catch (_) {}

      console.log('[BOOSTING] Confirmação de entrega concluída com sucesso');

      return res.json({
        success: true,
        message: 'Entrega confirmada e pagamento liberado com sucesso',
        blocked: true,
        data: {
          price: price,
          boosterReceives: boosterReceives,
          feeAmount: feeAmount,
          priceFormatted: formattedPrice,
          boosterReceivesFormatted: formattedBoosterReceives
        }
      });
    } catch (error) {
      console.error('[BOOSTING] Erro ao confirmar entrega:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Erro interno do servidor ao processar confirmação',
        error: error.message 
      });
    }
  }


  async reportService(req, res) {
    try {
      const { conversationId } = req.params;
      const { reason, description, type = 'other', evidence } = req.body;
      const userId = req.user?.id || req.user?._id;

      console.log('🚨 [DEBUG] Iniciando reportService...');
      console.log('   Conversation ID:', conversationId);
      console.log('   User ID:', userId);
      console.log('   Request body:', { reason, description, type, evidence });
      console.log('   Headers:', req.headers.authorization ? 'Token presente' : 'Token ausente');

      if (!userId) {
        console.log('❌ [DEBUG] Usuário não autenticado');
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }


      console.log('🔍 [DEBUG] Buscando conversa...');
      const conversation = await Conversation.findById(conversationId).populate('participants');
      
      if (!conversation) {
        console.log('❌ [DEBUG] Conversa não encontrada');
        return res.status(404).json({ success: false, message: 'Conversa não encontrada' });
      }

      console.log('✅ [DEBUG] Conversa encontrada');
      console.log('   Participants (raw):', conversation.participants);
      console.log('   Participants IDs:', conversation.participants.map(p => {
        const id = p._id ? p._id.toString() : p.toString();
        console.log(`     Participant: ${id} (type: ${typeof p}, has _id: ${!!p._id})`);
        return id;
      }));
      console.log('   Verificando se userId é participante:', userId, '(type:', typeof userId, ')');
      
      const isParticipant = conversation.isParticipant(userId);
      console.log('   É participante?', isParticipant);
      

      conversation.participants.forEach((p, index) => {
        const participantId = p._id ? p._id.toString() : p.toString();
        const match = participantId === userId.toString();
        console.log(`   Participant ${index}: ${participantId} === ${userId.toString()} ? ${match}`);
      });

      if (!isParticipant) {
        console.log('❌ [DEBUG] Usuário não é participante da conversa');
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }

      console.log('✅ [DEBUG] Usuário autorizado, continuando...');


      const acceptedProposal = await AcceptedProposal.findOne({ conversationId });


      const reporter = conversation.participants.find(p => p._id.toString() === userId.toString());
      const reported = conversation.participants.find(p => p._id.toString() !== userId.toString());

      if (!reporter || !reported) {
        return res.status(400).json({ success: false, message: 'Erro ao identificar participantes' });
      }


      let reporterData = null;
      let reportedData = null;

      try {
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
        

        try {
          const reporterResponse = await axios.get(`${apiUrl}/api/users/${reporter._id}`, {
            headers: { 'Authorization': req.headers.authorization }
          });
          reporterData = reporterResponse.data.user;
        } catch (apiError) {
          console.log('Erro ao buscar dados do denunciante:', apiError.message);
        }


        try {
          const reportedResponse = await axios.get(`${apiUrl}/api/users/${reported._id}`, {
            headers: { 'Authorization': req.headers.authorization }
          });
          reportedData = reportedResponse.data.user;
        } catch (apiError) {
          console.log('Erro ao buscar dados do denunciado:', apiError.message);
        }
      } catch (error) {
        console.log('Erro na comunicação com API principal:', error.message);
      }


      // Try to resolve a marketplace purchaseId linked to this conversation
      const resolvedPurchaseId = (() => {
        try {
          if (conversation?.marketplace?.purchaseId) {
            return conversation.marketplace.purchaseId.toString?.() || conversation.marketplace.purchaseId;
          }
          if (conversation?.metadata && typeof conversation.metadata.get === 'function') {
            return conversation.metadata.get('purchaseId') || null;
          }
          return conversation?.metadata?.purchaseId || null;
        } catch (_) { return null; }
      })();

      // If linked to a purchase, prevent duplicate ticket for the same order
      if (resolvedPurchaseId) {
        const existing = await Report.findOne({ purchaseId: resolvedPurchaseId });
        if (existing) {
          return res.status(409).json({ success: false, message: 'Já existe um ticket para este pedido', data: { reportId: existing._id } });
        }
      }

      const reportData = new Report({
        conversationId,
        purchaseId: resolvedPurchaseId || undefined,
        proposalId: acceptedProposal?._id,
        type,
        reason,
        description,
        reporter: {
          userid: reporter._id,
          name: reporterData?.name || reporter.name || 'Usuário não identificado',
          email: reporterData?.email || reporter.email,
          avatar: reporterData?.avatar || reporter.avatar,
          isVerified: reporterData?.isVerified || reporter.isVerified || false,
          totalOrders: reporterData?.totalOrders || 0,
          totalBoosts: reporterData?.totalBoosts || 0,
          rating: reporterData?.rating || 0,
          registeredAt: reporterData?.createdAt || reporter.createdAt,
          lastLoginAt: reporterData?.lastLoginAt,
          accountStatus: reporterData?.accountStatus || 'active'
        },
        reported: {
          userid: reported._id,
          name: reportedData?.name || reported.name || 'Usuário não identificado',
          email: reportedData?.email || reported.email,
          avatar: reportedData?.avatar || reported.avatar,
          isVerified: reportedData?.isVerified || reported.isVerified || false,
          totalOrders: reportedData?.totalOrders || 0,
          totalBoosts: reportedData?.totalBoosts || 0,
          rating: reportedData?.rating || 0,
          registeredAt: reportedData?.createdAt || reported.createdAt,
          lastLoginAt: reportedData?.lastLoginAt,
          accountStatus: reportedData?.accountStatus || 'active',
          previousReportsCount: reportedData?.previousReportsCount || 0,
          previousSuspensions: reportedData?.previousSuspensions || 0
        },
        contextData: {
          game: acceptedProposal?.game,
          category: acceptedProposal?.category,
          proposalValue: acceptedProposal?.price,
          startDate: acceptedProposal?.acceptedAt,
          expectedEndDate: acceptedProposal?.acceptedAt ? 
            new Date(acceptedProposal.acceptedAt.getTime() + (24 * 60 * 60 * 1000)) : 
            null,
          messagesCount: await Message.countDocuments({ conversation: conversationId }),
          conversationDuration: Math.floor((new Date() - conversation.createdAt) / (1000 * 60))
        },
        status: 'pending',
        priority: calculateReportPriority(type, reportedData?.previousReportsCount || 0)
      });

      try {
        await reportData.save();
      } catch (e) {
        if (e && (e.code === 11000 || e.code === 'E11000')) {
          return res.status(409).json({ success: false, message: 'Já existe um ticket para este pedido' });
        }
        throw e;
      }

      // Envia notificação ao Telegram com dados do cliente
      try {
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';

        // Prioriza cliente do acceptedProposal; fallback para conversation.client; se não houver, usa o reporter
        let clientUserId = null;
        try {
          if (acceptedProposal?.client?.userid) {
            clientUserId = acceptedProposal.client.userid.toString ? acceptedProposal.client.userid.toString() : String(acceptedProposal.client.userid);
          } else if (conversation?.client?.userid) {
            clientUserId = conversation.client.userid.toString ? conversation.client.userid.toString() : String(conversation.client.userid);
          } else if (reporter?._id) {
            clientUserId = reporter._id.toString ? reporter._id.toString() : String(reporter._id);
          }
        } catch (_) {}

        let clientApi = null;
        if (clientUserId) {
          try {
            const resp = await axios.get(`${apiUrl}/api/users/${clientUserId}`, {
              headers: { 'Authorization': req.headers.authorization }
            });
            clientApi = resp?.data?.user || null;
          } catch (e) {
            console.log('Erro ao buscar dados do cliente na MAIN_API (boosting report):', e?.message || e);
          }
        }

        await sendSupportTicketNotification({
          client: {
            id: clientUserId || (reporter?._id?.toString?.() || null),
            name: clientApi?.name || reporterData?.name || reporter?.name || 'Cliente',
            username: clientApi?.username || null,
            email: clientApi?.email || reporterData?.email || reporter?.email || null,
            phone: clientApi?.whatsapp || clientApi?.phone || clientApi?.phoneNumber || clientApi?.mobile || null
          },
          reporter: {
            id: reporter?._id?.toString?.() || (req.user?.id || req.user?._id),
            name: reporterData?.name || reporter?.name || 'Usuário',
            username: reporterData?.username || null,
            email: reporterData?.email || reporter?.email || null,
            phone: reporter?.phone || reporter?.phoneNumber || reporter?.whatsapp || reporter?.mobile || reporter?.phoneNormalized || reporterData?.whatsapp || reporterData?.phone || reporterData?.phoneNumber || reporterData?.mobile || null
          },
          reported: {
            id: reported?._id?.toString?.() || null,
            name: reportedData?.name || reported?.name || null,
            username: reportedData?.username || null,
            email: reportedData?.email || reported?.email || null
          },
          report: {
            id: reportData?._id?.toString?.() || null,
            type: type || 'other',
            reason,
            description
          },
          context: {
            conversationId,
            purchaseId: (() => {
              try {
                if (conversation?.marketplace?.purchaseId) return conversation.marketplace.purchaseId.toString?.() || conversation.marketplace.purchaseId;
                if (conversation?.metadata && typeof conversation.metadata.get === 'function') return conversation.metadata.get('purchaseId') || null;
              } catch (_) {}
              return null;
            })()
          }
        });
      } catch (_) {}


      await Conversation.findByIdAndUpdate(conversationId, {
        isReported: true,
        reportedAt: new Date(),
        reportedBy: userId
      });

      console.log('✅ [DEBUG] Conversa bloqueada após denúncia');


      const systemMessage = new Message({
        conversation: conversationId,
        sender: userId,
        content: `🚨 Atendimento denunciado\n📝 Motivo: ${reason}\n📄 Descrição: ${description || 'Não informada'}`,
        type: 'system',
        metadata: {
          type: 'report',
          reportId: reportData._id,
          reason,
          description,
          reportedBy: userId
        }
      });

      await systemMessage.save();


      conversation.lastMessage = systemMessage._id;
      conversation.lastMessageAt = new Date();
      conversation.boostingStatus = 'disputed';
      conversation.metadata.set('status', 'reported');
      conversation.metadata.set('reportedAt', new Date());
      conversation.metadata.set('reportedBy', userId);
      conversation.metadata.set('reportId', reportData._id);
      await conversation.save();


      try {
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithggapi.vercel.app';
        const itemId = conversation.marketplaceItem || conversation.proposal;
        
        if (itemId) {
          await axios.post(`${apiUrl}/api/reports/notification`, {
            type: 'boosting_service',
            targetId: itemId,
            conversationId,
            reportId: reportData._id,
            reason,
            description,
            reportedBy: userId,
            reportedUser: reported._id
          }, {
            headers: {
              'Authorization': req.headers.authorization
            }
          });
        }
      } catch (apiError) {
        console.log('Erro ao notificar backend sobre denúncia:', apiError.message);
      }

      res.json({
        success: true,
        message: 'Denúncia registrada com sucesso',
        reportId: reportData._id,
        systemMessage
      });
    } catch (error) {
      console.error('Erro ao registrar denúncia:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }



  async saveAcceptedProposal(req, res) {
    try {
      const { 
        conversationId, 
        proposalId, 
        proposalData,
        clientData,
        boosterData 
      } = req.body;

      const idempotencyKey = req.headers['x-idempotency-key'] || `save_${conversationId}_${proposalId}_${Date.now()}`;

      if (!conversationId || !proposalId || !proposalData) {
        return res.status(400).json({ 
          success: false, 
          message: 'Dados obrigatórios não fornecidos' 
        });
      }



      const existingProposal = await AcceptedProposal.findOne({ conversationId });
      

      const existingAgreement = await Agreement.findOne({
        'actionHistory.idempotencyKey': idempotencyKey
      });
      
      if (existingAgreement) {
        return res.json({
          success: true,
          message: 'Proposta já salva (idempotência)',
          proposalId: existingProposal?._id,
          agreementId: existingAgreement.agreementId
        });
      }


      const acceptedProposal = new AcceptedProposal({
        conversationId,
        proposalId,
        game: proposalData.game,
        category: proposalData.category,
        currentRank: proposalData.currentRank,
        desiredRank: proposalData.desiredRank,
        description: proposalData.description,
        price: proposalData.price,
        originalPrice: proposalData.originalPrice || proposalData.price,
        estimatedTime: proposalData.estimatedTime,
        client: {
          userid: clientData.userid,
          name: clientData.name,
          email: clientData.email,
          avatar: clientData.avatar,
          isVerified: clientData.isVerified || false,
          totalOrders: clientData.totalOrders || 0,
          rating: clientData.rating || 0,
          registeredAt: clientData.registeredAt
        },
        booster: {
          userid: boosterData.userid,
          name: boosterData.name,
          email: boosterData.email,
          avatar: boosterData.avatar,
          isVerified: boosterData.isVerified || false,
          rating: boosterData.rating || 0,
          totalBoosts: boosterData.totalBoosts || 0,
          completedBoosts: boosterData.completedBoosts || 0,
          specializations: boosterData.specializations || [],
          registeredAt: boosterData.registeredAt
        },
        acceptedAt: new Date()
      });


      if (!existingProposal) {
        await acceptedProposal.save();
      } else {

        acceptedProposal = null;
      }


      const agreement = new Agreement({
        conversationId,
        proposalId,
        acceptedProposalId: acceptedProposal?._id,
        
        proposalSnapshot: {
          game: proposalData.game,
          category: proposalData.category,
          currentRank: proposalData.currentRank,
          desiredRank: proposalData.desiredRank,
          description: proposalData.description,
          price: proposalData.price,
          originalPrice: proposalData.originalPrice || proposalData.price,
          estimatedTime: proposalData.estimatedTime
        },
        
        parties: {
          client: {
            userid: clientData.userid,
            name: clientData.name,
            email: clientData.email,
            avatar: clientData.avatar,
            metadata: new Map([
              ['isVerified', clientData.isVerified || false],
              ['totalOrders', clientData.totalOrders || 0],
              ['rating', clientData.rating || 0],
              ['registeredAt', clientData.registeredAt]
            ])
          },
          booster: {
            userid: boosterData.userid,
            name: boosterData.name,
            email: boosterData.email,
            avatar: boosterData.avatar,
            rating: boosterData.rating || 0,
            metadata: new Map([
              ['isVerified', boosterData.isVerified || false],
              ['totalBoosts', boosterData.totalBoosts || 0],
              ['completedBoosts', boosterData.completedBoosts || 0],
              ['specializations', boosterData.specializations || []],
              ['registeredAt', boosterData.registeredAt]
            ])
          }
        },
        
        financial: {
          totalAmount: proposalData.price,
          currency: 'BRL',
          paymentStatus: 'pending'
        },
        
        status: 'active'
      });


      agreement.addAction('created', clientData.userid, {
        proposalId,
        isMultiple: !!existingProposal
      }, idempotencyKey);

      await agreement.save();


      const conversation = await Conversation.findById(conversationId);
      if (conversation) {

        if (acceptedProposal) {
          conversation.acceptedProposal = acceptedProposal._id;
        }

        conversation.boostingStatus = 'active';
        conversation.metadata = conversation.metadata || new Map();
        conversation.metadata.set('latestAgreementId', agreement.agreementId);
        conversation.metadata.set('status', 'active');
        

        if (conversation.deliveryConfirmedAt) {
          conversation.deliveryConfirmedAt = undefined;
        }
        
        await conversation.save();
        console.log(`✅ Mensagens reativadas para nova proposta do booster na conversa ${conversationId}`);
      }

      res.json({
        success: true,
        message: existingProposal 
          ? 'Nova proposta aceita criada com sucesso (múltiplas propostas permitidas)'
          : 'Proposta aceita salva com sucesso',

        proposalId: acceptedProposal?._id || agreement._id,

        agreementId: agreement.agreementId,
        agreementStatus: agreement.status,
        isMultiple: !!existingProposal
      });
    } catch (error) {
      console.error('Erro ao salvar proposta aceita:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async getConversationStatus(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }

      const status = conversation.metadata.get('status') || 'active';
      const closingAt = conversation.metadata.get('closingAt');
      
      let timeRemaining = null;
      if (closingAt && status === 'delivery_confirmed') {
        timeRemaining = Math.max(0, Math.floor((closingAt - new Date()) / 1000));
      }

      res.json({
        success: true,
        status,
        isActive: conversation.isActive,
        isReported: conversation.isReported,
        reportedAt: conversation.reportedAt,
        reportedBy: conversation.reportedBy,
        boostingStatus: conversation.boostingStatus,
        closingAt,
        timeRemaining
      });
    } catch (error) {
      console.error('Erro ao obter status da conversa:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async unreportConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }


      await Conversation.findByIdAndUpdate(conversationId, {
        $unset: { 
          isReported: "",
          reportedAt: "",
          reportedBy: ""
        },
        $set: {
          isActive: true,
          boostingStatus: 'active'
        }
      });


      const systemMessage = new Message({
        conversation: conversationId,
        sender: userId,
        content: '🔓 Conversa desbloqueada - mensagens reativadas',
        type: 'system',
        metadata: {
          type: 'unreport',
          unblockedBy: userId,
          unblockedAt: new Date()
        }
      });

      await systemMessage.save();


      conversation.lastMessage = systemMessage._id;
      conversation.lastMessageAt = new Date();
      conversation.metadata.set('status', 'active');
      await conversation.save();

      res.json({
        success: true,
        message: 'Conversa desbloqueada com sucesso',
        systemMessage
      });

    } catch (error) {
      console.error('Erro ao desbloquear conversa:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }
}


function calculateReportPriority(type, previousReportsCount) {

  if (['fraud', 'harassment'].includes(type)) {
    return 'critical';
  }
  

  if (previousReportsCount >= 3) {
    return 'high';
  }
  
  if (previousReportsCount >= 1) {
    return 'medium';
  }
  

  if (['service_not_delivered', 'payment_issues'].includes(type)) {
    return 'high';
  }
  
  return 'medium';
}

module.exports = BoostingChatController;
