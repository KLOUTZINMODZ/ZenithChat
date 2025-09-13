/**
 * ConversationHandler - Substitui o polling da API REST
 * Gerencia atualizações de conversas em tempo real via WebSocket
 */

const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const logger = require('../../utils/logger');

class ConversationHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.userLastCheck = new Map();
    this.activePolling = new Map();
  }

  /**
   * Registra eventos do handler
   */
  registerEvents(socket) {
    socket.on('conversations:start_polling', (data) => this.handleStartPolling(socket, data));
    socket.on('conversations:stop_polling', () => this.handleStopPolling(socket));
    socket.on('conversations:get_list', (data) => this.handleGetConversations(socket, data));
  }

  /**
   * Inicia polling de conversas para um usuário
   */
  async handleStartPolling(socket, data) {
    try {
      const userId = socket.userId;
      const { lastCheck } = data || {};

      logger.info(`🔄 Starting conversation polling for user ${userId}`, { lastCheck });


      if (lastCheck) {
        this.userLastCheck.set(userId, parseInt(lastCheck));
      }


      this.activePolling.set(userId, {
        socketId: socket.id,
        startTime: Date.now()
      });


      await this.sendConversationsUpdate(userId);

      socket.emit('conversations:polling_started', {
        success: true,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error starting conversation polling:', error);
      socket.emit('conversations:error', {
        message: 'Erro ao iniciar polling de conversas',
        error: error.message
      });
    }
  }

  /**
   * Para polling de conversas
   */
  handleStopPolling(socket) {
    const userId = socket.userId;
    
    logger.info(`⏹️ Stopping conversation polling for user ${userId}`);
    
    this.activePolling.delete(userId);
    this.userLastCheck.delete(userId);

    socket.emit('conversations:polling_stopped', {
      success: true,
      timestamp: Date.now()
    });
  }

  /**
   * Busca conversas sob demanda (sem polling)
   */
  async handleGetConversations(socket, data) {
    try {
      const userId = socket.userId;
      const { lastCheck } = data || {};

      logger.info(`📋 Getting conversations for user ${userId}`);

      const conversations = await this.getConversationsData(userId, lastCheck);

      socket.emit('conversations:list', {
        conversations: conversations.conversations,
        timestamp: conversations.timestamp,
        hasUpdates: conversations.hasUpdates
      });

    } catch (error) {
      logger.error('Error getting conversations:', error);
      socket.emit('conversations:error', {
        message: 'Erro ao buscar conversas',
        error: error.message
      });
    }
  }

  /**
   * Busca dados das conversas (replicando lógica da API REST)
   */
  async getConversationsData(userId, lastCheck = null) {
    try {

      const conversations = await Conversation.find({
        'participants.user': userId
      })
      .populate('participants.user', 'name profileImage')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'sender',
          select: 'name'
        }
      })
      .sort({ updatedAt: -1 });


      const conversationsWithUnread = await Promise.all(
        conversations.map(async (conv) => {
          const unreadCount = await Message.countDocuments({
            conversation: conv._id,
            sender: { $ne: userId },
            readBy: { $ne: userId }
          });

          const plainConv = conv.toObject();
          plainConv.unreadCount = unreadCount;
          

          if (lastCheck) {
            const lastCheckDate = new Date(parseInt(lastCheck));
            plainConv.hasUpdate = conv.updatedAt > lastCheckDate;
          } else {
            plainConv.hasUpdate = true;
          }

          return plainConv;
        })
      );


      const hasUpdates = conversationsWithUnread.some(c => c.hasUpdate);

      return {
        conversations: conversationsWithUnread,
        timestamp: Date.now(),
        hasUpdates
      };

    } catch (error) {
      logger.error('Error fetching conversations data:', error);
      throw error;
    }
  }

  /**
   * Envia atualizações de conversas para um usuário
   */
  async sendConversationsUpdate(userId) {
    try {
      if (!this.activePolling.has(userId)) {
        return;
      }

      const lastCheck = this.userLastCheck.get(userId);
      const conversationsData = await this.getConversationsData(userId, lastCheck);


      if (conversationsData.hasUpdates) {
        this.sendToUser(userId, {
          type: 'conversations:update',
          data: {
            conversations: conversationsData.conversations,
            timestamp: conversationsData.timestamp
          }
        });


        this.userLastCheck.set(userId, conversationsData.timestamp);

        logger.info(`📤 Sent conversation updates to user ${userId}`, {
          conversationCount: conversationsData.conversations.length,
          hasUpdates: conversationsData.hasUpdates
        });
      }

    } catch (error) {
      logger.error(`Error sending conversation update to user ${userId}:`, error);
    }
  }

  /**
   * Envia dados para um usuário específico
   */
  sendToUser(userId, data) {
    const connections = this.connectionManager.getUserConnections(userId);
    
    connections.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
      }
    });
  }

  /**
   * Notifica sobre nova mensagem (atualiza conversas)
   */
  async onNewMessage(conversationId) {
    try {

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return;


      for (const participant of conversation.participants) {
        const userId = participant.user?.toString() || participant.toString();
        
        if (this.activePolling.has(userId)) {
          await this.sendConversationsUpdate(userId);
        }
      }

    } catch (error) {
      logger.error('Error handling new message notification:', error);
    }
  }

  /**
   * Limpa dados quando usuário desconecta
   */
  onUserDisconnect(userId) {
    this.activePolling.delete(userId);
    this.userLastCheck.delete(userId);
    logger.info(`🧹 Cleaned conversation polling data for user ${userId}`);
  }

  /**
   * Força atualização para todos os usuários ativos
   */
  async broadcastConversationUpdates() {
    const activeUsers = Array.from(this.activePolling.keys());
    
    logger.info(`📡 Broadcasting conversation updates to ${activeUsers.length} active users`);

    await Promise.all(
      activeUsers.map(userId => this.sendConversationsUpdate(userId))
    );
  }
}

module.exports = ConversationHandler;
