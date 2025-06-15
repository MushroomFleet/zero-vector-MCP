const { logger } = require('../utils/logger');

/**
 * API Key Authentication Middleware
 * Validates API keys and attaches key/user information to request
 */
const authenticateApiKey = (apiKeyService) => {
  return async (req, res, next) => {
    try {
      // Extract API key from header or query parameter
      const apiKey = req.headers['x-api-key'] || 
                   req.headers['authorization']?.replace('Bearer ', '') ||
                   req.query.api_key;

      if (!apiKey) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'MISSING_API_KEY',
            message: 'API key required',
            details: 'Provide API key in X-API-Key header, Authorization header, or api_key query parameter'
          }
        });
      }

      // Validate API key
      const keyData = await apiKeyService.validateApiKey(apiKey);
      
      if (!keyData) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid or expired API key'
          }
        });
      }

      // Attach key and user data to request
      req.apiKey = keyData;
      req.user = keyData.user;
      req.authType = 'api_key';

      // Add API key info to response headers for debugging
      if (req.headers['x-debug'] === 'true') {
        res.setHeader('X-API-Key-ID', keyData.id);
        res.setHeader('X-User-ID', keyData.userId);
      }

      logger.debug('API key authentication successful', {
        keyId: keyData.id,
        userId: keyData.userId,
        endpoint: req.path,
        method: req.method
      });

      next();

    } catch (error) {
      logger.error('API key authentication error', {
        error: error.message,
        endpoint: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(500).json({
        status: 'error',
        error: {
          code: 'AUTH_SERVICE_ERROR',
          message: 'Authentication service error'
        }
      });
    }
  };
};

module.exports = authenticateApiKey;
