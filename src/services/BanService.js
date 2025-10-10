const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * ✅ SERVIÇO DE BANIMENTO EM TEMPO REAL
 * Gerencia banimentos e notifica todas as conexões ativas
 */
class BanService {
  constructor() {
    this.wsServer = null;
  }

  /**
   * Inicializar com referência ao WebSocket Server
   */
  setWebSocketServer(wsServer) {
    this.wsServer = wsServer;
    logger.info('✅ BanService inicializado com WebSocket Server');
  }

  /**
   * ✅ BANIR USUÁRIO E DESCONECTAR IMEDIATAMENTE
   * @param {string} userId - ID do usuário a ser banido
   * @param {string} reason - Motivo do banimento
   * @param {string} bannedBy - ID do admin que baniu
   * @param {number|null} duration - Duração em dias (null = permanente)
   */
  async banUser(userId, reason, bannedBy = null, duration = null) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      if (user.banned) {
        logger.warn(`Usuário ${userId} já está banido`);
        return {
          success: false,
          message: 'Usuário já está banido',
          alreadyBanned: true
        };
      }

      // Banir no banco de dados
      await user.banUser(reason, bannedBy, duration);
      
      logger.warn(`🚫 USUÁRIO BANIDO: ${userId}`, {
        reason,
        bannedBy,
        duration: duration ? `${duration} dias` : 'Permanente',
        bannedAt: user.bannedAt
      });

      // ✅ DESCONECTAR IMEDIATAMENTE DE TODAS AS CONEXÕES
      if (this.wsServer) {
        this.disconnectUserImmediately(userId, reason);
      } else {
        logger.warn('⚠️ WebSocket Server não disponível, usuário não será desconectado imediatamente');
      }

      return {
        success: true,
        message: 'Usuário banido com sucesso',
        bannedAt: user.bannedAt,
        bannedUntil: user.bannedUntil,
        isPermanent: !user.bannedUntil
      };

    } catch (error) {
      logger.error('Erro ao banir usuário:', error);
      throw error;
    }
  }

  /**
   * ✅ DESBANIR USUÁRIO
   */
  async unbanUser(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      if (!user.banned) {
        return {
          success: false,
          message: 'Usuário não está banido'
        };
      }

      await user.unbanUser();
      
      logger.info(`✅ Usuário desbanido: ${userId}`);

      return {
        success: true,
        message: 'Usuário desbanido com sucesso'
      };

    } catch (error) {
      logger.error('Erro ao desbanir usuário:', error);
      throw error;
    }
  }

  /**
   * ✅ DESCONECTAR USUÁRIO IMEDIATAMENTE
   * Envia mensagem de banimento para TODAS as conexões ativas
   */
  disconnectUserImmediately(userId, reason) {
    if (!this.wsServer) {
      logger.warn('WebSocket Server não disponível');
      return;
    }

    logger.warn(`🚫 Desconectando usuário banido: ${userId}`);

    // Enviar mensagem de banimento para todas as conexões do usuário
    this.wsServer.sendToUser(userId, {
      type: 'user:banned',
      banned: true,
      reason: reason || 'Violação dos termos de uso',
      forceLogout: true,
      timestamp: new Date().toISOString()
    });

    // Aguardar um pouco para garantir que a mensagem foi enviada
    setTimeout(() => {
      // Desconectar todas as conexões WebSocket
      this.wsServer.disconnectUser(userId, 'Account banned');
    }, 500);
  }

  /**
   * ✅ VERIFICAR SE USUÁRIO ESTÁ BANIDO
   */
  async isUserBanned(userId) {
    try {
      const user = await User.findById(userId).select('banned bannedAt bannedReason bannedUntil');
      
      if (!user) {
        return { banned: false, notFound: true };
      }

      if (user.isBanned()) {
        return {
          banned: true,
          bannedAt: user.bannedAt,
          bannedReason: user.bannedReason,
          bannedUntil: user.bannedUntil,
          isPermanent: !user.bannedUntil
        };
      }

      return { banned: false };

    } catch (error) {
      logger.error('Erro ao verificar banimento:', error);
      return { banned: false, error: error.message };
    }
  }

  /**
   * ✅ LISTAR USUÁRIOS BANIDOS
   */
  async listBannedUsers(limit = 50, skip = 0) {
    try {
      const users = await User.find({ banned: true })
        .select('name email banned bannedAt bannedReason bannedUntil bannedBy')
        .populate('bannedBy', 'name email')
        .sort({ bannedAt: -1 })
        .limit(limit)
        .skip(skip);

      const total = await User.countDocuments({ banned: true });

      return {
        success: true,
        users,
        total,
        page: Math.floor(skip / limit) + 1,
        totalPages: Math.ceil(total / limit)
      };

    } catch (error) {
      logger.error('Erro ao listar usuários banidos:', error);
      throw error;
    }
  }
}

// Singleton
const banService = new BanService();

module.exports = banService;
