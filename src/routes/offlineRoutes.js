const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const cache = require('../services/GlobalCache');
const logger = require('../utils/logger');


router.post('/activate', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    

    const offlineStatus = {
      isOfflineForChat: true,
      activatedAt: new Date().toISOString(),
      cacheEnabled: true,
      lastActiveRoute: req.body.lastRoute || 'unknown'
    };
    

    cache.set(`offline_status:${userId}`, offlineStatus, 86400);
    
    logger.info(`🔄 [Offline Mode] Activated for user ${userId} from route: ${offlineStatus.lastActiveRoute}`);
    
    res.json({
      success: true,
      message: 'Modo offline ativado - mensagens serão armazenadas em cache',
      data: {
        offlineMode: true,
        cacheEnabled: true,
        activatedAt: offlineStatus.activatedAt
      }
    });
    
  } catch (error) {
    logger.error('❌ [Offline Mode] Error activating offline mode:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao ativar modo offline',
      error: error.message
    });
  }
});


router.post('/deactivate', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    

    const offlineStatus = cache.get(`offline_status:${userId}`);
    
    if (offlineStatus) {

      cache.delete(`offline_status:${userId}`);
      

      const offlineMessages = cache.getOfflineMessages(userId);
      
      logger.info(`🔄 [Offline Mode] Deactivated for user ${userId}. Found ${offlineMessages.length} cached messages`);
      
      res.json({
        success: true,
        message: 'Modo offline desativado - bem-vindo de volta!',
        data: {
          offlineMode: false,
          cachedMessagesCount: offlineMessages.length,
          deactivatedAt: new Date().toISOString(),
          wasOfflineSince: offlineStatus.activatedAt
        }
      });
    } else {
      res.json({
        success: true,
        message: 'Usuário não estava em modo offline',
        data: {
          offlineMode: false,
          cachedMessagesCount: 0
        }
      });
    }
    
  } catch (error) {
    logger.error('❌ [Offline Mode] Error deactivating offline mode:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao desativar modo offline',
      error: error.message
    });
  }
});


router.get('/status', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const offlineStatus = cache.get(`offline_status:${userId}`);
    const offlineMessages = cache.getOfflineMessages(userId);
    
    res.json({
      success: true,
      data: {
        isOfflineForChat: !!offlineStatus,
        cacheEnabled: offlineStatus?.cacheEnabled || false,
        activatedAt: offlineStatus?.activatedAt || null,
        lastActiveRoute: offlineStatus?.lastActiveRoute || null,
        cachedMessagesCount: offlineMessages.length,
        offlineMessages: offlineMessages.slice(-5)
      }
    });
    
  } catch (error) {
    logger.error('❌ [Offline Mode] Error getting offline status:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar status offline',
      error: error.message
    });
  }
});


router.delete('/clear-cache', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const messageCount = cache.getOfflineMessages(userId).length;
    cache.clearOfflineMessages(userId);
    
    logger.info(`🗑️ [Offline Mode] Cleared ${messageCount} cached messages for user ${userId}`);
    
    res.json({
      success: true,
      message: `${messageCount} mensagens em cache foram removidas`,
      data: {
        clearedMessagesCount: messageCount,
        clearedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('❌ [Offline Mode] Error clearing cache:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao limpar cache',
      error: error.message
    });
  }
});

module.exports = router;
