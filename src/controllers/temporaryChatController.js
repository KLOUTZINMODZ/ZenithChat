const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AcceptedProposal = require('../models/AcceptedProposal');


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
          type: 'system',
          metadata: {
            type: 'temporary_proposal',
            proposalId,
            proposalData
          }
        });

        await proposalMessage.save();
        

        conversation.lastMessage = proposalMessage._id;
        conversation.lastMessageAt = new Date();
        await conversation.save();

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
          ['boosterData', boosterData]
        ])
      });

      await conversation.save();


      const initialMessage = new Message({
        conversation: conversation._id,
        sender: boosterId,
        content: `⏳ Chat Temporário criado...\n💰 Proposta: R$ ${proposalData.price}\n⏱️ Tempo estimado: ${proposalData.estimatedTime}\n📝 Mensagem: ${proposalData.message || 'Nenhuma'}\n\n💡 Este chat expira em 3 dias se a proposta não for aceita.`,
        type: 'system',
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
        type: 'system',
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
            type: 'system',
            metadata: {
              type: 'chat_expired',
              expiredAt: new Date()
            }
          });

          await expirationMessage.save();
          

          chat.lastMessage = expirationMessage._id;
          chat.lastMessageAt = new Date();
          await chat.save();
          
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
