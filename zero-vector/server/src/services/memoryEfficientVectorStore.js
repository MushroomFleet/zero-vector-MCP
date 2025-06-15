const VectorSimilarity = require('../utils/vectorSimilarity');
const { logVectorOperation, logMemoryUsage, logError } = require('../utils/logger');

/**
 * Memory-Efficient Vector Store
 * Optimized for 2GB memory usage with high-performance vector operations
 */
class MemoryEfficientVectorStore {
  constructor(maxMemoryMB = 2048, dimensions = 1536) {
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
    this.dimensions = dimensions;
    this.vectorSize = dimensions * 4; // 4 bytes per float32
    this.maxVectors = Math.floor(this.maxMemoryBytes / this.vectorSize);
    
    // Initialize the main vector storage buffer
    this.buffer = new ArrayBuffer(this.maxMemoryBytes);
    this.vectors = new Float32Array(this.buffer);
    
    // Vector metadata and management
    this.metadata = new Map();
    this.freeSlots = [];
    this.nextSlot = 0;
    this.vectorCount = 0;
    
    // Performance utilities
    this.similarity = new VectorSimilarity();
    
    // Performance tracking
    this.stats = {
      insertions: 0,
      deletions: 0,
      searches: 0,
      lastCleanup: Date.now()
    };

    console.log(`Initialized VectorStore: ${maxMemoryMB}MB, ${this.maxVectors} max vectors, ${dimensions}D`);
  }

  /**
   * Add a vector to the store
   */
  addVector(vector, id, metadata = {}) {
    const startTime = Date.now();
    
    try {
      // Validate input
      this.validateVector(vector, id);
      
      // Check if vector already exists
      if (this.metadata.has(id)) {
        throw new Error(`Vector with id '${id}' already exists`);
      }
      
      // Get available slot
      const slotIndex = this.allocateSlot();
      
      // Convert to Float32Array if needed
      const vectorArray = vector instanceof Float32Array ? vector : new Float32Array(vector);
      
      // Copy vector data to buffer
      const startIndex = slotIndex * this.dimensions;
      for (let i = 0; i < this.dimensions; i++) {
        this.vectors[startIndex + i] = vectorArray[i];
      }
      
      // Store metadata
      this.metadata.set(id, {
        slotIndex,
        dimensions: this.dimensions,
        timestamp: Date.now(),
        ...metadata
      });
      
      this.vectorCount++;
      this.stats.insertions++;
      
      const duration = Date.now() - startTime;
      logVectorOperation('insert', 1, this.dimensions, duration, { id, slotIndex });
      
      return {
        id,
        slotIndex,
        success: true
      };
      
    } catch (error) {
      logError(error, { operation: 'addVector', id, vectorLength: vector?.length });
      throw error;
    }
  }

  /**
   * Get a vector by ID
   */
  getVector(id, includeMetadata = false) {
    const vectorMeta = this.metadata.get(id);
    if (!vectorMeta) {
      return null;
    }
    
    const startIndex = vectorMeta.slotIndex * this.dimensions;
    const endIndex = startIndex + this.dimensions;
    const vector = this.vectors.slice(startIndex, endIndex);
    
    if (includeMetadata) {
      return {
        id,
        vector,
        metadata: vectorMeta
      };
    }
    
    return vector;
  }

  /**
   * Delete a vector by ID
   */
  deleteVector(id) {
    const vectorMeta = this.metadata.get(id);
    if (!vectorMeta) {
      return false;
    }
    
    // Mark slot as free
    this.freeSlots.push(vectorMeta.slotIndex);
    
    // Clear vector data (optional, for security)
    const startIndex = vectorMeta.slotIndex * this.dimensions;
    for (let i = 0; i < this.dimensions; i++) {
      this.vectors[startIndex + i] = 0;
    }
    
    // Remove metadata
    this.metadata.delete(id);
    
    // Clear from similarity cache
    this.similarity.magnitudeCache.delete(id);
    
    this.vectorCount--;
    this.stats.deletions++;
    
    logVectorOperation('delete', 1, this.dimensions, 0, { id });
    
    return true;
  }

  /**
   * Update an existing vector
   */
  updateVector(id, vector, metadata = {}) {
    const existingMeta = this.metadata.get(id);
    if (!existingMeta) {
      throw new Error(`Vector with id '${id}' not found`);
    }
    
    // Validate new vector
    this.validateVector(vector, id);
    
    // Update vector data
    const vectorArray = vector instanceof Float32Array ? vector : new Float32Array(vector);
    const startIndex = existingMeta.slotIndex * this.dimensions;
    
    for (let i = 0; i < this.dimensions; i++) {
      this.vectors[startIndex + i] = vectorArray[i];
    }
    
    // Update metadata
    this.metadata.set(id, {
      ...existingMeta,
      ...metadata,
      updatedAt: Date.now()
    });
    
    // Clear from similarity cache
    this.similarity.magnitudeCache.delete(id);
    
    logVectorOperation('update', 1, this.dimensions, 0, { id });
    
    return true;
  }

  /**
   * Perform similarity search
   */
  search(queryVector, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        limit = 10,
        threshold = 0.0,
        metric = 'cosine',
        filters = {},
        includeValues = false
      } = options;
      
      // Validate query vector
      this.validateVector(queryVector, 'query');
      
      const queryArray = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);
      const results = [];
      
      // Search through all vectors
      for (const [id, meta] of this.metadata) {
        // Apply filters
        if (!this.matchesFilters(meta, filters)) {
          continue;
        }
        
        // Get vector and calculate similarity
        const vector = this.getVector(id);
        const similarity = this.similarity.calculateSimilarity(
          queryArray, 
          vector, 
          metric, 
          'query', 
          id
        );
        
        // Apply threshold filter
        if (similarity >= threshold) {
          const result = {
            id,
            similarity,
            metadata: { ...meta }
          };
          
          if (includeValues) {
            result.vector = Array.from(vector);
          }
          
          results.push(result);
        }
      }
      
      // Sort by similarity (descending)
      results.sort((a, b) => b.similarity - a.similarity);
      
      // Apply limit
      const limitedResults = results.slice(0, limit);
      
      this.stats.searches++;
      const duration = Date.now() - startTime;
      
      logVectorOperation('search', limitedResults.length, this.dimensions, duration, {
        queryDimensions: queryVector.length,
        totalCandidates: this.vectorCount,
        threshold,
        metric
      });
      
      return limitedResults;
      
    } catch (error) {
      logError(error, { operation: 'search', queryLength: queryVector?.length });
      throw error;
    }
  }

  /**
   * Batch insert multiple vectors
   */
  batchInsert(vectors) {
    const startTime = Date.now();
    const results = [];
    const errors = [];
    
    for (const vectorData of vectors) {
      try {
        const { id, vector, metadata = {} } = vectorData;
        const result = this.addVector(vector, id, metadata);
        results.push(result);
      } catch (error) {
        errors.push({
          id: vectorData.id,
          error: error.message
        });
      }
    }
    
    const duration = Date.now() - startTime;
    logVectorOperation('batch_insert', results.length, this.dimensions, duration, {
      totalAttempted: vectors.length,
      errors: errors.length
    });
    
    return {
      successful: results,
      errors: errors,
      summary: {
        total: vectors.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }

  /**
   * Get all vector IDs (optionally with filters)
   */
  getAllIds(filters = {}) {
    const ids = [];
    
    for (const [id, meta] of this.metadata) {
      if (this.matchesFilters(meta, filters)) {
        ids.push(id);
      }
    }
    
    return ids;
  }

  /**
   * Get memory and performance statistics
   */
  getStats() {
    const usedSlots = this.vectorCount;
    const usedMemory = usedSlots * this.vectorSize;
    const similarityStats = this.similarity.getCacheStats();
    
    const stats = {
      // Memory statistics
      totalMemory: this.maxMemoryBytes,
      usedMemory,
      freeMemory: this.maxMemoryBytes - usedMemory,
      memoryUtilization: (usedMemory / this.maxMemoryBytes) * 100,
      
      // Vector statistics
      vectorCount: this.vectorCount,
      maxVectors: this.maxVectors,
      dimensions: this.dimensions,
      freeSlots: this.freeSlots.length,
      
      // Performance statistics
      operations: { ...this.stats },
      similarityCache: similarityStats,
      
      // System information
      uptime: Date.now() - (this.stats.lastCleanup || Date.now())
    };
    
    logMemoryUsage(stats);
    
    return stats;
  }

  /**
   * Cleanup and maintenance operations
   */
  cleanup() {
    const startTime = Date.now();
    
    // Clean similarity cache
    this.similarity.cleanupCache(10000);
    
    // Compact free slots array if it's getting large
    if (this.freeSlots.length > 1000) {
      this.freeSlots.sort((a, b) => a - b);
    }
    
    this.stats.lastCleanup = Date.now();
    
    const duration = Date.now() - startTime;
    logVectorOperation('cleanup', 0, 0, duration);
  }

  // Private helper methods

  validateVector(vector, id) {
    if (!vector || !Array.isArray(vector) && !(vector instanceof Float32Array)) {
      throw new Error(`Invalid vector format for ${id}`);
    }
    
    if (vector.length !== this.dimensions) {
      throw new Error(`Vector ${id} has ${vector.length} dimensions, expected ${this.dimensions}`);
    }
    
    // Check for invalid values
    for (let i = 0; i < vector.length; i++) {
      if (!isFinite(vector[i])) {
        throw new Error(`Vector ${id} contains invalid value at index ${i}: ${vector[i]}`);
      }
    }
  }

  allocateSlot() {
    let slotIndex;
    
    if (this.freeSlots.length > 0) {
      slotIndex = this.freeSlots.pop();
    } else if (this.nextSlot < this.maxVectors) {
      slotIndex = this.nextSlot++;
    } else {
      throw new Error(`Vector store is full. Maximum capacity: ${this.maxVectors} vectors`);
    }
    
    return slotIndex;
  }

  matchesFilters(metadata, filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (key === 'timestamp') {
        // Handle timestamp range queries
        if (typeof value === 'object' && value !== null) {
          if (value.$gte && metadata.timestamp < value.$gte) return false;
          if (value.$lte && metadata.timestamp > value.$lte) return false;
          if (value.$lt && metadata.timestamp >= value.$lt) return false;
          if (value.$gt && metadata.timestamp <= value.$gt) return false;
        } else {
          if (metadata.timestamp !== value) return false;
        }
      } else {
        // Direct equality check
        if (metadata[key] !== value) return false;
      }
    }
    return true;
  }
}

module.exports = MemoryEfficientVectorStore;
