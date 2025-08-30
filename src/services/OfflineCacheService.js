const logger = require('../utils/logger');
const cache = require('./GlobalCache');

class OfflineCacheService {
  constructor() {
    this.offlineUsers = new Map(); // userId -> offlineData
    this.messageQueue = new Map(); // userId -> messages[]
  }

  /**
   * Ativar cache offline para usuário
   */
  activateOfflineMode(userId, routeInfo = {}) {
    const offlineData = {
      activatedAt: new Date().toISOString(),
      lastRoute: routeInfo.route || 'unknown',
      cacheEnabled: true,
      messageCount: 0
    };

    this.offlineUsers.set(userId, offlineData);
    cache.set(`offline_status:${userId}`, offlineData, 86400); // 24h

    logger.info(`🔄 [Offline Cache] Activated for user ${userId} from route: ${offlineData.lastRoute}`);
    
    return offlineData;
  }

  /**
   * Desativar cache offline para usuário
   */
  deactivateOfflineMode(userId) {
    const offlineData = this.offlineUsers.get(userId);
    
    if (offlineData) {
      this.offlineUsers.delete(userId);
      cache.delete(`offline_status:${userId}`);
      
      const cachedMessages = cache.getOfflineMessages(userId);
      
      logger.info(`🔄 [Offline Cache] Deactivated for user ${userId}. Had ${cachedMessages.length} cached messages`);
      
      return {
        wasOffline: true,
        offlineSince: offlineData.activatedAt,
        cachedMessagesCount: cachedMessages.length,
        deactivatedAt: new Date().toISOString()
      };
    }

    return {
      wasOffline: false,
      cachedMessagesCount: 0
    };
  }

  /**
   * Verificar se usuário está em modo offline
   */
  isUserOfflineForChat(userId) {
    return this.offlineUsers.has(userId) || !!cache.get(`offline_status:${userId}`);
  }

  /**
   * Obter status offline do usuário
   */
  getOfflineStatus(userId) {
    const localData = this.offlineUsers.get(userId);
    const cachedData = cache.get(`offline_status:${userId}`);
    
    const offlineData = localData || cachedData;
    
    if (offlineData) {
      const cachedMessages = cache.getOfflineMessages(userId);
      
      return {
        isOffline: true,
        activatedAt: offlineData.activatedAt,
        lastRoute: offlineData.lastRoute,
        cacheEnabled: offlineData.cacheEnabled,
        cachedMessagesCount: cachedMessages.length,
        recentMessages: cachedMessages.slice(-3) // Últimas 3 para preview
      };
    }

    return {
      isOffline: false,
      cachedMessagesCount: 0
    };
  }

  /**
   * Cachear mensagem para usuário offline
   */
  cacheMessageForOfflineUser(userId, message) {
    if (this.isUserOfflineForChat(userId)) {
      const enrichedMessage = {
        ...message,
        cachedAt: new Date().toISOString(),
        cachedForOfflineUser: true
      };

      cache.cacheOfflineMessage(userId, enrichedMessage);
      
      // Atualizar contador local
      const offlineData = this.offlineUsers.get(userId);
      if (offlineData) {
        offlineData.messageCount = (offlineData.messageCount || 0) + 1;
      }

      logger.info(`📦 [Offline Cache] Message cached for offline user ${userId}`);
      
      return true;
    }
    
    return false;
  }

  /**
   * Obter estatísticas do cache offline
   */
  getStats() {
    const stats = {
      totalOfflineUsers: this.offlineUsers.size,
      offlineUsers: [],
      totalCachedMessages: 0
    };

    this.offlineUsers.forEach((data, userId) => {
      const cachedMessages = cache.getOfflineMessages(userId);
      
      stats.offlineUsers.push({
        userId,
        activatedAt: data.activatedAt,
        lastRoute: data.lastRoute,
        cachedMessagesCount: cachedMessages.length
      });
      
      stats.totalCachedMessages += cachedMessages.length;
    });

    return stats;
  }

  /**
   * Limpar cache de usuário específico
   */
  clearUserCache(userId) {
    const messageCount = cache.getOfflineMessages(userId).length;
    cache.clearOfflineMessages(userId);
    
    logger.info(`🗑️ [Offline Cache] Cleared ${messageCount} messages for user ${userId}`);
    
    return messageCount;
  }

  /**
   * Limpar todos os caches offline expirados
   */
  cleanupExpiredCaches() {
    let cleanedCount = 0;
    
    this.offlineUsers.forEach((data, userId) => {
      const activatedAt = new Date(data.activatedAt);
      const now = new Date();
      const hoursSinceActivation = (now - activatedAt) / (1000 * 60 * 60);
      
      // Limpar caches com mais de 24 horas
      if (hoursSinceActivation > 24) {
        this.deactivateOfflineMode(userId);
        this.clearUserCache(userId);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      logger.info(`🧹 [Offline Cache] Cleaned up ${cleanedCount} expired offline caches`);
    }

    return cleanedCount;
  }
}

module.exports = new OfflineCacheService();
