const CacheService = require('./CacheService');
const logger = require('../utils/logger');


class GlobalCache {
  constructor() {
    if (GlobalCache.instance) {
      return GlobalCache.instance;
    }
    
    this.cacheService = new CacheService();
    GlobalCache.instance = this;
    
    logger.info('🌐 Global Cache initialized');
  }


  set(key, value, ttlSeconds) {
    return this.cacheService.set(key, value, ttlSeconds);
  }

  get(key) {
    return this.cacheService.get(key);
  }

  delete(key) {
    return this.cacheService.delete(key);
  }


  cacheMessage(conversationId, message) {
    return this.cacheService.cacheMessage(conversationId, message);
  }

  cacheMessages(conversationId, messages) {
    return this.cacheService.cacheMessages(conversationId, messages);
  }

  getCachedMessages(conversationId) {
    return this.cacheService.getCachedMessages(conversationId);
  }


  cacheConversations(userId, conversations) {
    return this.cacheService.cacheConversations(userId, conversations);
  }

  getCachedConversations(userId) {
    return this.cacheService.getCachedConversations(userId);
  }


  cacheUserSession(userId, sessionData) {
    return this.cacheService.cacheUserSession(userId, sessionData);
  }

  getUserSession(userId) {
    return this.cacheService.getUserSession(userId);
  }


  cacheOfflineMessage(userId, message) {
    return this.cacheService.cacheOfflineMessage(userId, message);
  }

  getOfflineMessages(userId) {
    return this.cacheService.getOfflineMessages(userId);
  }

  clearOfflineMessages(userId) {
    return this.cacheService.clearOfflineMessages(userId);
  }


  invalidateConversationCache(conversationId, participantIds) {
    return this.cacheService.invalidateConversationCache(conversationId, participantIds);
  }

  invalidateUserCache(userId) {
    return this.cacheService.invalidateUserCache(userId);
  }


  getStats() {
    return this.cacheService.getStats();
  }

  clear() {
    return this.cacheService.clear();
  }

  close() {
    return this.cacheService.close();
  }

  // Utility: expose current cache keys for invalidation helpers
  listKeys() {
    try {
      const it = this.cacheService && this.cacheService.cache && this.cacheService.cache.keys ? this.cacheService.cache.keys() : [];
      return Array.from(it);
    } catch (_) {
      return [];
    }
  }
}


module.exports = new GlobalCache();
