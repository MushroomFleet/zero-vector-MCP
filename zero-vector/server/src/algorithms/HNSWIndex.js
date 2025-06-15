/**
 * Hierarchical Navigable Small World (HNSW) Index
 * High-performance approximate nearest neighbor search
 * Based on: "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs"
 */

const VectorSimilarity = require('../utils/vectorSimilarity');

class HNSWIndex {
  constructor(options = {}) {
    // HNSW parameters
    this.M = options.M || 16;                    // Maximum connections per node
    this.maxM = this.M;                          // Maximum connections at layer 0
    this.maxM0 = this.M * 2;                    // Maximum connections at higher layers
    this.ml = 1.0 / Math.log(2.0);             // Level generation factor
    this.efConstruction = options.efConstruction || 200;  // Size of dynamic candidate list
    this.efSearch = options.efSearch || 50;      // Size of search dynamic list
    this.distanceFunction = options.distanceFunction || 'cosine';
    
    // Graph structure: Map<level, Map<nodeId, Set<connectedNodeIds>>>
    this.layers = new Map();
    this.nodes = new Map();                      // Map<nodeId, {vector, level, metadata}>
    this.entryPoint = null;                      // Entry point for search
    this.nodeCount = 0;
    
    // Performance utilities
    this.similarity = new VectorSimilarity();
    
    // Statistics
    this.stats = {
      searchCount: 0,
      insertCount: 0,
      totalSearchTime: 0,
      avgSearchTime: 0,
      layerDistribution: new Map()
    };
    
    console.log(`HNSW Index initialized: M=${this.M}, efConstruction=${this.efConstruction}, efSearch=${this.efSearch}`);
  }

  /**
   * Insert a new vector into the HNSW index
   */
  insert(vector, id, metadata = {}) {
    const startTime = Date.now();
    
    try {
      // Generate level for new node
      const level = this.generateLevel();
      
      // Create node
      const node = {
        id,
        vector: new Float32Array(vector),
        level,
        metadata,
        insertTime: Date.now()
      };
      
      this.nodes.set(id, node);
      
      // Initialize layers up to the node's level
      for (let lc = 0; lc <= level; lc++) {
        if (!this.layers.has(lc)) {
          this.layers.set(lc, new Map());
        }
        this.layers.get(lc).set(id, new Set());
      }
      
      // If this is the first node, make it the entry point
      if (this.entryPoint === null) {
        this.entryPoint = { id, level };
        this.nodeCount++;
        this.stats.insertCount++;
        return true;
      }
      
      // Search for closest points starting from top layer
      let currentClosest = [this.entryPoint.id];
      
      // Search from top layer down to level + 1
      for (let lc = this.entryPoint.level; lc > level; lc--) {
        currentClosest = this.searchLayer(vector, currentClosest, 1, lc);
      }
      
      // Search and connect from level down to 0
      for (let lc = Math.min(level, this.entryPoint.level); lc >= 0; lc--) {
        const candidates = this.searchLayer(vector, currentClosest, this.efConstruction, lc);
        
        // Select M neighbors
        const selectedNeighbors = this.selectNeighbors(
          vector, 
          candidates, 
          lc === 0 ? this.maxM0 : this.maxM
        );
        
        // Add bidirectional connections
        for (const neighborId of selectedNeighbors) {
          this.addConnection(id, neighborId, lc);
          this.addConnection(neighborId, id, lc);
          
          // Prune connections if necessary
          this.pruneConnections(neighborId, lc);
        }
        
        currentClosest = selectedNeighbors;
      }
      
      // Update entry point if necessary
      if (level > this.entryPoint.level) {
        this.entryPoint = { id, level };
      }
      
      this.nodeCount++;
      this.stats.insertCount++;
      
      // Update statistics
      if (!this.stats.layerDistribution.has(level)) {
        this.stats.layerDistribution.set(level, 0);
      }
      this.stats.layerDistribution.set(level, this.stats.layerDistribution.get(level) + 1);
      
      const duration = Date.now() - startTime;
      return { success: true, level, duration };
      
    } catch (error) {
      throw new Error(`Failed to insert vector ${id}: ${error.message}`);
    }
  }

  /**
   * Search for k nearest neighbors
   */
  search(queryVector, k = 10, ef = null) {
    const startTime = Date.now();
    
    if (this.entryPoint === null || this.nodeCount === 0) {
      return [];
    }
    
    const searchEf = ef || Math.max(k, this.efSearch);
    
    try {
      // Start from entry point
      let currentClosest = [this.entryPoint.id];
      
      // Search from top layer down to layer 1
      for (let lc = this.entryPoint.level; lc > 0; lc--) {
        currentClosest = this.searchLayer(queryVector, currentClosest, 1, lc);
      }
      
      // Search layer 0 with larger ef
      const candidates = this.searchLayer(queryVector, currentClosest, searchEf, 0);
      
      // Return top k results
      const results = candidates.slice(0, k).map(nodeId => {
        const node = this.nodes.get(nodeId);
        const similarity = this.calculateDistance(queryVector, node.vector);
        
        return {
          id: nodeId,
          similarity: this.distanceFunction === 'cosine' ? similarity : 1 / (1 + similarity),
          metadata: node.metadata,
          level: node.level
        };
      });
      
      // Update statistics
      this.stats.searchCount++;
      const duration = Date.now() - startTime;
      this.stats.totalSearchTime += duration;
      this.stats.avgSearchTime = this.stats.totalSearchTime / this.stats.searchCount;
      
      return results;
      
    } catch (error) {
      throw new Error(`HNSW search failed: ${error.message}`);
    }
  }

  /**
   * Search within a specific layer
   */
  searchLayer(queryVector, entryPoints, numClosest, layer) {
    const visited = new Set();
    const candidates = [];  // Min-heap based on distance
    const dynamic = [];     // Max-heap for closest candidates
    
    // Initialize with entry points
    for (const nodeId of entryPoints) {
      const distance = this.calculateDistance(queryVector, this.nodes.get(nodeId).vector);
      
      candidates.push({ id: nodeId, distance });
      dynamic.push({ id: nodeId, distance });
      visited.add(nodeId);
    }
    
    // Sort initial candidates
    candidates.sort((a, b) => a.distance - b.distance);
    dynamic.sort((a, b) => b.distance - a.distance);
    
    while (candidates.length > 0) {
      const current = candidates.shift();
      
      // If current is further than worst in dynamic, stop
      if (dynamic.length >= numClosest && current.distance > dynamic[0].distance) {
        break;
      }
      
      // Examine all connections of current node at this layer
      const connections = this.layers.get(layer)?.get(current.id) || new Set();
      
      for (const neighborId of connections) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          
          const distance = this.calculateDistance(queryVector, this.nodes.get(neighborId).vector);
          
          if (dynamic.length < numClosest || distance < dynamic[0].distance) {
            candidates.push({ id: neighborId, distance });
            dynamic.push({ id: neighborId, distance });
            
            // Maintain heap properties
            candidates.sort((a, b) => a.distance - b.distance);
            dynamic.sort((a, b) => b.distance - a.distance);
            
            // Keep only numClosest in dynamic
            if (dynamic.length > numClosest) {
              dynamic.shift();
            }
          }
        }
      }
    }
    
    // Return node IDs sorted by distance (closest first)
    return dynamic.reverse().map(item => item.id);
  }

  /**
   * Select neighbors using simple heuristic
   */
  selectNeighbors(queryVector, candidates, maxConnections) {
    // Sort candidates by distance
    const candidateDistances = candidates.map(nodeId => ({
      id: nodeId,
      distance: this.calculateDistance(queryVector, this.nodes.get(nodeId).vector)
    }));
    
    candidateDistances.sort((a, b) => a.distance - b.distance);
    
    // Return closest maxConnections candidates
    return candidateDistances.slice(0, maxConnections).map(item => item.id);
  }

  /**
   * Add bidirectional connection between nodes
   */
  addConnection(nodeId1, nodeId2, layer) {
    if (!this.layers.has(layer)) {
      this.layers.set(layer, new Map());
    }
    
    const layerGraph = this.layers.get(layer);
    
    if (!layerGraph.has(nodeId1)) {
      layerGraph.set(nodeId1, new Set());
    }
    
    layerGraph.get(nodeId1).add(nodeId2);
  }

  /**
   * Prune connections if node has too many
   */
  pruneConnections(nodeId, layer) {
    const connections = this.layers.get(layer)?.get(nodeId);
    if (!connections) return;
    
    const maxConnections = layer === 0 ? this.maxM0 : this.maxM;
    
    if (connections.size <= maxConnections) return;
    
    // Get node vector for distance calculations
    const nodeVector = this.nodes.get(nodeId).vector;
    
    // Calculate distances to all connected nodes
    const connectionDistances = Array.from(connections).map(connectedId => ({
      id: connectedId,
      distance: this.calculateDistance(nodeVector, this.nodes.get(connectedId).vector)
    }));
    
    // Sort by distance and keep only the closest maxConnections
    connectionDistances.sort((a, b) => a.distance - b.distance);
    const keepConnections = connectionDistances.slice(0, maxConnections);
    
    // Update connections
    const newConnections = new Set(keepConnections.map(item => item.id));
    this.layers.get(layer).set(nodeId, newConnections);
    
    // Remove reverse connections for pruned nodes
    const prunedConnections = connectionDistances.slice(maxConnections);
    for (const pruned of prunedConnections) {
      const prunedConnections = this.layers.get(layer)?.get(pruned.id);
      if (prunedConnections) {
        prunedConnections.delete(nodeId);
      }
    }
  }

  /**
   * Generate level for new node using exponential distribution
   */
  generateLevel() {
    let level = 0;
    while (Math.random() < 0.5 && level < 16) { // Cap at 16 levels
      level++;
    }
    return level;
  }

  /**
   * Calculate distance between vectors
   */
  calculateDistance(vectorA, vectorB) {
    switch (this.distanceFunction) {
      case 'cosine':
        return 1 - this.similarity.cosineSimilarity(vectorA, vectorB);
      case 'euclidean':
        return this.similarity.euclideanDistance(vectorA, vectorB);
      case 'dot':
        return -this.similarity.dotProduct(vectorA, vectorB);
      default:
        return 1 - this.similarity.cosineSimilarity(vectorA, vectorB);
    }
  }

  /**
   * Remove a node from the index
   */
  remove(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    
    // Remove all connections to this node
    for (let layer = 0; layer <= node.level; layer++) {
      const connections = this.layers.get(layer)?.get(nodeId) || new Set();
      
      // Remove reverse connections
      for (const connectedId of connections) {
        const connectedConnections = this.layers.get(layer)?.get(connectedId);
        if (connectedConnections) {
          connectedConnections.delete(nodeId);
        }
      }
      
      // Remove node from layer
      this.layers.get(layer)?.delete(nodeId);
    }
    
    // Remove node
    this.nodes.delete(nodeId);
    this.nodeCount--;
    
    // Update entry point if necessary
    if (this.entryPoint && this.entryPoint.id === nodeId) {
      this.findNewEntryPoint();
    }
    
    return true;
  }

  /**
   * Find new entry point when current one is removed
   */
  findNewEntryPoint() {
    let newEntryPoint = null;
    let maxLevel = -1;
    
    for (const [nodeId, node] of this.nodes) {
      if (node.level > maxLevel) {
        maxLevel = node.level;
        newEntryPoint = { id: nodeId, level: node.level };
      }
    }
    
    this.entryPoint = newEntryPoint;
  }

  /**
   * Get index statistics
   */
  getStats() {
    const layerCounts = {};
    for (const [level, count] of this.stats.layerDistribution) {
      layerCounts[level] = count;
    }
    
    return {
      nodeCount: this.nodeCount,
      layerCount: this.layers.size,
      entryPointLevel: this.entryPoint?.level || 0,
      parameters: {
        M: this.M,
        maxM0: this.maxM0,
        efConstruction: this.efConstruction,
        efSearch: this.efSearch,
        distanceFunction: this.distanceFunction
      },
      performance: {
        searchCount: this.stats.searchCount,
        insertCount: this.stats.insertCount,
        avgSearchTime: this.stats.avgSearchTime
      },
      layerDistribution: layerCounts
    };
  }

  /**
   * Clear the entire index
   */
  clear() {
    this.layers.clear();
    this.nodes.clear();
    this.entryPoint = null;
    this.nodeCount = 0;
    this.stats = {
      searchCount: 0,
      insertCount: 0,
      totalSearchTime: 0,
      avgSearchTime: 0,
      layerDistribution: new Map()
    };
  }
}

module.exports = HNSWIndex;
