const cache = require('../services/GlobalCache');
const logger = require('../utils/logger');

/**
 * Cache middleware for Express routes
 * Automatically caches GET requests and invalidates on mutations
 */
function cacheMiddleware(ttlSeconds = 300, keyGenerator = null) {
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const defaultKey = `route:${req.originalUrl}:${req.userId || 'anonymous'}`;
    const cacheKey = keyGenerator ? keyGenerator(req) : defaultKey;

    // Try to get from cache
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for route: ${req.originalUrl}`);
      return res.json({
        ...cachedData,
        cached: true,
        cacheKey: process.env.NODE_ENV === 'development' ? cacheKey : undefined
      });
    }

    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode === 200 && data.success !== false) {
        cache.set(cacheKey, data, ttlSeconds);
        logger.debug(`Cached response for route: ${req.originalUrl}`);
      }
      
      // Call original json method
      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Cache invalidation middleware
 * Automatically invalidates relevant cache entries on mutations
 */
function invalidationMiddleware(patterns = []) {
  return (req, res, next) => {
    // Only for mutation operations
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return next();
    }

    // Override res.json to trigger invalidation after successful response
    const originalJson = res.json;
    res.json = function(data) {
      // Only invalidate on successful operations
      if (res.statusCode < 400 && data.success !== false) {
        // Auto-generate patterns if not provided
        const autoPatterns = [
          `route:${req.originalUrl.split('/')[1]}`, // Invalidate related route cache
          `${req.userId}` // Invalidate user-specific cache
        ];
        
        const allPatterns = [...patterns, ...autoPatterns];
        
        allPatterns.forEach(pattern => {
          const invalidatedCount = invalidatePattern(pattern);
          if (invalidatedCount > 0) {
            logger.debug(`Invalidated ${invalidatedCount} cache entries for pattern: ${pattern}`);
          }
        });
      }
      
      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Helper function to invalidate cache patterns
 */
function invalidatePattern(pattern) {
  try {
    const keysToDelete = [];
    
    for (const key of cache.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => cache.delete(key));
    return keysToDelete.length;
  } catch (error) {
    logger.error('Error invalidating cache pattern:', error);
    return 0;
  }
}

/**
 * Performance monitoring middleware
 */
function performanceMiddleware() {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Override res.json to measure response time
    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - startTime;
      
      // Log slow requests
      if (duration > 1000) {
        logger.warn(`Slow request detected: ${req.method} ${req.originalUrl} - ${duration}ms`);
      }
      
      // Add performance headers in development
      if (process.env.NODE_ENV === 'development') {
        res.setHeader('X-Response-Time', `${duration}ms`);
        res.setHeader('X-Cache-Stats', JSON.stringify(cache.getStats()));
      }
      
      return originalJson.call(this, data);
    };

    next();
  };
}

module.exports = {
  cacheMiddleware,
  invalidationMiddleware,
  performanceMiddleware,
  invalidatePattern
};
