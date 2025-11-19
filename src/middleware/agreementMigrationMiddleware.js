const Agreement = require('../models/Agreement');
const AcceptedProposal = require('../models/AcceptedProposal');
const logger = require('../utils/logger');

/**
 * Middleware de migração automática: AcceptedProposal → Agreement
 * Garante retrocompatibilidade sem quebrar contratos existentes
 */
class AgreementMigrationMiddleware {
  
  /**
   * Migra AcceptedProposal para Agreement se ainda não foi migrado
   */
  static async migrateProposalToAgreement(acceptedProposal) {
    try {

      const existingAgreement = await Agreement.findOne({ 
        acceptedProposalId: acceptedProposal._id 
      });
      
      if (existingAgreement) {
        logger.info(`Agreement já existe: ${existingAgreement.agreementId}`);
        return existingAgreement;
      }


      const agreement = new Agreement({
        conversationId: acceptedProposal.conversationId,
        proposalId: acceptedProposal.proposalId,
        acceptedProposalId: acceptedProposal._id,
        
        proposalSnapshot: {
          game: acceptedProposal.game,
          category: acceptedProposal.category,
          currentRank: acceptedProposal.currentRank,
          desiredRank: acceptedProposal.desiredRank,
          description: acceptedProposal.description,
          price: acceptedProposal.price,
          originalPrice: acceptedProposal.originalPrice || acceptedProposal.price,
          estimatedTime: acceptedProposal.estimatedTime
        },
        
        parties: {
          client: {
            userid: acceptedProposal.client.userid,
            name: acceptedProposal.client.name,
            email: acceptedProposal.client.email,
            avatar: acceptedProposal.client.avatar,
            metadata: new Map([
              ['isVerified', acceptedProposal.client.isVerified],
              ['totalOrders', acceptedProposal.client.totalOrders],
              ['rating', acceptedProposal.client.rating],
              ['registeredAt', acceptedProposal.client.registeredAt]
            ])
          },
          booster: {
            userid: acceptedProposal.booster.userid,
            name: acceptedProposal.booster.name,
            email: acceptedProposal.booster.email,
            avatar: acceptedProposal.booster.avatar,
            rating: acceptedProposal.booster.rating,
            metadata: new Map([
              ['isVerified', acceptedProposal.booster.isVerified],
              ['totalBoosts', acceptedProposal.booster.totalBoosts],
              ['completedBoosts', acceptedProposal.booster.completedBoosts],
              ['specializations', acceptedProposal.booster.specializations],
              ['registeredAt', acceptedProposal.booster.registeredAt]
            ])
          }
        },
        

        status: this.mapAcceptedProposalStatus(acceptedProposal.status),
        

        createdAt: acceptedProposal.acceptedAt,
        activatedAt: acceptedProposal.acceptedAt,
        completedAt: acceptedProposal.completedAt,
        cancelledAt: acceptedProposal.cancelledAt,
        

        renegotiationData: this.migrateRenegotiationHistory(acceptedProposal.renegotiationHistory),
        
        financial: {
          totalAmount: acceptedProposal.price,
          currency: 'BRL',
          paymentStatus: acceptedProposal.status === 'completed' ? 'paid' : 'pending'
        }
      });


      agreement.addAction('created', acceptedProposal.client.userid, {
        migratedFrom: 'AcceptedProposal',
        originalId: acceptedProposal._id
      }, `migration_${acceptedProposal._id}`);
      
      if (acceptedProposal.status === 'completed' && acceptedProposal.completedAt) {
        agreement.addAction('completed', acceptedProposal.client.userid, {
          migratedFrom: 'AcceptedProposal',
          completedAt: acceptedProposal.completedAt
        }, `migration_complete_${acceptedProposal._id}`);
      }
      
      if (acceptedProposal.status === 'cancelled' && acceptedProposal.cancelledAt) {
        agreement.addAction('cancelled', acceptedProposal.client.userid, {
          migratedFrom: 'AcceptedProposal',
          cancelledAt: acceptedProposal.cancelledAt
        }, `migration_cancel_${acceptedProposal._id}`);
      }

      await agreement.save();
      
      logger.info(`Migração concluída: AcceptedProposal ${acceptedProposal._id} → Agreement ${agreement.agreementId}`);
      return agreement;
      
    } catch (error) {
      logger.error('Erro ao migrar AcceptedProposal para Agreement:', error);
      throw error;
    }
  }

  /**
   * Mapear status de AcceptedProposal para Agreement
   */
  static mapAcceptedProposalStatus(oldStatus) {
    const statusMap = {
      'active': 'active',
      'completed': 'completed', 
      'cancelled': 'cancelled',
      'disputed': 'disputed'
    };
    
    return statusMap[oldStatus] || 'active';
  }

  /**
   * Migrar histórico de renegociações
   */
  static migrateRenegotiationHistory(renegotiationHistory = []) {
    if (!renegotiationHistory.length) return {};

    const lastRenegotiation = renegotiationHistory[renegotiationHistory.length - 1];
    
    return {
      originalPrice: renegotiationHistory[0]?.previousPrice,
      currentPrice: lastRenegotiation.newPrice,
      originalTime: renegotiationHistory[0]?.previousTime,
      currentEstimatedTime: lastRenegotiation.newEstimatedTime,
      renegotiationCount: renegotiationHistory.length,
      lastRenegotiatedAt: lastRenegotiation.requestedAt,
      lastRenegotiatedBy: lastRenegotiation.requestedBy
    };
  }

  /**
   * Middleware para endpoints que precisam de Agreement
   * Auto-migra AcceptedProposal se necessário
   */
  static autoMigrate() {
    return async (req, res, next) => {
      try {
        const { conversationId } = req.params;
        
        if (!conversationId) {
          return next();
        }


        const acceptedProposal = await AcceptedProposal.findOne({ conversationId });
        
        if (!acceptedProposal) {
          return next();
        }


        let agreement = await Agreement.findOne({ 
          acceptedProposalId: acceptedProposal._id 
        });


        if (!agreement) {
          agreement = await this.migrateProposalToAgreement(acceptedProposal);
        }


        req.agreement = agreement;
        req.acceptedProposal = acceptedProposal;
        
        next();
      } catch (error) {
        logger.error('Erro no middleware de migração:', error);
        next(error);
      }
    };
  }

  /**
   * Middleware para garantir Agreement existe antes de operações críticas
   */
  static ensureAgreement() {
    return async (req, res, next) => {
      try {
        const { conversationId, agreementId } = req.params;
        
        let agreement = null;
        

        if (agreementId) {
          agreement = await Agreement.findByAgreementId(agreementId);
        }

        else if (conversationId) {
          agreement = await Agreement.findOne({ conversationId });
          

          if (!agreement) {
            const acceptedProposal = await AcceptedProposal.findOne({ conversationId });
            if (acceptedProposal) {
              agreement = await this.migrateProposalToAgreement(acceptedProposal);
            }
          }
        }
        
        if (!agreement) {
          return res.status(404).json({ 
            success: false, 
            message: 'Acordo não encontrado' 
          });
        }
        
        req.agreement = agreement;
        next();
      } catch (error) {
        logger.error('Erro ao garantir Agreement:', error);
        next(error);
      }
    };
  }

  /**
   * Middleware de compatibilidade: responde tanto para Agreement quanto AcceptedProposal
   */
  static dualCompatibility() {
    return async (req, res, next) => {
      try {
        const { conversationId } = req.params;
        
        if (!conversationId) {
          return next();
        }


        const acceptedProposal = await AcceptedProposal.findOne({ conversationId });
        let agreement = null;
        
        if (acceptedProposal) {
          agreement = await Agreement.findOne({ 
            acceptedProposalId: acceptedProposal._id 
          });
          

          if (!agreement) {
            agreement = await this.migrateProposalToAgreement(acceptedProposal);
          }
        }


        req.acceptedProposal = acceptedProposal;
        req.agreement = agreement;
        

        req.unifiedResponse = (additionalData = {}) => {
          const baseResponse = {
            success: true,

            ...(agreement && {
              agreementId: agreement.agreementId,
              agreementStatus: agreement.status,
              agreementVersion: agreement.version
            }),

            ...(acceptedProposal && {
              proposalId: acceptedProposal._id,
              proposalStatus: acceptedProposal.status
            }),
            ...additionalData
          };
          
          return baseResponse;
        };

        next();
      } catch (error) {
        logger.error('Erro no middleware de compatibilidade dual:', error);
        next(error);
      }
    };
  }

  /**
   * Migração em lote de todas as AcceptedProposal pendentes
   */
  static async batchMigration() {
    try {
      logger.info('🚀 Iniciando migração em lote...');
      

      const acceptedProposals = await AcceptedProposal.find({});
      
      let migratedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      
      for (const proposal of acceptedProposals) {
        try {

          const existingAgreement = await Agreement.findOne({ 
            acceptedProposalId: proposal._id 
          });
          
          if (existingAgreement) {
            skippedCount++;
            continue;
          }


          await this.migrateProposalToAgreement(proposal);
          migratedCount++;
          
        } catch (error) {
          logger.error(`Erro ao migrar proposta ${proposal._id}:`, error);
          errorCount++;
        }
      }
      
      logger.info(`Migração em lote concluída: ${migratedCount} migradas, ${skippedCount} ignoradas, ${errorCount} erros`);
      
      return {
        total: acceptedProposals.length,
        migrated: migratedCount,
        skipped: skippedCount,
        errors: errorCount
      };
      
    } catch (error) {
      logger.error('Erro na migração em lote:', error);
      throw error;
    }
  }
}

module.exports = AgreementMigrationMiddleware;
