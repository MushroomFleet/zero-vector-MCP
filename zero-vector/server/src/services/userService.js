const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('../config');
const { logger } = require('../utils/logger');
const validator = require('validator');

/**
 * User Service
 * Handles user registration, authentication, and management
 */
class UserService {
  constructor(database) {
    this.database = database;
    this.db = database.db; // Access the underlying SQLite connection
  }

  /**
   * Register a new user
   */
  async registerUser(userData) {
    try {
      const { email, password, role = 'user' } = userData;

      // Validate input
      this.validateUserInput({ email, password, role });

      // Check if user already exists
      const existingUser = await this.getUserByEmail(email);
      if (existingUser) {
        throw new Error('User already exists with this email');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

      // Generate user ID
      const userId = crypto.randomUUID();

      // Create user record
      const stmt = this.db.prepare(`
        INSERT INTO users (id, email, password_hash, role, created_at, is_active, failed_login_attempts, locked_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      stmt.run(userId, email.toLowerCase(), passwordHash, role, now, 1, 0, null);

      logger.info('User registered successfully', {
        userId,
        email: email.toLowerCase(),
        role
      });

      return {
        id: userId,
        email: email.toLowerCase(),
        role,
        createdAt: now,
        isActive: true
      };

    } catch (error) {
      logger.error('User registration failed', {
        error: error.message,
        email: userData.email
      });
      throw error;
    }
  }

  /**
   * Authenticate user with email and password
   */
  async authenticateUser(email, password) {
    try {
      const user = await this.getUserByEmail(email);
      if (!user) {
        throw new Error('Invalid credentials');
      }

      // Check if user is active
      if (!user.isActive) {
        throw new Error('User account is deactivated');
      }

      // Check if user is locked
      if (user.lockedUntil && user.lockedUntil > Date.now()) {
        const lockoutEndTime = new Date(user.lockedUntil).toISOString();
        throw new Error(`Account is locked until ${lockoutEndTime}`);
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      
      if (!isValidPassword) {
        await this.handleFailedLogin(user.id);
        throw new Error('Invalid credentials');
      }

      // Reset failed login attempts on successful login
      await this.resetFailedLoginAttempts(user.id);

      // Update last login timestamp
      await this.updateLastLogin(user.id);

      logger.info('User authenticated successfully', {
        userId: user.id,
        email: user.email
      });

      return {
        id: user.id,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      };

    } catch (error) {
      logger.error('User authentication failed', {
        error: error.message,
        email
      });
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    try {
      const stmt = this.db.prepare(`
        SELECT id, email, password_hash, role, created_at, updated_at, last_login, 
               is_active, failed_login_attempts, locked_until
        FROM users 
        WHERE email = ?
      `);

      const row = stmt.get(email.toLowerCase());
      if (!row) return null;

      return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLogin: row.last_login,
        isActive: row.is_active === 1,
        failedLoginAttempts: row.failed_login_attempts,
        lockedUntil: row.locked_until
      };

    } catch (error) {
      logger.error('Failed to get user by email', {
        error: error.message,
        email
      });
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    try {
      const stmt = this.db.prepare(`
        SELECT id, email, role, created_at, updated_at, last_login, is_active
        FROM users 
        WHERE id = ?
      `);

      const row = stmt.get(userId);
      if (!row) return null;

      return {
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLogin: row.last_login,
        isActive: row.is_active === 1
      };

    } catch (error) {
      logger.error('Failed to get user by ID', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId, newRole) {
    try {
      if (!['admin', 'user', 'readonly'].includes(newRole)) {
        throw new Error('Invalid role specified');
      }

      const stmt = this.db.prepare(`
        UPDATE users 
        SET role = ?, updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(newRole, Date.now(), userId);
      
      if (result.changes === 0) {
        throw new Error('User not found');
      }

      logger.info('User role updated', {
        userId,
        newRole
      });

      return true;

    } catch (error) {
      logger.error('Failed to update user role', {
        error: error.message,
        userId,
        newRole
      });
      throw error;
    }
  }

  /**
   * Deactivate user account
   */
  async deactivateUser(userId) {
    try {
      const stmt = this.db.prepare(`
        UPDATE users 
        SET is_active = 0, updated_at = ?
        WHERE id = ?
      `);

      const result = stmt.run(Date.now(), userId);
      
      if (result.changes === 0) {
        throw new Error('User not found');
      }

      logger.info('User deactivated', { userId });
      return true;

    } catch (error) {
      logger.error('Failed to deactivate user', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * List all users (admin only, with pagination)
   */
  async listUsers(page = 1, limit = 50) {
    try {
      const offset = (page - 1) * limit;

      const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM users');
      const { total } = countStmt.get();

      const stmt = this.db.prepare(`
        SELECT id, email, role, created_at, last_login, is_active
        FROM users 
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `);

      const rows = stmt.all(limit, offset);

      const users = rows.map(row => ({
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
        lastLogin: row.last_login,
        isActive: row.is_active === 1
      }));

      return {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      logger.error('Failed to list users', {
        error: error.message,
        page,
        limit
      });
      throw error;
    }
  }

  /**
   * Handle failed login attempt
   */
  async handleFailedLogin(userId) {
    try {
      const user = await this.getUserById(userId);
      const newFailedAttempts = (user?.failedLoginAttempts || 0) + 1;

      let lockedUntil = null;
      if (newFailedAttempts >= config.auth.maxLoginAttempts) {
        lockedUntil = Date.now() + (config.auth.lockoutTimeMinutes * 60 * 1000);
      }

      const stmt = this.db.prepare(`
        UPDATE users 
        SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(newFailedAttempts, lockedUntil, Date.now(), userId);

      if (lockedUntil) {
        logger.warn('User account locked due to failed login attempts', {
          userId,
          failedAttempts: newFailedAttempts,
          lockedUntil
        });
      }

    } catch (error) {
      logger.error('Failed to handle failed login', {
        error: error.message,
        userId
      });
    }
  }

  /**
   * Reset failed login attempts
   */
  async resetFailedLoginAttempts(userId) {
    try {
      const stmt = this.db.prepare(`
        UPDATE users 
        SET failed_login_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(Date.now(), userId);

    } catch (error) {
      logger.error('Failed to reset failed login attempts', {
        error: error.message,
        userId
      });
    }
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId) {
    try {
      const stmt = this.db.prepare(`
        UPDATE users 
        SET last_login = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(Date.now(), Date.now(), userId);

    } catch (error) {
      logger.error('Failed to update last login', {
        error: error.message,
        userId
      });
    }
  }

  /**
   * Validate user input
   */
  validateUserInput({ email, password, role }) {
    if (!email || !validator.isEmail(email)) {
      throw new Error('Valid email is required');
    }

    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      throw new Error('Password must contain at least one lowercase letter, one uppercase letter, and one number');
    }

    if (role && !['admin', 'user', 'readonly'].includes(role)) {
      throw new Error('Role must be one of: admin, user, readonly');
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get user with password hash
      const userWithPassword = await this.getUserByEmail(user.email);
      
      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, userWithPassword.passwordHash);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Validate new password
      this.validateUserInput({ email: user.email, password: newPassword });

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);

      // Update password
      const stmt = this.db.prepare(`
        UPDATE users 
        SET password_hash = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(newPasswordHash, Date.now(), userId);

      logger.info('Password changed successfully', { userId });
      return true;

    } catch (error) {
      logger.error('Failed to change password', {
        error: error.message,
        userId
      });
      throw error;
    }
  }
}

module.exports = UserService;
