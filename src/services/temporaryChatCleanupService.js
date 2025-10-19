const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const logger = require('../utils/logger');

class TemporaryChatCleanupService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Serviço de limpeza de chats temporários já está rodando');
      return;
    }

    this.cleanupExpiredChats().catch((err) => {
      logger.error('Erro na execução inicial da limpeza de chats temporários:', err);
    });

    this.intervalId = setInterval(() => {
      this.cleanupExpiredChats().catch((err) => {
        logger.error('Erro na execução agendada da limpeza de chats temporários:', err);
      });
    }, 3600000);

    this.isRunning = true;
    logger.info('Serviço de limpeza de chats temporários iniciado (executa a cada hora)');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('🛑 Serviço de limpeza de chats temporários parado');
  }

  async cleanupExpiredChats() {
    try {
      logger.info('🧹 Iniciando limpeza de chats temporários expirados...');

      const expiredChats = await Conversation.find({
        isTemporary: true,
        status: 'pending',
        expiresAt: { $lt: new Date() }
      });

      if (expiredChats.length === 0) {
        logger.info('Nenhum chat temporário expirado encontrado');
        return { cleanedCount: 0 };
      }

      logger.info(`🔍 Encontrados ${expiredChats.length} chats temporários expirados`);

      let cleanedCount = 0;
      let errorCount = 0;

      for (const chat of expiredChats) {
        try {
          // Expirar o chat
          await chat.expireTemporaryChat();

          // CORREÇÃO: Criar mensagem de sistema informando expiração
          // Garantir que temos um participante válido
          if (chat.participants && chat.participants.length > 0) {
            // Extrair ObjectId do participante (pode ser objeto ou ObjectId)
            const systemSenderId = chat.participants[0]._id || chat.participants[0];
            
            // Validar que temos um ID válido
            if (!systemSenderId) {
              logger.warn(`⚠️ Chat ${chat._id} não tem participante válido, pulando mensagem de expiração`);
            } else {
              const expirationMessage = new Message({
                conversation: chat._id,
                sender: systemSenderId,
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
              
              logger.info(`📨 Mensagem de expiração criada para chat ${chat._id}`);
            }
          } else {
            logger.warn(`⚠️ Chat ${chat._id} não tem participantes, pulando mensagem de expiração`);
          }
          
          cleanedCount++;
          logger.info(`Chat ${chat._id} expirado com sucesso`);
          
        } catch (error) {
          errorCount++;
          logger.error(`❌ Erro ao expirar chat ${chat._id}:`, error);
          // Log detalhado do erro para debug
          if (error.errors) {
            Object.keys(error.errors).forEach(key => {
              logger.error(`  - Campo ${key}: ${error.errors[key].message}`);
            });
          }
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

  async manualCleanup() {
    logger.info('🧹 Executando limpeza manual de chats temporários...');
    return await this.cleanupExpiredChats();
  }

  async getStats() {
    try {
      const stats = await Promise.all([

        Conversation.countDocuments({
          isTemporary: true,
          status: 'pending',
          expiresAt: { $gt: new Date() }
        }),
        

        Conversation.countDocuments({
          isTemporary: true,
          status: 'pending',
          expiresAt: { $lt: new Date() }
        }),
        

        Conversation.countDocuments({
          isTemporary: true,
          status: 'expired'
        }),
        

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

  getStatus() {
    return {
      isRunning: this.isRunning,
      nextRun: this.job ? this.job.nextDate() : null,
      timezone: 'America/Sao_Paulo'
    };
  }
}

module.exports = new TemporaryChatCleanupService();
