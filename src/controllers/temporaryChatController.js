const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AcceptedProposal = require('../models/AcceptedProposal');
const WebSocketServer = require('../websocket/WebSocketServer');


function extractValidObjectId(id) {
  if (!id) return null;
  

  const cleanId = id.toString().split('_')[0];
  

  if (cleanId.length === 24 && /^[0-9a-fA-F]{24}$/.test(cleanId)) {
    return cleanId;
  }
  

  logger.warn('Invalid ID detected', { original: id, cleaned: cleanId });
  return null;
}

class TemporaryChatController {

  async createTemporaryChat(req, res) {
    // Endpoint called - removed for performance
    try {
      const {
        clientId,
        boosterId,
        proposalId,
        boostingId,
        proposalData,
        clientData,
        boosterData
      } = req.body;

      if (!clientId || !boosterId || !proposalId || !proposalData) {
        return res.status(400).json({
          success: false,
          message: 'Dados obrigatórios não fornecidos'
        });
      }



      let conversation = null;
      if (boostingId) {
        conversation = await Conversation.findOne({
          participants: { $all: [clientId, boosterId], $size: 2 },
          type: 'direct',
          'metadata.boostingId': boostingId,
          // CRITICAL: Only reuse ACTIVE conversations, not completed/expired ones
          status: { $in: ['pending', 'accepted', 'active'] },
          boostingStatus: { $nin: ['completed', 'cancelled', 'disputed'] }
        });
      }

      if (!conversation && proposalId) {
        conversation = await Conversation.findOne({
          participants: { $all: [clientId, boosterId], $size: 2 },
          type: 'direct',
          $or: [
            { 'metadata.proposalId': proposalId },
            { proposal: proposalId }
          ],
          // CRITICAL: Only reuse ACTIVE conversations, not completed/expired ones
          status: { $in: ['pending', 'accepted', 'active'] },
          boostingStatus: { $nin: ['completed', 'cancelled', 'disputed'] }
        });
      }

      if (conversation) {
        // Reusing active conversation

        const _priceValue = typeof proposalData.price === 'string'
          ? parseFloat(proposalData.price.replace(/\./g, '').replace(',', '.'))
          : Number(proposalData.price || 0);
        const _priceFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
          .format(isNaN(_priceValue) ? 0 : _priceValue);

        const proposalMessage = new Message({
          conversation: conversation._id,
          sender: boosterId,
          content: `⏳ Nova proposta temporária recebida!\n💰 Valor: ${_priceFormatted}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}\n📝 Mensagem: ${proposalData.message || 'Nenhuma'}`,
          type: 'system',
          metadata: {
            type: 'temporary_proposal',
            systemType: 'temporary_created',
            proposalId,
            price: isNaN(_priceValue) ? 0 : _priceValue,
            priceFormatted: _priceFormatted,
            date: new Date().toISOString(),
            proposalData
          }
        });

        await proposalMessage.save();


        try {
          const webSocketServer = req.app.get('webSocketServer');
          if (webSocketServer) {
            const messageToSend = { ...proposalMessage.toObject(), content: proposalMessage.content };
            const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
            participants.forEach(participantId => {
              webSocketServer.sendToUser(participantId, {
                type: 'message:new',
                data: {
                  message: messageToSend,
                  conversationId: conversation._id
                },
                timestamp: new Date().toISOString()
              });
            });
          }
        } catch (_) {}


        try {
          const notificationService = req.app.locals?.notificationService;
          if (notificationService) {
            const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
            const recipients = participants.filter(id => id.toString() !== boosterId.toString());
            for (const userId of recipients) {
              await notificationService.sendNotification(userId, {
                id: `proposal_${proposalId}`,
                title: 'Nova proposta recebida',
                message: `Valor: ${_priceFormatted} • Tempo: ${proposalData.estimatedTime}`,
                type: 'new_proposal',
                conversationId: conversation._id,
                proposalId
              }, { persistent: true });
            }
          }
        } catch (_) {}


        conversation.lastMessage = proposalMessage._id;
        conversation.lastMessageAt = new Date();
        await conversation.save();


        try {
          const wsServer = require('../websocket/WebSocketServer');
          if (wsServer && wsServer.sendToUser) {

            wsServer.sendToUser(clientId, {
              type: 'proposal:received',
              data: {
                conversationId: conversation._id,
                proposalId,
                proposalData,
                clientData,
                boosterData,
                expiresAt: conversation.expiresAt,
                timestamp: new Date().toISOString()
              }
            });
            

            wsServer.sendToUser(boosterId, {
              type: 'proposal:received',
              data: {
                conversationId: conversation._id,
                proposalId,
                proposalData,
                clientData,
                boosterData,
                expiresAt: conversation.expiresAt,
                timestamp: new Date().toISOString()
              }
            });
          }
        } catch (wsError) {
          console.error('❌ Erro ao emitir evento WebSocket:', wsError);
        }

        return res.json({
          success: true,
          message: 'Proposta adicionada à conversa existente',
          conversationId: conversation._id
        });
      }


      // Creating new temporary conversation
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);


      const User = require('../models/User');
      const clientUser = await User.findById(clientId);
      const boosterUser = await User.findById(boosterId);

      conversation = new Conversation({
        participants: [clientId, boosterId],
        type: 'direct',
        isTemporary: true,
        expiresAt: expiresAt,
        status: 'pending',
        proposal: proposalId,

        client: {
          userid: clientUser._id,
          name: clientUser.name,
          // email: clientUser.email,  // ✅ REMOVIDO - PII não deve ser salvo no banco
          avatar: clientUser.avatar,
          isVerified: clientUser.isVerified || false,
          totalOrders: clientUser.totalOrders || 0,
          rating: clientUser.rating || 0,
          registeredAt: clientUser.createdAt
        },
        booster: {
          userid: boosterUser._id,
          name: boosterUser.name,
          // email: boosterUser.email,  // ✅ REMOVIDO - PII não deve ser salvo no banco
          avatar: boosterUser.avatar,
          isVerified: boosterUser.isVerified || false,
          rating: boosterUser.rating || 0,
          totalBoosts: boosterUser.totalBoosts || 0,
          completedBoosts: boosterUser.completedBoosts || 0,
          specializations: boosterUser.specializations || [],
          registeredAt: boosterUser.createdAt
        },
        metadata: new Map([
          ['proposalData', proposalData],
          ['clientData', clientData],
          ['boosterData', boosterData],
          ['boostingId', boostingId],
          ['proposalId', proposalId]
        ])
      });

      await conversation.save();


      const _priceValue2 = typeof proposalData.price === 'string'
        ? parseFloat(proposalData.price.replace(/\./g, '').replace(',', '.'))
        : Number(proposalData.price || 0);
      const _priceFormatted2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
        .format(isNaN(_priceValue2) ? 0 : _priceValue2);

      const initialMessage = new Message({
        conversation: conversation._id,
        sender: boosterId,
        content: `⏳ Chat Temporário criado...\n💰 Proposta: ${_priceFormatted2}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}\n📝 Mensagem: ${proposalData.message || 'Nenhuma'}\n\n💡 Este chat expira em 3 dias se a proposta não for aceita.`,
        type: 'system',
        metadata: {
          type: 'temporary_chat_created',
          systemType: 'temporary_created',
          proposalId,
          price: isNaN(_priceValue2) ? 0 : _priceValue2,
          priceFormatted: _priceFormatted2,
          date: new Date().toISOString(),
          expiresAt
        }
      });

      await initialMessage.save();


      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer) {
          const messageToSend = { ...initialMessage.toObject(), content: initialMessage.content };
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          participants.forEach(participantId => {
            webSocketServer.sendToUser(participantId, {
              type: 'message:new',
              data: {
                message: messageToSend,
                conversationId: conversation._id
              },
              timestamp: new Date().toISOString()
            });
          });
        }
      } catch (_) {}


      try {
        const notificationService = req.app.locals?.notificationService;
        if (notificationService) {
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          const recipients = participants.filter(id => id.toString() !== boosterId.toString());
          for (const userId of recipients) {
            await notificationService.sendNotification(userId, {
              id: `temporary_chat_${conversation._id}`,
              title: 'Chat temporário criado',
              message: `Proposta: ${_priceFormatted2} • Tempo: ${proposalData.estimatedTime}`,
              type: 'temporary_chat_created',
              conversationId: conversation._id,
              proposalId
            }, { persistent: true });
          }
        }
      } catch (_) {}


      conversation.lastMessage = initialMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();


      try {
        const wsServer = require('../websocket/WebSocketServer');
        if (wsServer && wsServer.sendToUser) {
          
          // Dados completos da conversa para o evento
          const conversationData = {
            _id: conversation._id,
            participants: [
              { user: clientData, role: 'client' },
              { user: boosterData, role: 'booster' }
            ],
            isTemporary: true,
            status: 'pending',
            expiresAt: expiresAt,
            metadata: {
              proposalId,
              proposalData
            },
            lastMessage: {
              content: initialMessage.content,
              createdAt: initialMessage.createdAt,
              type: 'system'
            },
            unreadCount: 1,
            updatedAt: conversation.updatedAt || new Date().toISOString(),
            createdAt: conversation.createdAt || new Date().toISOString(),
            type: 'boosting'
          };

          // ✅ NOVO: Emitir conversation:new com dados completos
          wsServer.sendToUser(clientId, {
            type: 'conversation:new',
            data: {
              conversation: conversationData
            }
          });
          
          wsServer.sendToUser(boosterId, {
            type: 'conversation:new',
            data: {
              conversation: conversationData
            }
          });
          
          // ✅ Também manter proposal:received para compatibilidade
          wsServer.sendToUser(clientId, {
            type: 'proposal:received',
            data: {
              conversationId: conversation._id,
              proposalId,
              proposalData,
              clientData,
              boosterData,
              expiresAt: expiresAt,
              timestamp: new Date().toISOString()
            }
          });
          

          wsServer.sendToUser(boosterId, {
            type: 'proposal:received',
            data: {
              conversationId: conversation._id,
              proposalId,
              proposalData,
              clientData,
              boosterData,
              expiresAt: expiresAt,
              timestamp: new Date().toISOString()
            }
          });
          
          console.log('✅ Eventos WebSocket emitidos:', {
            'conversation:new': true,
            'proposal:received': true,
            conversationId: conversation._id
          });
        }
      } catch (wsError) {
        console.error('❌ Erro ao emitir evento WebSocket:', wsError);
      }

      res.json({
        success: true,
        message: 'Chat temporário criado com sucesso',
        conversationId: conversation._id,
        expiresAt: expiresAt
      });

    } catch (error) {
      console.error('Erro ao criar chat temporário:', error);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }



  async acceptTemporaryProposal(req, res) {
    let lockTimestamp = null;
    try {
      const { conversationId } = req.params;
      const { proposalId: rawProposalId } = req.body;
      const userId = req.user?.id || req.user?._id;
      

      const proposalId = rawProposalId ? extractValidObjectId(rawProposalId) : null;
      
      // Proposal ID processing

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Usuário não autenticado'
        });
      }


      lockTimestamp = new Date().toISOString();
      const lockResult = await Conversation.updateOne(
        {
          _id: conversationId,
          isTemporary: true,
          status: 'pending',
          $or: [
            { 'metadata.acceptingLock': { $exists: false } },
            { 'metadata.acceptingLock': null }
          ]
        },
        {
          $set: {
            'metadata.acceptingLock': lockTimestamp
          }
        }
      );

      if (!lockResult.modifiedCount) {
        return res.status(409).json({
          success: false,
          message: 'Esta proposta já está sendo processada ou foi aceita.'
        });
      }


      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        await Conversation.updateOne(
          { _id: conversationId, 'metadata.acceptingLock': lockTimestamp },
          { $unset: { 'metadata.acceptingLock': '' } }
        );
        return res.status(404).json({
          success: false,
          message: 'Conversa não encontrada'
        });
      }


      if (!conversation.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado à conversa'
        });
      }


      if (!conversation.isTemporary || conversation.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Esta conversa não é um chat temporário pendente'
        });
      }


      if (conversation.isExpired()) {
        await conversation.expireTemporaryChat();
        return res.status(400).json({
          success: false,
          message: 'Este chat temporário já expirou'
        });
      }


      const metadataSource = conversation.metadata instanceof Map
        ? conversation.metadata
        : new Map(Object.entries(conversation.metadata || {}));
      const getMetadataValue = (key) => {
        if (!metadataSource) return undefined;
        try {
          return metadataSource.get ? metadataSource.get(key) : metadataSource[key];
        } catch (error) {
          return metadataSource[key];
        }
      };

      const boostingId = getMetadataValue('boostingId') || conversation.boostingId;

      if (boostingId) {
        const existingAccepted = await Conversation.findOne({
          _id: { $ne: conversationId },
          $or: [
            { 'metadata.boostingId': boostingId },
            { boostingId }
          ],
          status: { $in: ['accepted', 'active'] }
        }).lean();

        if (existingAccepted) {
          await Conversation.updateOne(
            { _id: conversationId, 'metadata.acceptingLock': lockTimestamp },
            { $unset: { 'metadata.acceptingLock': '' } }
          );
          return res.status(409).json({
            success: false,
            message: 'Já existe uma proposta aceita para este pedido de boosting.'
          });
        }
      }


      await conversation.acceptTemporaryChat();


      const proposalData = getMetadataValue('proposalData');
      const clientData = getMetadataValue('clientData');
      const boosterData = getMetadataValue('boosterData');


      const finalProposalId = proposalId || extractValidObjectId(conversation.proposal);
      
      // Final proposal ID



      const numericAcceptedPrice = typeof proposalData.price === 'string'
        ? parseFloat(proposalData.price.replace(/\./g, '').replace(',', '.'))
        : Number(proposalData.price || 0);

      const acceptedProposal = new AcceptedProposal({
        conversationId: conversation._id,
        proposalId: finalProposalId,
        game: proposalData.game,
        category: proposalData.category,
        currentRank: proposalData.currentRank,
        desiredRank: proposalData.desiredRank,
        description: proposalData.description,
        price: isNaN(numericAcceptedPrice) ? 0 : numericAcceptedPrice,
        originalPrice: isNaN(numericAcceptedPrice) ? 0 : numericAcceptedPrice,
        estimatedTime: proposalData.estimatedTime,
        client: {
          userid: clientData.userid,
          name: clientData.name,
          avatar: clientData.avatar,
          isVerified: false,
          totalOrders: 0,
          rating: 0
        },
        booster: {
          userid: boosterData.userid,
          name: boosterData.name,
          avatar: boosterData.avatar,
          isVerified: false,
          rating: 0,
          totalBoosts: 0,
          completedBoosts: 0,
          specializations: []
        },
        status: 'active',
        acceptedAt: new Date()
      });

      await acceptedProposal.save();


      conversation.acceptedProposal = acceptedProposal._id;
      if (conversation.metadata instanceof Map) {
        conversation.metadata.delete('acceptingLock');
      } else if (conversation.metadata) {
        delete conversation.metadata.acceptingLock;
      }
      await conversation.save();


      const _priceValue3 = typeof proposalData.price === 'string'
        ? parseFloat(proposalData.price.replace(/\./g, '').replace(',', '.'))
        : Number(proposalData.price || 0);
      const _priceFormatted3 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
        .format(isNaN(_priceValue3) ? 0 : _priceValue3);

      const acceptanceMessage = new Message({
        conversation: conversation._id,
        sender: userId,
        content: `Proposta aceita! Cliente ${clientData.name} e Booster ${boosterData.name} foram conectados.\n💰 Valor acordado: ${_priceFormatted3}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}`,
        type: 'system',
        metadata: {
          type: 'proposal_accepted',
          systemType: 'proposal_accepted',
          proposalId: finalProposalId,
          acceptedBy: userId,
          acceptedAt: new Date(),
          price: isNaN(_priceValue3) ? 0 : _priceValue3,
          priceFormatted: _priceFormatted3,
          date: new Date().toISOString()
        }
      });

      await acceptanceMessage.save();


      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer) {
          const messageToSend = { ...acceptanceMessage.toObject(), content: acceptanceMessage.content };
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          participants.forEach(participantId => {
            webSocketServer.sendToUser(participantId, {
              type: 'message:new',
              data: {
                message: messageToSend,
                conversationId: conversation._id
              },
              timestamp: new Date().toISOString()
            });
          });
        }
      } catch (_) {}


      try {
        const notificationService = req.app.locals?.notificationService;
        if (notificationService) {
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          for (const userId of participants) {
            await notificationService.sendNotification(userId, {
              id: `proposal_accepted_${finalProposalId}`,
              title: 'Proposta aceita',
              message: `Valor acordado: ${_priceFormatted3} • Tempo: ${proposalData.estimatedTime}`,
              type: 'proposal_accepted',
              conversationId: conversation._id,
              proposalId: finalProposalId
            }, { persistent: true });
          }
        }
      } catch (_) {}


      conversation.lastMessage = acceptanceMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();

      try {
        await this.expireCompetingTemporaryChats(req, conversation, {
          userId,
          acceptedProposalId: acceptedProposal._id
        });
      } catch (expireError) {
        logger?.error?.('[acceptTemporaryChat] Failed to expire competing chats', { error: expireError?.message, conversationId: conversation._id });
      }


      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer) {
          const clientId = clientData.userid;
          const boosterId = boosterData.userid;

          const connectionManager = webSocketServer.connectionManager;

          const proposalAcceptedEventData = {
            conversationId: conversation._id,
            proposalId: finalProposalId,
            proposalData,
            clientData,
            boosterData,
            acceptedBy: userId,
            acceptedAt: new Date().toISOString(),
            status: 'accepted',
            isTemporary: false,
            boostingStatus: 'active',
            timestamp: new Date().toISOString()
          };

          const conversationUpdateEventData = {
            conversationId: conversation._id,
            status: 'accepted',
            isTemporary: false,
            boostingStatus: 'active',
            updatedAt: new Date().toISOString(),
            clientId,
            boosterId,
            proposalData,
            clientData,
            boosterData
          };

          const sendToUserRobust = (userIds, eventType, eventData, userType) => {
            let eventSent = false;

            for (const userId of userIds) {
              const connections = connectionManager.getUserConnections(userId);
              if (connections.length > 0) {
                webSocketServer.sendToUser(userId, { type: eventType, data: eventData });
                eventSent = true;
                break;
              }
            }

            if (!eventSent) {
              logger.warn(`[acceptTemporaryChat] Failed to send ${eventType} to ${userType} - no active connections`);
            }

            return eventSent;
          };

          const clientIds = [
            clientId,
            clientId?.toString(),
            clientData._id?.toString(),
            clientData.userid?.toString()
          ].filter(id => id).map(id => id.toString());

          const boosterIds = [
            boosterId,
            boosterId?.toString(),
            boosterData._id?.toString(),
            boosterData.userid?.toString()
          ].filter(id => id).map(id => id.toString());

          const clientEventSent = sendToUserRobust(clientIds, 'proposal:accepted', proposalAcceptedEventData, 'CLIENT');
          sendToUserRobust(clientIds, 'conversation:updated', conversationUpdateEventData, 'CLIENT');

          const boosterEventSent = sendToUserRobust(boosterIds, 'proposal:accepted', proposalAcceptedEventData, 'BOOSTER');
          sendToUserRobust(boosterIds, 'conversation:updated', conversationUpdateEventData, 'BOOSTER');

          if (!clientEventSent || !boosterEventSent) {
            const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
            participants.forEach(participantId => {
              try {
                const participantIdStr = participantId.toString();
                webSocketServer.sendToUser(participantIdStr, { type: 'proposal:accepted', data: proposalAcceptedEventData });
                webSocketServer.sendToUser(participantIdStr, { type: 'conversation:updated', data: conversationUpdateEventData });
              } catch (error) {
                logger.error('[acceptTemporaryChat] Error in participant fallback', { participantId, error: error.message });
              }
            });
          }
        } else {
          logger.warn('[acceptTemporaryChat] WebSocket server not available');
        }
      } catch (wsError) {
        logger.error('[acceptTemporaryChat] Error emitting WebSocket events', { error: wsError.message });
      }


      // ✅ Estado já foi atualizado por acceptTemporaryChat() - apenas garantir que foi salvo
      try {
        // Verificar se os estados estão corretos
        if (conversation.isTemporary || conversation.status !== 'accepted' || conversation.boostingStatus !== 'active') {
          logger.warn('[acceptTemporaryChat] Inconsistent state detected, fixing', { isTemporary: conversation.isTemporary, status: conversation.status });
          
          conversation.isTemporary = false;
          conversation.status = 'accepted';
          conversation.expiresAt = null;
          conversation.boostingStatus = 'active';
          await conversation.save();
        }
        
        // Final state verified
      } catch (cleanupError) {
        console.error('❌ [Temporary Chat Accept] Finalization error:', cleanupError);
      }

      res.json({
        success: true,
        message: 'Proposta aceita com sucesso',
        acceptedProposal: acceptedProposal
      });

    } catch (error) {
      console.error('Erro ao aceitar proposta temporária:', error);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    } finally {
      if (lockTimestamp) {
        try {
          await Conversation.updateOne(
            { _id: req.params.conversationId, 'metadata.acceptingLock': lockTimestamp },
            { $unset: { 'metadata.acceptingLock': '' } }
          );
        } catch (unlockError) {
          logger?.error?.('[acceptTemporaryChat] Failed to release acceptance lock', { unlockError: unlockError?.message });
        }
      }
    }
  }


  async expireCompetingTemporaryChats(req, acceptedConversation, { userId, acceptedProposalId }) {
    try {
      if (!acceptedConversation) {
        return;
      }

      const now = new Date();
      const metadata = acceptedConversation.metadata;
      const boostingId = metadata?.get?.('boostingId') || metadata?.boostingId || acceptedConversation.boostingId;

      if (!boostingId) {
        return;
      }

      const competingChats = await Conversation.find({
        _id: { $ne: acceptedConversation._id },
        isTemporary: true,
        status: 'pending',
        $or: [
          { 'metadata.boostingId': boostingId },
          { boostingId }
        ]
      });

      if (!competingChats.length) {
        return;
      }

      const webSocketServer = req.app.get('webSocketServer');
      const notificationService = req.app.locals?.notificationService;
      const proposalHandler = req.app.get('proposalHandler');

      for (const chat of competingChats) {
        try {
          chat.isTemporary = false;
          chat.status = 'expired';
          chat.isActive = false;
          chat.boostingStatus = 'cancelled';
          chat.isDeleted = true;
          chat.deletedAt = now;
          chat.deletedBy = userId;
          chat.deletedReason = 'auto_rejected';

          if (chat.metadata) {
            if (typeof chat.metadata.set === 'function') {
              chat.metadata.set('autoRejectedAt', now);
              chat.metadata.set('autoRejectedReason', 'another_proposal_accepted');
              chat.metadata.set('acceptedConversationId', acceptedConversation._id.toString());
              chat.metadata.set('blockedAt', now);
              chat.metadata.set('blockedReason', 'auto_rejected');
            } else {
              chat.metadata = {
                ...chat.metadata,
                autoRejectedAt: now,
                autoRejectedReason: 'another_proposal_accepted',
                acceptedConversationId: acceptedConversation._id.toString(),
                blockedAt: now,
                blockedReason: 'auto_rejected'
              };
            }
          }

          await chat.save();

          const otherProposalId = chat.metadata?.get?.('proposalId') || chat.metadata?.proposalId || chat.proposal;
          const proposalData = chat.metadata?.get?.('proposalData') || chat.metadata?.proposalData || {};
          const clientData = chat.metadata?.get?.('clientData') || chat.metadata?.clientData || {};
          const boosterData = chat.metadata?.get?.('boosterData') || chat.metadata?.boosterData || {};

          const rejectionMessage = new Message({
            conversation: chat._id,
            sender: userId,
            content: '❌ Esta proposta foi automaticamente rejeitada porque outra proposta foi aceita pelo cliente.',
            type: 'system',
            metadata: {
              type: 'proposal_auto_rejected',
              rejectedAt: now,
              acceptedConversationId: acceptedConversation._id,
              acceptedProposalId: acceptedProposalId
            }
          });

          await rejectionMessage.save();

          chat.lastMessage = rejectionMessage._id;
          chat.lastMessageAt = now;
          await chat.save();

          const participants = chat.participants.map(p => p.toString ? p.toString() : p);

          if (webSocketServer) {
            const serializedMessage = { ...rejectionMessage.toObject(), content: rejectionMessage.content };

            // CRITICAL: Enviar eventos em ordem específica para garantir sincronização
            participants.forEach(participantId => {
              const participant = participantId.toString();
              
              // 1. Enviar mensagem de rejeição
              webSocketServer.sendToUser(participant, {
                type: 'message:new',
                data: {
                  message: serializedMessage,
                  conversationId: chat._id
                },
                timestamp: now.toISOString()
              });

              // 2. Enviar evento de proposta rejeitada
              webSocketServer.sendToUser(participant, {
                type: 'proposal:rejected',
                data: {
                  conversationId: chat._id,
                  proposalId: otherProposalId,
                  proposalData,
                  clientData,
                  boosterData,
                  rejectedBy: userId,
                  rejectedAt: now.toISOString(),
                  reason: 'another_proposal_accepted',
                  acceptedConversationId: acceptedConversation._id,
                  acceptedProposalId
                },
                timestamp: now.toISOString()
              });

              // 3. Atualizar status da conversa
              webSocketServer.sendToUser(participant, {
                type: 'conversation:updated',
                data: {
                  conversationId: chat._id,
                  status: 'expired',
                  isTemporary: false,
                  isActive: false,
                  boostingStatus: 'cancelled',
                  isDeleted: true,
                  deletedAt: now.toISOString(),
                  deletedReason: 'auto_rejected',
                  updatedAt: now.toISOString()
                }
              });

              // 4. CRITICAL: Enviar evento de deleção para remover chat do frontend
              webSocketServer.sendToUser(participant, {
                type: 'conversation:deleted',
                data: {
                  conversationId: chat._id,
                  reason: 'auto_rejected',
                  acceptedConversationId: acceptedConversation._id,
                  acceptedProposalId,
                  deletedAt: now.toISOString(),
                  message: 'Chat removido porque outra proposta foi aceita'
                },
                timestamp: now.toISOString()
              });
            });
          }

          if (notificationService) {
            for (const participantId of participants) {
              try {
                await notificationService.sendNotification(participantId, {
                  id: `proposal_auto_rejected_${chat._id}`,
                  title: 'Proposta encerrada',
                  message: 'Outra proposta foi aceita pelo cliente. Esta conversa foi encerrada automaticamente.',
                  type: 'proposal_auto_rejected',
                  conversationId: chat._id,
                  proposalId: otherProposalId,
                  metadata: {
                    reason: 'another_proposal_accepted'
                  }
                }, { persistent: true });
              } catch (notificationError) {
                console.error('Erro ao enviar notificação de proposta rejeitada automaticamente:', notificationError);
              }
            }
          }

          if (proposalHandler && boostingId) {
            try {
              proposalHandler.broadcastProposalRejected(boostingId, otherProposalId);
            } catch (broadcastError) {
              // Silenciar erro
            }
          }

          // CRITICAL: Deletar permanentemente a conversa do banco de dados
          try {
            // Deletar todas as mensagens da conversa
            await Message.deleteMany({ conversation: chat._id });
            
            // Deletar a conversa
            await Conversation.deleteOne({ _id: chat._id });
          } catch (deleteError) {
            // Silenciar erro de deleção
          }
        } catch (chatError) {
          // Silenciar erro
        }
      }
    } catch (error) {
      // Silenciar erro geral
    }
  }


  async rejectTemporaryProposal(req, res) {
    try {
      const { conversationId } = req.params;
      const { proposalId: rawProposalId } = req.body;
      const userId = req.user?.id || req.user?._id;
      
      const proposalId = rawProposalId ? extractValidObjectId(rawProposalId) : null;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Usuário não autenticado'
        });
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversa não encontrada'
        });
      }

      if (!conversation.isParticipant(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado à conversa'
        });
      }

      if (!conversation.isTemporary || conversation.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Esta conversa não é um chat temporário pendente'
        });
      }
      

      const now = new Date();

      conversation.status = 'expired';
      conversation.isActive = false;
      conversation.isDeleted = true;
      conversation.deletedAt = now;
      conversation.deletedBy = userId;
      conversation.deletedReason = 'manual_rejected';
      await conversation.save();


      const proposalData = conversation.metadata.get('proposalData');
      const clientData = conversation.metadata.get('clientData');
      const boosterData = conversation.metadata.get('boosterData');
      const finalProposalId = proposalId || extractValidObjectId(conversation.proposal);


      const rejectionMessage = new Message({
        conversation: conversation._id,
        sender: userId,
        content: `❌ Proposta rejeitada por ${userId === clientData.userid ? clientData.name : boosterData.name}.`,
        type: 'system',
        metadata: {
          type: 'proposal_rejected',
          proposalId: finalProposalId,
          rejectedBy: userId,
          rejectedAt: new Date()
        }
      });

      await rejectionMessage.save();


      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer) {
          const messageToSend = { ...rejectionMessage.toObject(), content: rejectionMessage.content };
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          participants.forEach(participantId => {
            webSocketServer.sendToUser(participantId, {
              type: 'message:new',
              data: {
                message: messageToSend,
                conversationId: conversation._id
              },
              timestamp: new Date().toISOString()
            });
          });
        }
      } catch (_) {}


      try {
        const notificationService = req.app.locals?.notificationService;
        if (notificationService) {
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);
          for (const userId of participants) {
            await notificationService.sendNotification(userId, {
              id: `proposal_rejected_${finalProposalId}`,
              title: 'Proposta rejeitada',
              message: 'A proposta foi rejeitada.',
              type: 'proposal_rejected',
              conversationId: conversation._id,
              proposalId: finalProposalId
            }, { persistent: true });
          }
        }
      } catch (notificationError) {
        console.error('Erro ao enviar notificação de proposta rejeitada:', notificationError);
      }

      conversation.lastMessage = rejectionMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();


      try {
        conversation.isActive = false;
        conversation.status = 'expired';
        await conversation.save();
      } catch (stateError) {
        console.error('❌ Erro ao atualizar estado da conversa para expirada/inativa:', stateError);
      }


      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer && typeof webSocketServer.sendToUser === 'function') {
          const participants = conversation.participants.map(p => p.toString ? p.toString() : p);

          participants.forEach(participantId => {
            webSocketServer.sendToUser(participantId, {
              type: 'proposal:rejected',
              data: {
                conversationId: conversation._id,
                proposalId: finalProposalId,
                proposalData,
                clientData,
                boosterData,
                rejectedBy: userId,
                rejectedAt: new Date().toISOString(),
                timestamp: new Date().toISOString()
              }
            });
            webSocketServer.sendToUser(participantId, {
              type: 'conversation:deleted',
              data: {
                conversationId: conversation._id,
                reason: 'manual_rejected'
              },
              timestamp: now.toISOString()
            });
          });


          const updatePayload = {
            type: 'conversation:updated',
            data: {
              conversationId: conversation._id,
              status: 'expired',
              isTemporary: !!conversation.isTemporary,
              isActive: false,
              updatedAt: new Date().toISOString()
            }
          };
          participants.forEach(participantId => webSocketServer.sendToUser(participantId, updatePayload));
        }
      } catch (wsError) {
        console.error('❌ Erro ao emitir evento WebSocket de rejeição:', wsError);
      }

      res.json({
        success: true,
        message: 'Proposta rejeitada com sucesso'
      });

    } catch (error) {
      console.error('Erro ao rejeitar proposta temporária:', error);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }


  async getExpiredTemporaryChats(req, res) {
    try {
      const expiredChats = await Conversation.find({
        isTemporary: true,
        status: 'pending',
        expiresAt: { $lt: new Date() }
      });

      res.json({
        success: true,
        data: {
          expiredChats: expiredChats.length,
          chats: expiredChats
        }
      });

    } catch (error) {
      console.error('Erro ao buscar chats expirados:', error);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }


  async cleanupExpiredChats(req, res) {
    try {
      const expiredChats = await Conversation.find({
        isTemporary: true,
        status: 'pending',
        expiresAt: { $lt: new Date() }
      });

      let cleanedCount = 0;
      for (const chat of expiredChats) {
        try {
          await chat.expireTemporaryChat();
          
          // CORREÇÃO: Garantir que sender seja fornecido
          if (!chat.participants || chat.participants.length === 0) {
            logger.warn('[cleanupExpiredChats] Chat has no participants, skipping', { chatId: chat._id });
            cleanedCount++;
            continue;
          }

          // Extrair ObjectId do participante (pode ser objeto ou ObjectId)
          const systemSenderId = chat.participants[0]._id || chat.participants[0];
          
          if (!systemSenderId) {
            logger.warn('[cleanupExpiredChats] Chat has no valid participant, skipping', { chatId: chat._id });
            cleanedCount++;
            continue;
          }

          const expirationMessage = new Message({
            conversation: chat._id,
            sender: systemSenderId, // Campo obrigatório adicionado
            content: '🚫 Este chat expirou porque a proposta não foi aceita em até 3 dias.',
            type: 'system',
            metadata: {
              type: 'chat_expired',
              expiredAt: new Date()
            }
          });

          await expirationMessage.save();


          try {
            const webSocketServer = req.app.get('webSocketServer');
            if (webSocketServer) {
              const messageToSend = { ...expirationMessage.toObject(), content: expirationMessage.content };
              const participants = chat.participants.map(p => p.toString ? p.toString() : p);
              participants.forEach(participantId => {
                webSocketServer.sendToUser(participantId, {
                  type: 'message:new',
                  data: {
                    message: messageToSend,
                    conversationId: chat._id
                  },
                  timestamp: new Date().toISOString()
                });
              });
            }
          } catch (_) {}


          try {
            const notificationService = req.app.locals?.notificationService;
            if (notificationService) {
              const participants = chat.participants.map(p => p.toString ? p.toString() : p);
              for (const userId of participants) {
                await notificationService.sendNotification(userId, {
                  id: `temporary_chat_expired_${chat._id}`,
                  title: 'Chat temporário expirou',
                  message: 'A proposta não foi aceita em até 3 dias.',
                  type: 'proposal_expired',
                  conversationId: chat._id
                }, { persistent: true });
              }
            }
          } catch (_) {}
          

          chat.lastMessage = expirationMessage._id;
          chat.lastMessageAt = new Date();
          await chat.save();
          

          try {
            const wsServer = require('../websocket/WebSocketServer');
            if (wsServer && wsServer.sendToUser) {
              const participants = chat.participants;
              const proposalData = chat.metadata.get('proposalData');
              const clientData = chat.metadata.get('clientData');
              const boosterData = chat.metadata.get('boosterData');
              
              participants.forEach(participantId => {
                wsServer.sendToUser(participantId, {
                  type: 'proposal:expired',
                  data: {
                    conversationId: chat._id,
                    proposalId: chat.proposal,
                    proposalData,
                    clientData,
                    boosterData,
                    expiredAt: new Date().toISOString(),
                    timestamp: new Date().toISOString()
                  }
                });
              });
            }
          } catch (wsError) {
            console.error('❌ Erro ao emitir evento WebSocket de expiração:', wsError);
          }
          
          cleanedCount++;
        } catch (error) {
          console.error(`Erro ao expirar chat ${chat._id}:`, error);
        }
      }

      res.json({
        success: true,
        message: `${cleanedCount} chats temporários expirados foram limpos`,
        cleanedCount
      });

    } catch (error) {
      console.error('Erro ao limpar chats expirados:', error);
      res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }
}

module.exports = new TemporaryChatController();
