/**
 * ConversationHandler - Substitui o polling da API REST
 * Gerencia atualizações de conversas em tempo real via WebSocket
 */

const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const User = require('../../models/User');
const Purchase = require('../../models/Purchase');
const logger = require('../../utils/logger');
const { decryptMessage } = require('../../utils/encryption');
const { sanitizeUserData, sanitizeConversation } = require('../../utils/dataSanitizer');

class ConversationHandler {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.userLastCheck = new Map();
    this.activePolling = new Map();
    // Feature flags and runtime caches
    this.updateThrottleMs = parseInt(process.env.WS_CONV_UPDATE_THROTTLE_MS || '2000');
    this.userUpdateTimers = new Map();
    this.userLastUpdateAt = new Map();
    this.marketplaceCache = new Map(); // key: purchaseId or conversationId -> { data, expires }
  }

  async processConversation(conv, userId, lastCheck = null) {
    if (!conv) return null;

    // Use stored unreadCount map on Conversation instead of heavy COUNTs
    const uc = conv.unreadCount;
    const unreadCount = (() => {
      try {
        if (!uc) return 0;
        if (typeof uc.get === 'function') return uc.get(userId.toString()) || 0;
        if (typeof uc === 'object') return uc[userId?.toString?.()] || 0;
        if (typeof uc === 'number') return uc;
        return 0;
      } catch (_) { return 0; }
    })();

    // ✅ Decrypt lastMessage preview if available
    try {
      if (conv.lastMessage && conv.lastMessage.content) {
        conv.lastMessage.content = decryptMessage(conv.lastMessage.content);
      }
    } catch (_) {}

    // ✅ Enriquecimento específico para Marketplace (não afeta boosting)
    await this.enrichMarketplaceConversation(conv);

    // ✅ SEGURANÇA: Usar sanitizeConversation para remover dados sensíveis
    let sanitized = sanitizeConversation(conv, userId);

    // ✅ Adicionar unreadCount e hasUpdate após sanitização
    sanitized.unreadCount = unreadCount;

    if (lastCheck) {
      const lastCheckDate = new Date(parseInt(lastCheck));
      sanitized.hasUpdate = conv.updatedAt > lastCheckDate;
    } else {
      sanitized.hasUpdate = true;
    }

    // ✅ Sanitizar client/booster/marketplace userids aninhados
    if (sanitized.client && sanitized.client.userid) {
      sanitized.client.userid = sanitizeUserData(sanitized.client.userid, {
        includeEmail: false,
        includeAvatar: true,
        includeId: true
      });
    }

    if (sanitized.booster && sanitized.booster.userid) {
      sanitized.booster.userid = sanitizeUserData(sanitized.booster.userid, {
        includeEmail: false,
        includeAvatar: true,
        includeId: true
      });
    }

    if (sanitized.marketplace) {
      if (sanitized.marketplace.buyer && sanitized.marketplace.buyer.userid) {
        sanitized.marketplace.buyer.userid = sanitizeUserData(sanitized.marketplace.buyer.userid, {
          includeEmail: false,
          includeAvatar: true,
          includeId: true
        });
      }
      if (sanitized.marketplace.seller && sanitized.marketplace.seller.userid) {
        sanitized.marketplace.seller.userid = sanitizeUserData(sanitized.marketplace.seller.userid, {
          includeEmail: false,
          includeAvatar: true,
          includeId: true
        });
      }
    }

    return sanitized;
  }

  async getSanitizedConversationForUser(conversationId, userId, { lastCheck = null } = {}) {
    try {
      const conv = await Conversation.findById(conversationId)
        .populate('participants', 'name avatar profileImage')
        .populate('client.userid', 'name avatar profileImage')
        .populate('booster.userid', 'name avatar profileImage')
        .populate('marketplace.buyer.userid', 'name avatar profileImage')
        .populate('marketplace.seller.userid', 'name avatar profileImage')
        .populate({
          path: 'lastMessage',
          populate: {
            path: 'sender',
            select: 'name avatar profileImage'
          }
        })
        .select('-__v')
        .lean();

      if (!conv) return null;

      const participantIds = (conv.participants || []).map((p) => {
        if (!p) return null;
        if (p._id) return p._id.toString();
        return p.toString ? p.toString() : String(p);
      }).filter(Boolean);

      if (!participantIds.includes(userId.toString())) {
        return null;
      }

      return await this.processConversation(conv, userId, lastCheck);
    } catch (error) {
      logger.error('Error building sanitized conversation snapshot:', error);
      return null;
    }
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

      // Simple cache to avoid repeated enrichment work across frequent refreshes
      try {
        const ttl = parseInt(process.env.MARKETPLACE_ENRICH_CACHE_TTL_MS || '60000');
        const cacheKey = String(meta?.purchaseId || conv._id?.toString?.() || conv._id);
        const cached = cacheKey && this.marketplaceCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
          const d = cached.data;
          conv.metadata = d.metadata ?? meta;
          if (d.client) conv.client = d.client;
          if (d.booster) conv.booster = d.booster;
          if (d.marketplace) conv.marketplace = d.marketplace;
          if (Array.isArray(d.participants)) conv.participants = d.participants;
          return;
        }
        // After enrichment, we'll store into cache
        var cacheKeyToUse = cacheKey;
        var cacheTtlToUse = ttl;
        var cacheStore = true;
      } catch (_) {}

      let buyerId = null, sellerId = null;
      let purchasePrice = null, purchaseStatus = null, purchaseDateVal = null, itemTitleUsed = null, itemImageUsed = null;
      if (meta.purchaseId) {
        const purchase = await Purchase.findById(meta.purchaseId).select('buyerId sellerId conversationId price status escrowReservedAt createdAt itemId');
        if (purchase) {
          buyerId = purchase.buyerId?.toString() || null;
          sellerId = purchase.sellerId?.toString() || null;
          purchasePrice = Number(purchase.price) || null;
          purchaseStatus = purchase.status || null;
          purchaseDateVal = purchase.escrowReservedAt || purchase.createdAt || null;
          if (!meta.marketplaceItemId && purchase.itemId) meta.marketplaceItemId = purchase.itemId?.toString?.() || purchase.itemId;
        }
      }
      if (!buyerId || !sellerId) {
        const purchaseByConv = await Purchase.findOne({ conversationId: conv._id }).select('buyerId sellerId price status escrowReservedAt createdAt itemId');
        if (purchaseByConv) {
          buyerId = buyerId || (purchaseByConv.buyerId?.toString() || null);
          sellerId = sellerId || (purchaseByConv.sellerId?.toString() || null);
          if (purchasePrice == null) purchasePrice = Number(purchaseByConv.price) || null;
          if (!purchaseStatus) purchaseStatus = purchaseByConv.status || null;
          if (!purchaseDateVal) purchaseDateVal = purchaseByConv.escrowReservedAt || purchaseByConv.createdAt || null;
          if (!meta.marketplaceItemId && purchaseByConv.itemId) meta.marketplaceItemId = purchaseByConv.itemId?.toString?.() || purchaseByConv.itemId;
        }
      }

      // Ensure buyer and seller are not the same user due to legacy/edge cases
      try {
        if (buyerId && sellerId && buyerId === sellerId) {
          // Try re-derive seller from item
          if (meta.marketplaceItemId) {
            const item = await require('../../models/MarketItem').findById(meta.marketplaceItemId).select('sellerId userId');
            const sellerFromItem = item?.sellerId?.toString?.() || item?.userId?.toString?.();
            if (sellerFromItem && sellerFromItem !== buyerId) {
              sellerId = sellerFromItem;
            }
          }
          // If still equal, try use the other participant as seller
          if (buyerId === sellerId && Array.isArray(conv.participants) && conv.participants.length >= 2) {
            const partIds = conv.participants.map(p => p && (p._id?.toString?.() || String(p))).filter(Boolean);
            const candidate = partIds.find(id => id !== buyerId);
            if (candidate) sellerId = candidate;
          }
          // If still equal, drop seller to avoid duplicating same user for both roles
          if (buyerId === sellerId) sellerId = null;
        }
      } catch (_) {}

      if (!buyerId && !sellerId) {
        conv.metadata = meta;
        return;
      }

      const buyersellerIds = [buyerId, sellerId].filter(Boolean);
      const users = await User.find({ _id: { $in: buyersellerIds } }).select('name email avatar profileImage');
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

      // Compatibilidade com front que usa client/booster (sempre definir conforme computado)
      if (clientData) conv.client = { userid: clientData.userid, name: clientData.name, avatar: clientData.avatar };
      if (boosterData) conv.booster = { userid: boosterData.userid, name: boosterData.name, avatar: boosterData.avatar };

      // Rebuild participants for direct chat to ensure two distinct entries
      try {
        const rebuilt = [];
        if (buyer) rebuilt.push({ _id: buyer._id, name: buyer.name, email: buyer.email, avatar: buyer.avatar, profileImage: buyer.avatar || buyer.profileImage || null });
        if (seller) rebuilt.push({ _id: seller._id, name: seller.name, email: seller.email, avatar: seller.avatar, profileImage: seller.avatar || seller.profileImage || null });
        if (rebuilt.length >= 1) {
          const seen = new Set();
          conv.participants = rebuilt.filter(p => {
            const id = p && p._id?.toString?.();
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
          });
        }
      } catch (_) {}

      // Fornece bloco marketplace com resumo (para documentos legados sem subdocumento)
      try {
        // Item resumo
        try {
          if (meta.marketplaceItemId) {
            const item = await require('../../models/MarketItem').findById(meta.marketplaceItemId).select('sellerId userId title image images');
            if (!itemTitleUsed && item?.title) itemTitleUsed = String(item.title);
            if (!itemImageUsed) {
              if (item?.image) itemImageUsed = String(item.image);
              else if (Array.isArray(item?.images) && item.images.length > 0) itemImageUsed = String(item.images[0]);
            }
          }
        } catch (_) {}
        if (!conv.marketplace) conv.marketplace = {};
        if (clientData) {
          conv.marketplace.buyer = {
            userid: clientData.userid,
            name: clientData.name,
            email: buyer?.email || null,
            avatar: clientData.avatar || null
          };
        }
        if (boosterData) {
          conv.marketplace.seller = {
            userid: boosterData.userid,
            name: boosterData.name,
            email: seller?.email || null,
            avatar: boosterData.avatar || null
          };
        }
        const getMeta = (k, dflt=null) => (meta && Object.prototype.hasOwnProperty.call(meta, k)) ? meta[k] : dflt;
        conv.marketplace.nomeRegistrado = conv.marketplace.nomeRegistrado || getMeta('nomeRegistrado', conv.client?.name || null);
        conv.marketplace.purchaseId = conv.marketplace.purchaseId || getMeta('purchaseId', null);
        conv.marketplace.marketplaceItemId = conv.marketplace.marketplaceItemId || getMeta('marketplaceItemId', null);
        conv.marketplace.statusCompra = conv.marketplace.statusCompra || purchaseStatus || getMeta('statusCompra', conv.statusCompra || null);
        const priceVal = purchasePrice != null ? purchasePrice : Number(getMeta('price', NaN));
        if (!conv.marketplace.price && !Number.isNaN(priceVal)) conv.marketplace.price = priceVal;
        conv.marketplace.currency = conv.marketplace.currency || getMeta('currency', 'BRL');
        conv.marketplace.itemTitle = conv.marketplace.itemTitle || itemTitleUsed || getMeta('itemTitle', null);
        conv.marketplace.itemImage = conv.marketplace.itemImage || itemImageUsed || getMeta('itemImage', null);
        const pd = conv.marketplace.purchaseDate || purchaseDateVal || getMeta('purchaseDate', null);
        if (pd) conv.marketplace.purchaseDate = typeof pd === 'string' ? new Date(pd) : pd;
      } catch (_) {}

    } catch (err) {
      // Loga mas não quebra fluxo
      try { logger.warn('Marketplace enrichment failed for conversation', { id: conv?._id?.toString?.(), error: err?.message }); } catch (_) {}
    }
    // Cache the enrichment if prepared
    try {
      if (cacheStore && cacheKeyToUse) {
        this.marketplaceCache.set(cacheKeyToUse, {
          data: {
            metadata: conv.metadata,
            client: conv.client,
            booster: conv.booster,
            marketplace: conv.marketplace,
            participants: conv.participants
          },
          expires: Date.now() + (cacheTtlToUse || 60000)
        });
      }
    } catch (_) {}
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

      // Log removido para evitar consumo excessivo de memória

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

      // Log removido para evitar consumo excessivo de memória

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
      // ✅ SEGURANÇA: Nunca incluir email nos populates
      const conversations = await Conversation.find({
        participants: userId
      })
      .populate('participants', 'name avatar profileImage')
      .populate('client.userid', 'name avatar profileImage')
      .populate('booster.userid', 'name avatar profileImage')
      .populate('marketplace.buyer.userid', 'name avatar profileImage')
      .populate('marketplace.seller.userid', 'name avatar profileImage')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'sender',
          select: 'name avatar profileImage'
        }
      })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .select('-__v')  // ✅ Excluir campo interno
      .lean();


      const conversationsWithUnread = await Promise.all(
        conversations.map((conv) => this.processConversation(conv, userId, lastCheck))
      );


      const hasUpdates = conversationsWithUnread.some(c => c?.hasUpdate);

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
   * Throttled wrapper for sendConversationsUpdate to reduce spam
   */
  sendConversationsUpdateThrottled(userId) {
    try {
      const now = Date.now();
      const last = this.userLastUpdateAt.get(userId) || 0;
      const remaining = this.updateThrottleMs - (now - last);
      if (remaining > 0 && this.userUpdateTimers.has(userId)) {
        return; // already scheduled
      }
      const delay = Math.max(0, remaining);
      if (this.userUpdateTimers.has(userId)) {
        clearTimeout(this.userUpdateTimers.get(userId));
      }
      const t = setTimeout(async () => {
        try { await this.sendConversationsUpdate(userId); } catch (_) {}
        this.userLastUpdateAt.set(userId, Date.now());
        this.userUpdateTimers.delete(userId);
      }, delay);
      this.userUpdateTimers.set(userId, t);
    } catch (_) {}
  }

  /**
   * Emit a compact conversation:updated event to all participants except the sender
   */
  async sendCompactUpdateToParticipants(conversation, message, senderId) {
    try {
      const convObj = conversation.toObject ? conversation.toObject() : conversation;
      const now = new Date();
      for (const participant of convObj.participants || []) {
        const uid = participant?._id?.toString?.() || participant?.toString?.();
        if (!uid || uid === senderId) continue;

        // unreadCount from conversation map
        const uc = convObj.unreadCount;
        const unreadCount = (() => {
          try {
            if (!uc) return 0;
            if (typeof uc.get === 'function') return uc.get(uid) || 0;
            if (typeof uc === 'object') return uc[uid] || 0;
            if (typeof uc === 'number') return uc;
            return 0;
          } catch (_) { return 0; }
        })();

        this.sendToUser(uid, {
          type: 'conversation:updated',
          data: {
            _id: convObj._id,
            lastMessage: message?.content ?? '',
            lastMessageDate: convObj.lastMessageAt || now,
            unreadCount,
            isTemporary: !!convObj.isTemporary,
            status: convObj.status || null,
            updatedAt: convObj.updatedAt || now,
            // Minimal participant avatars for UI list
            participants: (convObj.participants || []).map(p => ({
              _id: p._id?.toString?.() || String(p),
              name: p.name,
              profileImage: p.avatar || p.profileImage || null
            })),
            // Optional compact marketplace summary if present
            marketplace: convObj.marketplace ? {
              price: convObj.marketplace.price ?? null,
              statusCompra: convObj.marketplace.statusCompra ?? null,
              itemTitle: convObj.marketplace.itemTitle ?? null,
              itemImage: convObj.marketplace.itemImage ?? null
            } : null
          },
          timestamp: now.toISOString()
        });
      }
    } catch (e) {
      logger.warn('sendCompactUpdateToParticipants failed', { error: e?.message });
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
        // If compact updates are enabled, we prefer letting MessageHandler emit them.
        // Otherwise, fall back to throttled full updates for polling users.
        if (this.activePolling.has(userId)) {
          if (String(process.env.WS_CONV_UPDATE_COMPACT || 'true').toLowerCase() === 'true') {
            this.sendConversationsUpdateThrottled(userId);
          } else {
            await this.sendConversationsUpdate(userId);
          }
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
