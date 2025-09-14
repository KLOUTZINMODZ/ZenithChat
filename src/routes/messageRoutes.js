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
const { cacheMiddleware, invalidationMiddleware, performanceMiddleware } = require('../middleware/cacheMiddleware');


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
    .populate('sender', 'name email avatar')
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
    .populate('participants', 'name email avatar')
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
      .populate('participants', 'name email avatar profileImage')
      .populate('lastMessage')
      .populate('client.userid', 'name email avatar profileImage')
      .populate('booster.userid', 'name email avatar profileImage')
      .populate('marketplace.buyer.userid', 'name email avatar profileImage')
      .populate('marketplace.seller.userid', 'name email avatar profileImage')
      .sort('-lastMessageAt')
      .skip(skip)
      .limit(parseInt(limit));

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
        const plain = conv.toObject();
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
        if (!isMarketplace || isBoosting) {
          plain.metadata = meta;
          return plain;
        }

        let buyerId = null, sellerId = null;
        if (meta.purchaseId) {
          const p = await Purchase.findById(meta.purchaseId).select('buyerId sellerId');
          if (p) {
            buyerId = p.buyerId?.toString() || null;
            sellerId = p.sellerId?.toString() || null;
          }
        }
        if (!buyerId || !sellerId) {
          const p2 = await Purchase.findOne({ conversationId: conv._id }).select('buyerId sellerId');
          if (p2) {
            buyerId = buyerId || (p2.buyerId?.toString() || null);
            sellerId = sellerId || (p2.sellerId?.toString() || null);
          }
        }

        // Fallback: deduz seller a partir do marketplaceItemId
        try {
          if ((!sellerId || !buyerId) && meta.marketplaceItemId) {
            const item = await MarketItem.findById(meta.marketplaceItemId).select('userId');
            if (item?.userId) {
              const sellerFromItem = item.userId.toString();
              sellerId = sellerId || sellerFromItem;
              // buyerId é o outro participante (se possível deduzir)
              if (!buyerId && Array.isArray(plain.participants)) {
                const participantIds = plain.participants.map(p => p && (p._id?.toString?.() || String(p))).filter(Boolean);
                const maybeBuyer = participantIds.find(pid => pid !== sellerFromItem);
                if (maybeBuyer) buyerId = maybeBuyer;
              }
            }
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

          // Merge/ensure client & booster fields even if object já existe
          if (clientData) {
            plain.client = {
              ...(plain.client || {}),
              userid: clientData.userid,
              name: plain.client?.name || clientData.name,
              avatar: plain.client?.avatar || clientData.avatar
            };
          }
          if (boosterData) {
            plain.booster = {
              ...(plain.booster || {}),
              userid: boosterData.userid,
              name: plain.booster?.name || boosterData.name,
              avatar: plain.booster?.avatar || boosterData.avatar
            };
          }

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
        return conv.toObject();
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


        const userUnreadCount = (conv.unreadCount && typeof conv.unreadCount.get === 'function')
          ? (conv.unreadCount.get(userId.toString()) || 0)
          : (typeof conv.unreadCount === 'number' ? conv.unreadCount : 0);


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


// GET /api/conversations/:conversationId - retorna uma conversa única enriquecida
router.get('/conversations/:conversationId', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id || req.userId;

    const conv = await Conversation.findById(conversationId)
      .populate('participants', 'name email avatar profileImage')
      .populate('lastMessage')
      .populate('client.userid', 'name email avatar profileImage')
      .populate('booster.userid', 'name email avatar profileImage')
      .populate('marketplace.buyer.userid', 'name email avatar profileImage')
      .populate('marketplace.seller.userid', 'name email avatar profileImage');

    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Verifica participação do usuário
    try {
      if (typeof conv.isParticipant === 'function') {
        if (!conv.isParticipant(userId)) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }
      } else {
        const isPart = (conv.participants || []).some(p => {
          const id = p && (p._id?.toString?.() || p.toString?.() || String(p));
          return id === userId.toString();
        });
        if (!isPart) return res.status(403).json({ success: false, message: 'Access denied' });
      }
    } catch (_) {}

    // Conta não lidas para o usuário
    let unreadCount = 0;
    try {
      unreadCount = await Message.countDocuments({
        conversation: conv._id,
        sender: { $ne: userId },
        'readBy.user': { $ne: userId }
      });
    } catch (_) {}

    // Converte e decripta preview
    const plain = conv.toObject();
    try {
      if (plain.lastMessage && plain.lastMessage.content) {
        plain.lastMessage.content = decryptMessage(plain.lastMessage.content);
      }
    } catch (_) {}

    // Normaliza metadata
    const rawMeta = plain.metadata;
    let meta = {};
    try {
      if (rawMeta && typeof rawMeta.get === 'function') {
        meta = Object.fromEntries(rawMeta);
      } else if (rawMeta && typeof rawMeta === 'object') {
        meta = { ...rawMeta };
      }
    } catch (_) {}

    // Enriquecimento específico para Marketplace (não tocar boosting)
    try {
      const isBoosting = meta?.boostingId || plain.boostingStatus;
      const isMarketplace = meta?.purchaseId || meta?.context === 'marketplace_purchase' || plain.type === 'marketplace';
      if (isMarketplace && !isBoosting) {
        let buyerId = null, sellerId = null;
        if (meta.purchaseId) {
          const p = await Purchase.findById(meta.purchaseId).select('buyerId sellerId');
          if (p) {
            buyerId = p.buyerId?.toString() || null;
            sellerId = p.sellerId?.toString() || null;
          }
        }
        if (!buyerId || !sellerId) {
          const p2 = await Purchase.findOne({ conversationId: conv._id }).select('buyerId sellerId');
          if (p2) {
            buyerId = buyerId || (p2.buyerId?.toString() || null);
            sellerId = sellerId || (p2.sellerId?.toString() || null);
          }
        }
        // Fallback via marketplaceItemId
        if ((!sellerId || !buyerId) && meta.marketplaceItemId) {
          const item = await MarketItem.findById(meta.marketplaceItemId).select('userId');
          if (item?.userId) {
            sellerId = sellerId || item.userId.toString();
          }
          // buyerId pode ser o outro participante
          if (!buyerId && Array.isArray(plain.participants)) {
            const ids = plain.participants.map(p => p && (p._id?.toString?.() || String(p))).filter(Boolean);
            const current = userId.toString();
            const other = ids.find(id => id !== sellerId && id !== current);
            if (other) buyerId = other;
          }
        }

        const lookupIds = [buyerId, sellerId].filter(Boolean);
        const users = lookupIds.length ? await User.find({ _id: { $in: lookupIds } }).select('name email avatar profileImage') : [];
        const map = new Map(users.map(u => [u._id.toString(), u]));

        const buyer = buyerId ? map.get(buyerId) : null;
        const seller = sellerId ? map.get(sellerId) : null;

        const clientData = buyer ? {
          userid: buyer._id.toString(),
          _id: buyer._id.toString(),
          name: buyer.name || 'Cliente',
          avatar: buyer.avatar || buyer.profileImage || null
        } : undefined;

        const boosterData = seller ? {
          userid: seller._id.toString(),
          _id: seller._id.toString(),
          name: seller.name || 'Vendedor',
          avatar: seller.avatar || seller.profileImage || null
        } : undefined;

        // Atualiza metadata e compat client/booster
        plain.metadata = { ...meta };
        if (clientData) plain.metadata.clientData = { ...(plain.metadata.clientData || {}), ...clientData };
        if (boosterData) plain.metadata.boosterData = { ...(plain.metadata.boosterData || {}), ...boosterData };
        if (!plain.client && clientData) plain.client = { userid: clientData.userid, name: clientData.name, avatar: clientData.avatar };
        if (!plain.booster && boosterData) plain.booster = { userid: boosterData.userid, name: boosterData.name, avatar: boosterData.avatar };

        // Rebuild participants deduplicados
        try {
          const rebuilt = [];
          if (buyer) rebuilt.push({ _id: buyer._id, name: buyer.name, email: buyer.email, avatar: buyer.avatar, profileImage: buyer.avatar || buyer.profileImage || null });
          if (seller) rebuilt.push({ _id: seller._id, name: seller.name, email: seller.email, avatar: seller.avatar, profileImage: seller.avatar || seller.profileImage || null });
          if (rebuilt.length >= 1) {
            const seen = new Set();
            plain.participants = rebuilt.filter(p => {
              const id = p && p._id?.toString?.();
              if (!id || seen.has(id)) return false;
              seen.add(id);
              return true;
            });
          }
        } catch (_) {}
      } else {
        plain.metadata = meta;
      }
    } catch (e) {
      logger.warn('Marketplace enrichment (REST single) failed', { id: conv?._id?.toString?.(), error: e?.message });
      plain.metadata = meta;
    }

    // Formatação compatível
    let otherParticipant = null;
    const isGroupChat = Array.isArray(plain.participants) ? (plain.type === 'group' || plain.participants.length > 2) : false;
    if (!isGroupChat && Array.isArray(plain.participants) && plain.participants.length >= 2) {
      otherParticipant = plain.participants.find(
        p => p && p._id && p._id.toString() !== userId.toString()
      );
    }

    const formatted = {
      _id: plain._id,
      isGroupChat,
      name: isGroupChat ? (plain.name || plain.groupName || 'Group Chat') : (otherParticipant?.name || 'Unknown User'),
      image: isGroupChat ? (plain.groupImage || null) : (otherParticipant?.avatar || otherParticipant?.profileImage || null),
      lastMessage: (plain.lastMessage && plain.lastMessage.content) ? plain.lastMessage.content : '',
      lastMessageDate: plain.lastMessageAt || plain.updatedAt,
      unreadCount,
      participants: (plain.participants || []).map(p => ({
        _id: p._id,
        name: p.name,
        email: p.email,
        profileImage: p.avatar || p.profileImage
      })),
      relatedItem: plain.marketplaceItem || null,
      relatedOrder: plain.proposal || null,
      updatedAt: plain.updatedAt,

      boostingStatus: plain.boostingStatus || null,
      type: plain.type,

      isTemporary: plain.isTemporary || false,
      expiresAt: plain.expiresAt || null,
      status: plain.status || null,
      client: plain.client || null,
      booster: plain.booster || null,
      metadata: plain.metadata || null,
      marketplace: plain.marketplace || null
    };

    // Para compatibilidade com código que espera o objeto direto
    return res.json(formatted);

  } catch (error) {
    logger.error('Error fetching single conversation:', error);
    return res.status(500).json({ success: false, message: 'Error fetching conversation', error: error.message });
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
      .populate('sender', 'name email avatar')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Message.countDocuments({
      conversation: conversationId
    });


    const decryptedMessages = messages.map(msg => {
      const msgObj = msg.toObject();
      msgObj.content = decryptMessage(msg.content);
      return msgObj;
    });

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


    if (conversation.isReported) {
      logger.warn('[MSG:REST] Conversation reported - blocking send', { conversationId, userId });
      return res.status(423).json({
        success: false,
        message: 'Chat reportado - não é possível enviar mensagens',
        error: 'CHAT_REPORTED'
      });
    }


    if (!conversation.isActive) {
      logger.warn('[MSG:REST] Conversation inactive/finalized - blocking send', { conversationId, userId });
      return res.status(423).json({
        success: false,
        message: 'Chat finalizado - envie uma nova proposta para reativar',
        error: 'CHAT_FINALIZED'
      });
    }


    if (conversation.boostingStatus === 'completed') {

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
        logger.warn('[MSG:REST] Boosting completed without active agreement/proposal - blocking', { conversationId, userId });
        return res.status(423).json({
          success: false,
          message: 'Atendimento finalizado - aguardando nova proposta do booster',
          error: 'BOOSTING_COMPLETED'
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


    const conversation = await Conversation.findById(conversationId);
    if (conversation && conversation.unreadCount) {
      conversation.unreadCount[userId.toString()] = 0;
      await conversation.save();
      

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
