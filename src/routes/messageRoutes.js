const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
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


    const formattedConversations = conversations.map(conv => {
      try {

        let otherParticipant = null;
        const isGroupChat = conv.type === 'group' || conv.participants.length > 2;
        
        if (!isGroupChat && conv.participants.length >= 2) {
          otherParticipant = conv.participants.find(
            p => p && p._id && p._id.toString() !== userId.toString()
          );
        }


        const userUnreadCount = conv.unreadCount?.get(userId.toString()) || 0;


        return {
          _id: conv._id,
          isGroupChat: isGroupChat,
          name: isGroupChat 
            ? (conv.name || conv.groupName || 'Group Chat') 
            : (otherParticipant?.name || 'Unknown User'),
          image: isGroupChat 
            ? (conv.groupImage || null) 
            : (otherParticipant?.avatar || otherParticipant?.profileImage || null),
          lastMessage: conv.lastMessage?.content || '',
          lastMessageDate: conv.lastMessageAt || conv.updatedAt,
          unreadCount: userUnreadCount,
          participants: conv.participants.map(p => ({
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
          metadata: conv.metadata || null
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


    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.isParticipant(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }


    if (conversation.isReported) {
      return res.status(423).json({
        success: false,
        message: 'Chat reportado - não é possível enviar mensagens',
        error: 'CHAT_REPORTED'
      });
    }


    if (!conversation.isActive) {
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

    res.status(201).json({
      success: true,
      data: {
        ...message.toObject(),
        content: content
      }
    });
  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: error.message
    });
  }
});

router.post('/conversations', auth, invalidationMiddleware(['conversations:']), async (req, res) => {
  try {
    const { participantIds, type = 'direct', metadata = {} } = req.body;
    const userId = req.user._id || req.userId;

    // Ensure current user is in participants
    if (!participantIds.includes(userId.toString())) {
      participantIds.push(userId);
    }

    const conversation = await Conversation.findOrCreate(participantIds, metadata);
    await conversation.populate('participants', 'name email avatar');

    // Invalidate cache for all participants
    participantIds.forEach(participantId => {
      cache.invalidateUserCache(participantId);
    });

    res.status(201).json({
      success: true,
      data: conversation
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
