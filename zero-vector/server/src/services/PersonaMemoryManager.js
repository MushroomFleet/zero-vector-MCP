const { v4: uuidv4 } = require('uuid');
const { logger, logError } = require('../utils/logger');

/**
 * Persona Memory Manager
 * Handles AI persona memory storage, retrieval, and lifecycle management
 */
class PersonaMemoryManager {
  constructor(database, vectorStore, embeddingService) {
    this.database = database;
    this.vectorStore = vectorStore;
    this.embeddingService = embeddingService;
    this.memoryTypes = {
      CONVERSATION: 'conversation',
      FACT: 'fact',
      PREFERENCE: 'preference',
      CONTEXT: 'context',
      SYSTEM: 'system'
    };
  }

  /**
   * Create a new AI persona
   */
  async createPersona(userId, personaData) {
    try {
      const personaId = uuidv4();
      
      // Validate numeric inputs
      const maxMemorySize = typeof personaData.maxMemorySize === 'number' ? personaData.maxMemorySize : 1000;
      const memoryDecayTime = typeof personaData.memoryDecayTime === 'number' ? personaData.memoryDecayTime : (7 * 24 * 60 * 60 * 1000);
      const temperature = typeof personaData.temperature === 'number' ? personaData.temperature : 0.7;
      const maxTokens = typeof personaData.maxTokens === 'number' ? personaData.maxTokens : 2048;
      const memoryRetrievalThreshold = typeof personaData.memoryRetrievalThreshold === 'number' ? personaData.memoryRetrievalThreshold : 0.7;

      const persona = {
        id: personaId,
        userId: userId,
        name: personaData.name,
        description: personaData.description || '',
        systemPrompt: personaData.systemPrompt || '',
        config: {
          temperature: temperature,
          maxTokens: maxTokens,
          embeddingProvider: personaData.embeddingProvider || 'local',
          embeddingModel: personaData.embeddingModel || 'all-MiniLM-L6-v2',
          memoryRetrievalThreshold: memoryRetrievalThreshold,
          ...personaData.config
        },
        maxMemorySize: maxMemorySize,
        memoryDecayTime: memoryDecayTime,
        isActive: true
      };

      // Insert persona into database
      await this.database.insertPersona(persona);

      // Log persona creation (temporarily disabled to fix timestamp issue)
      // await this.database.insertAuditLog({
      //   id: uuidv4(),
      //   userId: userId,
      //   action: 'CREATE_PERSONA',
      //   resourceType: 'persona',
      //   resourceId: personaId,
      //   details: {
      //     name: persona.name,
      //     maxMemorySize: persona.maxMemorySize,
      //     memoryDecayTime: persona.memoryDecayTime
      //   }
      // });

      logger.info('Persona created successfully', {
        personaId,
        userId,
        name: persona.name,
        maxMemorySize: persona.maxMemorySize
      });

      return persona;

    } catch (error) {
      logError(error, {
        operation: 'createPersona',
        userId,
        personaData: { name: personaData.name }
      });
      throw error;
    }
  }

  /**
   * Get persona by ID
   */
  async getPersona(personaId, userId = null) {
    try {
      const persona = await this.database.getPersonaById(personaId);
      
      if (!persona) {
        throw new Error('Persona not found');
      }

      // Verify ownership if userId provided
      if (userId && persona.user_id !== userId) {
        throw new Error('Access denied: Persona does not belong to user');
      }

      return this.formatPersonaResponse(persona);

    } catch (error) {
      logError(error, {
        operation: 'getPersona',
        personaId,
        userId
      });
      throw error;
    }
  }

  /**
   * List user personas
   */
  async listPersonas(userId, includeInactive = false) {
    try {
      const personas = await this.database.listPersonas(userId, includeInactive);
      
      const formattedPersonas = await Promise.all(
        personas.map(async (persona) => {
          const stats = await this.getPersonaMemoryStats(persona.id);
          return {
            ...this.formatPersonaResponse(persona),
            memoryStats: stats
          };
        })
      );

      return formattedPersonas;

    } catch (error) {
      logError(error, {
        operation: 'listPersonas',
        userId
      });
      throw error;
    }
  }

  /**
   * Update persona
   */
  async updatePersona(personaId, userId, updates) {
    try {
      // Verify ownership
      const existingPersona = await this.getPersona(personaId, userId);
      
      const allowedUpdates = {
        name: updates.name,
        description: updates.description,
        systemPrompt: updates.systemPrompt,
        maxMemorySize: updates.maxMemorySize,
        memoryDecayTime: updates.memoryDecayTime,
        isActive: updates.isActive
      };

      // Handle config updates
      if (updates.config) {
        allowedUpdates.config = {
          ...existingPersona.config,
          ...updates.config
        };
      }

      // Remove undefined values
      Object.keys(allowedUpdates).forEach(key => {
        if (allowedUpdates[key] === undefined) {
          delete allowedUpdates[key];
        }
      });

      // Update in database
      await this.database.updatePersona(personaId, allowedUpdates);

      // Log update
      await this.database.insertAuditLog({
        id: uuidv4(),
        userId: userId,
        action: 'UPDATE_PERSONA',
        resourceType: 'persona',
        resourceId: personaId,
        details: allowedUpdates
      });

      logger.info('Persona updated successfully', {
        personaId,
        userId,
        updates: Object.keys(allowedUpdates)
      });

      return await this.getPersona(personaId, userId);

    } catch (error) {
      logError(error, {
        operation: 'updatePersona',
        personaId,
        userId
      });
      throw error;
    }
  }

  /**
   * Delete persona
   */
  async deletePersona(personaId, userId) {
    try {
      // Verify ownership
      await this.getPersona(personaId, userId);

      // Soft delete persona
      await this.database.deletePersona(personaId);

      // Clean up all memories for this persona
      await this.cleanupPersonaMemories(personaId);

      // Log deletion
      await this.database.insertAuditLog({
        id: uuidv4(),
        userId: userId,
        action: 'DELETE_PERSONA',
        resourceType: 'persona',
        resourceId: personaId,
        details: { action: 'soft_delete' }
      });

      logger.info('Persona deleted successfully', { personaId, userId });

    } catch (error) {
      logError(error, {
        operation: 'deletePersona',
        personaId,
        userId
      });
      throw error;
    }
  }

  /**
   * Add memory to persona
   */
  async addMemory(personaId, content, context = {}) {
    try {
      const persona = await this.database.getPersonaById(personaId);
      if (!persona) {
        throw new Error('Persona not found');
      }

      // Generate embedding for the content
      const embeddingResult = await this.embeddingService.generateEmbedding(content, {
        provider: persona.config.embeddingProvider || 'local',
        model: persona.config.embeddingModel,
        useCache: true
      });

      // Create memory metadata
      const memoryId = uuidv4();
      const timestamp = Date.now();
      const memoryMetadata = {
        personaId: personaId,
        originalContent: content,
        memoryType: context.type || this.memoryTypes.CONVERSATION,
        importance: typeof context.importance === 'number' ? context.importance : 0.5,
        conversationId: context.conversationId || null,
        speaker: context.speaker || null,
        timestamp: timestamp,
        embeddingProvider: embeddingResult.provider,
        embeddingModel: embeddingResult.model,
        context: context
      };

      // Store vector in vector store
      const storeResult = await this.vectorStore.addVector(
        embeddingResult.vector,
        memoryId,
        memoryMetadata
      );

      // Store metadata in database
      await this.database.insertVectorMetadata({
        id: memoryId,
        dimensions: embeddingResult.vector.length,
        personaId: personaId,
        contentType: 'persona_memory',
        source: 'memory_manager',
        tags: [context.type || this.memoryTypes.CONVERSATION],
        customMetadata: memoryMetadata
      });

      // Check memory limits and cleanup if necessary
      await this.enforceMemoryLimits(personaId);

      logger.info('Memory added to persona', {
        personaId,
        memoryId,
        memoryType: memoryMetadata.memoryType,
        contentLength: content.length
      });

      return {
        id: memoryId,
        content: content,
        type: memoryMetadata.memoryType,
        timestamp: memoryMetadata.timestamp,
        slotIndex: storeResult.slotIndex
      };

    } catch (error) {
      logError(error, {
        operation: 'addMemory',
        personaId,
        contentLength: content?.length
      });
      throw error;
    }
  }

  /**
   * Retrieve relevant memories for a query
   */
  async retrieveRelevantMemories(personaId, query, options = {}) {
    try {
      const {
        limit = 5,
        threshold = 0.7,
        memoryTypes = null,
        maxAge = null,
        includeContext = true
      } = options;

      const persona = await this.database.getPersonaById(personaId);
      if (!persona) {
        throw new Error('Persona not found');
      }

      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(query, {
        provider: persona.config.embeddingProvider || 'local',
        model: persona.config.embeddingModel,
        useCache: true
      });

      // Search for similar memories
      const searchResults = await this.vectorStore.search(queryEmbedding.vector, {
        limit: limit * 2, // Get more to filter
        threshold: threshold,
        metric: 'cosine',
        filters: { personaId: personaId },
        includeValues: false,
        includeMetadata: true,
        useIndex: true
      });

      // Filter and enrich results
      let filteredResults = searchResults;

      // Filter by memory types if specified
      if (memoryTypes && Array.isArray(memoryTypes)) {
        filteredResults = filteredResults.filter(result => 
          memoryTypes.includes(result.metadata.memoryType)
        );
      }

      // Filter by age if specified
      if (maxAge) {
        const cutoffTime = Date.now() - maxAge;
        filteredResults = filteredResults.filter(result => 
          result.metadata.timestamp >= cutoffTime
        );
      }

      // Sort by relevance and recency
      filteredResults.sort((a, b) => {
        const scoreA = a.similarity + (a.metadata.importance || 0.5) * 0.1;
        const scoreB = b.similarity + (b.metadata.importance || 0.5) * 0.1;
        return scoreB - scoreA;
      });

      // Limit final results
      filteredResults = filteredResults.slice(0, limit);

      // Enrich with database metadata if needed
      if (includeContext) {
        for (const result of filteredResults) {
          try {
            const dbMetadata = await this.database.getVectorMetadata(result.id);
            if (dbMetadata) {
              result.metadata = { ...result.metadata, ...dbMetadata.customMetadata };
            }
          } catch (error) {
            logger.warn('Failed to fetch metadata for memory', {
              memoryId: result.id,
              error: error.message
            });
          }
        }
      }

      logger.info('Retrieved relevant memories', {
        personaId,
        query: query.substring(0, 100),
        resultCount: filteredResults.length,
        avgSimilarity: filteredResults.length > 0 
          ? (filteredResults.reduce((sum, r) => sum + r.similarity, 0) / filteredResults.length).toFixed(3)
          : 0
      });

      return filteredResults;

    } catch (error) {
      logError(error, {
        operation: 'retrieveRelevantMemories',
        personaId,
        query: query?.substring(0, 100)
      });
      throw error;
    }
  }

  /**
   * Add conversation exchange to memory
   */
  async addConversationExchange(personaId, userMessage, assistantResponse, conversationId = null) {
    try {
      const convId = conversationId || uuidv4();
      const timestamp = Date.now();

      // Add user message memory
      const userMemory = await this.addMemory(personaId, userMessage, {
        type: this.memoryTypes.CONVERSATION,
        conversationId: convId,
        speaker: 'user',
        importance: 0.6,
        exchange_type: 'user_input'
      });

      // Add assistant response memory
      const assistantMemory = await this.addMemory(personaId, assistantResponse, {
        type: this.memoryTypes.CONVERSATION,
        conversationId: convId,
        speaker: 'assistant',
        importance: 0.5,
        exchange_type: 'assistant_response'
      });

      logger.info('Conversation exchange added to memory', {
        personaId,
        conversationId: convId,
        userMessageLength: userMessage.length,
        assistantResponseLength: assistantResponse.length
      });

      return {
        conversationId: convId,
        userMemory,
        assistantMemory,
        timestamp
      };

    } catch (error) {
      logError(error, {
        operation: 'addConversationExchange',
        personaId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(personaId, conversationId, limit = 20) {
    try {
      // Search for memories with the specific conversation ID
      const memories = await this.database.searchVectorMetadata({
        personaId: personaId,
        limit: limit * 2 // Get more to sort properly
      });

      // Filter by conversation ID and sort by timestamp with null checks
      const conversationMemories = memories
        .filter(memory => {
          const customMeta = memory.customMetadata || {};
          return customMeta.conversationId === conversationId &&
                 customMeta.memoryType === this.memoryTypes.CONVERSATION;
        })
        .sort((a, b) => {
          const timestampA = (a.customMetadata || {}).timestamp || 0;
          const timestampB = (b.customMetadata || {}).timestamp || 0;
          return timestampA - timestampB;
        })
        .slice(0, limit);

      logger.info('Retrieved conversation history', {
        personaId,
        conversationId,
        memoryCount: conversationMemories.length
      });

      return conversationMemories.map(memory => {
        const customMeta = memory.customMetadata || {};
        return {
          id: memory.id,
          content: customMeta.originalContent || '',
          speaker: customMeta.speaker || 'unknown',
          timestamp: customMeta.timestamp || 0,
          type: customMeta.exchange_type || 'unknown'
        };
      });

    } catch (error) {
      logError(error, {
        operation: 'getConversationHistory',
        personaId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Get persona memory statistics
   */
  async getPersonaMemoryStats(personaId) {
    try {
      const memories = await this.database.searchVectorMetadata({
        personaId: personaId,
        limit: 10000 // Get all for counting
      });

      const stats = {
        totalMemories: memories.length,
        memoryTypeBreakdown: {},
        oldestMemory: null,
        newestMemory: null,
        averageImportance: 0,
        conversationCount: 0
      };

      if (memories.length > 0) {
        // Calculate type breakdown with null checks
        memories.forEach(memory => {
          const customMeta = memory.customMetadata || {};
          const type = customMeta.memoryType || 'unknown';
          stats.memoryTypeBreakdown[type] = (stats.memoryTypeBreakdown[type] || 0) + 1;
        });

        // Find oldest and newest with proper null handling
        const validTimestamps = memories
          .map(m => (m.customMetadata || {}).timestamp)
          .filter(timestamp => timestamp && typeof timestamp === 'number');
        
        if (validTimestamps.length > 0) {
          stats.oldestMemory = Math.min(...validTimestamps);
          stats.newestMemory = Math.max(...validTimestamps);
        }

        // Calculate average importance with null checks
        const importanceSum = memories.reduce(
          (sum, memory) => {
            const customMeta = memory.customMetadata || {};
            const importance = customMeta.importance;
            return sum + (typeof importance === 'number' ? importance : 0.5);
          }, 
          0
        );
        stats.averageImportance = importanceSum / memories.length;

        // Count unique conversations with null checks
        const conversationIds = new Set(
          memories
            .map(m => (m.customMetadata || {}).conversationId)
            .filter(id => id && typeof id === 'string')
        );
        stats.conversationCount = conversationIds.size;
      }

      return stats;

    } catch (error) {
      logError(error, {
        operation: 'getPersonaMemoryStats',
        personaId
      });
      return {
        totalMemories: 0,
        memoryTypeBreakdown: {},
        oldestMemory: null,
        newestMemory: null,
        averageImportance: 0,
        conversationCount: 0
      };
    }
  }

  /**
   * Enforce memory limits for a persona
   */
  async enforceMemoryLimits(personaId) {
    try {
      const persona = await this.database.getPersonaById(personaId);
      if (!persona) return;

      const memories = await this.database.searchVectorMetadata({
        personaId: personaId,
        limit: 10000
      });

      if (memories.length <= persona.max_memory_size) return;

      // Sort by importance and age (keep important and recent) with null checks
      memories.sort((a, b) => {
        const customMetaA = a.customMetadata || {};
        const customMetaB = b.customMetadata || {};
        
        const importanceA = typeof customMetaA.importance === 'number' ? customMetaA.importance : 0.5;
        const importanceB = typeof customMetaB.importance === 'number' ? customMetaB.importance : 0.5;
        
        const timestampA = typeof customMetaA.timestamp === 'number' ? customMetaA.timestamp : Date.now();
        const timestampB = typeof customMetaB.timestamp === 'number' ? customMetaB.timestamp : Date.now();
        
        const scoreA = importanceA + (1 - (Date.now() - timestampA) / (30 * 24 * 60 * 60 * 1000)) * 0.3;
        const scoreB = importanceB + (1 - (Date.now() - timestampB) / (30 * 24 * 60 * 60 * 1000)) * 0.3;
        
        return scoreB - scoreA;
      });

      // Remove oldest/least important memories
      const memoriesToRemove = memories.slice(persona.max_memory_size);
      
      for (const memory of memoriesToRemove) {
        await this.removeMemory(memory.id);
      }

      logger.info('Memory limits enforced', {
        personaId,
        totalMemories: memories.length,
        removedCount: memoriesToRemove.length,
        remainingCount: persona.max_memory_size
      });

    } catch (error) {
      logError(error, {
        operation: 'enforceMemoryLimits',
        personaId
      });
    }
  }

  /**
   * Cleanup expired memories
   */
  async cleanupExpiredMemories() {
    try {
      let totalCleaned = 0;
      
      // Get all active personas
      const allUsers = await this.database.getStats();
      
      // For each user, get their personas and clean up expired memories
      // This is a simplified approach - in production you'd want to batch this
      const personas = await this.database.searchVectorMetadata({ limit: 10000 });
      const personaIds = [...new Set(personas.map(m => m.persona_id).filter(Boolean))];

      for (const personaId of personaIds) {
        try {
          const persona = await this.database.getPersonaById(personaId);
          if (!persona) continue;

          const expiredTime = Date.now() - persona.memory_decay_time;
          const memories = await this.database.searchVectorMetadata({
            personaId: personaId,
            limit: 10000
          });

          const expiredMemories = memories.filter(
            memory => {
              const customMeta = memory.customMetadata || {};
              const timestamp = customMeta.timestamp;
              return typeof timestamp === 'number' && timestamp < expiredTime;
            }
          );

          for (const memory of expiredMemories) {
            await this.removeMemory(memory.id);
            totalCleaned++;
          }

        } catch (error) {
          logger.warn('Failed to cleanup memories for persona', {
            personaId,
            error: error.message
          });
        }
      }

      logger.info('Memory cleanup completed', {
        totalCleaned,
        processedPersonas: personaIds.length
      });

      return { totalCleaned };

    } catch (error) {
      logError(error, {
        operation: 'cleanupExpiredMemories'
      });
      throw error;
    }
  }

  /**
   * Remove a specific memory
   */
  async removeMemory(memoryId) {
    try {
      // Remove from vector store
      await this.vectorStore.deleteVector(memoryId);

      // Remove metadata from database
      await this.database.deleteVectorMetadata(memoryId);

      logger.debug('Memory removed', { memoryId });

    } catch (error) {
      logError(error, {
        operation: 'removeMemory',
        memoryId
      });
      throw error;
    }
  }

  /**
   * Clean up all memories for a persona
   */
  async cleanupPersonaMemories(personaId) {
    try {
      const memories = await this.database.searchVectorMetadata({
        personaId: personaId,
        limit: 10000
      });

      for (const memory of memories) {
        await this.removeMemory(memory.id);
      }

      logger.info('Persona memories cleaned up', {
        personaId,
        removedCount: memories.length
      });

    } catch (error) {
      logError(error, {
        operation: 'cleanupPersonaMemories',
        personaId
      });
    }
  }

  /**
   * Format persona response
   */
  formatPersonaResponse(persona) {
    // Safely handle timestamps - ensure they are valid numbers
    const createdAt = this.safeTimestamp(persona.created_at);
    const updatedAt = this.safeTimestamp(persona.updated_at);

    return {
      id: persona.id,
      userId: persona.user_id,
      name: persona.name,
      description: persona.description,
      systemPrompt: persona.system_prompt,
      config: persona.config,
      maxMemorySize: persona.max_memory_size,
      memoryDecayTime: persona.memory_decay_time,
      createdAt: createdAt,
      updatedAt: updatedAt,
      isActive: Boolean(persona.is_active)
    };
  }

  /**
   * Safely handle timestamp values to prevent Invalid Date errors
   */
  safeTimestamp(timestamp) {
    // Handle null, undefined, or empty values
    if (!timestamp && timestamp !== 0) {
      return Date.now();
    }
    
    // Convert string timestamps to numbers
    let numericTimestamp;
    if (typeof timestamp === 'string') {
      numericTimestamp = parseInt(timestamp, 10);
      if (isNaN(numericTimestamp)) {
        return Date.now();
      }
    } else if (typeof timestamp === 'number') {
      numericTimestamp = timestamp;
    } else {
      return Date.now();
    }
    
    // Check if it's a valid timestamp range
    if (numericTimestamp < 0 || numericTimestamp > Date.now() + (365 * 24 * 60 * 60 * 1000)) {
      return Date.now();
    }
    
    // Test that it creates a valid Date object
    try {
      const date = new Date(numericTimestamp);
      if (isNaN(date.getTime())) {
        return Date.now();
      }
      return numericTimestamp;
    } catch (error) {
      return Date.now();
    }
  }
}

module.exports = PersonaMemoryManager;
