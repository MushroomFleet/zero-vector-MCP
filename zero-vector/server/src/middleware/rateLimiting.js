const rateLimit = require('express-rate-limit');
const { logger } = require('../utils/logger');
const config = require('../config');

let RedisStore;
let redisClient;

// Initialize Redis if enabled
if (config.redis.enabled) {
  try {
    const redis = require('redis');
    RedisStore = require('rate-limit-redis');
    
    redisClient = redis.createClient({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected for rate limiting');
    });

  } catch (error) {
    logger.warn('Redis not available, falling back to memory store', {
      error: error.message
    });
  }
}

/**
 * Create rate limiter with Redis store if available
 */
const createRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: config.security.rateLimitWindowMs,
    max: config.security.rateLimitMaxRequests,
    message: {
      status: 'error',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
  };

  const limiterOptions = { ...defaultOptions, ...options };

  // Use Redis store if available
  if (redisClient && RedisStore) {
    limiterOptions.store = new RedisStore({
      client: redisClient,
      prefix: options.prefix || 'rl:'
    });
  }

  return rateLimit(limiterOptions);
};

/**
 * Global rate limiter for all requests
 */
const globalRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  prefix: 'global_rl:',
  message: {
    status: 'error',
    error: {
      code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later'
    }
  }
});

/**
 * API key specific rate limiter
 */
const apiKeyRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => req.apiKey?.rateLimit || 100,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
  prefix: 'api_key_rl:',
  message: {
    status: 'error',
    error: {
      code: 'API_KEY_RATE_LIMIT_EXCEEDED',
      message: 'API key rate limit exceeded'
    }
  }
});

/**
 * Search operation rate limiter (more restrictive)
 */
const searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  prefix: 'search_rl:',
  message: {
    status: 'error',
    error: {
      code: 'SEARCH_RATE_LIMIT_EXCEEDED',
      message: 'Search rate limit exceeded, please reduce request frequency'
    }
  }
});

/**
 * Write operation rate limiter
 */
const writeRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 50,
  prefix: 'write_rl:',
  message: {
    status: 'error',
    error: {
      code: 'WRITE_RATE_LIMIT_EXCEEDED',
      message: 'Write operation rate limit exceeded'
    }
  }
});

/**
 * Authentication rate limiter (for login attempts)
 */
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  prefix: 'auth_rl:',
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Use email if provided, otherwise IP
    return req.body?.email || req.ip;
  },
  message: {
    status: 'error',
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later'
    }
  }
});

/**
 * Dynamic rate limiter based on user role
 */
const dynamicRateLimiter = (baseMax = 100) => {
  return createRateLimiter({
    windowMs: 60 * 1000,
    max: (req) => {
      if (req.user?.role === 'admin') {
        return baseMax * 5; // Admins get 5x the limit
      } else if (req.user?.role === 'user') {
        return baseMax * 2; // Regular users get 2x
      }
      return baseMax; // Default limit
    },
    keyGenerator: (req) => req.user?.id || req.ip,
    prefix: 'dynamic_rl:'
  });
};

/**
 * Rate limiter with custom error handling
 */
const rateLimiterWithLogging = (limiter, operationType = 'general') => {
  return (req, res, next) => {
    limiter(req, res, (error) => {
      if (error) {
        logger.warn('Rate limit exceeded', {
          operationType,
          ip: req.ip,
          userId: req.user?.id,
          apiKeyId: req.apiKey?.id,
          endpoint: req.path,
          method: req.method,
          userAgent: req.get('User-Agent')
        });
      }
      next(error);
    });
  };
};

/**
 * Check rate limit status without consuming quota
 */
const checkRateLimit = (keyPrefix, windowMs, max) => {
  return async (req, res, next) => {
    if (!redisClient) {
      return next();
    }

    try {
      const key = `${keyPrefix}:${req.ip}`;
      const current = await redisClient.get(key);
      const remaining = Math.max(0, max - (parseInt(current) || 0));
      
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Date.now() + windowMs);

      next();
    } catch (error) {
      logger.error('Rate limit check error', { error: error.message });
      next();
    }
  };
};

module.exports = {
  globalRateLimiter,
  apiKeyRateLimiter,
  searchRateLimiter,
  writeRateLimiter,
  authRateLimiter,
  dynamicRateLimiter,
  rateLimiterWithLogging,
  checkRateLimit,
  createRateLimiter,
  redisClient
};
