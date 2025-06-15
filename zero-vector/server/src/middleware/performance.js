const { logPerformance, logger } = require('../utils/logger');

/**
 * Performance Monitoring Middleware
 * Tracks request performance and logs slow operations
 */
const performanceMiddleware = (req, res, next) => {
  // Record start time
  req.startTime = Date.now();

  // Track request count
  if (!global.requestCount) {
    global.requestCount = 0;
  }
  global.requestCount++;

  // Override res.json to capture response size
  const originalJson = res.json;
  res.json = function(data) {
    const responseSize = JSON.stringify(data).length;
    res.set('X-Response-Size', responseSize.toString());
    return originalJson.call(this, data);
  };

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const responseSize = parseInt(res.get('X-Response-Size') || '0', 10);

    // Log performance metrics
    const performanceData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      responseSize,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    };

    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', performanceData);
    }

    // Log performance metric
    logPerformance(`${req.method} ${req.url}`, duration, performanceData);
  });

  // Track memory usage periodically
  if (global.requestCount % 100 === 0) {
    const memUsage = process.memoryUsage();
    logger.info('Memory usage check', {
      requestCount: global.requestCount,
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    });
  }

  next();
};

module.exports = performanceMiddleware;
