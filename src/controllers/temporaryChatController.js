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
  

  console.warn('⚠️ ID inválido detectado:', id, '-> Extraído:', cleanId);
  return null;
}

class TemporaryChatController {

  async createTemporaryChat(req, res) {
    console.log('🔥 createTemporaryChat endpoint chamado:', req.body);
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


      let conversation = await Conversation.findOne({
        participants: { $all: [clientId, boosterId] },
        type: 'direct'
      });

      if (conversation) {

        const proposalMessage = new Message({
          conversation: conversation._id,
          sender: boosterId,
          content: `⏳ Nova proposta temporária recebida!\n💰 Valor: R$ ${proposalData.price}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}\n📝 Mensagem: ${proposalData.message || 'Nenhuma'}`,
          type: 'message:new',
          metadata: {
            type: 'temporary_proposal',
            proposalId,
            proposalData
          }
        });

        await proposalMessage.save();
        
        // Atualizar conversa
        conversation.lastMessage = proposalMessage._id;
        conversation.lastMessageAt = new Date();
        await conversation.save();

        // Emit WebSocket event for proposal received
        try {
          const wsServer = require('../websocket/WebSocketServer');
          if (wsServer && wsServer.sendToUser) {
            // Send to client
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
            
            // Send to booster
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
          email: clientUser.email,
          avatar: clientUser.avatar,
          isVerified: clientUser.isVerified || false,
          totalOrders: clientUser.totalOrders || 0,
          rating: clientUser.rating || 0,
          registeredAt: clientUser.createdAt
        },
        booster: {
          userid: boosterUser._id,
          name: boosterUser.name,
          email: boosterUser.email,
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


      const initialMessage = new Message({
        conversation: conversation._id,
        sender: boosterId,
        content: `⏳ Chat Temporário criado...\n💰 Proposta: R$ ${proposalData.price}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}\n📝 Mensagem: ${proposalData.message || 'Nenhuma'}\n\n💡 Este chat expira em 3 dias se a proposta não for aceita.`,
        type: 'message:new',
        metadata: {
          type: 'temporary_chat_created',
          proposalId,
          expiresAt
        }
      });

      await initialMessage.save();


      conversation.lastMessage = initialMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();

      // Emit WebSocket event for new temporary chat created
      try {
        const wsServer = require('../websocket/WebSocketServer');
        if (wsServer && wsServer.sendToUser) {
          // Send to client
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
          
          // Send to booster
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
    try {
      const { conversationId } = req.params;
      const { proposalId: rawProposalId } = req.body;
      const userId = req.user?.id || req.user?._id;
      

      const proposalId = rawProposalId ? extractValidObjectId(rawProposalId) : null;
      
      console.log('🔍 [DEBUG] Proposal ID processing:', {
        raw: rawProposalId,
        cleaned: proposalId,
        conversationProposal: null
      });

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


      if (conversation.isExpired()) {
        await conversation.expireTemporaryChat();
        return res.status(400).json({
          success: false,
          message: 'Este chat temporário já expirou'
        });
      }


      await conversation.acceptTemporaryChat();


      const proposalData = conversation.metadata.get('proposalData');
      const clientData = conversation.metadata.get('clientData');
      const boosterData = conversation.metadata.get('boosterData');


      const finalProposalId = proposalId || extractValidObjectId(conversation.proposal);
      
      console.log('🔍 [DEBUG] Final proposal ID for AcceptedProposal:', {
        proposalId,
        conversationProposal: conversation.proposal,
        cleanedConversationProposal: extractValidObjectId(conversation.proposal),
        finalProposalId
      });


      const acceptedProposal = new AcceptedProposal({
        conversationId: conversation._id,
        proposalId: finalProposalId,
        game: proposalData.game,
        category: proposalData.category,
        currentRank: proposalData.currentRank,
        desiredRank: proposalData.desiredRank,
        description: proposalData.description,
        price: proposalData.price,
        originalPrice: proposalData.price,
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
      await conversation.save();


      const acceptanceMessage = new Message({
        conversation: conversation._id,
        sender: userId,
        content: `✅ Proposta aceita! Cliente ${clientData.name} e Booster ${boosterData.name} foram conectados.\n💰 Valor acordado: R$ ${proposalData.price}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}`,
        type: 'message:new',
        metadata: {
          type: 'proposal_accepted',
          proposalId: finalProposalId,
          acceptedBy: userId,
          acceptedAt: new Date()
        }
      });

      await acceptanceMessage.save();


      conversation.lastMessage = acceptanceMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();

      // Emit WebSocket events for real-time updates
      try {
        const webSocketServer = req.app.get('webSocketServer');
        if (webSocketServer) {
          console.log('🔌 WebSocket server found, emitting events...');
          
          const participants = conversation.participants;
          const clientId = clientData.userid;
          const boosterId = boosterData.userid;
          
          console.log('📊 Event emission details:', {
            conversationId: conversation._id,
            clientId: clientId,
            clientIdType: typeof clientId,
            boosterId: boosterId,
            boosterIdType: typeof boosterId,
            participants: participants.map(p => p.toString()),
            participantTypes: participants.map(p => typeof p.toString())
          });
          
          // Check if users are currently connected
          const connectionManager = webSocketServer.connectionManager;
          const clientConnections = connectionManager.getUserConnections(clientId?.toString());
          const boosterConnections = connectionManager.getUserConnections(boosterId?.toString());
          
          console.log('🔍 Connection status check:', {
            clientConnected: clientConnections.length > 0,
            clientConnectionCount: clientConnections.length,
            boosterConnected: boosterConnections.length > 0,
            boosterConnectionCount: boosterConnections.length,
            allOnlineUsers: connectionManager.getOnlineUsers()
          });  
          
          console.log('🔍 [Temporary Chat Accept] Client ID:', clientId);
          console.log('🔍 [Temporary Chat Accept] Booster ID:', boosterId);
          
          // Create comprehensive event data
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
          
          // Enhanced WebSocket event emission with robust user ID handling
          const sendToUserRobust = (userIds, eventType, eventData, userType) => {
            let eventSent = false;
            
            for (const userId of userIds) {
              const connections = connectionManager.getUserConnections(userId);
              if (connections.length > 0) {
                console.log(`🎯 Sending ${eventType} to ${userType} via ID: ${userId} (${connections.length} connections)`);
                webSocketServer.sendToUser(userId, { type: eventType, data: eventData });
                eventSent = true;
                break;
              }
            }
            
            if (!eventSent) {
              console.warn(`⚠️ Failed to send ${eventType} to ${userType}. No active connections found for any ID variant.`);
            }
            
            return eventSent;
          };
          
          // Get all possible ID formats for both users
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
          
          console.log('🔍 All possible client IDs:', clientIds);
          console.log('🔍 All possible booster IDs:', boosterIds);
          console.log('📊 Currently online users:', connectionManager.getOnlineUsers());
          
          // Send events to both users with robust ID handling
          const clientEventSent = sendToUserRobust(clientIds, 'proposal:accepted', proposalAcceptedEventData, 'CLIENT');
          sendToUserRobust(clientIds, 'conversation:updated', conversationUpdateEventData, 'CLIENT');
          
          const boosterEventSent = sendToUserRobust(boosterIds, 'proposal:accepted', proposalAcceptedEventData, 'BOOSTER');
          sendToUserRobust(boosterIds, 'conversation:updated', conversationUpdateEventData, 'BOOSTER');
          
          // Final fallback to all participants if direct targeting failed
          if (!clientEventSent || !boosterEventSent) {
            console.log('🔄 Using participant fallback for missed events...');
            participants.forEach(participantId => {
              try {
                const participantIdStr = participantId.toString();
                webSocketServer.sendToUser(participantIdStr, { type: 'proposal:accepted', data: proposalAcceptedEventData });
                webSocketServer.sendToUser(participantIdStr, { type: 'conversation:updated', data: conversationUpdateEventData });
                console.log(`✅ Fallback events sent to participant: ${participantIdStr}`);
              } catch (error) {
                console.error(`❌ Error in participant fallback for ${participantId}:`, error);
              }
            });
          }
          
          console.log('✅ Enhanced WebSocket event emission completed');
        } else {
          console.warn('⚠️ [Temporary Chat Accept] WebSocket server not available for real-time updates');
        }
      } catch (wsError) {
        console.error('❌ [Temporary Chat Accept] Error emitting WebSocket events:', wsError);
        // Don't fail the request if WebSocket fails
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
    }
  }

  // Reject temporary proposal
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

      // Mark conversation as rejected
      conversation.status = 'rejected';
      await conversation.save();

      // Get proposal data for WebSocket event
      const proposalData = conversation.metadata.get('proposalData');
      const clientData = conversation.metadata.get('clientData');
      const boosterData = conversation.metadata.get('boosterData');
      const finalProposalId = proposalId || extractValidObjectId(conversation.proposal);

      // Create rejection message
      const rejectionMessage = new Message({
        conversation: conversation._id,
        sender: userId,
        content: `❌ Proposta rejeitada por ${userId === clientData.userid ? clientData.name : boosterData.name}.`,
        type: 'message:new',
        metadata: {
          type: 'proposal_rejected',
          proposalId: finalProposalId,
          rejectedBy: userId,
          rejectedAt: new Date()
        }
      });

      await rejectionMessage.save();

      conversation.lastMessage = rejectionMessage._id;
      conversation.lastMessageAt = new Date();
      await conversation.save();

      // Emit WebSocket event for proposal rejected
      try {
        const wsServer = require('../websocket/WebSocketServer');
        if (wsServer && wsServer.sendToUser) {
          const participants = conversation.participants;
          
          participants.forEach(participantId => {
            wsServer.sendToUser(participantId, {
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
          });
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
          

          const expirationMessage = new Message({
            conversation: chat._id,
            content: '🚫 Este chat expirou porque a proposta não foi aceita em até 3 dias.',
            type: 'message:new',
            metadata: {
              type: 'chat_expired',
              expiredAt: new Date()
            }
          });

          await expirationMessage.save();
          

          chat.lastMessage = expirationMessage._id;
          chat.lastMessageAt = new Date();
          await chat.save();
          
          // Emit WebSocket event for proposal expired
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
