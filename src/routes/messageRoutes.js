const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Purchase = require('../models/Purchase');
const MarketItem = require('../models/MarketItem');
const User = require('../models/User');
const { encryptMessage, decryptMessage } = require('../utils/encryption');
const logger = require('../utils/logger');
const cache = require('../services/GlobalCache');
const { cacheMiddleware, invalidationMiddleware, performanceMiddleware, invalidatePattern } = require('../middleware/cacheMiddleware');


router.get('/sync/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { since } = req.query;
    const userId = req.user._id || req.user.id;
    
    logger.info(`[SYNC] Sincronização solicitada para conversa ${conversationId} por usuário ${userId}`);
    

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      logger.warn(`[SYNC] Acesso negado para conversa ${conversationId} - usuário ${userId}`);
      return res.status(403).json({ error: 'Access denied' });
    }
    

    const sinceDate = since ? new Date(parseInt(since)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const messages = await Message.find({
      conversation: conversationId,
      createdAt: { $gte: sinceDate }
    })
    .populate('sender', 'name avatar')
    .sort('createdAt')
    .limit(100);
    

    const decryptedMessages = messages.map(msg => ({
      ...msg.toObject(),
      content: decryptMessage(msg.content)
    }));
    
    logger.info(`[SYNC] Retornando ${decryptedMessages.length} mensagens para conversa ${conversationId}`);
    
    res.json({
      success: true,
      messages: decryptedMessages,
      syncedAt: new Date().toISOString(),
      messageCount: decryptedMessages.length,
      conversationId
    });
    
  } catch (error) {
    logger.error('[SYNC] Erro no endpoint de sincronização:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



router.get('/conversations/boosting/:boostingId', auth, async (req, res) => {
  try {
    const { boostingId } = req.params;
    const userId = req.user._id || req.userId;

    if (!boostingId) {
      return res.status(400).json({ success: false, message: 'boostingId is required' });
    }

    const conversation = await Conversation.findOne({
      participants: userId,
      'metadata.boostingId': boostingId,
      isActive: true
    })
    .populate('participants', 'name avatar')
    .populate('lastMessage');

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    return res.json({ success: true, conversation });
  } catch (error) {
    logger.error('Error fetching conversation by boostingId:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


router.use(performanceMiddleware());


router.get('/conversations', auth, cacheMiddleware(120), async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user._id || req.userId;
    const cacheKey = `conversations:${userId}:page:${page}:limit:${limit}`;
    
    logger.info(`Fetching conversations for user ${userId}`, { page, limit });
    

    let cachedData = cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for conversations user ${userId}`);
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }

    const skip = (page - 1) * limit;

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true
    })
      .populate('participants', 'name avatar profileImage')
      .populate('lastMessage')
      .populate('client.userid', 'name avatar profileImage')
      .populate('booster.userid', 'name avatar profileImage')
      .populate('marketplace.buyer.userid', 'name avatar profileImage')
      .populate('marketplace.seller.userid', 'name avatar profileImage')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Conversation.countDocuments({
      participants: userId,
      isActive: true
    });

    logger.info(`Found ${conversations.length} conversations for user ${userId}`);


    conversations.forEach(conv => {
      if (conv.isTemporary) {
        logger.debug(`[DEBUG] Raw temporary conversation data:`, {
          _id: conv._id,
          isTemporary: conv.isTemporary,
          status: conv.status,
          client: conv.client,
          booster: conv.booster,
          metadata: conv.metadata,
          expiresAt: conv.expiresAt
        });
      }
    });


    // Enriquecimento apenas para marketplace
    const enriched = await Promise.all(conversations.map(async conv => {
      try {
        const plain = { ...conv };
        // Normaliza metadata (Map -> Object)
        const rawMeta = plain.metadata;
        let meta = {};
        if (rawMeta && typeof rawMeta.get === 'function') {
          meta = Object.fromEntries(rawMeta);
        } else if (rawMeta && typeof rawMeta === 'object') {
          meta = { ...rawMeta };
        }

        const isBoosting = meta?.boostingId || plain.boostingStatus;
        const isMarketplace = meta?.purchaseId || meta?.context === 'marketplace_purchase' || plain.type === 'marketplace';
        
        // Enriquecer boosting com agreement
        if (isBoosting && !isMarketplace) {
          try {
            const Agreement = require('../models/Agreement');
            const agreement = await Agreement.findOne({ conversationId: plain._id }).sort({ createdAt: -1 }).lean();
            if (agreement) {
              plain.agreement = agreement;
              // Adicionar preço ao metadata para compatibilidade
              if (agreement.serviceDetails?.price && !meta.price) {
                meta.price = agreement.serviceDetails.price;
              }
            }
          } catch (err) {
            logger.error('Error enriching boosting conversation with agreement:', err);
          }
          plain.metadata = meta;
          return plain;
        }
        
        if (!isMarketplace) {
          plain.metadata = meta;
          return plain;
        }

        let buyerId = null, sellerId = null;
        let purchasePrice = null, purchaseStatus = null, purchaseDateVal = null, itemTitleUsed = null, itemImageUsed = null;
        if (meta.purchaseId) {
          const p = await Purchase.findById(meta.purchaseId).select('buyerId sellerId price status escrowReservedAt createdAt itemId');
          if (p) {
            buyerId = p.buyerId?.toString() || null;
            sellerId = p.sellerId?.toString() || null;
            purchasePrice = Number(p.price) || null;
            purchaseStatus = p.status || null;
            purchaseDateVal = p.escrowReservedAt || p.createdAt || null;
          }
        }
        if (!buyerId || !sellerId) {
          const p2 = await Purchase.findOne({ conversationId: plain._id }).select('buyerId sellerId price status escrowReservedAt createdAt itemId');
          if (p2) {
            buyerId = buyerId || (p2.buyerId?.toString() || null);
            sellerId = sellerId || (p2.sellerId?.toString() || null);
            if (purchasePrice == null) purchasePrice = Number(p2.price) || null;
            if (!purchaseStatus) purchaseStatus = p2.status || null;
            if (!purchaseDateVal) purchaseDateVal = p2.escrowReservedAt || p2.createdAt || null;
            if (!meta.marketplaceItemId && p2.itemId) meta.marketplaceItemId = p2.itemId?.toString?.() || p2.itemId;
          }
        }

        // Ensure buyer and seller are not the same user due to legacy/edge cases
        try {
          if (buyerId && sellerId && buyerId === sellerId) {
            // Try re-derive seller from item
            if (meta.marketplaceItemId) {
              const item = await MarketItem.findById(meta.marketplaceItemId).select('userId');
              const sellerFromItem = item?.userId?.toString?.();
              if (sellerFromItem && sellerFromItem !== buyerId) {
                sellerId = sellerFromItem;
              }
            }
            // If still equal, try use the other participant as seller
            if (buyerId === sellerId && Array.isArray(plain.participants) && plain.participants.length >= 2) {
              const participantIds = plain.participants.map(p => p && (p._id?.toString?.() || String(p))).filter(Boolean);
              const candidate = participantIds.find(pid => pid !== buyerId);
              if (candidate) sellerId = candidate;
            }
            // If still equal, drop seller to avoid duplicating same user for both roles
            if (buyerId === sellerId) sellerId = null;
          }
        } catch (_) {}

        // Fallback: deduz seller a partir do marketplaceItemId
        try {
          if (meta.marketplaceItemId) {
            const item = await MarketItem.findById(meta.marketplaceItemId).select('sellerId userId title image');
            const sellerFromItem = item?.sellerId?.toString?.() || item?.userId?.toString?.();
            if (sellerFromItem) {
              sellerId = sellerId || sellerFromItem;
              // buyerId é o outro participante (se possível deduzir)
              if (!buyerId && Array.isArray(plain.participants)) {
                const participantIds = plain.participants.map(p => p && (p._id?.toString?.() || String(p))).filter(Boolean);
                const maybeBuyer = participantIds.find(pid => pid !== sellerFromItem);
                if (maybeBuyer) buyerId = maybeBuyer;
              }
            }
            if (!itemTitleUsed && item?.title) itemTitleUsed = String(item.title);
            if (!itemImageUsed && item?.image) itemImageUsed = String(item.image);
          }
        } catch (_) {}

        if (buyerId || sellerId) {
          const ids = [buyerId, sellerId].filter(Boolean);
          const users = await User.find({ _id: { $in: ids } }).select('name email avatar profileImage');
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

          plain.metadata = { ...meta };
          if (clientData) plain.metadata.clientData = { ...(plain.metadata.clientData || {}), ...clientData };
          if (boosterData) plain.metadata.boosterData = { ...(plain.metadata.boosterData || {}), ...boosterData };

          // Always set client & booster from computed roles to avoid stale/wrong data
          if (clientData) {
            plain.client = { userid: clientData.userid, name: clientData.name, avatar: clientData.avatar };
          }
          if (boosterData) {
            plain.booster = { userid: boosterData.userid, name: boosterData.name, avatar: boosterData.avatar };
          }

          // Sempre forneça um bloco marketplace no payload quando for contexto marketplace (para front exibir info ricas)
          try {
            if (!plain.marketplace) plain.marketplace = {};
            // Buyer/Seller
            if (clientData) {
              plain.marketplace.buyer = {
                userid: clientData.userid,
                name: clientData.name,
                email: buyer?.email || null,
                avatar: clientData.avatar || null
              };
            }
            if (boosterData) {
              plain.marketplace.seller = {
                userid: boosterData.userid,
                name: boosterData.name,
                email: seller?.email || null,
                avatar: boosterData.avatar || null
              };
            }
            // Campos de resumo (com fallback a metadata)
            const getMeta = (k, dflt=null) => (meta && Object.prototype.hasOwnProperty.call(meta, k)) ? meta[k] : dflt;
            plain.marketplace.nomeRegistrado = plain.marketplace.nomeRegistrado || getMeta('nomeRegistrado', plain.client?.name || null);
            plain.marketplace.purchaseId = plain.marketplace.purchaseId || getMeta('purchaseId', null);
            plain.marketplace.marketplaceItemId = plain.marketplace.marketplaceItemId || getMeta('marketplaceItemId', null);
            plain.marketplace.statusCompra = plain.marketplace.statusCompra || getMeta('statusCompra', plain.statusCompra || null);
            // price/currency/title/image/date
            plain.marketplace.price = plain.marketplace.price || purchasePrice || Number(getMeta('price', NaN));
            if (Number.isNaN(plain.marketplace.price)) delete plain.marketplace.price;
            plain.marketplace.currency = plain.marketplace.currency || getMeta('currency', 'BRL');
            plain.marketplace.itemTitle = plain.marketplace.itemTitle || itemTitleUsed || getMeta('itemTitle', null);
            plain.marketplace.itemImage = plain.marketplace.itemImage || itemImageUsed || getMeta('itemImage', null);
            const pd = plain.marketplace.purchaseDate || purchaseDateVal || getMeta('purchaseDate', null);
            if (pd) plain.marketplace.purchaseDate = typeof pd === 'string' ? new Date(pd) : pd;
            if (!plain.marketplace.statusCompra && purchaseStatus) plain.marketplace.statusCompra = purchaseStatus;
          } catch (_) {}

          // Dedup participants (caso backend tenha IDs duplicados)
          try {
            const rebuilt = [];
            if (buyer) rebuilt.push({ _id: buyer._id, name: buyer.name, email: buyer.email, avatar: buyer.avatar, profileImage: buyer.avatar || buyer.profileImage || null });
            if (seller) rebuilt.push({ _id: seller._id, name: seller.name, email: seller.email, avatar: seller.avatar, profileImage: seller.avatar || seller.profileImage || null });
            if (rebuilt.length >= 1) {
              // dedup por _id
              const seen = new Set();
              plain.participants = rebuilt.filter(p => {
                const id = p && p._id?.toString?.();
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
              });
            } else if (Array.isArray(plain.participants)) {
              const seen = new Set();
              plain.participants = plain.participants.filter(p => {
                const id = p && p._id ? p._id.toString() : String(p);
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
              });
            }
          } catch {}
        } else {
          plain.metadata = meta;
        }

        return plain;
      } catch (e) {
        logger.warn('Marketplace enrichment (REST) failed for conversation', { id: conv?._id?.toString?.(), error: e?.message });
        return conv;
      }
    }));

    const formattedConversations = enriched.map(conv => {
      try {

        let otherParticipant = null;
        const isGroupChat = conv.type === 'group' || conv.participants.length > 2;
        
        if (!isGroupChat && conv.participants.length >= 2) {
          otherParticipant = conv.participants.find(
            p => p && p._id && p._id.toString() !== userId.toString()
          );
        }


        const userUnreadCount = (() => {
          const uc = conv.unreadCount;
          if (!uc) return 0;
          if (typeof uc.get === 'function') return uc.get(userId.toString()) || 0;
          if (typeof uc === 'object') return uc[userId.toString()] || 0;
          if (typeof uc === 'number') return uc;
          return 0;
        })();


        return {
          _id: conv._id,
          isGroupChat: isGroupChat,
          name: isGroupChat 
            ? (conv.name || conv.groupName || 'Group Chat') 
            : (otherParticipant?.name || 'Unknown User'),
          image: isGroupChat 
            ? (conv.groupImage || null) 
            : (otherParticipant?.avatar || otherParticipant?.profileImage || null),
          lastMessage: (conv.lastMessage && conv.lastMessage.content)
            ? decryptMessage(conv.lastMessage.content)
            : '',
          lastMessageDate: conv.lastMessageAt || conv.updatedAt,
          unreadCount: userUnreadCount,
          participants: (conv.participants || []).map(p => ({
            _id: p._id,
            name: p.name,
            email: p.email,
            profileImage: p.avatar || p.profileImage
          })),
          relatedItem: conv.marketplaceItem || null,
          relatedOrder: conv.proposal || null,
          updatedAt: conv.updatedAt,

          boostingStatus: conv.boostingStatus || null,
          type: conv.type,

          isTemporary: conv.isTemporary || false,
          expiresAt: conv.expiresAt || null,
          status: conv.status || null,
          client: conv.client || null,
          booster: conv.booster || null,
          metadata: conv.metadata || null,
          marketplace: conv.marketplace || null
        };
      } catch (convError) {
        logger.error('Error formatting conversation:', { 
          conversationId: conv._id, 
          error: convError.message 
        });
        

        return {
          _id: conv._id,
          isGroupChat: false,
          name: 'Unknown Conversation',
          image: null,
          lastMessage: '',
          lastMessageDate: conv.lastMessageAt || conv.updatedAt,
          unreadCount: 0,
          participants: [],
          relatedItem: null,
          relatedOrder: null,
          updatedAt: conv.updatedAt
        };
      }
    });

    const responseData = {
      conversations: formattedConversations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    };


    cache.set(cacheKey, responseData, 120);
    logger.debug(`Cached conversations for user ${userId}`);

    logger.info(`Returning ${formattedConversations.length} formatted conversations`);

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching conversations',
      error: error.message
    });
  }
});

// NOVA ROTA: Obter conversa individual por ID
router.get('/conversations/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id || req.userId;

    const conversation = await Conversation.findById(conversationId)
      .populate('participants', 'name avatar')
      .populate('lastMessage');

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversa não encontrada' 
      });
    }

    if (!conversation.isParticipant(userId)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Acesso negado' 
      });
    }

    return res.json({ 
      success: true, 
      conversation: conversation.toObject() 
    });
  } catch (error) {
    logger.error('[MSG:REST] Erro ao obter conversa:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro ao buscar conversa',
      error: error.message 
    });
  }
});

router.get('/conversations/:conversationId/messages', auth, cacheMiddleware(300), async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user._id || req.userId;
    const cacheKey = `messages:${conversationId}:page:${page}:limit:${limit}`;


    let cachedData = cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for messages conversation ${conversationId}`);
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }

    const skip = (page - 1) * limit;


    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isParticipant(userId)) {
      logger.warn('[MSG:REST] Access denied', { conversationId, userId });
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const messages = await Message.find({
      conversation: conversationId
    })
      .populate('sender', 'name avatar')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Message.countDocuments({
      conversation: conversationId
    });


    const decryptedMessages = messages.map(msg => ({
      ...msg,
      content: decryptMessage(msg.content)
    }));

    const responseData = {
      messages: decryptedMessages.reverse(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };


    cache.set(cacheKey, responseData, 300);
    logger.debug(`Cached messages for conversation ${conversationId}`);

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: error.message
    });
  }
});


router.post('/conversations/:conversationId/messages', auth, invalidationMiddleware(['conversations:', 'messages:']), async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, type = 'text', attachments = [] } = req.body;
    const userId = req.user._id || req.userId;

    logger.info('[MSG:REST] Incoming message', {
      conversationId,
      userId,
      type,
      attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
      hasContent: !!content
    });


    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isParticipant(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // VALIDAÇÃO 0: Usuário banido (prioritário)
    const User = require('../models/User');
    const userDoc = await User.findById(userId);
    if (userDoc && userDoc.isBanned) {
      logger.warn('[MSG:REST] User is banned - blocking send', { 
        conversationId, 
        userId,
        bannedAt: userDoc.bannedAt,
        banReason: userDoc.banReason
      });
      
      return res.status(403).json({
        success: false,
        message: 'Usuário banido - não é possível enviar mensagens',
        error: 'USER_BANNED',
        banned: true,
        bannedAt: userDoc.bannedAt,
        banReason: userDoc.banReason
      });
    }

    // VALIDAÇÃO 1: Chat bloqueado (isBlocked = true)
    if (conversation.isBlocked) {
      const reasonMap = {
        'pedido_finalizado': 'Pedido finalizado',
        'pedido_cancelado': 'Pedido cancelado',
        'support_ticket': 'Suporte acionado - ticket aberto',
        'denunciado': 'Chat denunciado',
        'fraude': 'Suspeita de fraude',
        'proposta_recusada': 'Proposta recusada',
        'usuario_banido': 'Usuário banido'
      };
      const reason = reasonMap[conversation.blockedReason] || 'Chat bloqueado';
      
      logger.warn('[MSG:REST] Conversation is blocked - blocking send', { 
        conversationId, 
        userId, 
        blockedReason: conversation.blockedReason,
        blockedAt: conversation.blockedAt,
        blockedBy: conversation.blockedBy
      });
      
      return res.status(423).json({
        success: false,
        message: `${reason} - não é possível enviar mensagens`,
        error: 'CHAT_BLOCKED',
        blocked: true,
        blockedReason: conversation.blockedReason,
        blockedAt: conversation.blockedAt
      });
    }

    // VALIDAÇÃO 2: Chat reportado
    if (conversation.isReported) {
      logger.warn('[MSG:REST] Conversation is reported - blocking send', { conversationId, userId });
      return res.status(423).json({
        success: false,
        message: 'Chat reportado - não é possível enviar mensagens',
        error: 'CHAT_REPORTED'
      });
    }

    // VALIDAÇÃO 3: Usar método canReceiveMessages() para validação unificada
    if (!conversation.canReceiveMessages()) {
      const blockReason = conversation.isFinalized ? 'Chat finalizado permanentemente' :
                         conversation.status === 'expired' ? 'Chat temporário expirado' :
                         !conversation.isActive ? 'Chat inativo' :
                         'Chat não pode receber mensagens';
      
      logger.warn('[MSG:REST] Conversation cannot receive messages', { 
        conversationId, 
        userId,
        isActive: conversation.isActive,
        isFinalized: conversation.isFinalized,
        status: conversation.status,
        boostingStatus: conversation.boostingStatus
      });
      
      return res.status(423).json({
        success: false,
        message: blockReason,
        error: 'CHAT_CANNOT_RECEIVE_MESSAGES',
        details: {
          isActive: conversation.isActive,
          isFinalized: conversation.isFinalized,
          status: conversation.status
        }
      });
    }

    // VALIDAÇÃO 4: Validar todos os status terminais de boosting
    const TERMINAL_STATUSES = ['completed', 'cancelled', 'disputed'];
    if (TERMINAL_STATUSES.includes(conversation.boostingStatus)) {

      const Agreement = require('../models/Agreement');
      const AcceptedProposal = require('../models/AcceptedProposal');
      

      const activeAgreement = await Agreement.findOne({ 
        conversationId: conversation._id, 
        status: 'active',
        $or: [
          { 'parties.client.userid': userId },
          { 'parties.booster.userid': userId }
        ]
      });
      
      const activeProposal = await AcceptedProposal.findOne({
        conversationId: conversation._id,
        status: 'active',
        $or: [
          { 'client.userid': userId },
          { 'booster.userid': userId }
        ]
      });


      if (!activeAgreement && !activeProposal) {
        const statusMessages = {
          'completed': 'Atendimento finalizado - aguardando nova proposta do booster',
          'cancelled': 'Atendimento cancelado - não é possível enviar mensagens',
          'disputed': 'Atendimento em disputa - aguardando resolução'
        };
        
        logger.warn(`[MSG:REST] Boosting ${conversation.boostingStatus} without active work - blocking`, { 
          conversationId, 
          userId,
          boostingStatus: conversation.boostingStatus
        });
        
        return res.status(423).json({
          success: false,
          message: statusMessages[conversation.boostingStatus] || 'Chat não está ativo',
          error: `BOOSTING_${conversation.boostingStatus.toUpperCase()}`,
          boostingStatus: conversation.boostingStatus
        });
      }
    }


    const encryptedContent = encryptMessage(content);
    const message = new Message({
      conversation: conversationId,
      sender: userId,
      content: encryptedContent,
      type,
      attachments,
      readBy: [{ user: userId, readAt: new Date() }]
    });

    await message.save();


    conversation.lastMessage = message._id;
    conversation.lastMessageAt = new Date();
    await conversation.incrementUnreadCount(userId);

    await message.populate('sender', 'name email avatar');


    const participantIds = conversation.participants.map(p => p.toString());
    cache.invalidateConversationCache(conversationId, participantIds);
    // Also invalidate route-level caches for GET message lists that use cacheMiddleware
    try {
      invalidatePattern(`route:/api/messages/conversations/${conversationId}`);
      invalidatePattern('route:/api/messages');
    } catch (_) {}
    

    cache.cacheMessage(conversationId, {
      ...message.toObject(),
      content: content
    });

    logger.info('[MSG:REST] Message saved', { conversationId, userId, messageId: message._id, type, attachmentsCount: (attachments || []).length });
    res.status(201).json({
      success: true,
      data: {
        ...message.toObject(),
        content: content
      }
    });
  } catch (error) {
    logger.error('[MSG:REST] Error sending message:', { message: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: error.message
    });
  }
});

router.post('/conversations', auth, invalidationMiddleware(['conversations:']), async (req, res) => {
  try {
    let { participantIds, participantId, type = 'direct', metadata = {}, boostingRequestId, proposalId: proposalIdBody } = req.body;
    const userId = req.user._id || req.userId;


    let participants = Array.isArray(participantIds) ? [...participantIds] : [];
    if (participantId && !participants.includes(participantId)) {
      participants.push(participantId);
    }
    if (!participants.includes(userId.toString())) {
      participants.push(userId.toString());
    }


    metadata = metadata || {};
    if (boostingRequestId && !metadata.boostingId) {
      metadata.boostingId = boostingRequestId;
    }
    if (proposalIdBody && !metadata.proposalId) {
      metadata.proposalId = proposalIdBody;
    }


    const conversation = await Conversation.findOrCreateByContext(participants, metadata);
    await conversation.populate('participants', 'name email avatar');

    participants.forEach(pid => {
      cache.invalidateUserCache(pid);
    });

    res.status(201).json({
      success: true,
      data: conversation,
      conversation
    });
  } catch (error) {
    logger.error('Error creating conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating conversation',
      error: error.message
    });
  }
});


router.put('/conversations/:conversationId/read', auth, invalidationMiddleware(['conversations:', 'messages:']), async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { messageIds = [] } = req.body;
    const userId = req.user._id || req.userId;

    // VALIDAÇÃO DE AUTORIZAÇÃO: Verificar se usuário é participante da conversa
    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    // Verificar se userId está na lista de participantes
    const isParticipant = conversation.participants.some(
      p => p.toString() === userId.toString()
    );
    
    if (!isParticipant) {
      logger.warn('Unauthorized attempt to mark messages as read', {
        userId,
        conversationId,
        ip: req.ip
      });
      
      return res.status(403).json({
        success: false,
        message: 'Access denied: You are not a participant of this conversation'
      });
    }

    // Marcar mensagens como lidas (apenas da conversa validada)
    await Message.updateMany(
      {
        _id: { $in: messageIds },
        conversation: conversationId,
        'readBy.user': { $ne: userId }
      },
      {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date()
          }
        }
      }
    );

    // Zerar contador de não lidas
    if (conversation.unreadCount) {
      conversation.unreadCount[userId.toString()] = 0;
      await conversation.save();
      
      // Invalidar cache
      cache.invalidateUserCache(userId);
    }

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    logger.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking messages as read',
      error: error.message
    });
  }
});


router.delete('/messages/:messageId', auth, invalidationMiddleware(['messages:', 'conversations:']), async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id || req.userId;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }


    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await message.softDelete();

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    logger.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting message',
      error: error.message
    });
  }
});


router.get('/cache/stats', auth, async (req, res) => {
  try {
    const stats = cache.getStats();
    
    res.json({
      success: true,
      data: {
        cacheStats: stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting cache statistics',
      error: error.message
    });
  }
});


router.delete('/cache/clear', auth, async (req, res) => {
  try {
    cache.clear();
    
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    logger.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing cache',
      error: error.message
    });
  }
});

module.exports = router;
