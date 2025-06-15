const winston = require('winston');
const path = require('path');
const config = require('../config');

// Ensure logs directory exists
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: config.monitoring.logLevel,
  defaultMeta: { 
    service: 'zero-vector-server',
    version: '1.0.0'
  },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),

    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 10
    }),

    // Performance log file
    new winston.transports.File({
      filename: path.join(logsDir, 'performance.log'),
      level: 'info',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Add console transport in development
if (config.server.nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Performance logging helper
const logPerformance = (operation, duration, metadata = {}) => {
  logger.info({
    event: 'performance_metric',
    operation,
    duration,
    ...metadata
  });

  // Warn on slow operations
  if (duration > 1000) {
    logger.warn({
      event: 'slow_operation',
      operation,
      duration,
      ...metadata
    });
  }
};

// API request logging helper
const logApiRequest = (req, res, duration) => {
  const logData = {
    event: 'api_request',
    method: req.method,
    url: req.url,
    status: res.statusCode,
    duration,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: res.get('Content-Length') || 0
  };

  // Add user context if available
  if (req.user) {
    logData.userId = req.user.id;
  }

  if (req.apiKey) {
    logData.apiKeyId = req.apiKey.id;
  }

  // Log at appropriate level based on status code
  if (res.statusCode >= 500) {
    logger.error(logData);
  } else if (res.statusCode >= 400) {
    logger.warn(logData);
  } else {
    logger.info(logData);
  }
};

// Error logging helper
const logError = (error, context = {}) => {
  logger.error({
    event: 'error',
    message: error.message,
    stack: error.stack,
    ...context
  });
};

// Vector operation logging helper
const logVectorOperation = (operation, vectorCount, dimensions, duration, metadata = {}) => {
  logger.info({
    event: 'vector_operation',
    operation,
    vectorCount,
    dimensions,
    duration,
    ...metadata
  });
};

// Memory usage logging helper
const logMemoryUsage = (memoryStats) => {
  logger.info({
    event: 'memory_usage',
    ...memoryStats
  });
};

module.exports = {
  logger,
  logPerformance,
  logApiRequest,
  logError,
  logVectorOperation,
  logMemoryUsage
};
