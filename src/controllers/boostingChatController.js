const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AcceptedProposal = require('../models/AcceptedProposal');
const Agreement = require('../models/Agreement');
const Report = require('../models/Report');
const axios = require('axios');

class BoostingChatController {

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


      const apiUrl = process.env.MAIN_API_URL || 'https://zenithapi-steel.vercel.app';
      
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


      const apiUrl = process.env.MAIN_API_URL || 'https://zenithapi-steel.vercel.app';
      
      try {

        const itemId = conversation.marketplaceItem || conversation.proposal;
        
        if (itemId) {
          await axios.post(`${apiUrl}/api/boosting-requests/${itemId}/cancel`, {
            reason,
            conversationId,
            cancelledBy: userId
          }, {
            headers: {
              'Authorization': req.headers.authorization
            }
          });
        } else {
          console.log('Nenhum marketplaceItem ou proposal encontrado na conversa para notificar backend');
        }
      } catch (apiError) {
        console.error('Erro ao notificar cancelamento:', apiError);
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


      const conversation = await Conversation.findById(conversationId);
      if (!conversation || !conversation.isParticipant(userId)) {
        return res.status(403).json({ success: false, message: 'Acesso negado à conversa' });
      }


      let agreement = await Agreement.findOne({ conversationId });
      let acceptedProposal = await AcceptedProposal.findOne({ conversationId });
      

      if (acceptedProposal && !agreement) {
        try {
          const AgreementMigration = require('../middleware/agreementMigrationMiddleware');
          agreement = await AgreementMigration.migrateProposalToAgreement(acceptedProposal);
        } catch (migrationError) {
          console.warn('Falha na migração durante confirmDelivery:', migrationError);
        }
      }


      const boosterUserId = acceptedProposal?.booster?.userid || 
                           agreement?.boosterUserId || 
                           conversation.participants.find(p => p.toString() !== userId);


      const rawPriceForFinalization = agreement?.proposalSnapshot?.price ?? acceptedProposal?.price ?? null;
      const numericPriceFinal = typeof rawPriceForFinalization === 'string'
        ? parseFloat(rawPriceForFinalization.replace(/\./g, '').replace(',', '.'))
        : (rawPriceForFinalization != null ? Number(rawPriceForFinalization) : null);
      const formattedPriceFinal = (numericPriceFinal != null && !isNaN(numericPriceFinal))
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numericPriceFinal)
        : null;

      const systemMessage = new Message({
        conversation: conversationId,
        sender: userId,
        content: formattedPriceFinal
          ? `✅ Entrega confirmada pelo cliente\n💰 Valor: ${formattedPriceFinal}\n🔒 Chat finalizado`
          : `✅ Entrega confirmada pelo cliente\n🔒 Chat finalizado`,
        type: 'system',
        metadata: {
          type: 'delivery_confirmed',
          systemType: 'order_finalized',
          confirmedBy: userId,
          closedAt: new Date(),
          price: (numericPriceFinal != null && !isNaN(numericPriceFinal)) ? numericPriceFinal : undefined,
          priceFormatted: formattedPriceFinal || undefined
        }
      });

      await systemMessage.save();


      if (boosterUserId) {
        const boosterMessage = new Message({
          conversation: conversationId,
          sender: userId,
          content: `🎉 Parabéns! O cliente confirmou a entrega do seu serviço.\n\n💰 O pagamento será processado em breve.\n🔒 Este chat foi finalizado.\n\nObrigado por usar nossa plataforma!`,
          type: 'system',
          metadata: {
            type: 'booster_notification',
            targetUser: boosterUserId,
            confirmedBy: userId
          }
        });

        await boosterMessage.save();
        console.log(`✅ Mensagem para booster ${boosterUserId} criada`);
      }


      conversation.lastMessage = systemMessage._id;
      conversation.lastMessageAt = new Date();
      conversation.boostingStatus = 'completed';
      conversation.metadata.set('status', 'delivery_confirmed');
      conversation.deliveryConfirmedAt = new Date();
      

      console.log(`🔒 [DEBUG] Bloqueando conversa ${conversationId} no HackloteChatApi...`);
      console.log(`   Estado anterior: isBlocked=${conversation.isBlocked}`);
      
      conversation.isBlocked = true;
      conversation.blockedReason = 'pedido_finalizado';
      conversation.blockedAt = new Date();
      conversation.blockedBy = userId;
      
      const savedConversation = await conversation.save();
      
      console.log(`✅ [DEBUG] Conversa bloqueada no HackloteChatApi:`);
      console.log(`   isBlocked: ${savedConversation.isBlocked}`);
      console.log(`   blockedReason: ${savedConversation.blockedReason}`);
      console.log(`   conversationId: ${savedConversation._id}`);


      if (agreement) {
        if (agreement.status === 'completed') {
          console.log(`✅ Agreement ${agreement.agreementId} já está completado - operação idempotente`);
        } else if (agreement.status === 'active') {
          await agreement.complete(userId, { completedVia: 'confirmDelivery' }, `delivery_${conversationId}_${Date.now()}`);
        } else {
          console.warn(`⚠️ Agreement ${agreement.agreementId} está em status ${agreement.status} - não pode ser completado`);
        }
      } else if (acceptedProposal) {
        if (acceptedProposal.status === 'completed') {
          console.log(`✅ AcceptedProposal já está completado - operação idempotente`);
        } else {
          await acceptedProposal.complete();
        }
      }


      const apiUrl = process.env.MAIN_API_URL || 'https://zenithapi-steel.vercel.app';
      
      try {

        const itemId = conversation.marketplaceItem || conversation.proposal;
        
        if (itemId) {
          await axios.post(`${apiUrl}/api/boosting-proposals/${itemId}/confirm-delivery`, {
            conversationId,
            confirmedBy: userId
          }, {
            headers: {
              'Authorization': req.headers.authorization
            }
          });
        } else {
          console.log('Nenhum marketplaceItem ou proposal encontrado na conversa para notificar backend');
        }
      } catch (apiError) {
        console.error('Erro ao notificar confirmação de entrega:', apiError);

        if (apiError.response?.status >= 400) {
          console.error('❌ Main API failed - rolling back conversation status');
          conversation.boostingStatus = 'active';
          conversation.isBlocked = false;
          conversation.blockedReason = null;
          conversation.blockedAt = null;
          conversation.blockedBy = null;
          await conversation.save();
          
          return res.status(500).json({
            success: false,
            message: 'Erro ao processar confirmação no sistema principal',
            details: apiError.message
          });
        }
      }


      const webSocketServer = req.app.get('webSocketServer');
      if (webSocketServer) {
        const participants = savedConversation.participants?.map?.(p => p.toString ? p.toString() : p) || [];
        participants.forEach(participantId => {
          webSocketServer.sendToUser(participantId, {
            type: 'delivery_confirmed',
            data: {
              conversationId,
              boostingStatus: 'completed',
              confirmedBy: userId,
              confirmedAt: new Date(),
              blocked: true,

              orderId: (savedConversation.marketplaceItem || savedConversation.proposal) || null,
              price: (numericPriceFinal != null && !isNaN(numericPriceFinal)) ? numericPriceFinal : null,
              priceFormatted: formattedPriceFinal || null
            },
            timestamp: new Date().toISOString()
          });
        });

        try {
          const messageToSend = { ...systemMessage.toObject(), content: systemMessage.content };
          participants.forEach(participantId => {
            webSocketServer.sendToUser(participantId, {
              type: 'message:new',
              data: {
                message: messageToSend,
                conversationId
              },
              timestamp: new Date().toISOString()
            });
          });
        } catch (_) {}
      }

      res.json({
        success: true,
        message: 'Entrega confirmada com sucesso',
        systemMessage,
        blocked: true
      });
    } catch (error) {
      console.error('Erro ao confirmar entrega:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor' });
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
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithapi-steel.vercel.app';
        

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


      const reportData = new Report({
        conversationId,
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

      await reportData.save();


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
        const apiUrl = process.env.MAIN_API_URL || 'https://zenithapi-steel.vercel.app';
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
