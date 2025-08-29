const cache = require('../services/GlobalCache');
const logger = require('../utils/logger');

/**
 * Cache middleware for Express routes
 * Automatically caches GET requests and invalidates on mutations
 */
function cacheMiddleware(ttlSeconds = 300, keyGenerator = null) {
  return (req, res, next) => {

    if (req.method !== 'GET') {
      return next();
    }


    const defaultKey = `route:${req.originalUrl}:${req.userId || 'anonymous'}`;
    const cacheKey = keyGenerator ? keyGenerator(req) : defaultKey;


    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for route: ${req.originalUrl}`);
      return res.json({
        ...cachedData,
        cached: true,
        cacheKey: process.env.NODE_ENV === 'development' ? cacheKey : undefined
      });
    }


    const originalJson = res.json;
    res.json = function(data) {

      if (res.statusCode === 200 && data.success !== false) {
        cache.set(cacheKey, data, ttlSeconds);
        logger.debug(`Cached response for route: ${req.originalUrl}`);
      }
      

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

    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      return next();
    }


    const originalJson = res.json;
    res.json = function(data) {

      if (res.statusCode < 400 && data.success !== false) {

        const autoPatterns = [
          `route:${req.originalUrl.split('/')[1]}`,
          `${req.userId}`
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
    

    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - startTime;
      

      if (duration > 1000) {
        logger.warn(`Slow request detected: ${req.method} ${req.originalUrl} - ${duration}ms`);
      }
      

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
