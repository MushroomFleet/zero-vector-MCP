const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const { logger, logApiRequest, logError } = require('./utils/logger');
const DatabaseRepository = require('./repositories/database');
const IndexedVectorStore = require('./services/IndexedVectorStore');

// Import services
const UserService = require('./services/userService');
const ApiKeyService = require('./services/apiKeyService');
const JwtService = require('./services/jwtService');

// Import middleware
const performanceMiddleware = require('./middleware/performance');
const { errorHandler } = require('./middleware/errorHandler');
const { globalRateLimiter } = require('./middleware/rateLimiting');
const authenticateApiKey = require('./middleware/authenticateApiKey');
const authenticateJWT = require('./middleware/authenticateJWT');

// Import routes
const vectorRoutes = require('./routes/vectors');
const embeddingRoutes = require('./routes/embeddings');
const personaRoutes = require('./routes/personas');
const healthRoutes = require('./routes/health');
const createAuthRoutes = require('./routes/auth');

/**
 * Zero-Vector Server
 * Main application entry point
 */
class ZeroVectorServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.database = null;
    this.vectorStore = null;
    this.userService = null;
    this.apiKeyService = null;
    this.jwtService = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the server
   */
  async initialize() {
    try {
      logger.info('Initializing Zero-Vector Server...');

      // Initialize database
      await this.initializeDatabase();

      // Initialize authentication services
      await this.initializeAuthServices();

      // Initialize vector store
      await this.initializeVectorStore();

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      logger.info('Zero-Vector Server initialized successfully');

    } catch (error) {
      logError(error, { operation: 'server_initialization' });
      throw error;
    }
  }

  /**
   * Initialize database connection
   */
  async initializeDatabase() {
    this.database = new DatabaseRepository();
    await this.database.initialize();
    
    // Make database available to routes via app context
    this.app.set('database', this.database);
    
    logger.info('Database initialized successfully');
  }

  /**
   * Initialize authentication services
   */
  async initializeAuthServices() {
    // Initialize JWT service
    this.jwtService = new JwtService();

    // Initialize user service
    this.userService = new UserService(this.database);

    // Initialize API key service
    this.apiKeyService = new ApiKeyService(this.database);

    // Make auth services available to routes via app context
    this.app.set('userService', this.userService);
    this.app.set('apiKeyService', this.apiKeyService);
    this.app.set('jwtService', this.jwtService);

    logger.info('Authentication services initialized successfully');
  }

  /**
   * Initialize vector store
   */
  async initializeVectorStore() {
    this.vectorStore = new IndexedVectorStore(
      config.vectorDb.maxMemoryMB,
      config.vectorDb.defaultDimensions,
      {
        M: 16,
        efConstruction: 200,
        efSearch: 50,
        distanceFunction: 'cosine',
        indexThreshold: 100
      }
    );

    // Make vector store available to routes via app context
    this.app.set('vectorStore', this.vectorStore);

    logger.info('Vector store initialized successfully');
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      },
      crossOriginEmbedderPolicy: false
    }));

    // CORS middleware
    this.app.use(cors({
      origin: config.server.nodeEnv === 'production' 
        ? ['https://yourdomain.com'] // Update in production
        : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Body parsing middleware
    this.app.use(express.json({ 
      limit: '50mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Performance monitoring middleware
    this.app.use(performanceMiddleware);

    // Request logging middleware
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logApiRequest(req, res, duration);
      });
      
      next();
    });

    // Add server context to requests
    this.app.use((req, res, next) => {
      req.vectorStore = this.vectorStore;
      req.database = this.database;
      req.userService = this.userService;
      req.apiKeyService = this.apiKeyService;
      req.jwtService = this.jwtService;
      next();
    });

    logger.info('Middleware setup completed');
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Apply global rate limiting to all routes except health
    this.app.use('/api', globalRateLimiter);

    // Health check routes (no auth required)
    this.app.use('/health', healthRoutes);

    // Authentication routes
    const authRoutes = createAuthRoutes(this.userService, this.jwtService, this.apiKeyService);
    this.app.use('/auth', authRoutes);

    // Protected API routes
    this.app.use('/api/vectors', vectorRoutes);
    this.app.use('/api/embeddings', embeddingRoutes);
    this.app.use('/api/personas', authenticateApiKey(this.apiKeyService), personaRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Zero-Vector Server',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          auth: '/auth',
          vectors: '/api/vectors'
        }
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        availableEndpoints: [
          'GET /',
          'GET /health',
          'POST /auth/register',
          'POST /auth/login',
          'POST /api/vectors',
          'GET /api/vectors/search'
        ]
      });
    });

    logger.info('Routes setup completed');
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Global error handler
    this.app.use(errorHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logError(error, { event: 'uncaught_exception' });
      
      if (!this.isShuttingDown) {
        this.gracefulShutdown('UNCAUGHT_EXCEPTION');
      }
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logError(new Error(`Unhandled Rejection: ${reason}`), { 
        event: 'unhandled_rejection',
        promise: promise.toString()
      });
    });

    logger.info('Error handling setup completed');
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      this.gracefulShutdown(signal);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
  }

  /**
   * Start the server
   */
  async start() {
    try {
      await this.initialize();

      this.server = this.app.listen(config.server.port, config.server.host, () => {
        logger.info(`Zero-Vector Server running on ${config.server.host}:${config.server.port}`);
        logger.info(`Environment: ${config.server.nodeEnv}`);
        logger.info(`Vector Store: ${config.vectorDb.maxMemoryMB}MB, ${config.vectorDb.defaultDimensions}D`);
        logger.info(`Database: ${config.database.path}`);
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.syscall !== 'listen') {
          throw error;
        }

        const bind = typeof config.server.port === 'string'
          ? 'Pipe ' + config.server.port
          : 'Port ' + config.server.port;

        switch (error.code) {
          case 'EACCES':
            logError(new Error(`${bind} requires elevated privileges`));
            process.exit(1);
            break;
          case 'EADDRINUSE':
            logError(new Error(`${bind} is already in use`));
            process.exit(1);
            break;
          default:
            throw error;
        }
      });

      return this.server;

    } catch (error) {
      logError(error, { operation: 'server_start' });
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Graceful shutdown initiated by ${signal}`);

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Close database connection
      if (this.database) {
        await this.database.close();
        logger.info('Database connection closed');
      }

      // Cleanup vector store
      if (this.vectorStore) {
        this.vectorStore.cleanup();
        logger.info('Vector store cleaned up');
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logError(error, { operation: 'graceful_shutdown' });
      process.exit(1);
    }
  }

  /**
   * Get server statistics
   */
  getStats() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      server: {
        uptime: uptime,
        memoryUsage: {
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024) // MB
        },
        platform: process.platform,
        nodeVersion: process.version
      },
      vectorStore: this.vectorStore ? this.vectorStore.getStats() : null,
      config: {
        maxMemoryMB: config.vectorDb.maxMemoryMB,
        defaultDimensions: config.vectorDb.defaultDimensions,
        indexType: config.vectorDb.indexType,
        distanceMetric: config.vectorDb.distanceMetric
      }
    };
  }
}

// Create and export server instance
const server = new ZeroVectorServer();

// Start server if this file is run directly
if (require.main === module) {
  server.start().catch((error) => {
    logError(error, { operation: 'server_startup' });
    process.exit(1);
  });
}

module.exports = server;
