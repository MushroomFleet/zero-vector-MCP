const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * Vector Operations Routes
 * Handles all vector CRUD operations and similarity search
 */

/**
 * Insert a single vector
 * POST /api/vectors
 */
router.post('/', asyncHandler(async (req, res) => {
  const { id, vector, metadata = {} } = req.body;

  // Validate required fields
  if (!vector || !Array.isArray(vector)) {
    throw new ValidationError('Vector array is required');
  }

  if (vector.length === 0) {
    throw new ValidationError('Vector cannot be empty');
  }

  // Generate ID if not provided
  const vectorId = id || uuidv4();

  // Validate vector dimensions
  const expectedDimensions = req.vectorStore.dimensions;
  if (vector.length !== expectedDimensions) {
    throw new ValidationError(
      `Vector must have ${expectedDimensions} dimensions, got ${vector.length}`
    );
  }

  // Validate vector values
  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== 'number' || !isFinite(vector[i])) {
      throw new ValidationError(`Invalid vector value at index ${i}: ${vector[i]}`);
    }
  }

  try {
    // Add vector to store
    const result = await req.vectorStore.addVector(vector, vectorId, metadata);

    // Store metadata in database
    await req.database.insertVectorMetadata({
      id: vectorId,
      dimensions: vector.length,
      personaId: metadata.personaId || null,
      contentType: metadata.contentType || null,
      source: metadata.source || null,
      tags: metadata.tags || [],
      customMetadata: metadata
    });

    logger.info('Vector inserted successfully', {
      id: vectorId,
      dimensions: vector.length,
      slotIndex: result.slotIndex
    });

    res.status(201).json({
      status: 'success',
      data: {
        id: vectorId,
        dimensions: vector.length,
        slotIndex: result.slotIndex,
        metadata: metadata
      },
      message: 'Vector inserted successfully'
    });

  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        status: 'error',
        error: 'VECTOR_EXISTS',
        message: `Vector with id '${vectorId}' already exists`
      });
    }
    throw error;
  }
}));

/**
 * Get a vector by ID
 * GET /api/vectors/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { include_metadata = false, include_values = false } = req.query;

  const vector = req.vectorStore.getVector(id, include_metadata);
  
  if (!vector) {
    return res.status(404).json({
      status: 'error',
      error: 'VECTOR_NOT_FOUND',
      message: `Vector with id '${id}' not found`
    });
  }

  const response = {
    status: 'success',
    data: {
      id: id,
      dimensions: vector.length || req.vectorStore.dimensions
    }
  };

  if (include_values === 'true') {
    response.data.vector = Array.isArray(vector) ? vector : Array.from(vector);
  }

  if (include_metadata === 'true') {
    try {
      const dbMetadata = await req.database.getVectorMetadata(id);
      if (dbMetadata) {
        response.data.metadata = dbMetadata;
      }
    } catch (error) {
      logger.warn('Failed to fetch metadata for vector', { id, error: error.message });
    }
  }

  res.json(response);
}));

/**
 * Update a vector
 * PUT /api/vectors/:id
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { vector, metadata = {} } = req.body;

  if (!vector || !Array.isArray(vector)) {
    throw new ValidationError('Vector array is required');
  }

  // Validate vector dimensions
  const expectedDimensions = req.vectorStore.dimensions;
  if (vector.length !== expectedDimensions) {
    throw new ValidationError(
      `Vector must have ${expectedDimensions} dimensions, got ${vector.length}`
    );
  }

  try {
    const success = req.vectorStore.updateVector(id, vector, metadata);
    
    if (!success) {
      return res.status(404).json({
        status: 'error',
        error: 'VECTOR_NOT_FOUND',
        message: `Vector with id '${id}' not found`
      });
    }

    // Update metadata in database
    await req.database.updateVectorMetadata(id, {
      personaId: metadata.personaId,
      contentType: metadata.contentType,
      source: metadata.source,
      tags: metadata.tags,
      customMetadata: metadata
    });

    logger.info('Vector updated successfully', { id, dimensions: vector.length });

    res.json({
      status: 'success',
      data: {
        id: id,
        dimensions: vector.length,
        metadata: metadata
      },
      message: 'Vector updated successfully'
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Delete a vector
 * DELETE /api/vectors/:id
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const success = req.vectorStore.deleteVector(id);
  
  if (!success) {
    return res.status(404).json({
      status: 'error',
      error: 'VECTOR_NOT_FOUND',
      message: `Vector with id '${id}' not found`
    });
  }

  // Delete metadata from database
  try {
    await req.database.deleteVectorMetadata(id);
  } catch (error) {
    logger.warn('Failed to delete vector metadata', { id, error: error.message });
  }

  logger.info('Vector deleted successfully', { id });

  res.json({
    status: 'success',
    message: 'Vector deleted successfully',
    data: { id }
  });
}));

/**
 * Similarity search
 * POST /api/vectors/search
 */
router.post('/search', asyncHandler(async (req, res) => {
  const {
    query,
    limit = 10,
    threshold = 0.0,
    metric = 'cosine',
    filters = {},
    include_values = false,
    include_metadata = true
  } = req.body;

  if (!query || !Array.isArray(query)) {
    throw new ValidationError('Query vector array is required');
  }

  // Validate query dimensions
  const expectedDimensions = req.vectorStore.dimensions;
  if (query.length !== expectedDimensions) {
    throw new ValidationError(
      `Query vector must have ${expectedDimensions} dimensions, got ${query.length}`
    );
  }

  // Validate parameters
  if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
    throw new ValidationError('Limit must be a number between 1 and 1000');
  }

  if (typeof threshold !== 'number' || threshold < -1 || threshold > 1) {
    throw new ValidationError('Threshold must be a number between -1 and 1');
  }

  if (!['cosine', 'euclidean', 'dot'].includes(metric)) {
    throw new ValidationError('Metric must be one of: cosine, euclidean, dot');
  }

  try {
    const startTime = Date.now();

    // Perform similarity search
    const results = req.vectorStore.search(query, {
      limit: parseInt(limit),
      threshold: parseFloat(threshold),
      metric: metric,
      filters: filters,
      includeValues: include_values === true || include_values === 'true'
    });

    // Enrich results with database metadata if requested
    if (include_metadata === true || include_metadata === 'true') {
      for (const result of results) {
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

    const queryTime = Date.now() - startTime;

    logger.info('Vector search completed', {
      queryDimensions: query.length,
      resultCount: results.length,
      queryTime,
      threshold,
      metric
    });

    res.json({
      status: 'success',
      data: {
        matches: results,
        query: {
          dimensions: query.length,
          metric: metric,
          threshold: threshold,
          limit: limit
        },
        meta: {
          totalMatches: results.length,
          queryTime: queryTime,
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Batch insert vectors
 * POST /api/vectors/batch
 */
router.post('/batch', asyncHandler(async (req, res) => {
  const { vectors } = req.body;

  if (!vectors || !Array.isArray(vectors)) {
    throw new ValidationError('Vectors array is required');
  }

  if (vectors.length === 0) {
    throw new ValidationError('Vectors array cannot be empty');
  }

  if (vectors.length > 1000) {
    throw new ValidationError('Maximum 1000 vectors allowed per batch');
  }

  // Validate each vector
  const expectedDimensions = req.vectorStore.dimensions;
  const vectorsToInsert = [];

  for (let i = 0; i < vectors.length; i++) {
    const vectorData = vectors[i];
    
    if (!vectorData.vector || !Array.isArray(vectorData.vector)) {
      throw new ValidationError(`Vector at index ${i} must have a vector array`);
    }

    if (vectorData.vector.length !== expectedDimensions) {
      throw new ValidationError(
        `Vector at index ${i} must have ${expectedDimensions} dimensions`
      );
    }

    vectorsToInsert.push({
      id: vectorData.id || uuidv4(),
      vector: vectorData.vector,
      metadata: vectorData.metadata || {}
    });
  }

  try {
    const startTime = Date.now();

    // Perform batch insert
    const result = await req.vectorStore.batchInsert(vectorsToInsert);

    // Insert successful metadata into database
    const metadataPromises = result.successful.map(async (successResult) => {
      const vectorData = vectorsToInsert.find(v => v.id === successResult.id);
      if (vectorData) {
        try {
          await req.database.insertVectorMetadata({
            id: successResult.id,
            dimensions: vectorData.vector.length,
            personaId: vectorData.metadata.personaId || null,
            contentType: vectorData.metadata.contentType || null,
            source: vectorData.metadata.source || null,
            tags: vectorData.metadata.tags || [],
            customMetadata: vectorData.metadata
          });
        } catch (error) {
          logger.warn('Failed to insert metadata for batch vector', {
            id: successResult.id,
            error: error.message
          });
        }
      }
    });

    await Promise.allSettled(metadataPromises);

    const duration = Date.now() - startTime;

    logger.info('Batch insert completed', {
      totalVectors: vectors.length,
      successful: result.successful.length,
      failed: result.errors.length,
      duration
    });

    res.status(result.errors.length > 0 ? 207 : 201).json({
      status: result.errors.length === 0 ? 'success' : 'partial_success',
      data: {
        summary: result.summary,
        successful: result.successful,
        errors: result.errors
      },
      meta: {
        duration: duration,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Get vector store statistics
 * GET /api/vectors/stats
 */
router.get('/_stats', asyncHandler(async (req, res) => {
  const stats = req.vectorStore.getStats();
  
  res.json({
    status: 'success',
    data: stats,
    timestamp: new Date().toISOString()
  });
}));

/**
 * List vector IDs with optional filtering
 * GET /api/vectors
 */
router.get('/', asyncHandler(async (req, res) => {
  const {
    limit = 100,
    offset = 0,
    persona_id,
    content_type,
    source,
    created_after,
    created_before
  } = req.query;

  // Build filters
  const filters = {};
  if (persona_id) filters.personaId = persona_id;
  if (content_type) filters.contentType = content_type;
  if (source) filters.source = source;
  if (created_after) filters.createdAfter = parseInt(created_after);
  if (created_before) filters.createdBefore = parseInt(created_before);

  try {
    // Get vector metadata from database
    const vectors = await req.database.searchVectorMetadata(
      filters,
      parseInt(limit),
      parseInt(offset)
    );

    res.json({
      status: 'success',
      data: {
        vectors: vectors,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          count: vectors.length
        }
      }
    });

  } catch (error) {
    throw error;
  }
}));

module.exports = router;
