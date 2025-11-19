const Agreement = require('../models/Agreement');
const AcceptedProposal = require('../models/AcceptedProposal');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const BoostingOrder = require('../models/BoostingOrder');
const axios = require('axios');
const { calculateAndSendEscrowUpdate } = require('../routes/walletRoutes');

class AgreementController {
  

  async createAgreement(req, res) {
    try {
      const { 
        conversationId, 
        proposalId, 
        proposalData,
        clientData,
        boosterData,
        acceptedProposalId
      } = req.body;
      
      const idempotencyKey = req.headers['x-idempotency-key'];
      
      if (!conversationId || !proposalId || !proposalData || !clientData || !boosterData) {
        return res.status(400).json({ 
          success: false, 
          message: 'Dados obrigatórios não fornecidos' 
        });
      }


      if (idempotencyKey) {
        const existingAgreement = await Agreement.findOne({
          'actionHistory.idempotencyKey': idempotencyKey
        });
        
        if (existingAgreement) {
          return res.json({
            success: true,
            message: 'Acordo já existe (idempotência)',
            agreement: {
              agreementId: existingAgreement.agreementId,
              status: existingAgreement.status,
              version: existingAgreement.version
            }
          });
        }
      }


      const agreement = new Agreement({
        conversationId,
        proposalId,
        acceptedProposalId,
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
        createdVia: 'migration'
      }, idempotencyKey);

      await agreement.save();

      // Criar BoostingOrder para persistência dos dados
      try {
        await BoostingOrder.createFromAgreement(agreement);
        console.log('BoostingOrder criado para agreement:', agreement.agreementId);
      } catch (boError) {
        console.error('Erro ao criar BoostingOrder:', boError);
        // Não falhar a criação do agreement se BoostingOrder falhar
      }

      const conversation = await Conversation.findById(conversationId);
      if (conversation) {

        if (acceptedProposalId) {
          conversation.acceptedProposal = acceptedProposalId;
        }
        conversation.boostingStatus = 'active';
        conversation.metadata = conversation.metadata || new Map();
        conversation.metadata.set('latestAgreementId', agreement.agreementId);
        await conversation.save();
      }

      res.json({
        success: true,
        message: 'Acordo criado com sucesso',
        agreement: {
          agreementId: agreement.agreementId,
          status: agreement.status,
          version: agreement.version,
          createdAt: agreement.createdAt
        }
      });
    } catch (error) {
      console.error('Erro ao criar acordo:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async getAgreement(req, res) {
    try {
      const { agreementId } = req.params;
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      // Tentar buscar por agreementId (string) ou _id (ObjectId)
      let agreement = await Agreement.findByAgreementId(agreementId);
      
      if (!agreement) {
        // Tentar buscar por _id se agreementId não encontrou
        agreement = await Agreement.findById(agreementId);
      }
      
      if (!agreement) {
        return res.status(404).json({ 
          success: false, 
          message: 'Acordo não encontrado' 
        });
      }


      const isParticipant = 
        agreement.parties.client.userid.toString() === userId.toString() ||
        agreement.parties.booster.userid.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao acordo' });
      }

      // Buscar dados atualizados do booster e cliente para obter rating correto
      const [boosterUser, clientUser] = await Promise.all([
        User.findById(agreement.parties.booster.userid).select('_id name avatar rating').lean(),
        User.findById(agreement.parties.client.userid).select('_id name avatar rating').lean()
      ]);

      // Atualizar parties com dados frescos
      const updatedParties = {
        client: {
          ...agreement.parties.client,
          avatar: clientUser?.avatar || agreement.parties.client.avatar,
          rating: clientUser?.rating
        },
        booster: {
          ...agreement.parties.booster,
          avatar: boosterUser?.avatar || agreement.parties.booster.avatar,
          rating: boosterUser?.rating || 0
        }
      };

      res.json({
        success: true,
        data: {
          _id: agreement._id,
          agreementId: agreement.agreementId,
          conversationId: agreement.conversationId,
          price: agreement.price,
          boostingRequestId: agreement.boostingRequestId,
          proposalSnapshot: agreement.proposalSnapshot,
          parties: updatedParties,
          status: agreement.status,
          version: agreement.version,
          createdAt: agreement.createdAt,
          activatedAt: agreement.activatedAt,
          completedAt: agreement.completedAt,
          actionHistory: agreement.actionHistory,
          renegotiationData: agreement.renegotiationData,
          financial: agreement.financial
        }
      });
    } catch (error) {
      console.error('Erro ao buscar acordo:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async completeAgreement(req, res) {
    try {
      const { agreementId } = req.params;
      const userId = req.user?.id || req.user?._id;
      const { version, completionNotes } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      const agreement = await Agreement.findByAgreementId(agreementId);
      
      if (!agreement) {
        return res.status(404).json({ success: false, message: 'Acordo não encontrado' });
      }


      const isParticipant = 
        agreement.parties.client.userid.toString() === userId.toString() ||
        agreement.parties.booster.userid.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao acordo' });
      }


      if (version && agreement.version !== parseInt(version)) {
        return res.status(409).json({
          success: false,
          message: 'Conflito de versão. Dados foram modificados por outro processo.',
          currentVersion: agreement.version,
          requestedVersion: version
        });
      }


      if (idempotencyKey) {
        const existingAction = agreement.actionHistory.find(
          a => a.idempotencyKey === idempotencyKey && a.action === 'completed'
        );
        
        if (existingAction) {
          return res.json({
            success: true,
            message: 'Acordo já foi completado (idempotência)',
            agreement: {
              agreementId: agreement.agreementId,
              status: agreement.status,
              version: agreement.version,
              completedAt: agreement.completedAt
            }
          });
        }
      }


      await agreement.complete(userId, {
        completionNotes,
        completedVia: 'api'
      }, idempotencyKey);

      // Atualizar BoostingOrder
      try {
        const boostingOrder = await BoostingOrder.findOne({ agreementId: agreement._id });
        if (boostingOrder) {
          await boostingOrder.syncFromAgreement(agreement);
          console.log('BoostingOrder atualizado após conclusão:', agreement.agreementId);
        } else {
          // Criar se não existir
          await BoostingOrder.createFromAgreement(agreement);
          console.log('BoostingOrder criado durante conclusão:', agreement.agreementId);
        }
      } catch (boError) {
        console.error('Erro ao atualizar BoostingOrder:', boError);
      }

      // Atualizar estatísticas do booster
      try {
        const User = require('../models/User');
        const boosterId = agreement.parties.booster.userid;
        
        console.log(`🔍 [Agreement Complete] Tentando incrementar boosts para booster: ${boosterId}`);
        console.log(`🔍 [Agreement Complete] Tipo do boosterId: ${typeof boosterId}`);
        
        const updateResult = await User.findByIdAndUpdate(
          boosterId,
          {
            $inc: { 
              completedBoosts: 1,
              totalBoosts: 1
            }
          },
          { new: true, runValidators: false }
        );
        
        if (updateResult) {
          console.log(`[Agreement Complete] Booster stats updated successfully!`);
          console.log(`   - User: ${updateResult.name}`);
          console.log(`   - New totalBoosts: ${updateResult.totalBoosts}`);
          console.log(`   - New completedBoosts: ${updateResult.completedBoosts}`);
        } else {
          console.error(`❌ [Agreement Complete] User not found with ID: ${boosterId}`);
        }
        
      } catch (statsError) {
        console.error('❌ [Agreement Complete] Error updating booster stats:');
        console.error('   Message:', statsError.message);
        console.error('   Stack:', statsError.stack);
        // Não falha a operação se não conseguir atualizar stats
      }

      const systemMessage = new Message({
        conversation: agreement.conversationId,
        sender: agreement.parties.booster.userid,
        content: 'Entrega confirmada! O serviço foi concluído com sucesso.',
        type: 'system',
        metadata: new Map([
          ['agreementId', agreement.agreementId],
          ['action', 'completed'],
          ['automated', true]
        ])
      });
      await systemMessage.save();


      try {
        await axios.post(`${process.env.MAIN_API_URL}/api/boosting/confirm-delivery`, {
          conversationId: agreement.conversationId.toString(),
          agreementId: agreement.agreementId,
          completedBy: userId
        });
      } catch (apiError) {
        console.warn('Falha ao notificar API principal:', apiError.message);
      }

      res.json({
        success: true,
        message: 'Acordo completado com sucesso',
        agreement: {
          agreementId: agreement.agreementId,
          status: agreement.status,
          version: agreement.version,
          completedAt: agreement.completedAt
        }
      });
    } catch (error) {
      console.error('Erro ao completar acordo:', error);
      if (error.message.includes('Cannot complete agreement')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async cancelAgreement(req, res) {
    try {
      const { agreementId } = req.params;
      const userId = req.user?.id || req.user?._id;
      const { version, cancelReason } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      const agreement = await Agreement.findByAgreementId(agreementId);
      
      if (!agreement) {
        return res.status(404).json({ success: false, message: 'Acordo não encontrado' });
      }


      const isParticipant = 
        agreement.parties.client.userid.toString() === userId.toString() ||
        agreement.parties.booster.userid.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao acordo' });
      }


      if (version && agreement.version !== parseInt(version)) {
        return res.status(409).json({
          success: false,
          message: 'Conflito de versão. Dados foram modificados por outro processo.',
          currentVersion: agreement.version,
          requestedVersion: version
        });
      }


      if (idempotencyKey) {
        const existingAction = agreement.actionHistory.find(
          a => a.idempotencyKey === idempotencyKey && a.action === 'cancelled'
        );
        
        if (existingAction) {
          return res.json({
            success: true,
            message: 'Acordo já foi cancelado (idempotência)',
            agreement: {
              agreementId: agreement.agreementId,
              status: agreement.status,
              version: agreement.version,
              cancelledAt: agreement.cancelledAt
            }
          });
        }
      }


      await agreement.cancel(userId, cancelReason, idempotencyKey);

      // Atualizar saldo bloqueado para o cliente
      try {
        // Obtém o ID do cliente do acordo
        const clientUserId = agreement.parties?.client?.userid;
        if (clientUserId) {
          // Atualizar a exibição do saldo bloqueado na interface do cliente
          await calculateAndSendEscrowUpdate(req.app, clientUserId);
          console.log(`Saldo bloqueado atualizado para cliente ${clientUserId} após cancelamento`);
        }
      } catch (escrowUpdateError) {
        console.error('Erro ao atualizar saldo bloqueado:', escrowUpdateError);
        // Não bloqueia o processo de cancelamento
      }

      // Atualizar BoostingOrder
      try {
        const boostingOrder = await BoostingOrder.findOne({ agreementId: agreement._id });
        if (boostingOrder) {
          await boostingOrder.syncFromAgreement(agreement);
          console.log('BoostingOrder atualizado após cancelamento:', agreement.agreementId);
        } else {
          // Criar se não existir
          await BoostingOrder.createFromAgreement(agreement);
          console.log('BoostingOrder criado durante cancelamento:', agreement.agreementId);
        }
      } catch (boError) {
        console.error('Erro ao atualizar BoostingOrder:', boError);
      }

      const systemMessage = new Message({
        conversation: agreement.conversationId,
        sender: userId,
        content: `❌ Acordo cancelado. Motivo: ${cancelReason || 'Não especificado'}`,
        type: 'system',
        metadata: new Map([
          ['agreementId', agreement.agreementId],
          ['action', 'cancelled'],
          ['automated', true]
        ])
      });
      await systemMessage.save();


      try {
        await axios.post(`${process.env.MAIN_API_URL}/api/boosting/cancel`, {
          conversationId: agreement.conversationId.toString(),
          agreementId: agreement.agreementId,
          cancelledBy: userId,
          reason: cancelReason
        });
      } catch (apiError) {
        console.warn('Falha ao notificar API principal:', apiError.message);
      }

      res.json({
        success: true,
        message: 'Acordo cancelado com sucesso',
        agreement: {
          agreementId: agreement.agreementId,
          status: agreement.status,
          version: agreement.version,
          cancelledAt: agreement.cancelledAt
        }
      });
    } catch (error) {
      console.error('Erro ao cancelar acordo:', error);
      if (error.message.includes('Cannot cancel agreement')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async renegotiateAgreement(req, res) {
    try {
      const { agreementId } = req.params;
      const userId = req.user?.id || req.user?._id;
      const { version, newPrice, newEstimatedTime, reason } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      const agreement = await Agreement.findByAgreementId(agreementId);
      
      if (!agreement) {
        return res.status(404).json({ success: false, message: 'Acordo não encontrado' });
      }


      const isParticipant = 
        agreement.parties.client.userid.toString() === userId.toString() ||
        agreement.parties.booster.userid.toString() === userId.toString();

      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'Acesso negado ao acordo' });
      }


      if (version && agreement.version !== parseInt(version)) {
        return res.status(409).json({
          success: false,
          message: 'Conflito de versão. Dados foram modificados por outro processo.',
          currentVersion: agreement.version,
          requestedVersion: version
        });
      }


      if (idempotencyKey) {
        const existingAction = agreement.actionHistory.find(
          a => a.idempotencyKey === idempotencyKey && a.action === 'renegotiated'
        );
        
        if (existingAction) {
          return res.json({
            success: true,
            message: 'Renegociação já processada (idempotência)',
            agreement: {
              agreementId: agreement.agreementId,
              status: agreement.status,
              version: agreement.version,
              renegotiationData: agreement.renegotiationData
            }
          });
        }
      }


      await agreement.renegotiate(userId, newPrice, newEstimatedTime, reason, idempotencyKey);


      const systemMessage = new Message({
        conversation: agreement.conversationId,
        sender: userId,
        content: `🔄 Proposta renegociada:\n• Preço: R$ ${newPrice}\n• Prazo: ${newEstimatedTime}\n• Motivo: ${reason}`,
        type: 'system',
        metadata: new Map([
          ['agreementId', agreement.agreementId],
          ['action', 'renegotiated'],
          ['automated', true]
        ])
      });
      await systemMessage.save();

      res.json({
        success: true,
        message: 'Acordo renegociado com sucesso',
        agreement: {
          agreementId: agreement.agreementId,
          status: agreement.status,
          version: agreement.version,
          renegotiationData: agreement.renegotiationData
        }
      });
    } catch (error) {
      console.error('Erro ao renegociar acordo:', error);
      if (error.message.includes('Cannot renegotiate agreement')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async getConversationAgreements(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user?.id || req.user?._id;
      const { status } = req.query;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }

      const agreements = await Agreement.findByConversation(conversationId, status);

      res.json({
        success: true,
        agreements: agreements.map(agreement => ({
          agreementId: agreement.agreementId,
          proposalSnapshot: agreement.proposalSnapshot,
          parties: agreement.parties,
          status: agreement.status,
          version: agreement.version,
          createdAt: agreement.createdAt,
          completedAt: agreement.completedAt,
          cancelledAt: agreement.cancelledAt,
          renegotiationData: agreement.renegotiationData
        }))
      });
    } catch (error) {
      console.error('Erro ao listar acordos:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }


  async getUserAgreements(req, res) {
    try {
      const userId = req.user?.id || req.user?._id;
      const { role, status } = req.query;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Usuário não autenticado' });
      }

      const agreements = await Agreement.findByUser(userId, role, status);

      res.json({
        success: true,
        agreements: agreements.map(agreement => ({
          agreementId: agreement.agreementId,
          conversationId: agreement.conversationId,
          proposalSnapshot: agreement.proposalSnapshot,
          parties: agreement.parties,
          status: agreement.status,
          version: agreement.version,
          createdAt: agreement.createdAt,
          completedAt: agreement.completedAt,
          cancelledAt: agreement.cancelledAt,
          renegotiationData: agreement.renegotiationData
        }))
      });
    } catch (error) {
      console.error('Erro ao listar acordos do usuário:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new AgreementController();
