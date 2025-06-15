const { logger, logError } = require('../../utils/logger');

/**
 * Embedding Service
 * Base class for managing multiple embedding providers
 */
class EmbeddingService {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = null;
    this.cache = new Map(); // Simple LRU cache for embeddings
    this.maxCacheSize = 10000;
    this.stats = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      totalTime: 0,
      avgTime: 0
    };
  }

  /**
   * Register an embedding provider
   */
  registerProvider(name, provider) {
    if (!provider || typeof provider.generateEmbedding !== 'function') {
      throw new Error('Provider must implement generateEmbedding method');
    }

    this.providers.set(name, provider);
    
    // Set as default if none exists
    if (!this.defaultProvider) {
      this.defaultProvider = name;
    }

    logger.info(`Embedding provider registered: ${name}`);
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(providerName) {
    if (!this.providers.has(providerName)) {
      throw new Error(`Provider '${providerName}' not found`);
    }
    
    this.defaultProvider = providerName;
    logger.info(`Default embedding provider set to: ${providerName}`);
  }

  /**
   * Generate embeddings using specified or default provider
   */
  async generateEmbedding(text, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        provider = this.defaultProvider,
        useCache = true,
        model = null,
        dimensions = null,
        normalize = true
      } = options;

      // Validate input
      if (!text || typeof text !== 'string') {
        throw new Error('Text input is required and must be a string');
      }

      if (!provider || !this.providers.has(provider)) {
        throw new Error(`Provider '${provider}' not found or not registered`);
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(text, provider, model, dimensions);
      if (useCache && this.cache.has(cacheKey)) {
        this.stats.cacheHits++;
        const cachedResult = this.cache.get(cacheKey);
        
        // Move to end (LRU)
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cachedResult);
        
        logger.debug('Embedding cache hit', { provider, textLength: text.length });
        return cachedResult;
      }

      this.stats.cacheMisses++;

      // Generate embedding using provider
      const providerInstance = this.providers.get(provider);
      const embedding = await providerInstance.generateEmbedding(text, {
        model,
        dimensions,
        normalize
      });

      // Validate embedding result
      if (!embedding || !Array.isArray(embedding.vector)) {
        throw new Error('Invalid embedding result from provider');
      }

      const result = {
        vector: embedding.vector,
        dimensions: embedding.vector.length,
        provider: provider,
        model: embedding.model || model || 'default',
        usage: embedding.usage || {},
        metadata: {
          textLength: text.length,
          normalized: normalize,
          generatedAt: new Date().toISOString()
        }
      };

      // Cache the result
      if (useCache) {
        this.addToCache(cacheKey, result);
      }

      // Update statistics
      this.stats.requests++;
      const duration = Date.now() - startTime;
      this.stats.totalTime += duration;
      this.stats.avgTime = this.stats.totalTime / this.stats.requests;

      logger.info('Embedding generated successfully', {
        provider,
        model: result.model,
        dimensions: result.dimensions,
        textLength: text.length,
        duration
      });

      return result;

    } catch (error) {
      this.stats.errors++;
      const duration = Date.now() - startTime;
      
      logError(error, {
        operation: 'generateEmbedding',
        provider: options.provider || this.defaultProvider,
        textLength: text?.length,
        duration
      });
      
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateBatchEmbeddings(texts, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        provider = this.defaultProvider,
        batchSize = 10,
        useCache = true,
        ...embeddingOptions
      } = options;

      if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Texts must be a non-empty array');
      }

      const results = [];
      const errors = [];

      // Process in batches
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        
        // Check if provider supports batch processing
        const providerInstance = this.providers.get(provider);
        if (providerInstance.generateBatchEmbeddings) {
          try {
            const batchResults = await providerInstance.generateBatchEmbeddings(batch, embeddingOptions);
            results.push(...batchResults);
          } catch (batchError) {
            // Fall back to individual processing
            for (const text of batch) {
              try {
                const result = await this.generateEmbedding(text, { ...embeddingOptions, provider, useCache });
                results.push(result);
              } catch (error) {
                errors.push({ text, error: error.message });
              }
            }
          }
        } else {
          // Process individually
          for (const text of batch) {
            try {
              const result = await this.generateEmbedding(text, { ...embeddingOptions, provider, useCache });
              results.push(result);
            } catch (error) {
              errors.push({ text, error: error.message });
            }
          }
        }
      }

      const duration = Date.now() - startTime;
      
      logger.info('Batch embedding completed', {
        provider,
        totalTexts: texts.length,
        successful: results.length,
        errors: errors.length,
        duration
      });

      return {
        embeddings: results,
        errors: errors,
        summary: {
          total: texts.length,
          successful: results.length,
          failed: errors.length,
          duration
        }
      };

    } catch (error) {
      logError(error, {
        operation: 'generateBatchEmbeddings',
        textCount: texts?.length
      });
      throw error;
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    const providers = [];
    
    for (const [name, provider] of this.providers) {
      providers.push({
        name,
        isDefault: name === this.defaultProvider,
        models: provider.getSupportedModels ? provider.getSupportedModels() : ['default'],
        features: {
          batchProcessing: !!provider.generateBatchEmbeddings,
          configurableDimensions: !!provider.supportsDimensions,
          normalization: !!provider.supportsNormalization
        }
      });
    }
    
    return providers;
  }

  /**
   * Get service statistics
   */
  getStats() {
    const hitRate = this.stats.requests > 0 
      ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100 
      : 0;

    return {
      providers: {
        registered: this.providers.size,
        default: this.defaultProvider,
        available: Array.from(this.providers.keys())
      },
      cache: {
        size: this.cache.size,
        maxSize: this.maxCacheSize,
        hitRate: hitRate.toFixed(2) + '%'
      },
      performance: {
        ...this.stats,
        hitRate: hitRate.toFixed(2) + '%'
      }
    };
  }

  /**
   * Clear embedding cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('Embedding cache cleared');
  }

  /**
   * Configure cache settings
   */
  configureCache(maxSize) {
    this.maxCacheSize = maxSize;
    
    // Trim cache if necessary
    if (this.cache.size > maxSize) {
      const entries = Array.from(this.cache.entries());
      const toKeep = entries.slice(-maxSize);
      
      this.cache.clear();
      toKeep.forEach(([key, value]) => this.cache.set(key, value));
    }
    
    logger.info(`Embedding cache configured: maxSize=${maxSize}`);
  }

  // Private helper methods

  generateCacheKey(text, provider, model, dimensions) {
    const hash = this.simpleHash(text);
    return `${provider}:${model || 'default'}:${dimensions || 'default'}:${hash}`;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  addToCache(key, value) {
    // Implement LRU cache
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, value);
  }

  /**
   * Health check for all providers
   */
  async healthCheck() {
    const results = {};
    
    for (const [name, provider] of this.providers) {
      try {
        if (provider.healthCheck) {
          results[name] = await provider.healthCheck();
        } else {
          // Basic test with small text
          const testResult = await provider.generateEmbedding('test', { model: 'default' });
          results[name] = {
            status: 'healthy',
            lastChecked: new Date().toISOString(),
            dimensions: testResult.vector.length
          };
        }
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          error: error.message,
          lastChecked: new Date().toISOString()
        };
      }
    }
    
    return results;
  }
}

module.exports = EmbeddingService;
