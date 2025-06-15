const { logger } = require('../utils/logger');

/**
 * JWT Authentication Middleware
 * Validates JWT tokens and attaches user information to request
 */
const authenticateJWT = (jwtService) => {
  return async (req, res, next) => {
    try {
      // Extract JWT token from Authorization header
      const authHeader = req.headers['authorization'];
      
      if (!authHeader) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'MISSING_TOKEN',
            message: 'Authorization token required',
            details: 'Provide JWT token in Authorization header as "Bearer <token>"'
          }
        });
      }

      const tokenMatch = authHeader.match(/^Bearer\s(.+)$/);
      if (!tokenMatch) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Invalid token format',
            details: 'Authorization header must be in format "Bearer <token>"'
          }
        });
      }

      const token = tokenMatch[1];

      // Verify JWT token
      const decoded = await jwtService.verifyAccessToken(token);
      
      // Attach user data to request
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role
      };
      req.authType = 'jwt';
      req.tokenData = {
        iat: decoded.iat,
        exp: decoded.exp
      };

      // Add user info to response headers for debugging
      if (req.headers['x-debug'] === 'true') {
        res.setHeader('X-User-ID', decoded.userId);
        res.setHeader('X-User-Role', decoded.role);
        res.setHeader('X-Token-Expires', new Date(decoded.exp * 1000).toISOString());
      }

      logger.debug('JWT authentication successful', {
        userId: decoded.userId,
        role: decoded.role,
        endpoint: req.path,
        method: req.method
      });

      next();

    } catch (error) {
      logger.error('JWT authentication error', {
        error: error.message,
        endpoint: req.path,
        method: req.method,
        ip: req.ip
      });

      // Handle specific JWT errors
      if (error.message === 'Token expired') {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Access token has expired',
            details: 'Use refresh token to obtain a new access token'
          }
        });
      }

      if (error.message === 'Invalid token') {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid access token'
          }
        });
      }

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

module.exports = authenticateJWT;
