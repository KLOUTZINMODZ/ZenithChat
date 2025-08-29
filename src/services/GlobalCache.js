const CacheService = require('./CacheService');
const logger = require('../utils/logger');

// Singleton instance for global cache access
class GlobalCache {
  constructor() {
    if (GlobalCache.instance) {
      return GlobalCache.instance;
    }
    
    this.cacheService = new CacheService();
    GlobalCache.instance = this;
    
    logger.info('🌐 Global Cache initialized');
  }

  // Proxy all methods to the cache service
  set(key, value, ttlSeconds) {
    return this.cacheService.set(key, value, ttlSeconds);
  }

  get(key) {
    return this.cacheService.get(key);
  }

  delete(key) {
    return this.cacheService.delete(key);
  }

  // Message cache methods
  cacheMessage(conversationId, message) {
    return this.cacheService.cacheMessage(conversationId, message);
  }

  cacheMessages(conversationId, messages) {
    return this.cacheService.cacheMessages(conversationId, messages);
  }

  getCachedMessages(conversationId) {
    return this.cacheService.getCachedMessages(conversationId);
  }

  // Conversation cache methods
  cacheConversations(userId, conversations) {
    return this.cacheService.cacheConversations(userId, conversations);
  }

  getCachedConversations(userId) {
    return this.cacheService.getCachedConversations(userId);
  }

  // Session cache methods
  cacheUserSession(userId, sessionData) {
    return this.cacheService.cacheUserSession(userId, sessionData);
  }

  getUserSession(userId) {
    return this.cacheService.getUserSession(userId);
  }

  // Offline message methods
  cacheOfflineMessage(userId, message) {
    return this.cacheService.cacheOfflineMessage(userId, message);
  }

  getOfflineMessages(userId) {
    return this.cacheService.getOfflineMessages(userId);
  }

  clearOfflineMessages(userId) {
    return this.cacheService.clearOfflineMessages(userId);
  }

  // Cache invalidation
  invalidateConversationCache(conversationId, participantIds) {
    return this.cacheService.invalidateConversationCache(conversationId, participantIds);
  }

  invalidateUserCache(userId) {
    return this.cacheService.invalidateUserCache(userId);
  }

  // Utility methods
  getStats() {
    return this.cacheService.getStats();
  }

  clear() {
    return this.cacheService.clear();
  }

  close() {
    return this.cacheService.close();
  }
}

// Export singleton instance
module.exports = new GlobalCache();
