const express = require('express');
const router = express.Router();
const cache = require('../services/GlobalCache');
const logger = require('../utils/logger');
const { auth } = require('../middleware/auth');

/**
 * GET /api/cache/stats
 * Obter estatísticas do cache do servidor
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const stats = cache.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/cache/sync/:userId
 * Sincronizar cache do usuário - retorna dados relevantes para sincronização
 */
router.get('/sync/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    

    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const syncData = {
      conversations: cache.getCachedConversations(userId),
      session: cache.getUserSession(userId),
      timestamp: new Date().toISOString(),
      version: Date.now().toString()
    };


    if (syncData.conversations) {
      syncData.messageCache = {};
      syncData.conversations.forEach(conv => {
        const messages = cache.getCachedMessages(conv._id);
        if (messages && messages.length > 0) {
          syncData.messageCache[conv._id] = messages;
        }
      });
    }

    res.json({
      success: true,
      data: syncData
    });

    logger.debug(`Cache sync requested for user ${userId}`);
  } catch (error) {
    logger.error('Error syncing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/cache/invalidate
 * Invalidar cache específico
 */
router.post('/invalidate', auth, async (req, res) => {
  try {
    const { type, id } = req.body;
    const userId = req.user.id;

    switch (type) {
      case 'conversation':
        cache.invalidateConversationCache(id, [userId]);
        break;
      case 'user':

        if (id === userId) {
          cache.invalidateUserCache(userId);
        } else {
          return res.status(403).json({
            success: false,
            error: 'Can only invalidate own cache'
          });
        }
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid cache type'
        });
    }

    res.json({
      success: true,
      message: `${type} cache invalidated`
    });

    logger.debug(`Cache invalidated - type: ${type}, id: ${id}, by user: ${userId}`);
  } catch (error) {
    logger.error('Error invalidating cache:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/cache/warm/:userId
 * Pré-carregar cache para usuário (warm up)
 */
router.post('/warm/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }


    const Conversation = require('../models/Conversation');
    const conversations = await Conversation.find({
      participants: userId
    })
      .populate('participants', 'name avatar')
      .populate('lastMessage')
      .sort('-lastMessageAt')
      .limit(50);


    cache.cacheConversations(userId, conversations);


    const Message = require('../models/Message');
    let cachedMessagesCount = 0;

    for (const conv of conversations.slice(0, 10)) {
      const messages = await Message.find({
        conversation: conv._id
      })
        .populate('sender', 'name avatar')
        .sort('-createdAt')
        .limit(50);

      if (messages.length > 0) {
        cache.cacheMessages(conv._id, messages.reverse());
        cachedMessagesCount += messages.length;
      }
    }

    res.json({
      success: true,
      data: {
        conversationsCached: conversations.length,
        messagesCached: cachedMessagesCount,
        timestamp: new Date().toISOString()
      }
    });

    logger.info(`Cache warmed up for user ${userId} - ${conversations.length} conversations, ${cachedMessagesCount} messages`);
  } catch (error) {
    logger.error('Error warming cache:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/cache/clear
 * Limpar todo o cache (admin only)
 */
router.delete('/clear', auth, async (req, res) => {
  try {

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    cache.clear();

    res.json({
      success: true,
      message: 'Cache cleared completely'
    });

    logger.warn(`Cache cleared by admin user ${req.user.id}`);
  } catch (error) {
    logger.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/cache/health
 * Status de saúde do cache
 */
router.get('/health', async (req, res) => {
  try {
    const stats = cache.getStats();
    const health = {
      status: 'healthy',
      cache: {
        size: stats.cacheSize,
        maxSize: stats.maxSize,
        hitRate: stats.hitRate,
        memoryUsage: stats.memoryUsage
      },
      timestamp: new Date().toISOString()
    };


    if (stats.cacheSize > stats.maxSize * 0.9) {
      health.status = 'warning';
      health.warning = 'Cache approaching size limit';
    }

    if (parseFloat(stats.hitRate) < 50) {
      health.status = 'warning';
      health.warning = 'Low cache hit rate';
    }

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Error checking cache health:', error);
    res.status(500).json({
      success: false,
      data: {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
