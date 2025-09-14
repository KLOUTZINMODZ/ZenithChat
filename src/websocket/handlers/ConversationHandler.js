/**
 * ConversationHandler - Substitui o polling da API REST
 * Gerencia atualizações de conversas em tempo real via WebSocket
 */

const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const User = require('../../models/User');
const Purchase = require('../../models/Purchase');
const logger = require('../../utils/logger');

class ConversationHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.userLastCheck = new Map();
    this.activePolling = new Map();
  }

  /**
   * Enriquecimento para conversas de Marketplace:
   * - Detecta context por metadata.purchaseId ou metadata.context === 'marketplace_purchase'
   * - Preenche metadata.clientData / metadata.boosterData
   * - Preenche client / booster (userid, name, avatar)
   * Não altera conversas de boosting.
   */
  async enrichMarketplaceConversation(conv) {
    try {
      // Padroniza metadata para objeto simples
      const rawMeta = conv.metadata;
      let meta = {};
      if (rawMeta && typeof rawMeta.get === 'function') {
        meta = Object.fromEntries(rawMeta);
      } else if (rawMeta && typeof rawMeta === 'object') {
        meta = { ...rawMeta };
      }

      const isMarketplace = meta?.purchaseId || meta?.context === 'marketplace_purchase' || conv.type === 'marketplace';
      const isBoosting = meta?.boostingId || conv.boostingStatus; // não mexer se for boosting
      if (!isMarketplace || isBoosting) {
        conv.metadata = meta; // ainda normalize metadata
        return;
      }

      let buyerId = null, sellerId = null;
      if (meta.purchaseId) {
        const purchase = await Purchase.findById(meta.purchaseId).select('buyerId sellerId conversationId');
        if (purchase) {
          buyerId = purchase.buyerId?.toString() || null;
          sellerId = purchase.sellerId?.toString() || null;
        }
      }
      if (!buyerId || !sellerId) {
        const purchaseByConv = await Purchase.findOne({ conversationId: conv._id }).select('buyerId sellerId');
        if (purchaseByConv) {
          buyerId = buyerId || (purchaseByConv.buyerId?.toString() || null);
          sellerId = sellerId || (purchaseByConv.sellerId?.toString() || null);
        }
      }

      if (!buyerId && !sellerId) {
        conv.metadata = meta;
        return;
      }

      const ids = [buyerId, sellerId].filter(Boolean);
      const users = await User.find({ _id: { $in: ids } }).select('name avatar');
      const map = new Map(users.map(u => [u._id.toString(), u]));

      const buyer = buyerId ? map.get(buyerId) : null;
      const seller = sellerId ? map.get(sellerId) : null;

      const clientData = buyer ? {
        userid: buyer._id.toString(),
        _id: buyer._id.toString(),
        name: buyer.name || 'Cliente',
        avatar: buyer.avatar || null
      } : undefined;

      const boosterData = seller ? {
        userid: seller._id.toString(),
        _id: seller._id.toString(),
        name: seller.name || 'Vendedor',
        avatar: seller.avatar || null
      } : undefined;

      conv.metadata = { ...meta };
      if (clientData) conv.metadata.clientData = { ...(conv.metadata.clientData || {}), ...clientData };
      if (boosterData) conv.metadata.boosterData = { ...(conv.metadata.boosterData || {}), ...boosterData };

      // Compatibilidade com front que usa client/booster
      if (!conv.client && clientData) conv.client = { userid: clientData.userid, name: clientData.name, avatar: clientData.avatar };
      if (!conv.booster && boosterData) conv.booster = { userid: boosterData.userid, name: boosterData.name, avatar: boosterData.avatar };

      // Garante que participants contenha buyer e seller (se estiver faltando ou duplicado)
      try {
        if (Array.isArray(conv.participants)) {
          const ids = new Set(conv.participants.map(p => p && p._id ? p._id.toString() : (p?.toString?.() || String(p))));
          const list = [...conv.participants];
          if (clientData && !ids.has(clientData._id)) {
            list.push({ _id: clientData._id, name: clientData.name, avatar: clientData.avatar });
          }
          if (boosterData && !ids.has(boosterData._id)) {
            list.push({ _id: boosterData._id, name: boosterData.name, avatar: boosterData.avatar });
          }
          conv.participants = list;
        }
      } catch (_) {}

    } catch (err) {
      // Loga mas não quebra fluxo
      try { logger.warn('Marketplace enrichment failed for conversation', { id: conv?._id?.toString?.(), error: err?.message }); } catch (_) {}
    }
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

      // Corrige query/populate para o schema real (participants é ObjectId de User)
      const conversations = await Conversation.find({
        participants: userId
      })
      .populate('participants', 'name avatar profileImage email')
      .populate('client.userid', 'name avatar profileImage email')
      .populate('booster.userid', 'name avatar profileImage email')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'sender',
          select: 'name avatar profileImage'
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

          // Enriquecimento específico para Marketplace (não afeta boosting)
          await this.enrichMarketplaceConversation(plainConv);

          // Normaliza participants no formato compacto esperado pelo front
          try {
            if (Array.isArray(plainConv.participants)) {
              const seen = new Set();
              plainConv.participants = plainConv.participants
                .map(p => p && p._id ? { _id: p._id, name: p.name, email: p.email, profileImage: p.avatar || p.profileImage || null } : p)
                .filter(p => {
                  const id = p && (p._id?.toString ? p._id.toString() : String(p));
                  if (!id || seen.has(id)) return false;
                  seen.add(id);
                  return true;
                });
            }
          } catch (_) {}

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
