const express = require('express');
const router = express.Router();
const purchasesRoutes = require('./purchasesRoutes');
const { auth } = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const logger = require('../utils/logger');


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
      .populate('participants', 'name email avatar profileImage')
      .populate('lastMessage')
      .sort('-lastMessageAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Conversation.countDocuments({
      participants: userId,
      isActive: true
    });

    logger.info(`[COMPATIBILITY] Found ${conversations.length} conversations`);


    const formattedConversations = conversations.map(conv => {
      try {

        const otherParticipant = conv.participants.find(
          p => p && p._id && p._id.toString() !== userId.toString()
        );


        const userUnreadCount = conv.unreadCount?.get?.(userId.toString()) || 
                               conv.unreadCount?.[userId.toString()] || 0;

        return {
          _id: conv._id,
          isGroupChat: conv.type === 'group' || conv.participants.length > 2,
          name: conv.type === 'group' 
            ? (conv.name || conv.groupName || 'Group Chat')
            : (otherParticipant?.name || 'Unknown User'),
          lastMessage: conv.lastMessage?.content || '',
          lastMessageDate: conv.lastMessageAt || conv.updatedAt,
          unreadCount: userUnreadCount,
          participants: conv.participants.map(p => ({
            _id: p._id,
            name: p.name,
            email: p.email
          })),
          relatedItem: conv.marketplaceItem || null,
          relatedOrder: conv.proposal || null,
          updatedAt: conv.updatedAt
        };
      } catch (error) {
        logger.error(`[COMPATIBILITY] Error formatting conversation ${conv._id}:`, error);
        return {
          _id: conv._id,
          isGroupChat: false,
          name: 'Unknown Conversation',
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
      .populate('sender', 'name email avatar profileImage')
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
      content: msg.content,
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
