const logger = require('./logger');

/**
 * Cache Optimization Utilities
 * Provides intelligent caching strategies and performance optimizations
 */
class CacheOptimizer {
  constructor(cacheService) {
    this.cache = cacheService;
    this.performanceMetrics = {
      queryTimes: new Map(),
      cacheEfficiency: new Map()
    };
  }

  /**
   * Intelligent TTL calculation based on data access patterns
   */
  calculateOptimalTTL(dataType, accessFrequency = 'medium') {
    const ttlMap = {
      messages: {
        high: 1800,
        medium: 900,
        low: 300
      },
      conversations: {
        high: 300,
        medium: 180,
        low: 60
      },
      userSessions: {
        high: 86400,
        medium: 43200,
        low: 21600
      },
      offlineMessages: {
        high: 1296000,
        medium: 604800,
        low: 86400
      }
    };

    return ttlMap[dataType]?.[accessFrequency] || 300;
  }

  /**
   * Preload frequently accessed data
   */
  async warmupCache(userId) {
    try {
      const startTime = Date.now();
      

      const cacheKey = `conversations:${userId}:warmup`;
      if (!this.cache.get(cacheKey)) {
        logger.debug(`Warming up cache for user ${userId}`);
        


        this.cache.set(cacheKey, { warmedUp: true }, 3600);
      }
      
      const duration = Date.now() - startTime;
      logger.debug(`Cache warmup completed for user ${userId} in ${duration}ms`);
      
    } catch (error) {
      logger.error('Error during cache warmup:', error);
    }
  }

  /**
   * Adaptive cache sizing based on memory usage
   */
  optimizeCacheSize() {
    const stats = this.cache.getStats();
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    

    if (heapUsedMB > 500 && this.cache.maxSize > 5000) {
      this.cache.maxSize = Math.max(5000, this.cache.maxSize * 0.8);
      logger.warn(`High memory usage detected. Reducing cache size to ${this.cache.maxSize}`);
    }

    else if (heapUsedMB < 200 && parseFloat(stats.hitRate) > 80 && this.cache.maxSize < 20000) {
      this.cache.maxSize = Math.min(20000, this.cache.maxSize * 1.2);
      logger.info(`Good cache performance. Increasing cache size to ${this.cache.maxSize}`);
    }
  }

  /**
   * Cache-aside pattern helper
   */
  async getOrSet(key, fetchFunction, ttl = 300) {

    let data = this.cache.get(key);
    
    if (data !== null) {
      return data;
    }


    try {
      data = await fetchFunction();
      if (data !== null && data !== undefined) {
        this.cache.set(key, data, ttl);
      }
      return data;
    } catch (error) {
      logger.error(`Error in cache-aside pattern for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Batch cache operations
   */
  async setBatch(entries) {
    try {
      entries.forEach(({ key, value, ttl }) => {
        this.cache.set(key, value, ttl);
      });
      logger.debug(`Batch cached ${entries.length} entries`);
    } catch (error) {
      logger.error('Error in batch cache operation:', error);
    }
  }

  /**
   * Cache pattern matching for bulk invalidation
   */
  invalidatePattern(pattern) {
    try {
      const keysToDelete = [];
      
      for (const key of this.cache.cache.keys()) {
        if (key.includes(pattern)) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => this.cache.delete(key));
      logger.debug(`Invalidated ${keysToDelete.length} cache entries matching pattern: ${pattern}`);
      
      return keysToDelete.length;
    } catch (error) {
      logger.error('Error invalidating cache pattern:', error);
      return 0;
    }
  }

  /**
   * Performance monitoring
   */
  recordQueryTime(operation, duration) {
    if (!this.performanceMetrics.queryTimes.has(operation)) {
      this.performanceMetrics.queryTimes.set(operation, []);
    }
    
    const times = this.performanceMetrics.queryTimes.get(operation);
    times.push(duration);
    

    if (times.length > 100) {
      times.shift();
    }
  }

  getPerformanceReport() {
    const report = {
      cacheStats: this.cache.getStats(),
      queryPerformance: {},
      recommendations: []
    };


    for (const [operation, times] of this.performanceMetrics.queryTimes.entries()) {
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      report.queryPerformance[operation] = {
        averageMs: Math.round(avgTime),
        samples: times.length
      };
    }


    const hitRate = parseFloat(report.cacheStats.hitRate);
    if (hitRate < 50) {
      report.recommendations.push('Low cache hit rate - consider increasing TTL values');
    }
    if (hitRate > 90) {
      report.recommendations.push('Excellent cache performance - consider expanding cache scope');
    }
    
    return report;
  }
}

module.exports = CacheOptimizer;
