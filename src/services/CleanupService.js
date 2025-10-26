/**
 * Serviço de Limpeza Automática
 * 
 * Executa tarefas de limpeza periódicas:
 * - Remove pedidos de boosting expirados (sem propostas aceitas após 3 dias)
 */

const cron = require('node-cron');
const BoostingRequest = require('../models/BoostingRequest');
const AcceptedProposal = require('../models/AcceptedProposal');
const axios = require('axios');

const HACKLOTE_API_URL = process.env.HACKLOTE_API_URL || 'https://zenithggapi.vercel.app/api';
const EXPIRATION_DAYS = 3;

class CleanupService {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * Inicia os jobs de limpeza
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  CleanupService já está rodando');
      return;
    }

    console.log('🧹 Iniciando CleanupService...');

    // Job 1: Limpar pedidos de boosting expirados
    // Executa todo dia às 03:00 AM
    const boostingCleanupJob = cron.schedule('0 3 * * *', async () => {
      console.log('\n🔄 [CleanupService] Executando limpeza de pedidos de boosting...');
      try {
        const result = await this.cleanExpiredBoostings();
        console.log(`✅ [CleanupService] Limpeza concluída: ${result.deleted} pedidos deletados`);
      } catch (error) {
        console.error('❌ [CleanupService] Erro na limpeza de boosting:', error.message);
      }
    }, {
      scheduled: true,
      timezone: "America/Sao_Paulo"
    });

    this.jobs.push({
      name: 'boosting-cleanup',
      job: boostingCleanupJob,
      schedule: '0 3 * * *'
    });

    // Job 2: Verificação rápida a cada 6 horas (opcional)
    const quickCheckJob = cron.schedule('0 */6 * * *', async () => {
      console.log('\n🔍 [CleanupService] Verificação rápida de pedidos expirados...');
      try {
        const result = await this.cleanExpiredBoostings();
        if (result.deleted > 0) {
          console.log(`✅ [CleanupService] Verificação rápida: ${result.deleted} pedidos deletados`);
        }
      } catch (error) {
        console.error('❌ [CleanupService] Erro na verificação rápida:', error.message);
      }
    }, {
      scheduled: true,
      timezone: "America/Sao_Paulo"
    });

    this.jobs.push({
      name: 'quick-check',
      job: quickCheckJob,
      schedule: '0 */6 * * *'
    });

    this.isRunning = true;
    console.log('✅ CleanupService iniciado com sucesso!');
    console.log(`📅 Jobs agendados:`);
    this.jobs.forEach(j => {
      console.log(`   - ${j.name}: ${j.schedule}`);
    });
  }

  /**
   * Para todos os jobs
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Parando CleanupService...');
    
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      console.log(`   ✅ Job ${name} parado`);
    });

    this.jobs = [];
    this.isRunning = false;
    console.log('✅ CleanupService parado');
  }

  /**
   * Limpa pedidos de boosting expirados
   */
  async cleanExpiredBoostings() {
    try {
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() - EXPIRATION_DAYS);

      // Buscar pedidos expirados
      const expiredBoostings = await BoostingRequest.find({
        createdAt: { $lt: expirationDate },
        status: 'open'
      });

      if (expiredBoostings.length === 0) {
        return { deleted: 0, checked: 0 };
      }

      console.log(`   📊 Encontrados ${expiredBoostings.length} pedidos expirados para verificar`);

      let deletedCount = 0;
      let checkedCount = 0;

      for (const boosting of expiredBoostings) {
        checkedCount++;
        
        try {
          // Verificar se existe proposta aceita
          const hasAcceptedProposal = await AcceptedProposal.findOne({
            boostingId: boosting._id.toString(),
            status: { $in: ['pending', 'in_progress', 'completed'] }
          });

          if (hasAcceptedProposal) {
            continue;
          }

          // Verificar propostas pendentes na API
          let hasPendingProposals = false;
          try {
            const proposalsResponse = await axios.get(
              `${HACKLOTE_API_URL}/boosting/${boosting._id}/proposals`,
              {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
              }
            );

            if (proposalsResponse.data?.success && proposalsResponse.data?.data?.proposals) {
              const pendingProposals = proposalsResponse.data.data.proposals.filter(
                p => p.status === 'pending' || p.status === 'accepted'
              );
              hasPendingProposals = pendingProposals.length > 0;
            }
          } catch (apiError) {
            // Se falhar, não deletar por segurança
            continue;
          }

          if (hasPendingProposals) {
            continue;
          }

          // Deletar da API principal
          try {
            await axios.delete(
              `${HACKLOTE_API_URL}/boosting/${boosting._id}`,
              {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
              }
            );
          } catch (apiError) {
            console.warn(`   ⚠️  Erro ao deletar boosting ${boosting._id} da API:`, apiError.message);
          }

          // Deletar do MongoDB local
          await BoostingRequest.deleteOne({ _id: boosting._id });
          
          console.log(`   🗑️  Pedido ${boosting._id} deletado (criado em ${boosting.createdAt.toISOString()})`);
          deletedCount++;

        } catch (error) {
          console.error(`   ❌ Erro ao processar boosting ${boosting._id}:`, error.message);
        }
      }

      return { deleted: deletedCount, checked: checkedCount };

    } catch (error) {
      console.error('   ❌ Erro ao limpar pedidos expirados:', error.message);
      throw error;
    }
  }

  /**
   * Executa limpeza manualmente (para testes)
   */
  async runManually() {
    console.log('🔧 Executando limpeza manual...');
    try {
      const result = await this.cleanExpiredBoostings();
      console.log(`✅ Limpeza manual concluída:`);
      console.log(`   - Verificados: ${result.checked}`);
      console.log(`   - Deletados: ${result.deleted}`);
      return result;
    } catch (error) {
      console.error('❌ Erro na limpeza manual:', error);
      throw error;
    }
  }
}

// Singleton
const cleanupService = new CleanupService();

module.exports = cleanupService;
