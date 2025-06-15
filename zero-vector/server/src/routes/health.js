const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * Health Check Routes
 * Provides various health and status endpoints
 */

/**
 * Basic health check
 * GET /health
 */
router.get('/', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  
  // Test database connection
  let dbStatus = 'unknown';
  try {
    const isHealthy = await req.database.healthCheck();
    dbStatus = isHealthy ? 'healthy' : 'unhealthy';
  } catch (error) {
    dbStatus = 'unhealthy';
    logger.error('Database health check failed', { error: error.message });
  }

  // Test vector store
  let vectorStoreStatus = 'unknown';
  try {
    const stats = req.vectorStore.getStats();
    vectorStoreStatus = 'healthy';
  } catch (error) {
    vectorStoreStatus = 'unhealthy';
    logger.error('Vector store health check failed', { error: error.message });
  }

  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: dbStatus,
      vectorStore: vectorStoreStatus
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      pid: process.pid
    },
    responseTime: Date.now() - startTime
  };

  // Set overall status based on service health
  if (dbStatus !== 'healthy' || vectorStoreStatus !== 'healthy') {
    healthCheck.status = 'degraded';
    res.status(503);
  }

  res.json(healthCheck);
}));

/**
 * Detailed health check with performance metrics
 * GET /health/detailed
 */
router.get('/detailed', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  
  // Get detailed vector store statistics
  const vectorStats = req.vectorStore.getStats();
  
  // Get database statistics
  let dbStats = {};
  try {
    const recentStats = await req.database.getUsageStats({
      since: Date.now() - 3600000 // Last hour
    });
    
    dbStats = {
      recentOperations: recentStats.length,
      connectionStatus: 'healthy'
    };
  } catch (error) {
    dbStats = {
      connectionStatus: 'unhealthy',
      error: error.message
    };
  }

  // System performance metrics
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  const detailedHealth = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: {
      uptime: process.uptime(),
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    },
    performance: {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024) // MB
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    },
    services: {
      database: dbStats,
      vectorStore: vectorStats
    },
    responseTime: Date.now() - startTime
  };

  res.json(detailedHealth);
}));

/**
 * Readiness probe
 * GET /health/ready
 */
router.get('/ready', asyncHandler(async (req, res) => {
  const checks = [];
  let allReady = true;

  // Check database readiness
  try {
    const isHealthy = await req.database.healthCheck();
    if (isHealthy) {
      checks.push({ service: 'database', status: 'ready' });
    } else {
      checks.push({ 
        service: 'database', 
        status: 'not_ready', 
        error: 'Database health check failed' 
      });
      allReady = false;
    }
  } catch (error) {
    checks.push({ 
      service: 'database', 
      status: 'not_ready', 
      error: error.message 
    });
    allReady = false;
  }

  // Check vector store readiness
  try {
    const stats = req.vectorStore.getStats();
    if (stats.vectorCount >= 0) { // Basic sanity check
      checks.push({ service: 'vectorStore', status: 'ready' });
    } else {
      checks.push({ 
        service: 'vectorStore', 
        status: 'not_ready', 
        error: 'Invalid stats' 
      });
      allReady = false;
    }
  } catch (error) {
    checks.push({ 
      service: 'vectorStore', 
      status: 'not_ready', 
      error: error.message 
    });
    allReady = false;
  }

  const readiness = {
    ready: allReady,
    timestamp: new Date().toISOString(),
    checks: checks
  };

  res.status(allReady ? 200 : 503).json(readiness);
}));

/**
 * Liveness probe
 * GET /health/live
 */
router.get('/live', (req, res) => {
  // Simple liveness check - if we can respond, we're alive
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid
  });
});

/**
 * Vector store metrics
 * GET /health/metrics
 */
router.get('/metrics', asyncHandler(async (req, res) => {
  const vectorStats = req.vectorStore.getStats();
  const memUsage = process.memoryUsage();
  
  // Format metrics in a simple key-value format
  const metrics = {
    'vector_store_total_vectors': vectorStats.vectorCount,
    'vector_store_max_vectors': vectorStats.maxVectors,
    'vector_store_memory_utilization_percent': vectorStats.memoryUtilization,
    'vector_store_used_memory_bytes': vectorStats.usedMemory,
    'vector_store_free_memory_bytes': vectorStats.freeMemory,
    'vector_store_dimensions': vectorStats.dimensions,
    'vector_store_free_slots': vectorStats.freeSlots,
    
    'similarity_cache_size': vectorStats.similarityCache.size,
    'similarity_cache_hits': vectorStats.similarityCache.hits,
    'similarity_cache_misses': vectorStats.similarityCache.misses,
    'similarity_cache_hit_rate': vectorStats.similarityCache.hitRate,
    
    'operations_insertions_total': vectorStats.operations.insertions,
    'operations_deletions_total': vectorStats.operations.deletions,
    'operations_searches_total': vectorStats.operations.searches,
    
    'system_memory_rss_bytes': memUsage.rss,
    'system_memory_heap_total_bytes': memUsage.heapTotal,
    'system_memory_heap_used_bytes': memUsage.heapUsed,
    'system_memory_external_bytes': memUsage.external,
    
    'system_uptime_seconds': process.uptime(),
    'system_cpu_user_microseconds': process.cpuUsage().user,
    'system_cpu_system_microseconds': process.cpuUsage().system
  };

  res.set('Content-Type', 'text/plain');
  
  // Output metrics in Prometheus format
  let output = '';
  for (const [key, value] of Object.entries(metrics)) {
    output += `${key} ${value}\n`;
  }
  
  res.send(output);
}));

/**
 * Configuration information
 * GET /health/config
 */
router.get('/config', (req, res) => {
  const config = {
    vectorStore: {
      maxMemoryMB: req.vectorStore.maxMemoryBytes / (1024 * 1024),
      dimensions: req.vectorStore.dimensions,
      maxVectors: req.vectorStore.maxVectors
    },
    server: {
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      platform: process.platform
    },
    features: {
      vectorOperations: true,
      similaritySearch: true,
      batchOperations: true,
      memoryOptimization: true
    }
  };

  res.json(config);
});

module.exports = router;
