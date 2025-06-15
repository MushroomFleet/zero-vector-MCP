const { logger } = require('../utils/logger');

/**
 * Role-based authorization middleware
 */
const requireRole = (requiredRoles) => {
  // Ensure requiredRoles is an array
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      if (!roles.includes(req.user.role)) {
        logger.warn('Authorization failed - insufficient role', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: roles,
          endpoint: req.path,
          method: req.method
        });

        return res.status(403).json({
          status: 'error',
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'Insufficient permissions to access this resource',
            details: `Required role(s): ${roles.join(', ')}`
          }
        });
      }

      logger.debug('Authorization successful', {
        userId: req.user.id,
        userRole: req.user.role,
        endpoint: req.path,
        method: req.method
      });

      next();
    } catch (error) {
      logger.error('Authorization error', {
        error: error.message,
        userId: req.user?.id,
        endpoint: req.path,
        method: req.method
      });

      return res.status(500).json({
        status: 'error',
        error: {
          code: 'AUTHORIZATION_SERVICE_ERROR',
          message: 'Authorization service error'
        }
      });
    }
  };
};

/**
 * Permission-based authorization middleware for API keys
 */
const requirePermission = (requiredPermissions) => {
  // Ensure requiredPermissions is an array
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  
  return (req, res, next) => {
    try {
      // For JWT authentication, check user role
      if (req.authType === 'jwt') {
        if (req.user?.role === 'admin') {
          return next(); // Admins have all permissions
        }
        
        // For non-admin JWT users, check if they have basic access
        if (!permissions.includes('read') && req.user?.role !== 'user') {
          return res.status(403).json({
            status: 'error',
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Insufficient permissions to access this resource'
            }
          });
        }
        
        return next();
      }

      // For API key authentication, check specific permissions
      if (req.authType === 'api_key') {
        if (!req.apiKey || !req.apiKey.permissions) {
          return res.status(401).json({
            status: 'error',
            error: {
              code: 'INVALID_API_KEY',
              message: 'Invalid API key or missing permissions'
            }
          });
        }

        const hasPermission = permissions.some(permission => 
          checkPermission(req.apiKey.permissions, permission)
        );

        if (!hasPermission) {
          logger.warn('Authorization failed - insufficient API key permissions', {
            apiKeyId: req.apiKey.id,
            apiKeyPermissions: req.apiKey.permissions,
            requiredPermissions: permissions,
            endpoint: req.path,
            method: req.method
          });

          return res.status(403).json({
            status: 'error',
            error: {
              code: 'INSUFFICIENT_API_KEY_PERMISSIONS',
              message: 'API key does not have sufficient permissions',
              details: `Required permission(s): ${permissions.join(', ')}`
            }
          });
        }
      }

      logger.debug('Permission check successful', {
        authType: req.authType,
        userId: req.user?.id,
        apiKeyId: req.apiKey?.id,
        requiredPermissions: permissions,
        endpoint: req.path,
        method: req.method
      });

      next();
    } catch (error) {
      logger.error('Permission check error', {
        error: error.message,
        endpoint: req.path,
        method: req.method
      });

      return res.status(500).json({
        status: 'error',
        error: {
          code: 'AUTHORIZATION_SERVICE_ERROR',
          message: 'Authorization service error'
        }
      });
    }
  };
};

/**
 * Check if permissions array contains required permission
 */
const checkPermission = (userPermissions, requiredPermission) => {
  if (!Array.isArray(userPermissions)) {
    return false;
  }

  // Admin permission grants all access
  if (userPermissions.includes('admin')) {
    return true;
  }

  // Check for exact permission match
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // Check for broader permissions (e.g., 'write' includes 'read')
  if (requiredPermission === 'read' && 
      (userPermissions.includes('write') || userPermissions.includes('delete'))) {
    return true;
  }

  // Check for resource-specific permissions
  if (requiredPermission.includes(':')) {
    const [resource, action] = requiredPermission.split(':');
    
    // Check if user has general permission for the action
    if (userPermissions.includes(action)) {
      return true;
    }
    
    // Check for resource-specific permission
    if (userPermissions.includes(`${resource}:${action}`)) {
      return true;
    }
  }

  return false;
};

/**
 * Require user to be the owner of a resource or an admin
 */
const requireOwnershipOrAdmin = (resourceIdField = 'id') => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      // Admins can access any resource
      if (req.user.role === 'admin') {
        return next();
      }

      // Check if user owns the resource
      const resourceId = req.params[resourceIdField];
      if (!resourceId) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'MISSING_RESOURCE_ID',
            message: 'Resource ID is required'
          }
        });
      }

      // For user resources, check if the ID matches the authenticated user
      if (resourceIdField === 'userId' || resourceIdField === 'id') {
        if (req.user.id !== resourceId) {
          return res.status(403).json({
            status: 'error',
            error: {
              code: 'ACCESS_DENIED',
              message: 'Access denied - you can only access your own resources'
            }
          });
        }
      }

      // For other resources, this middleware should be combined with 
      // additional checks in the route handler
      next();

    } catch (error) {
      logger.error('Ownership check error', {
        error: error.message,
        userId: req.user?.id,
        endpoint: req.path,
        method: req.method
      });

      return res.status(500).json({
        status: 'error',
        error: {
          code: 'AUTHORIZATION_SERVICE_ERROR',
          message: 'Authorization service error'
        }
      });
    }
  };
};

/**
 * Optional authentication middleware
 * Allows both authenticated and unauthenticated access
 */
const optionalAuth = (authMiddleware) => {
  return (req, res, next) => {
    // If no authorization header is present, continue without authentication
    if (!req.headers.authorization && !req.headers['x-api-key'] && !req.query.api_key) {
      return next();
    }

    // Otherwise, use the provided auth middleware
    authMiddleware(req, res, next);
  };
};

/**
 * Rate limiting based on authentication status
 */
const authBasedRateLimit = (authenticatedLimit, unauthenticatedLimit) => {
  return (req, res, next) => {
    const limit = req.user ? authenticatedLimit : unauthenticatedLimit;
    
    // Add rate limit info to headers
    res.setHeader('X-RateLimit-Authenticated', req.user ? 'true' : 'false');
    res.setHeader('X-RateLimit-Limit', limit);
    
    next();
  };
};

module.exports = {
  requireRole,
  requirePermission,
  requireOwnershipOrAdmin,
  optionalAuth,
  authBasedRateLimit,
  checkPermission
};
