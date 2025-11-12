/**
 * Job de reconciliação automática para garantir consistência de dados
 */
const cron = require('node-cron');
const ReconciliationService = require('../services/ReconciliationService');
const RetryQueue = require('../services/RetryQueue');
const logger = require('../utils/logger');

class ReconciliationJob {
  /**
   * Iniciar jobs programados
   */
  static startJobs() {
    // Processar fila de retry a cada 5 minutos
    cron.schedule('*/5 * * * *', async () => {
      try {
        logger.info('🕒 Executando job de processamento da fila de retry');
        const processed = await RetryQueue.processPendingTasks();
        logger.info(`✅ Job de processamento concluído: ${processed} tarefas processadas`);
      } catch (error) {
        logger.error(`❌ Erro no job de processamento da fila: ${error.message}`);
      }
    });
    
    // Reconciliar propostas sem agreements uma vez por dia às 03:00
    cron.schedule('0 3 * * *', async () => {
      try {
        logger.info('🕒 Executando job de reconciliação de propostas');
        const result = await ReconciliationService.reconcileProposalsWithoutAgreements();
        logger.info(`✅ Job de reconciliação concluído`, result);
      } catch (error) {
        logger.error(`❌ Erro no job de reconciliação: ${error.message}`);
      }
    });
    
    logger.info('✅ Jobs de reconciliação iniciados com sucesso');
  }
  
  /**
   * Executa reconciliação manual
   */
  static async runManualReconciliation() {
    try {
      logger.info('🔄 Iniciando reconciliação manual');
      
      // Processar fila de retry
      const processed = await RetryQueue.processPendingTasks();
      logger.info(`✅ Processamento da fila concluído: ${processed} tarefas processadas`);
      
      // Reconciliar propostas
      const result = await ReconciliationService.reconcileProposalsWithoutAgreements();
      logger.info(`✅ Reconciliação concluída`, result);
      
      return {
        processedTasks: processed,
        reconciliationResult: result
      };
    } catch (error) {
      logger.error(`❌ Erro na reconciliação manual: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Reconcilia proposta específica com preço exato
   */
  static async reconcileSpecificProposal(price) {
    try {
      logger.info(`🔄 Iniciando reconciliação específica para proposta com preço R$ ${price}`);
      const result = await ReconciliationService.findProposalByPrice(price);
      logger.info(`✅ Reconciliação específica concluída`, { 
        found: result.found, 
        count: result.proposals?.length || 0 
      });
      return result;
    } catch (error) {
      logger.error(`❌ Erro na reconciliação específica: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ReconciliationJob;
