/**
 * Performance Statistics Service
 * Tracks and calculates server performance metrics
 */

const { logger } = require('../utils/logger');

class PerformanceStatsService {
  constructor(options = {}) {
    this.maxRequestHistory = options.maxRequestHistory || 1000;
    this.timeWindowMs = options.timeWindowMs || 60000; // 1 minute
    this.maxTimeWindows = options.maxTimeWindows || 60; // 1 hour of history
    
    // Request history for response time calculations
    this.requestHistory = [];
    
    // Time-bucketed request counts for rate calculations
    this.requestBuckets = new Map();
    
    // Performance metrics cache
    this.metricsCache = {
      avgResponseTime: 0,
      requestsPerMinute: 0,
      lastUpdated: Date.now()
    };
    
    // Cache invalidation timer
    this.cacheTimeout = 5000; // 5 seconds
    
    logger.info('Performance Statistics Service initialized', {
      maxRequestHistory: this.maxRequestHistory,
      timeWindowMs: this.timeWindowMs,
      maxTimeWindows: this.maxTimeWindows
    });
  }

  /**
   * Record a completed request
   * @param {Object} requestData - Request performance data
   */
  recordRequest(requestData) {
    const now = Date.now();
    const { duration, method, url, statusCode } = requestData;

    // Add to request history for response time calculations
    this.requestHistory.push({
      timestamp: now,
      duration,
      method,
      url,
      statusCode
    });

    // Trim history if it gets too large
    if (this.requestHistory.length > this.maxRequestHistory) {
      this.requestHistory = this.requestHistory.slice(-this.maxRequestHistory);
    }

    // Add to time bucket for rate calculations
    const bucketKey = Math.floor(now / this.timeWindowMs);
    const currentCount = this.requestBuckets.get(bucketKey) || 0;
    this.requestBuckets.set(bucketKey, currentCount + 1);

    // Clean up old buckets
    this.cleanupOldBuckets(now);

    // Invalidate cache
    this.invalidateCache();
  }

  /**
   * Clean up old time buckets
   * @param {number} now - Current timestamp
   */
  cleanupOldBuckets(now) {
    const oldestAllowed = Math.floor((now - (this.maxTimeWindows * this.timeWindowMs)) / this.timeWindowMs);
    
    for (const [bucketKey] of this.requestBuckets) {
      if (bucketKey < oldestAllowed) {
        this.requestBuckets.delete(bucketKey);
      }
    }
  }

  /**
   * Calculate average response time
   * @param {number} timeWindowMs - Time window to calculate for (default: last 5 minutes)
   * @returns {number} Average response time in milliseconds
   */
  calculateAverageResponseTime(timeWindowMs = 300000) {
    const now = Date.now();
    const cutoff = now - timeWindowMs;
    
    const recentRequests = this.requestHistory.filter(req => req.timestamp > cutoff);
    
    if (recentRequests.length === 0) {
      return 0;
    }

    const totalDuration = recentRequests.reduce((sum, req) => sum + req.duration, 0);
    return Math.round(totalDuration / recentRequests.length);
  }

  /**
   * Calculate requests per minute
   * @param {number} minutes - Number of minutes to calculate over (default: 5)
   * @returns {number} Requests per minute
   */
  calculateRequestsPerMinute(minutes = 5) {
    const now = Date.now();
    const windowMs = minutes * 60 * 1000;
    const cutoff = Math.floor((now - windowMs) / this.timeWindowMs);
    
    let totalRequests = 0;
    for (const [bucketKey, count] of this.requestBuckets) {
      if (bucketKey > cutoff) {
        totalRequests += count;
      }
    }

    return Math.round(totalRequests / minutes);
  }

  /**
   * Get current performance metrics
   * @param {boolean} forceRefresh - Force cache refresh
   * @returns {Object} Performance metrics
   */
  getMetrics(forceRefresh = false) {
    const now = Date.now();
    
    // Return cached metrics if still valid
    if (!forceRefresh && (now - this.metricsCache.lastUpdated) < this.cacheTimeout) {
      return { ...this.metricsCache };
    }

    // Calculate fresh metrics
    const avgResponseTime = this.calculateAverageResponseTime();
    const requestsPerMinute = this.calculateRequestsPerMinute();

    // Update cache
    this.metricsCache = {
      avgResponseTime,
      requestsPerMinute,
      lastUpdated: now
    };

    return { ...this.metricsCache };
  }

  /**
   * Get detailed performance statistics
   * @returns {Object} Detailed performance data
   */
  getDetailedStats() {
    const now = Date.now();
    const metrics = this.getMetrics(true);

    // Calculate stats for different time windows
    const stats = {
      current: metrics,
      timeWindows: {
        lastMinute: {
          avgResponseTime: this.calculateAverageResponseTime(60000),
          requestsPerMinute: this.calculateRequestsPerMinute(1)
        },
        last5Minutes: {
          avgResponseTime: this.calculateAverageResponseTime(300000),
          requestsPerMinute: this.calculateRequestsPerMinute(5)
        },
        last15Minutes: {
          avgResponseTime: this.calculateAverageResponseTime(900000),
          requestsPerMinute: this.calculateRequestsPerMinute(15)
        }
      },
      requestHistory: {
        totalRequests: this.requestHistory.length,
        oldestRequest: this.requestHistory.length > 0 ? this.requestHistory[0].timestamp : null,
        newestRequest: this.requestHistory.length > 0 ? this.requestHistory[this.requestHistory.length - 1].timestamp : null
      },
      buckets: {
        activeBuckets: this.requestBuckets.size,
        totalRequestsInBuckets: Array.from(this.requestBuckets.values()).reduce((sum, count) => sum + count, 0)
      }
    };

    // Calculate percentiles if we have enough data
    if (this.requestHistory.length >= 10) {
      const recentDurations = this.requestHistory
        .filter(req => (now - req.timestamp) < 300000) // Last 5 minutes
        .map(req => req.duration)
        .sort((a, b) => a - b);

      if (recentDurations.length > 0) {
        stats.responseTimePercentiles = {
          p50: this.calculatePercentile(recentDurations, 0.5),
          p90: this.calculatePercentile(recentDurations, 0.9),
          p95: this.calculatePercentile(recentDurations, 0.95),
          p99: this.calculatePercentile(recentDurations, 0.99)
        };
      }
    }

    return stats;
  }

  /**
   * Calculate percentile from sorted array
   * @param {number[]} sortedArray - Sorted array of values
   * @param {number} percentile - Percentile (0-1)
   * @returns {number} Percentile value
   */
  calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Invalidate the metrics cache
   */
  invalidateCache() {
    this.metricsCache.lastUpdated = 0;
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.requestHistory = [];
    this.requestBuckets.clear();
    this.invalidateCache();
    logger.info('Performance statistics reset');
  }

  /**
   * Get service health information
   * @returns {Object} Service health data
   */
  getServiceHealth() {
    return {
      status: 'healthy',
      requestHistorySize: this.requestHistory.length,
      activeBuckets: this.requestBuckets.size,
      cacheAge: Date.now() - this.metricsCache.lastUpdated,
      memoryUsage: {
        requestHistory: this.requestHistory.length * 50, // Rough estimate in bytes
        buckets: this.requestBuckets.size * 20
      }
    };
  }
}

// Create singleton instance
const performanceStatsService = new PerformanceStatsService();

module.exports = {
  PerformanceStatsService,
  performanceStatsService
};
