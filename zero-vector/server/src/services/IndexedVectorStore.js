const MemoryEfficientVectorStore = require('./memoryEfficientVectorStore');
const HNSWIndex = require('../algorithms/HNSWIndex');
const { logVectorOperation, logError } = require('../utils/logger');

/**
 * Indexed Vector Store
 * Combines memory-efficient storage with HNSW indexing for high-performance search
 */
class IndexedVectorStore extends MemoryEfficientVectorStore {
  constructor(maxMemoryMB = 2048, dimensions = 1536, indexOptions = {}) {
    super(maxMemoryMB, dimensions);
    
    // Initialize HNSW index
    this.hnswIndex = new HNSWIndex({
      M: indexOptions.M || 16,
      efConstruction: indexOptions.efConstruction || 200,
      efSearch: indexOptions.efSearch || 50,
      distanceFunction: indexOptions.distanceFunction || 'cosine',
      ...indexOptions
    });
    
    // Index configuration
    this.indexEnabled = true;
    this.autoIndex = indexOptions.autoIndex !== false; // Default to true
    this.indexThreshold = indexOptions.indexThreshold || 100; // Build index after 100 vectors
    
    // Performance tracking
    this.searchStats = {
      hnswSearches: 0,
      linearSearches: 0,
      hnswTime: 0,
      linearTime: 0,
      avgHnswTime: 0,
      avgLinearTime: 0
    };
    
    console.log(`IndexedVectorStore initialized with HNSW: ${maxMemoryMB}MB, ${dimensions}D, M=${this.hnswIndex.M}`);
  }

  /**
   * Add vector with automatic indexing
   */
  addVector(vector, id, metadata = {}) {
    const startTime = Date.now();
    
    try {
      // Add to base vector store
      const result = super.addVector(vector, id, metadata);
      
      // Add to HNSW index if enabled
      if (this.indexEnabled && this.autoIndex) {
        try {
          this.hnswIndex.insert(vector, id, metadata);
        } catch (indexError) {
          // Log index error but don't fail the operation
          logError(indexError, { operation: 'hnswInsert', id });
        }
      }
      
      const duration = Date.now() - startTime;
      logVectorOperation('indexed_insert', 1, this.dimensions, duration, { 
        id, 
        indexed: this.indexEnabled && this.autoIndex 
      });
      
      return result;
      
    } catch (error) {
      logError(error, { operation: 'indexedAddVector', id });
      throw error;
    }
  }

  /**
   * Enhanced search with HNSW index
   */
  search(queryVector, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        limit = 10,
        threshold = 0.0,
        metric = 'cosine',
        filters = {},
        includeValues = false,
        useIndex = true,
        ef = null
      } = options;
      
      // Validate query vector
      this.validateVector(queryVector, 'query');
      
      let results = [];
      let searchMethod = 'linear';
      
      // Use HNSW index if enabled and sufficient vectors
      if (useIndex && this.indexEnabled && this.hnswIndex.nodeCount >= this.indexThreshold) {
        try {
          searchMethod = 'hnsw';
          const hnswResults = this.hnswIndex.search(queryVector, limit * 2, ef); // Get more candidates
          
          // Filter and convert HNSW results
          results = hnswResults
            .filter(result => {
              // Apply threshold
              if (result.similarity < threshold) return false;
              
              // Apply metadata filters
              const vectorMeta = this.metadata.get(result.id);
              return vectorMeta && this.matchesFilters(vectorMeta, filters);
            })
            .slice(0, limit)
            .map(result => {
              const vectorMeta = this.metadata.get(result.id);
              const formattedResult = {
                id: result.id,
                similarity: result.similarity,
                metadata: { ...vectorMeta, ...result.metadata }
              };
              
              if (includeValues) {
                formattedResult.vector = Array.from(this.getVector(result.id));
              }
              
              return formattedResult;
            });
          
          // Update HNSW stats
          this.searchStats.hnswSearches++;
          const hnswDuration = Date.now() - startTime;
          this.searchStats.hnswTime += hnswDuration;
          this.searchStats.avgHnswTime = this.searchStats.hnswTime / this.searchStats.hnswSearches;
          
        } catch (hnswError) {
          logError(hnswError, { operation: 'hnswSearch' });
          // Fall back to linear search
          searchMethod = 'linear_fallback';
        }
      }
      
      // Fall back to linear search if HNSW failed or not available
      if (results.length === 0 || searchMethod !== 'hnsw') {
        searchMethod = searchMethod === 'hnsw' ? 'linear_fallback' : 'linear';
        results = super.search(queryVector, options);
        
        // Update linear search stats
        this.searchStats.linearSearches++;
        const linearDuration = Date.now() - startTime;
        this.searchStats.linearTime += linearDuration;
        this.searchStats.avgLinearTime = this.searchStats.linearTime / this.searchStats.linearSearches;
      }
      
      const totalDuration = Date.now() - startTime;
      
      logVectorOperation('indexed_search', results.length, this.dimensions, totalDuration, {
        searchMethod,
        threshold,
        metric,
        useIndex: useIndex && this.indexEnabled,
        indexSize: this.hnswIndex.nodeCount
      });
      
      return results;
      
    } catch (error) {
      logError(error, { operation: 'indexedSearch' });
      throw error;
    }
  }

  /**
   * Delete vector from both store and index
   */
  deleteVector(id) {
    const success = super.deleteVector(id);
    
    if (success && this.indexEnabled) {
      try {
        this.hnswIndex.remove(id);
      } catch (indexError) {
        logError(indexError, { operation: 'hnswRemove', id });
      }
    }
    
    return success;
  }

  /**
   * Update vector in both store and index
   */
  updateVector(id, vector, metadata = {}) {
    const success = super.updateVector(id, vector, metadata);
    
    if (success && this.indexEnabled) {
      try {
        // Remove old version from index
        this.hnswIndex.remove(id);
        // Add updated version
        this.hnswIndex.insert(vector, id, metadata);
      } catch (indexError) {
        logError(indexError, { operation: 'hnswUpdate', id });
      }
    }
    
    return success;
  }

  /**
   * Rebuild the HNSW index from scratch
   */
  rebuildIndex() {
    const startTime = Date.now();
    
    try {
      console.log('Rebuilding HNSW index...');
      
      // Clear existing index
      this.hnswIndex.clear();
      
      let indexed = 0;
      const total = this.vectorCount;
      
      // Re-index all vectors
      for (const [id, meta] of this.metadata) {
        try {
          const vector = this.getVector(id);
          this.hnswIndex.insert(vector, id, meta);
          indexed++;
          
          if (indexed % 1000 === 0) {
            console.log(`Indexed ${indexed}/${total} vectors...`);
          }
        } catch (error) {
          logError(error, { operation: 'rebuildIndex', id });
        }
      }
      
      const duration = Date.now() - startTime;
      
      console.log(`Index rebuild completed: ${indexed}/${total} vectors in ${duration}ms`);
      
      logVectorOperation('rebuild_index', indexed, this.dimensions, duration, {
        totalVectors: total,
        indexedVectors: indexed
      });
      
      return {
        success: true,
        indexed,
        total,
        duration,
        stats: this.hnswIndex.getStats()
      };
      
    } catch (error) {
      logError(error, { operation: 'rebuildIndex' });
      throw error;
    }
  }

  /**
   * Enable or disable indexing
   */
  setIndexEnabled(enabled) {
    this.indexEnabled = enabled;
    console.log(`HNSW indexing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Configure HNSW search parameters
   */
  configureSearch(efSearch) {
    this.hnswIndex.efSearch = efSearch;
    console.log(`HNSW efSearch updated to ${efSearch}`);
  }

  /**
   * Get comprehensive statistics including index performance
   */
  getStats() {
    const baseStats = super.getStats();
    const hnswStats = this.hnswIndex.getStats();
    
    return {
      ...baseStats,
      index: {
        enabled: this.indexEnabled,
        autoIndex: this.autoIndex,
        threshold: this.indexThreshold,
        ...hnswStats
      },
      searchPerformance: {
        ...this.searchStats,
        hnswSpeedup: this.searchStats.avgLinearTime > 0 && this.searchStats.avgHnswTime > 0 
          ? (this.searchStats.avgLinearTime / this.searchStats.avgHnswTime).toFixed(2) + 'x'
          : 'N/A'
      }
    };
  }

  /**
   * Batch insert with optimized indexing
   */
  batchInsert(vectors) {
    const startTime = Date.now();
    
    // Temporarily disable auto-indexing for batch operations
    const originalAutoIndex = this.autoIndex;
    this.autoIndex = false;
    
    try {
      // Perform base batch insert
      const result = super.batchInsert(vectors);
      
      // Batch index successful insertions
      if (this.indexEnabled && result.successful.length > 0) {
        console.log(`Batch indexing ${result.successful.length} vectors...`);
        
        let indexed = 0;
        for (const successResult of result.successful) {
          try {
            const vectorData = vectors.find(v => v.id === successResult.id);
            if (vectorData) {
              this.hnswIndex.insert(vectorData.vector, successResult.id, vectorData.metadata || {});
              indexed++;
            }
          } catch (indexError) {
            logError(indexError, { operation: 'batchIndex', id: successResult.id });
          }
        }
        
        console.log(`Batch indexing completed: ${indexed}/${result.successful.length} vectors`);
      }
      
      // Restore auto-indexing setting
      this.autoIndex = originalAutoIndex;
      
      const duration = Date.now() - startTime;
      
      logVectorOperation('indexed_batch_insert', result.successful.length, this.dimensions, duration, {
        totalAttempted: vectors.length,
        indexed: this.indexEnabled
      });
      
      return result;
      
    } catch (error) {
      // Restore auto-indexing setting on error
      this.autoIndex = originalAutoIndex;
      throw error;
    }
  }

  /**
   * Advanced search with multiple strategies
   */
  hybridSearch(queryVector, options = {}) {
    const {
      limit = 10,
      threshold = 0.0,
      hnswCandidates = limit * 3,
      linearBackup = false,
      ...otherOptions
    } = options;
    
    let results = [];
    
    // Primary HNSW search
    if (this.indexEnabled && this.hnswIndex.nodeCount >= this.indexThreshold) {
      const hnswResults = this.search(queryVector, {
        ...otherOptions,
        limit: hnswCandidates,
        threshold: threshold * 0.8, // Lower threshold for candidates
        useIndex: true
      });
      
      results = hnswResults.slice(0, limit);
    }
    
    // Linear search backup if not enough results
    if (linearBackup && results.length < limit) {
      const linearResults = this.search(queryVector, {
        ...otherOptions,
        limit: limit - results.length,
        threshold,
        useIndex: false
      });
      
      // Merge results, avoiding duplicates
      const existingIds = new Set(results.map(r => r.id));
      const newResults = linearResults.filter(r => !existingIds.has(r.id));
      
      results = [...results, ...newResults];
    }
    
    return results;
  }

  /**
   * Cleanup operations including index maintenance
   */
  cleanup() {
    super.cleanup();
    
    // HNSW index doesn't need regular cleanup, but we can log stats
    const indexStats = this.hnswIndex.getStats();
    console.log(`HNSW Index: ${indexStats.nodeCount} nodes, ${indexStats.layerCount} layers`);
  }
}

module.exports = IndexedVectorStore;
