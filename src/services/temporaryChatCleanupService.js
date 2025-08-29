const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const logger = require('../utils/logger');

class TemporaryChatCleanupService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
  }

  // Iniciar serviço de limpeza automática (executa a cada hora)
  start() {
    if (this.isRunning) {
      logger.warn('Serviço de limpeza de chats temporários já está rodando');
      return;
    }

    // Executar imediatamente e depois a cada hora (3600000 ms = 1 hora)
    this.cleanupExpiredChats();
    this.intervalId = setInterval(async () => {
      await this.cleanupExpiredChats();
    }, 3600000); // 1 hora em milissegundos

    this.isRunning = true;
    logger.info('✅ Serviço de limpeza de chats temporários iniciado (executa a cada hora)');
  }

  // Parar serviço
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('🛑 Serviço de limpeza de chats temporários parado');
  }

  // Limpar chats temporários expirados
  async cleanupExpiredChats() {
    try {
      logger.info('🧹 Iniciando limpeza de chats temporários expirados...');

      const expiredChats = await Conversation.find({
        isTemporary: true,
        status: 'pending',
        expiresAt: { $lt: new Date() }
      });

      if (expiredChats.length === 0) {
        logger.info('✅ Nenhum chat temporário expirado encontrado');
        return { cleanedCount: 0 };
      }

      logger.info(`🔍 Encontrados ${expiredChats.length} chats temporários expirados`);

      let cleanedCount = 0;
      let errorCount = 0;

      for (const chat of expiredChats) {
        try {
          // Expirar o chat
          await chat.expireTemporaryChat();
          
          // Criar mensagem de expiração
          const expirationMessage = new Message({
            conversation: chat._id,
            content: '🚫 Este chat expirou porque a proposta não foi aceita em até 3 dias.',
            type: 'system',
            metadata: {
              type: 'chat_expired',
              expiredAt: new Date(),
              autoCleanup: true
            }
          });

          await expirationMessage.save();
          
          // Atualizar última mensagem
          chat.lastMessage = expirationMessage._id;
          chat.lastMessageAt = new Date();
          await chat.save();
          
          cleanedCount++;
          logger.info(`✅ Chat ${chat._id} expirado com sucesso`);
          
        } catch (error) {
          errorCount++;
          logger.error(`❌ Erro ao expirar chat ${chat._id}:`, error);
        }
      }

      const result = {
        totalFound: expiredChats.length,
        cleanedCount,
        errorCount,
        timestamp: new Date()
      };

      logger.info(`🧹 Limpeza concluída: ${cleanedCount} chats expirados, ${errorCount} erros`);
      
      return result;

    } catch (error) {
      logger.error('❌ Erro durante limpeza de chats temporários:', error);
      throw error;
    }
  }

  // Executar limpeza manual
  async manualCleanup() {
    logger.info('🧹 Executando limpeza manual de chats temporários...');
    return await this.cleanupExpiredChats();
  }

  // Obter estatísticas de chats temporários
  async getStats() {
    try {
      const stats = await Promise.all([
        // Chats temporários ativos (pendentes)
        Conversation.countDocuments({
          isTemporary: true,
          status: 'pending',
          expiresAt: { $gt: new Date() }
        }),
        
        // Chats temporários expirados (mas ainda não limpos)
        Conversation.countDocuments({
          isTemporary: true,
          status: 'pending',
          expiresAt: { $lt: new Date() }
        }),
        
        // Chats temporários já expirados (status expired)
        Conversation.countDocuments({
          isTemporary: true,
          status: 'expired'
        }),
        
        // Chats temporários aceitos (convertidos para permanentes)
        Conversation.countDocuments({
          isTemporary: false,
          status: 'active',
          metadata: { $exists: true }
        })
      ]);

      return {
        activePending: stats[0],
        expiredPending: stats[1], 
        expired: stats[2],
        converted: stats[3],
        total: stats[0] + stats[1] + stats[2],
        needsCleanup: stats[1] > 0
      };
    } catch (error) {
      logger.error('Erro ao obter estatísticas de chats temporários:', error);
      throw error;
    }
  }

  // Verificar se o serviço está rodando
  getStatus() {
    return {
      isRunning: this.isRunning,
      nextRun: this.job ? this.job.nextDate() : null,
      timezone: 'America/Sao_Paulo'
    };
  }
}

module.exports = new TemporaryChatCleanupService();
