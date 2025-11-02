const express = require('express');
const router = express.Router();
const purchasesRoutes = require('./purchasesRoutes');
const { auth } = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const logger = require('../utils/logger');
const { decryptMessage } = require('../utils/encryption');


router.get('/v1/messages/conversations', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user._id || req.userId;
    const skip = (page - 1) * limit;

    logger.info(`[COMPATIBILITY] Fetching conversations for user ${userId}`, { page, limit });

    const conversations = await Conversation.find({
      participants: userId,
      isActive: true
    })
      .populate('participants', 'name avatar profileImage')
      .populate('lastMessage')
      .populate('client.userid', 'name avatar profileImage')
      .populate('booster.userid', 'name avatar profileImage')
      .sort('-lastMessageAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Conversation.countDocuments({
      participants: userId,
      isActive: true
    });

    logger.info(`[COMPATIBILITY] Found ${conversations.length} conversations`);

    const enriched = await Promise.all(conversations.map(async (conv) => {
      try {
        const plain = { ...conv };
        const rawMeta = plain.metadata;
        let meta = {};
        if (rawMeta && typeof rawMeta.get === 'function') meta = Object.fromEntries(rawMeta);
        else if (rawMeta && typeof rawMeta === 'object') meta = { ...rawMeta };

        const isBoosting = meta?.boostingId || plain.boostingStatus;
        const isMarketplace = meta?.purchaseId || meta?.context === 'marketplace_purchase' || plain.type === 'marketplace';

        try {
          if (plain.lastMessage && plain.lastMessage.content) {
            plain.lastMessage.content = decryptMessage(plain.lastMessage.content);
          }
        } catch (_) { }

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

        if (buyerId || sellerId) {
          const ids = [buyerId, sellerId].filter(Boolean);
          const users = await User.find({ _id: { $in: ids } }).select('name email avatar profileImage');
          const map = new Map(users.map(u => [u._id.toString(), u]));

          const buyer = buyerId ? map.get(buyerId) : null;
          const seller = sellerId ? map.get(sellerId) : null;

          const clientData = buyer ? { userid: buyer._id.toString(), _id: buyer._id.toString(), name: buyer.name || 'Cliente', avatar: buyer.avatar || null } : undefined;
          const boosterData = seller ? { userid: seller._id.toString(), _id: seller._id.toString(), name: seller.name || 'Vendedor', avatar: seller.avatar || null } : undefined;

          plain.metadata = { ...meta };
          if (clientData) plain.metadata.clientData = { ...(plain.metadata.clientData || {}), ...clientData };
          if (boosterData) plain.metadata.boosterData = { ...(plain.metadata.boosterData || {}), ...boosterData };

          if (clientData) {
            plain.client = { ...(plain.client || {}), userid: clientData.userid, name: plain.client?.name || clientData.name, avatar: plain.client?.avatar || clientData.avatar };
          }
          if (boosterData) {
            plain.booster = { ...(plain.booster || {}), userid: boosterData.userid, name: plain.booster?.name || boosterData.name, avatar: plain.booster?.avatar || boosterData.avatar };
          }

          try {
            const rebuilt = [];
            if (buyer) rebuilt.push({ _id: buyer._id, name: buyer.name, email: buyer.email, avatar: buyer.avatar, profileImage: buyer.avatar || buyer.profileImage || null });
            if (seller) rebuilt.push({ _id: seller._id, name: seller.name, email: seller.email, avatar: seller.avatar, profileImage: seller.avatar || seller.profileImage || null });
            if (rebuilt.length >= 1) plain.participants = rebuilt;
            else if (Array.isArray(plain.participants)) {
              const seen = new Set();
              plain.participants = plain.participants.filter(p => {
                const id = p && p._id ? p._id.toString() : String(p);
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
              });
            }
          } catch (_) { }
        } else {
          plain.metadata = meta;
        }

        return plain;
      } catch (e) {
        logger.warn('[COMPATIBILITY] Marketplace enrichment failed', { id: conv?._id?.toString?.(), error: e?.message });
        return conv;
      }
    }));

    const formattedConversations = enriched.map(conv => {
      try {
        const isGroup = conv.type === 'group' || (conv.participants || []).length > 2;
        const other = !isGroup ? (conv.participants || []).find(p => p && p._id && p._id.toString() !== userId.toString()) : null;

        const userUnreadCount = conv.unreadCount?.get?.(userId.toString()) ||
                               conv.unreadCount?.[userId.toString()] ||
                               (typeof conv.unreadCount === 'number' ? conv.unreadCount : 0);

        return {
          _id: conv._id,
          isGroupChat: isGroup,
          name: isGroup ? (conv.name || conv.groupName || 'Group Chat') : (other?.name || 'Unknown User'),
          image: isGroup ? (conv.groupImage || null) : (other?.avatar || other?.profileImage || null),
          lastMessage: conv.lastMessage?.content || '',
          lastMessageDate: conv.lastMessageAt || conv.updatedAt,
          unreadCount: userUnreadCount,
          participants: (conv.participants || []).map(p => ({ _id: p._id, name: p.name, email: p.email, profileImage: p.avatar || p.profileImage })),
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
          metadata: conv.metadata || null
        };
      } catch (error) {
        logger.error(`[COMPATIBILITY] Error formatting conversation ${conv._id}:`, error);
        return {
          _id: conv._id,
          isGroupChat: false,
          name: 'Unknown Conversation',
          image: null,
          lastMessage: '',
          lastMessageDate: conv.updatedAt,
          unreadCount: 0,
          participants: [],
          relatedItem: null,
          relatedOrder: null,
          updatedAt: conv.updatedAt
        };
      }
    });

    const response = {
      success: true,
      data: {
        conversations: formattedConversations,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    };

    logger.info(`[COMPATIBILITY] Returning ${formattedConversations.length} conversations`);
    res.json(response);

  } catch (error) {
    logger.error('[COMPATIBILITY] Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching conversations',
      error: error.message
    });
  }
});

router.get('/v1/messages/conversations/:conversationId/messages', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user._id || req.userId;
    const skip = (page - 1) * limit;

    logger.info(`[COMPATIBILITY] Fetching messages for conversation ${conversationId}`);

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
      isActive: true
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const messages = await Message.find({
      conversation: conversationId,
      isDeleted: { $ne: true }
    })
      .populate('sender', 'name avatar profileImage')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Message.countDocuments({
      conversation: conversationId,
      isDeleted: { $ne: true }
    });

    const formattedMessages = messages.map(msg => ({
      _id: msg._id,
      conversationId: msg.conversation,
      senderId: msg.sender._id,
      content: decryptMessage(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
      sender: {
        _id: msg.sender._id,
        name: msg.sender.name,
        email: msg.sender.email,
        profileImage: msg.sender.avatar || msg.sender.profileImage
      },
      attachments: msg.attachments || [],
      type: msg.type || 'text'
    })).reverse();

    res.json({
      success: true,
      messages: formattedMessages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('[COMPATIBILITY] Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: error.message
    });
  }
});

// Ensure purchases routes are available via compatibility mount as well
router.use('/purchases', purchasesRoutes);

module.exports = router;
