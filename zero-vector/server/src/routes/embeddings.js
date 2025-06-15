const express = require('express');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');
const EmbeddingService = require('../services/embedding/EmbeddingService');
const LocalTransformersProvider = require('../services/embedding/LocalTransformersProvider');

const router = express.Router();

// Initialize embedding service with providers
const embeddingService = new EmbeddingService();

// Register local transformers provider as default
const localProvider = new LocalTransformersProvider();
embeddingService.registerProvider('local', localProvider);
embeddingService.setDefaultProvider('local');

/**
 * Generate embedding for text
 * POST /api/embeddings/generate
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const {
    text,
    provider = 'local',
    model = null,
    dimensions = null,
    normalize = true,
    useCache = true
  } = req.body;

  // Validate input
  if (!text || typeof text !== 'string') {
    throw new ValidationError('Text is required and must be a string');
  }

  if (text.length === 0) {
    throw new ValidationError('Text cannot be empty');
  }

  if (text.length > 10000) {
    throw new ValidationError('Text length cannot exceed 10,000 characters');
  }

  try {
    const result = await embeddingService.generateEmbedding(text, {
      provider,
      model,
      dimensions,
      normalize,
      useCache
    });

    logger.info('Embedding generated via API', {
      provider: result.provider,
      model: result.model,
      dimensions: result.dimensions,
      textLength: text.length
    });

    res.json({
      status: 'success',
      data: {
        embedding: result.vector,
        metadata: {
          provider: result.provider,
          model: result.model,
          dimensions: result.dimensions,
          textLength: text.length,
          usage: result.usage
        }
      }
    });

  } catch (error) {
    if (error.message.includes('Provider') && error.message.includes('not found')) {
      throw new ValidationError(`Embedding provider '${provider}' not available`);
    }
    throw error;
  }
}));

/**
 * Generate embeddings for multiple texts
 * POST /api/embeddings/batch
 */
router.post('/batch', asyncHandler(async (req, res) => {
  const {
    texts,
    provider = 'local',
    model = null,
    dimensions = null,
    normalize = true,
    useCache = true,
    batchSize = 10
  } = req.body;

  // Validate input
  if (!texts || !Array.isArray(texts)) {
    throw new ValidationError('Texts must be an array');
  }

  if (texts.length === 0) {
    throw new ValidationError('Texts array cannot be empty');
  }

  if (texts.length > 100) {
    throw new ValidationError('Maximum 100 texts allowed per batch');
  }

  // Validate each text
  for (let i = 0; i < texts.length; i++) {
    if (typeof texts[i] !== 'string') {
      throw new ValidationError(`Text at index ${i} must be a string`);
    }
    if (texts[i].length > 10000) {
      throw new ValidationError(`Text at index ${i} exceeds 10,000 character limit`);
    }
  }

  try {
    const result = await embeddingService.generateBatchEmbeddings(texts, {
      provider,
      model,
      dimensions,
      normalize,
      useCache,
      batchSize
    });

    logger.info('Batch embeddings generated via API', {
      provider,
      model,
      totalTexts: texts.length,
      successful: result.embeddings.length,
      errors: result.errors.length
    });

    res.json({
      status: result.errors.length === 0 ? 'success' : 'partial_success',
      data: {
        embeddings: result.embeddings.map(emb => ({
          embedding: emb.vector,
          metadata: {
            provider: emb.provider,
            model: emb.model,
            dimensions: emb.dimensions,
            usage: emb.usage
          }
        })),
        errors: result.errors,
        summary: result.summary
      }
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Generate embedding and store as vector
 * POST /api/embeddings/store
 */
router.post('/store', asyncHandler(async (req, res) => {
  const {
    text,
    id = null,
    metadata = {},
    provider = 'local',
    model = null,
    dimensions = null,
    normalize = true
  } = req.body;

  // Validate input
  if (!text || typeof text !== 'string') {
    throw new ValidationError('Text is required and must be a string');
  }

  try {
    // Generate embedding
    const embeddingResult = await embeddingService.generateEmbedding(text, {
      provider,
      model,
      dimensions,
      normalize,
      useCache: true
    });

    // Store in vector database
    const vectorId = id || require('uuid').v4();
    const storeResult = await req.vectorStore.addVector(
      embeddingResult.vector,
      vectorId,
      {
        ...metadata,
        originalText: text,
        embeddingProvider: embeddingResult.provider,
        embeddingModel: embeddingResult.model,
        embeddingDimensions: embeddingResult.dimensions
      }
    );

    // Store metadata in database
    await req.database.insertVectorMetadata({
      id: vectorId,
      dimensions: embeddingResult.vector.length,
      personaId: metadata.personaId || null,
      contentType: 'text_embedding',
      source: metadata.source || 'api',
      tags: metadata.tags || [],
      customMetadata: {
        ...metadata,
        originalText: text,
        embeddingProvider: embeddingResult.provider,
        embeddingModel: embeddingResult.model
      }
    });

    logger.info('Text embedded and stored as vector', {
      id: vectorId,
      provider: embeddingResult.provider,
      model: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
      textLength: text.length
    });

    res.status(201).json({
      status: 'success',
      data: {
        id: vectorId,
        dimensions: embeddingResult.dimensions,
        slotIndex: storeResult.slotIndex,
        embedding: {
          provider: embeddingResult.provider,
          model: embeddingResult.model,
          usage: embeddingResult.usage
        },
        metadata: metadata
      },
      message: 'Text embedded and stored as vector successfully'
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Semantic search using text query
 * POST /api/embeddings/search
 */
router.post('/search', asyncHandler(async (req, res) => {
  const {
    query,
    limit = 10,
    threshold = 0.0,
    metric = 'cosine',
    filters = {},
    include_values = false,
    include_metadata = true,
    provider = 'local',
    model = null,
    useIndex = true
  } = req.body;

  // Validate input
  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query text is required and must be a string');
  }

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingService.generateEmbedding(query, {
      provider,
      model,
      useCache: true
    });

    // Perform vector search
    const searchResults = await req.vectorStore.search(queryEmbedding.vector, {
      limit: parseInt(limit),
      threshold: parseFloat(threshold),
      metric,
      filters,
      includeValues: include_values === true || include_values === 'true',
      useIndex
    });

    // Enrich results with database metadata if requested
    if (include_metadata === true || include_metadata === 'true') {
      for (const result of searchResults) {
        try {
          const dbMetadata = await req.database.getVectorMetadata(result.id);
          if (dbMetadata) {
            result.metadata = { ...result.metadata, ...dbMetadata };
          }
        } catch (error) {
          logger.warn('Failed to fetch metadata for search result', {
            id: result.id,
            error: error.message
          });
        }
      }
    }

    logger.info('Semantic search completed', {
      query: query.substring(0, 100),
      provider: queryEmbedding.provider,
      model: queryEmbedding.model,
      resultCount: searchResults.length,
      threshold,
      metric
    });

    res.json({
      status: 'success',
      data: {
        query: {
          text: query,
          embedding: {
            provider: queryEmbedding.provider,
            model: queryEmbedding.model,
            dimensions: queryEmbedding.dimensions
          }
        },
        matches: searchResults,
        meta: {
          totalMatches: searchResults.length,
          threshold,
          metric,
          searchMethod: useIndex ? 'indexed' : 'linear'
        }
      }
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Get available embedding providers
 * GET /api/embeddings/providers
 */
router.get('/providers', asyncHandler(async (req, res) => {
  const providers = embeddingService.getAvailableProviders();
  
  res.json({
    status: 'success',
    data: {
      providers: providers,
      default: embeddingService.defaultProvider
    }
  });
}));

/**
 * Get embedding service statistics
 * GET /api/embeddings/stats
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = embeddingService.getStats();
  
  res.json({
    status: 'success',
    data: stats,
    timestamp: new Date().toISOString()
  });
}));

/**
 * Health check for embedding providers
 * GET /api/embeddings/health
 */
router.get('/health', asyncHandler(async (req, res) => {
  const healthResults = await embeddingService.healthCheck();
  
  const overallHealthy = Object.values(healthResults).every(
    result => result.status === 'healthy'
  );
  
  res.status(overallHealthy ? 200 : 503).json({
    status: overallHealthy ? 'healthy' : 'degraded',
    data: {
      overall: overallHealthy ? 'healthy' : 'degraded',
      providers: healthResults
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * Clear embedding cache
 * POST /api/embeddings/cache/clear
 */
router.post('/cache/clear', asyncHandler(async (req, res) => {
  embeddingService.clearCache();
  
  logger.info('Embedding cache cleared via API');
  
  res.json({
    status: 'success',
    message: 'Embedding cache cleared successfully'
  });
}));

/**
 * Configure embedding cache
 * POST /api/embeddings/cache/configure
 */
router.post('/cache/configure', asyncHandler(async (req, res) => {
  const { maxSize } = req.body;
  
  if (!maxSize || typeof maxSize !== 'number' || maxSize < 100 || maxSize > 100000) {
    throw new ValidationError('maxSize must be a number between 100 and 100,000');
  }
  
  embeddingService.configureCache(maxSize);
  
  logger.info('Embedding cache configured via API', { maxSize });
  
  res.json({
    status: 'success',
    message: 'Embedding cache configured successfully',
    data: { maxSize }
  });
}));

module.exports = router;
