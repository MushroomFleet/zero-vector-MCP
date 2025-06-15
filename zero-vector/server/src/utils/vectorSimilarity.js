/**
 * Vector Similarity Algorithms
 * Optimized implementations for cosine similarity, euclidean distance, and dot product
 */

class VectorSimilarity {
  constructor() {
    this.magnitudeCache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Calculate cosine similarity between two vectors
   * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
   */
  cosineSimilarity(vectorA, vectorB, idA = null, idB = null) {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    const dotProd = this.dotProduct(vectorA, vectorB);
    const magA = this.getMagnitude(vectorA, idA);
    const magB = this.getMagnitude(vectorB, idB);

    if (magA === 0 || magB === 0) {
      return 0; // Handle zero vectors
    }

    return dotProd / (magA * magB);
  }

  /**
   * Calculate euclidean distance between two vectors
   * Returns distance (0 = identical, larger = more different)
   */
  euclideanDistance(vectorA, vectorB) {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    let sumSquaredDiffs = 0;
    for (let i = 0; i < vectorA.length; i++) {
      const diff = vectorA[i] - vectorB[i];
      sumSquaredDiffs += diff * diff;
    }

    return Math.sqrt(sumSquaredDiffs);
  }

  /**
   * Calculate dot product between two vectors
   * Optimized for performance with typed arrays
   */
  dotProduct(vectorA, vectorB) {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    let result = 0;
    
    // Use typed array optimization if available
    if (vectorA instanceof Float32Array && vectorB instanceof Float32Array) {
      // Unroll loop for better performance on small vectors
      const len = vectorA.length;
      let i = 0;
      
      // Process 4 elements at a time
      for (; i < len - 3; i += 4) {
        result += vectorA[i] * vectorB[i] +
                  vectorA[i + 1] * vectorB[i + 1] +
                  vectorA[i + 2] * vectorB[i + 2] +
                  vectorA[i + 3] * vectorB[i + 3];
      }
      
      // Handle remaining elements
      for (; i < len; i++) {
        result += vectorA[i] * vectorB[i];
      }
    } else {
      // Standard implementation for regular arrays
      for (let i = 0; i < vectorA.length; i++) {
        result += vectorA[i] * vectorB[i];
      }
    }

    return result;
  }

  /**
   * Calculate vector magnitude with caching
   * Cache improves performance for repeated similarity calculations
   */
  getMagnitude(vector, id = null) {
    // Use cache if ID is provided
    if (id !== null && this.magnitudeCache.has(id)) {
      this.cacheHits++;
      return this.magnitudeCache.get(id);
    }

    let magnitude;
    
    if (vector instanceof Float32Array) {
      // Optimized calculation for typed arrays
      let sumSquares = 0;
      for (let i = 0; i < vector.length; i++) {
        sumSquares += vector[i] * vector[i];
      }
      magnitude = Math.sqrt(sumSquares);
    } else {
      // Standard calculation
      magnitude = Math.sqrt(
        vector.reduce((sum, val) => sum + val * val, 0)
      );
    }

    // Cache the result if ID is provided
    if (id !== null) {
      this.magnitudeCache.set(id, magnitude);
      this.cacheMisses++;
    }

    return magnitude;
  }

  /**
   * Calculate similarity based on specified metric
   */
  calculateSimilarity(vectorA, vectorB, metric = 'cosine', idA = null, idB = null) {
    switch (metric.toLowerCase()) {
      case 'cosine':
        return this.cosineSimilarity(vectorA, vectorB, idA, idB);
      
      case 'euclidean':
        // Convert distance to similarity (invert and normalize)
        const distance = this.euclideanDistance(vectorA, vectorB);
        return 1 / (1 + distance);
      
      case 'dot':
        return this.dotProduct(vectorA, vectorB);
      
      default:
        throw new Error(`Unsupported similarity metric: ${metric}`);
    }
  }

  /**
   * Normalize vector to unit length
   */
  normalizeVector(vector) {
    const magnitude = this.getMagnitude(vector);
    
    if (magnitude === 0) {
      return new Float32Array(vector.length); // Return zero vector
    }

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / magnitude;
    }

    return normalized;
  }

  /**
   * Batch similarity calculation for multiple vectors against a query
   */
  batchSimilarity(queryVector, targetVectors, metric = 'cosine', queryId = null) {
    const results = [];
    
    for (let i = 0; i < targetVectors.length; i++) {
      const target = targetVectors[i];
      const similarity = this.calculateSimilarity(
        queryVector, 
        target.vector, 
        metric, 
        queryId, 
        target.id
      );
      
      results.push({
        id: target.id,
        similarity: similarity,
        metadata: target.metadata
      });
    }

    return results;
  }

  /**
   * Clear the magnitude cache
   */
  clearCache() {
    this.magnitudeCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.magnitudeCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }

  /**
   * Clean up old cache entries to prevent memory leaks
   */
  cleanupCache(maxSize = 10000) {
    if (this.magnitudeCache.size > maxSize) {
      const entries = Array.from(this.magnitudeCache.entries());
      
      // Remove oldest half of entries
      const toRemove = Math.floor(entries.length / 2);
      for (let i = 0; i < toRemove; i++) {
        this.magnitudeCache.delete(entries[i][0]);
      }
    }
  }
}

module.exports = VectorSimilarity;
