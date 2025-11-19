/**
 * Serviço de reconciliação para garantir consistência entre 
 * propostas aceitas, agreements e boostingorders
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const RetryQueue = require('./RetryQueue');

class ReconciliationService {
  /**
   * Verifica propostas aceitas que não possuem Agreement
   * e cria os agreements faltantes
   */
  static async reconcileProposalsWithoutAgreements() {
    try {
      const Conversation = require('../models/Conversation');
      const AcceptedProposal = require('../models/AcceptedProposal');
      const Agreement = require('../models/Agreement');
      
      logger.info('🔄 Iniciando reconciliação de propostas aceitas sem agreements');
      
      // 1. Buscar propostas aceitas nos últimos 30 dias
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const acceptedProposals = await AcceptedProposal.find({
        acceptedAt: { $gte: thirtyDaysAgo },
        status: { $in: ['active', 'accepted'] }
      }).lean();
      
      logger.info(`📊 Encontradas ${acceptedProposals.length} propostas aceitas nos últimos 30 dias`);
      
      // 2. Para cada proposta, verificar se existe um Agreement correspondente
      let missingCount = 0;
      let enqueueCount = 0;
      
      for (const proposal of acceptedProposals) {
        try {
          const existingAgreement = await Agreement.findOne({
            $or: [
              { proposalId: proposal.proposalId },
              { acceptedProposalId: proposal._id }
            ]
          });
          
          if (!existingAgreement) {
            missingCount++;
            logger.warn(`⚠️ Proposta aceita sem Agreement: ${proposal._id}`, {
              proposalId: proposal.proposalId,
              conversationId: proposal.conversationId,
              price: proposal.proposalData?.price
            });
            
            // Enfileirar para criação
            await RetryQueue.enqueue('create_agreement_from_proposal', {
              conversationId: proposal.conversationId,
              proposalId: proposal.proposalId,
              acceptedProposalId: proposal._id,
              userId: proposal.clientData?.userid || 'system'
            }, 30); // Agendar para 30 segundos depois
            
            enqueueCount++;
          }
        } catch (error) {
          logger.error(`❌ Erro ao processar proposta ${proposal._id}: ${error.message}`);
        }
      }
      
      // 3. Buscar conversas com status aceita que não têm agreement
      const conversationsWithoutAgreement = await Conversation.find({
        status: 'accepted',
        boostingStatus: { $in: ['active', 'pending', 'in_progress'] },
        acceptedProposal: { $exists: true },
        agreementId: { $exists: false }
      }).limit(100);
      
      logger.info(`📊 Encontradas ${conversationsWithoutAgreement.length} conversas aceitas sem agreementId`);
      
      for (const conv of conversationsWithoutAgreement) {
        try {
          // Verificar se já existe um agreement para esta conversa
          const existingAgreement = await Agreement.findOne({ conversationId: conv._id });
          
          if (!existingAgreement) {
            // Verificar se existe AcceptedProposal
            let acceptedProposal;
            if (conv.acceptedProposal) {
              acceptedProposal = await AcceptedProposal.findById(conv.acceptedProposal);
            }
            
            if (!acceptedProposal) {
              logger.warn(`⚠️ Conversa ${conv._id} aceita sem AcceptedProposal`);
              continue;
            }
            
            // Enfileirar para criação
            await RetryQueue.enqueue('create_agreement_from_proposal', {
              conversationId: conv._id,
              proposalId: acceptedProposal.proposalId,
              acceptedProposalId: acceptedProposal._id,
              userId: acceptedProposal.clientData?.userid || 'system'
            }, 30);
            
            missingCount++;
            enqueueCount++;
          }
        } catch (error) {
          logger.error(`❌ Erro ao processar conversa ${conv._id}: ${error.message}`);
        }
      }
      
      // 4. Buscar Agreements que não têm BoostingOrder
      const BoostingOrder = require('../models/BoostingOrder');
      
      const agreements = await Agreement.find({
        status: { $ne: 'cancelled' },
        createdAt: { $gte: thirtyDaysAgo }
      }).limit(100).lean();
      
      let missingBoCount = 0;
      
      for (const agreement of agreements) {
        try {
          const boostingOrder = await BoostingOrder.findOne({ agreementId: agreement._id });
          
          if (!boostingOrder) {
            logger.warn(`⚠️ Agreement ${agreement._id} sem BoostingOrder`);
            missingBoCount++;
            
            try {
              await BoostingOrder.createFromAgreement(agreement);
              logger.info(`✅ BoostingOrder criado para agreement: ${agreement._id}`);
            } catch (boError) {
              logger.error(`❌ Erro ao criar BoostingOrder: ${boError.message}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Erro ao verificar BoostingOrder para agreement ${agreement._id}: ${error.message}`);
        }
      }
      
      return {
        acceptedProposalsCount: acceptedProposals.length,
        missingAgreementsCount: missingCount,
        enqueuedCount: enqueueCount,
        missingBoostingOrdersCount: missingBoCount
      };
    } catch (error) {
      logger.error(`❌ Erro na reconciliação: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Verifica especificamente se existe um Agreement para uma proposta
   * com determinado preço
   * @param {number} price - Preço exato da proposta
   */
  static async findProposalByPrice(price) {
    try {
      const AcceptedProposal = require('../models/AcceptedProposal');
      const Agreement = require('../models/Agreement');
      const BoostingOrder = require('../models/BoostingOrder');
      
      // Converter para número
      const searchPrice = Number(price);
      if (isNaN(searchPrice)) {
        throw new Error('Preço inválido');
      }
      
      // Margem de erro para comparação de preços
      const priceDelta = 0.01;
      
      // 1. Buscar propostas com este preço
      const proposals = await AcceptedProposal.find().lean();
      const matchingProposals = proposals.filter(p => {
        // Extrair preço da proposta
        const propPrice = typeof p.proposalData?.price === 'string'
          ? parseFloat(p.proposalData.price.replace(/\./g, '').replace(',', '.'))
          : Number(p.proposalData?.price || 0);
        
        return Math.abs(propPrice - searchPrice) < priceDelta;
      });
      
      if (matchingProposals.length === 0) {
        logger.info(`Nenhuma proposta encontrada com preço R$ ${searchPrice.toFixed(2)}`);
        return { found: false };
      }
      
      logger.info(`Encontradas ${matchingProposals.length} propostas com preço aproximado R$ ${searchPrice.toFixed(2)}`);
      
      // 2. Para cada proposta encontrada, verificar agreements
      const result = [];
      
      for (const proposal of matchingProposals) {
        const agreement = await Agreement.findOne({
          $or: [
            { proposalId: proposal.proposalId },
            { acceptedProposalId: proposal._id }
          ]
        });
        
        let boostingOrder = null;
        if (agreement) {
          boostingOrder = await BoostingOrder.findOne({ agreementId: agreement._id });
        }
        
        result.push({
          proposal: {
            _id: proposal._id,
            proposalId: proposal.proposalId,
            conversationId: proposal.conversationId,
            price: proposal.proposalData?.price,
            game: proposal.proposalData?.game,
            acceptedAt: proposal.acceptedAt
          },
          agreement: agreement ? {
            _id: agreement._id,
            agreementId: agreement.agreementId,
            status: agreement.status
          } : null,
          boostingOrder: boostingOrder ? {
            _id: boostingOrder._id,
            status: boostingOrder.status
          } : null
        });
        
        // Se não tiver agreement, criar
        if (!agreement) {
          logger.warn(`⚠️ Proposta ${proposal._id} sem Agreement, criando...`);
          
          await RetryQueue.enqueue('create_agreement_from_proposal', {
            conversationId: proposal.conversationId,
            proposalId: proposal.proposalId,
            acceptedProposalId: proposal._id,
            userId: proposal.clientData?.userid || 'system'
          }, 5); // Agendar para 5 segundos depois
        } 
        // Se tiver agreement mas não tiver boostingOrder, criar
        else if (!boostingOrder) {
          logger.warn(`⚠️ Agreement ${agreement._id} sem BoostingOrder, criando...`);
          
          try {
            await BoostingOrder.createFromAgreement(agreement);
            logger.info(`✅ BoostingOrder criado para agreement: ${agreement._id}`);
          } catch (boError) {
            logger.error(`❌ Erro ao criar BoostingOrder: ${boError.message}`);
          }
        }
      }
      
      return { found: true, proposals: result };
    } catch (error) {
      logger.error(`❌ Erro ao buscar proposta por preço: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ReconciliationService;
