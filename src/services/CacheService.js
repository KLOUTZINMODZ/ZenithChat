const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.cache = new Map();
    this.ttlMap = new Map();
    this.maxSize = 10000;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };
    
    this.startCleanupInterval();
    logger.info('🧠 In-Memory Cache Service initialized');
  }


  set(key, value, ttlSeconds = null) {
    try {
      this.evictIfNecessary();
      
      this.cache.set(key, value);
      this.stats.sets++;

      if (ttlSeconds) {
        const expiresAt = Date.now() + (ttlSeconds * 1000);
        this.ttlMap.set(key, expiresAt);
      }
      
      return true;
    } catch (error) {
      logger.error('Error setting cache:', error);
      return false;
    }
  }

  get(key) {
    try {

      if (this.isExpired(key)) {
        this.delete(key);
        this.stats.misses++;
        return null;
      }

      if (this.cache.has(key)) {
        this.stats.hits++;
        return this.cache.get(key);
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      logger.error('Error getting from cache:', error);
      this.stats.misses++;
      return null;
    }
  }

  delete(key) {
    try {
      const deleted = this.cache.delete(key);
      this.ttlMap.delete(key);
      if (deleted) {
        this.stats.deletes++;
      }
      return deleted;
    } catch (error) {
      logger.error('Error deleting from cache:', error);
      return false;
    }
  }


  cacheMessage(conversationId, message) {
    try {
      const key = `messages:${conversationId}`;
      let messages = this.get(key) || [];
      
      messages.unshift(message);
      

      if (messages.length > 100) {
        messages = messages.slice(0, 100);
      }
      
      this.set(key, messages, 3600);
      logger.debug(`Cached message for conversation ${conversationId}`);
    } catch (error) {
      logger.error('Error caching message:', error);
    }
  }

  cacheMessages(conversationId, messages) {
    try {
      const key = `messages:${conversationId}`;
      this.set(key, messages, 3600);
      logger.debug(`Cached ${messages.length} messages for conversation ${conversationId}`);
    } catch (error) {
      logger.error('Error caching messages:', error);
    }
  }

  getCachedMessages(conversationId) {
    try {
      const key = `messages:${conversationId}`;
      return this.get(key) || [];
    } catch (error) {
      logger.error('Error getting cached messages:', error);
      return [];
    }
  }


  cacheConversations(userId, conversations) {
    try {
      const key = `conversations:${userId}`;
      this.set(key, conversations, 300);
      logger.debug(`Cached ${conversations.length} conversations for user ${userId}`);
    } catch (error) {
      logger.error('Error caching conversations:', error);
    }
  }

  getCachedConversations(userId) {
    try {
      const key = `conversations:${userId}`;
      return this.get(key);
    } catch (error) {
      logger.error('Error getting cached conversations:', error);
      return null;
    }
  }


  cacheUserSession(userId, sessionData) {
    try {
      const key = `session:${userId}`;
      this.set(key, sessionData, 86400);
      logger.debug(`Cached session for user ${userId}`);
    } catch (error) {
      logger.error('Error caching user session:', error);
    }
  }

  getUserSession(userId) {
    try {
      const key = `session:${userId}`;
      return this.get(key);
    } catch (error) {
      logger.error('Error getting user session:', error);
      return null;
    }
  }


  cacheOfflineMessage(userId, message) {
    try {
      const key = `offline:${userId}`;
      let messages = this.get(key) || [];
      
      const cachedMessage = {
        ...message,
        timestamp: new Date(),
        cached: true
      };
      
      messages.push(cachedMessage);
      

      if (messages.length > 50) {
        messages = messages.slice(-50);
      }
      
      this.set(key, messages, 1296000);
      logger.info(`📦 CACHE: Cached offline message for user ${userId} - type: ${message.type}, reason: ${message.cached_reason}, total cached: ${messages.length}`);
    } catch (error) {
      logger.error('Error caching offline message:', error);
    }
  }

  getOfflineMessages(userId) {
    try {
      const key = `offline:${userId}`;
      const messages = this.get(key) || [];
      logger.info(`📤 CACHE: Retrieved ${messages.length} offline messages for user ${userId}`);
      return messages;
    } catch (error) {
      logger.error('Error getting offline messages:', error);
      return [];
    }
  }

  clearOfflineMessages(userId) {
    try {
      const key = `offline:${userId}`;
      const messages = this.get(key) || [];
      const count = messages.length;
      this.delete(key);
      logger.info(`🧹 CACHE: Cleared ${count} offline messages for user ${userId}`);
    } catch (error) {
      logger.error('Error clearing offline messages:', error);
    }
  }


  invalidateConversationCache(conversationId, participantIds = []) {
    try {

      this.delete(`messages:${conversationId}`);
      

      participantIds.forEach(userId => {
        this.delete(`conversations:${userId}`);
      });
      
      logger.debug(`Invalidated cache for conversation ${conversationId}`);
    } catch (error) {
      logger.error('Error invalidating conversation cache:', error);
    }
  }

  invalidateUserCache(userId) {
    try {

      const keysToDelete = [];
      
      for (const key of this.cache.keys()) {
        if (key.includes(`:${userId}`) || key.includes(`${userId}:`)) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => this.delete(key));
      logger.debug(`Invalidated cache for user ${userId} (${keysToDelete.length} keys)`);
    } catch (error) {
      logger.error('Error invalidating user cache:', error);
    }
  }


  isExpired(key) {
    const expiresAt = this.ttlMap.get(key);
    if (!expiresAt) return false;
    
    if (Date.now() > expiresAt) {
      return true;
    }
    return false;
  }

  evictIfNecessary() {
    if (this.cache.size >= this.maxSize) {

      const keysToEvict = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxSize * 0.1));
      keysToEvict.forEach(key => {
        this.cache.delete(key);
        this.ttlMap.delete(key);
        this.stats.evictions++;
      });
      logger.debug(`Evicted ${keysToEvict.length} cache entries (LRU)`);
    }
  }

  startCleanupInterval() {

    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  cleanup() {
    try {
      const now = Date.now();
      let expiredCount = 0;
      
      for (const [key, expiresAt] of this.ttlMap.entries()) {
        if (now > expiresAt) {
          this.cache.delete(key);
          this.ttlMap.delete(key);
          expiredCount++;
        }
      }
      
      if (expiredCount > 0) {
        logger.debug(`Cleaned ${expiredCount} expired cache entries`);
      }
    } catch (error) {
      logger.error('Error during cache cleanup:', error);
    }
  }


  clearConversationCache(conversationId) {
    try {
      this.delete(`messages:${conversationId}`);
      logger.debug(`Cleared conversation cache for ${conversationId}`);
    } catch (error) {
      logger.error('Error clearing conversation cache:', error);
    }
  }


  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : '0.00';
      
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
      memoryUsage: this.getMemoryEstimate()
    };
  }

  getMemoryEstimate() {

    let totalSize = 0;
    for (const [key, value] of this.cache.entries()) {
      totalSize += JSON.stringify(key).length + JSON.stringify(value).length;
    }
    return `${(totalSize / 1024 / 1024).toFixed(2)} MB`;
  }


  clear() {
    this.cache.clear();
    this.ttlMap.clear();
    logger.info('🧹 Cache cleared completely');
  }

  close() {
    this.clear();
    logger.info('🔄 Cache service closed');
  }
}

module.exports = CacheService;
