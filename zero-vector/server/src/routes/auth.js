const express = require('express');
const joi = require('joi');
const { logger } = require('../utils/logger');
const authenticateJWT = require('../middleware/authenticateJWT');
const { authRateLimiter } = require('../middleware/rateLimiting');

const router = express.Router();

/**
 * Authentication Routes
 * Handles user registration, login, logout, and token management
 */
const createAuthRoutes = (userService, jwtService, apiKeyService) => {
  
  // Validation schemas
  const registerSchema = joi.object({
    email: joi.string().email().required(),
    password: joi.string().min(8).required(),
    role: joi.string().valid('user', 'admin').optional()
  });

  const loginSchema = joi.object({
    email: joi.string().email().required(),
    password: joi.string().required()
  });

  const refreshTokenSchema = joi.object({
    refreshToken: joi.string().required()
  });

  const changePasswordSchema = joi.object({
    currentPassword: joi.string().required(),
    newPassword: joi.string().min(8).required()
  });

  const createApiKeySchema = joi.object({
    name: joi.string().max(100).required(),
    permissions: joi.array().items(
      joi.string().valid(
        'read', 'write', 'delete', 'admin',
        'vectors:read', 'vectors:write', 'vectors:delete',
        'personas:read', 'personas:write', 'personas:delete'
      )
    ).min(1).required(),
    rateLimit: joi.number().integer().min(1).max(10000).optional(),
    expiresInDays: joi.number().integer().min(1).max(365).optional()
  });

  /**
   * POST /auth/register
   * Register a new user
   */
  router.post('/register', authRateLimiter, async (req, res) => {
    try {
      // Validate input
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.details[0].message
          }
        });
      }

      const { email, password, role } = value;

      // Register user
      const user = await userService.registerUser({ email, password, role });

      // Generate tokens
      const tokens = await jwtService.generateTokens(user);

      logger.info('User registered successfully', {
        userId: user.id,
        email: user.email,
        role: user.role
      });

      res.status(201).json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt
          },
          tokens
        }
      });

    } catch (error) {
      logger.error('Registration failed', {
        error: error.message,
        email: req.body.email
      });

      if (error.message.includes('already exists')) {
        return res.status(409).json({
          status: 'error',
          error: {
            code: 'USER_EXISTS',
            message: 'User already exists with this email'
          }
        });
      }

      res.status(500).json({
        status: 'error',
        error: {
          code: 'REGISTRATION_FAILED',
          message: 'Failed to register user'
        }
      });
    }
  });

  /**
   * POST /auth/login
   * Authenticate user and return tokens
   */
  router.post('/login', authRateLimiter, async (req, res) => {
    try {
      // Validate input
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.details[0].message
          }
        });
      }

      const { email, password } = value;

      // Authenticate user
      const user = await userService.authenticateUser(email, password);

      // Generate tokens
      const tokens = await jwtService.generateTokens(user);

      logger.info('User logged in successfully', {
        userId: user.id,
        email: user.email
      });

      res.json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role
          },
          tokens
        }
      });

    } catch (error) {
      logger.error('Login failed', {
        error: error.message,
        email: req.body.email
      });

      if (error.message.includes('Invalid credentials') || 
          error.message.includes('locked') ||
          error.message.includes('deactivated')) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: error.message
          }
        });
      }

      res.status(500).json({
        status: 'error',
        error: {
          code: 'LOGIN_FAILED',
          message: 'Failed to authenticate user'
        }
      });
    }
  });

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token
   */
  router.post('/refresh', authRateLimiter, async (req, res) => {
    try {
      // Validate input
      const { error, value } = refreshTokenSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.details[0].message
          }
        });
      }

      const { refreshToken } = value;

      // Refresh token
      const tokens = await jwtService.refreshToken(refreshToken);

      res.json({
        status: 'success',
        data: { tokens }
      });

    } catch (error) {
      logger.error('Token refresh failed', {
        error: error.message
      });

      if (error.message.includes('expired') || error.message.includes('Invalid')) {
        return res.status(401).json({
          status: 'error',
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: error.message
          }
        });
      }

      res.status(500).json({
        status: 'error',
        error: {
          code: 'TOKEN_REFRESH_FAILED',
          message: 'Failed to refresh token'
        }
      });
    }
  });

  /**
   * POST /auth/logout
   * Logout user and revoke refresh token
   */
  router.post('/logout', authenticateJWT(jwtService), async (req, res) => {
    try {
      const refreshToken = req.body.refreshToken;

      if (refreshToken) {
        await jwtService.revokeRefreshToken(refreshToken);
      }

      logger.info('User logged out successfully', {
        userId: req.user.id
      });

      res.json({
        status: 'success',
        message: 'Logged out successfully'
      });

    } catch (error) {
      logger.error('Logout failed', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        status: 'error',
        error: {
          code: 'LOGOUT_FAILED',
          message: 'Failed to logout user'
        }
      });
    }
  });

  /**
   * POST /auth/logout-all
   * Logout user from all devices
   */
  router.post('/logout-all', authenticateJWT(jwtService), async (req, res) => {
    try {
      const revokedCount = await jwtService.revokeAllUserTokens(req.user.id);

      logger.info('User logged out from all devices', {
        userId: req.user.id,
        revokedTokens: revokedCount
      });

      res.json({
        status: 'success',
        message: 'Logged out from all devices successfully',
        data: {
          revokedTokens: revokedCount
        }
      });

    } catch (error) {
      logger.error('Logout all failed', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        status: 'error',
        error: {
          code: 'LOGOUT_ALL_FAILED',
          message: 'Failed to logout from all devices'
        }
      });
    }
  });

  /**
   * GET /auth/me
   * Get current user information
   */
  router.get('/me', authenticateJWT(jwtService), async (req, res) => {
    try {
      const user = await userService.getUserById(req.user.id);

      if (!user) {
        return res.status(404).json({
          status: 'error',
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.json({
        status: 'success',
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            isActive: user.isActive
          }
        }
      });

    } catch (error) {
      logger.error('Get user info failed', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        status: 'error',
        error: {
          code: 'GET_USER_FAILED',
          message: 'Failed to get user information'
        }
      });
    }
  });

  /**
   * POST /auth/change-password
   * Change user password
   */
  router.post('/change-password', authenticateJWT(jwtService), async (req, res) => {
    try {
      // Validate input
      const { error, value } = changePasswordSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.details[0].message
          }
        });
      }

      const { currentPassword, newPassword } = value;

      await userService.changePassword(req.user.id, currentPassword, newPassword);

      logger.info('Password changed successfully', {
        userId: req.user.id
      });

      res.json({
        status: 'success',
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Password change failed', {
        error: error.message,
        userId: req.user?.id
      });

      if (error.message.includes('incorrect')) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'INVALID_CURRENT_PASSWORD',
            message: 'Current password is incorrect'
          }
        });
      }

      res.status(500).json({
        status: 'error',
        error: {
          code: 'PASSWORD_CHANGE_FAILED',
          message: 'Failed to change password'
        }
      });
    }
  });

  /**
   * API Key Management Routes
   */

  /**
   * GET /auth/api-keys
   * List user's API keys
   */
  router.get('/api-keys', authenticateJWT(jwtService), async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === 'true';
      const apiKeys = await apiKeyService.listApiKeys(req.user.id, includeInactive);

      res.json({
        status: 'success',
        data: {
          apiKeys,
          count: apiKeys.length
        }
      });

    } catch (error) {
      logger.error('List API keys failed', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        status: 'error',
        error: {
          code: 'LIST_API_KEYS_FAILED',
          message: 'Failed to list API keys'
        }
      });
    }
  });

  /**
   * POST /auth/api-keys
   * Create new API key
   */
  router.post('/api-keys', authenticateJWT(jwtService), async (req, res) => {
    try {
      // Validate input
      const { error, value } = createApiKeySchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          status: 'error',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.details[0].message
          }
        });
      }

      const apiKey = await apiKeyService.createApiKey(req.user.id, value);

      logger.info('API key created successfully', {
        userId: req.user.id,
        keyId: apiKey.id,
        name: apiKey.name
      });

      res.status(201).json({
        status: 'success',
        data: { apiKey },
        message: 'API key created successfully. Save the key securely as it will not be shown again.'
      });

    } catch (error) {
      logger.error('Create API key failed', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        status: 'error',
        error: {
          code: 'CREATE_API_KEY_FAILED',
          message: 'Failed to create API key'
        }
      });
    }
  });

  /**
   * PUT /auth/api-keys/:keyId
   * Update API key
   */
  router.put('/api-keys/:keyId', authenticateJWT(jwtService), async (req, res) => {
    try {
      const { keyId } = req.params;
      const updates = req.body;

      await apiKeyService.updateApiKey(keyId, req.user.id, updates);

      logger.info('API key updated successfully', {
        userId: req.user.id,
        keyId
      });

      res.json({
        status: 'success',
        message: 'API key updated successfully'
      });

    } catch (error) {
      logger.error('Update API key failed', {
        error: error.message,
        userId: req.user?.id,
        keyId: req.params.keyId
      });

      if (error.message.includes('not found')) {
        return res.status(404).json({
          status: 'error',
          error: {
            code: 'API_KEY_NOT_FOUND',
            message: 'API key not found'
          }
        });
      }

      res.status(500).json({
        status: 'error',
        error: {
          code: 'UPDATE_API_KEY_FAILED',
          message: 'Failed to update API key'
        }
      });
    }
  });

  /**
   * DELETE /auth/api-keys/:keyId
   * Delete API key
   */
  router.delete('/api-keys/:keyId', authenticateJWT(jwtService), async (req, res) => {
    try {
      const { keyId } = req.params;

      await apiKeyService.deleteApiKey(keyId, req.user.id);

      logger.info('API key deleted successfully', {
        userId: req.user.id,
        keyId
      });

      res.json({
        status: 'success',
        message: 'API key deleted successfully'
      });

    } catch (error) {
      logger.error('Delete API key failed', {
        error: error.message,
        userId: req.user?.id,
        keyId: req.params.keyId
      });

      if (error.message.includes('not found')) {
        return res.status(404).json({
          status: 'error',
          error: {
            code: 'API_KEY_NOT_FOUND',
            message: 'API key not found'
          }
        });
      }

      res.status(500).json({
        status: 'error',
        error: {
          code: 'DELETE_API_KEY_FAILED',
          message: 'Failed to delete API key'
        }
      });
    }
  });

  return router;
};

module.exports = createAuthRoutes;
