const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');
const PersonaMemoryManager = require('../services/PersonaMemoryManager');
const EmbeddingService = require('../services/embedding/EmbeddingService');
const LocalTransformersProvider = require('../services/embedding/LocalTransformersProvider');
const OpenAIProvider = require('../services/embedding/OpenAIProvider');

const router = express.Router();

// Initialize services for personas (will be injected via middleware)
let personaMemoryManager = null;

// Middleware to initialize persona memory manager
const initializePersonaServices = (req, res, next) => {
  if (!personaMemoryManager) {
    // Initialize embedding service
    const embeddingService = new EmbeddingService();
    
    // Register local provider (always available as fallback)
    const localProvider = new LocalTransformersProvider();
    embeddingService.registerProvider('local', localProvider);
    
    // Register OpenAI provider if configured
    const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'local';
    if (embeddingProvider === 'openai' && process.env.OPENAI_API_KEY) {
      try {
        const openaiProvider = new OpenAIProvider({
          model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
        });
        embeddingService.registerProvider('openai', openaiProvider);
        embeddingService.setDefaultProvider('openai');
        logger.info('OpenAI embedding provider initialized and set as default');
      } catch (error) {
        logger.warn('Failed to initialize OpenAI provider, falling back to local', { error: error.message });
        embeddingService.setDefaultProvider('local');
      }
    } else {
      embeddingService.setDefaultProvider('local');
      if (embeddingProvider === 'openai') {
        logger.warn('OpenAI provider requested but no API key found, using local provider');
      }
    }

    // Initialize persona memory manager
    personaMemoryManager = new PersonaMemoryManager(
      req.database,
      req.vectorStore,
      embeddingService
    );
  }

  req.personaMemoryManager = personaMemoryManager;
  next();
};

// Apply persona services middleware to all routes
router.use(initializePersonaServices);

/**
 * Create a new persona
 * POST /api/personas
 */
router.post('/', asyncHandler(async (req, res) => {
  const {
    name,
    description,
    systemPrompt,
    config = {},
    maxMemorySize = 1000,
    memoryDecayTime = 7 * 24 * 60 * 60 * 1000, // 7 days
    temperature = 0.7,
    maxTokens = 2048,
    embeddingProvider = 'local',
    embeddingModel = 'all-MiniLM-L6-v2'
  } = req.body;

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Name is required and must be a non-empty string');
  }

  if (name.length > 100) {
    throw new ValidationError('Name cannot exceed 100 characters');
  }

  if (description && description.length > 500) {
    throw new ValidationError('Description cannot exceed 500 characters');
  }

  if (systemPrompt && systemPrompt.length > 2000) {
    throw new ValidationError('System prompt cannot exceed 2000 characters');
  }

  if (maxMemorySize < 10 || maxMemorySize > 10000) {
    throw new ValidationError('Max memory size must be between 10 and 10,000');
  }

  if (memoryDecayTime < 60000 || memoryDecayTime > 365 * 24 * 60 * 60 * 1000) { // 1 minute to 1 year
    throw new ValidationError('Memory decay time must be between 1 minute and 1 year');
  }

  try {
    const personaData = {
      name: name.trim(),
      description: description?.trim(),
      systemPrompt: systemPrompt?.trim(),
      config: {
        ...config,
        temperature,
        maxTokens,
        embeddingProvider,
        embeddingModel
      },
      maxMemorySize,
      memoryDecayTime
    };

    const persona = await req.personaMemoryManager.createPersona(req.user.id, personaData);

    logger.info('Persona created via API', {
      personaId: persona.id,
      userId: req.user.id,
      name: persona.name
    });

    res.status(201).json({
      status: 'success',
      data: persona,
      message: 'Persona created successfully'
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * List user personas
 * GET /api/personas
 */
router.get('/', asyncHandler(async (req, res) => {
  const { include_inactive = false } = req.query;

  try {
    const personas = await req.personaMemoryManager.listPersonas(
      req.user.id,
      include_inactive === 'true'
    );

    res.json({
      status: 'success',
      data: {
        personas: personas,
        count: personas.length
      }
    });

  } catch (error) {
    throw error;
  }
}));

/**
 * Get specific persona
 * GET /api/personas/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { include_stats = true } = req.query;

  try {
    const persona = await req.personaMemoryManager.getPersona(id, req.user.id);

    let responseData = persona;

    if (include_stats === 'true') {
      const memoryStats = await req.personaMemoryManager.getPersonaMemoryStats(id);
      responseData = {
        ...persona,
        memoryStats
      };
    }

    res.json({
      status: 'success',
      data: responseData
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Update persona
 * PUT /api/personas/:id
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Validate update fields
  if (updates.name !== undefined) {
    if (!updates.name || typeof updates.name !== 'string' || updates.name.trim().length === 0) {
      throw new ValidationError('Name must be a non-empty string');
    }
    if (updates.name.length > 100) {
      throw new ValidationError('Name cannot exceed 100 characters');
    }
  }

  if (updates.description !== undefined && updates.description.length > 500) {
    throw new ValidationError('Description cannot exceed 500 characters');
  }

  if (updates.systemPrompt !== undefined && updates.systemPrompt.length > 2000) {
    throw new ValidationError('System prompt cannot exceed 2000 characters');
  }

  if (updates.maxMemorySize !== undefined) {
    if (updates.maxMemorySize < 10 || updates.maxMemorySize > 10000) {
      throw new ValidationError('Max memory size must be between 10 and 10,000');
    }
  }

  try {
    const updatedPersona = await req.personaMemoryManager.updatePersona(id, req.user.id, updates);

    logger.info('Persona updated via API', {
      personaId: id,
      userId: req.user.id,
      updates: Object.keys(updates)
    });

    res.json({
      status: 'success',
      data: updatedPersona,
      message: 'Persona updated successfully'
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Delete persona
 * DELETE /api/personas/:id
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    await req.personaMemoryManager.deletePersona(id, req.user.id);

    logger.info('Persona deleted via API', {
      personaId: id,
      userId: req.user.id
    });

    res.json({
      status: 'success',
      message: 'Persona deleted successfully'
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Add memory to persona
 * POST /api/personas/:id/memories
 */
router.post('/:id/memories', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    content,
    type = 'conversation',
    importance = 0.5,
    conversationId,
    speaker,
    context = {}
  } = req.body;

  // Validate input
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new ValidationError('Content is required and must be a non-empty string');
  }

  if (content.length > 10000) {
    throw new ValidationError('Content cannot exceed 10,000 characters');
  }

  if (importance < 0 || importance > 1) {
    throw new ValidationError('Importance must be between 0 and 1');
  }

  const validTypes = ['conversation', 'fact', 'preference', 'context', 'system'];
  if (!validTypes.includes(type)) {
    throw new ValidationError(`Type must be one of: ${validTypes.join(', ')}`);
  }

  try {
    // Verify persona ownership
    await req.personaMemoryManager.getPersona(id, req.user.id);

    const memoryContext = {
      ...context,
      type,
      importance,
      conversationId,
      speaker
    };

    const memory = await req.personaMemoryManager.addMemory(id, content.trim(), memoryContext);

    logger.info('Memory added to persona via API', {
      personaId: id,
      memoryId: memory.id,
      userId: req.user.id,
      type,
      contentLength: content.length
    });

    res.status(201).json({
      status: 'success',
      data: memory,
      message: 'Memory added successfully'
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Search persona memories
 * POST /api/personas/:id/memories/search
 */
router.post('/:id/memories/search', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    query,
    limit = 5,
    threshold = 0.7,
    memoryTypes,
    maxAge,
    includeContext = true
  } = req.body;

  // Validate input
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new ValidationError('Query is required and must be a non-empty string');
  }

  if (limit < 1 || limit > 50) {
    throw new ValidationError('Limit must be between 1 and 50');
  }

  if (threshold < 0 || threshold > 1) {
    throw new ValidationError('Threshold must be between 0 and 1');
  }

  try {
    // Verify persona ownership
    await req.personaMemoryManager.getPersona(id, req.user.id);

    const searchOptions = {
      limit: parseInt(limit),
      threshold: parseFloat(threshold),
      memoryTypes,
      maxAge,
      includeContext: includeContext === true || includeContext === 'true'
    };

    logger.info('About to call retrieveRelevantMemories from API route', {
      personaId: id,
      query: query.trim().substring(0, 50),
      searchOptions
    });

    const memories = await req.personaMemoryManager.retrieveRelevantMemories(
      id,
      query.trim(),
      searchOptions
    );

    logger.info('retrieveRelevantMemories returned from API route', {
      personaId: id,
      resultCount: memories.length,
      sampleMemory: memories.length > 0 ? {
        id: memories[0].id,
        hasMetadata: !!memories[0].metadata,
        metadataKeys: memories[0].metadata ? Object.keys(memories[0].metadata) : [],
        hasOriginalContent: !!(memories[0].metadata && memories[0].metadata.originalContent)
      } : null
    });

    logger.info('Persona memory search completed via API', {
      personaId: id,
      userId: req.user.id,
      query: query.substring(0, 100),
      resultCount: memories.length
    });

    res.json({
      status: 'success',
      data: {
        query: query.trim(),
        memories: memories,
        options: searchOptions,
        meta: {
          count: memories.length,
          avgSimilarity: memories.length > 0 
            ? (memories.reduce((sum, m) => sum + m.similarity, 0) / memories.length).toFixed(3)
            : 0
        }
      }
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Add conversation exchange
 * POST /api/personas/:id/conversations
 */
router.post('/:id/conversations', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    userMessage,
    assistantResponse,
    conversationId
  } = req.body;

  // Validate input
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    throw new ValidationError('User message is required and must be a non-empty string');
  }

  if (!assistantResponse || typeof assistantResponse !== 'string' || assistantResponse.trim().length === 0) {
    throw new ValidationError('Assistant response is required and must be a non-empty string');
  }

  if (userMessage.length > 10000) {
    throw new ValidationError('User message cannot exceed 10,000 characters');
  }

  if (assistantResponse.length > 10000) {
    throw new ValidationError('Assistant response cannot exceed 10,000 characters');
  }

  try {
    // Verify persona ownership
    await req.personaMemoryManager.getPersona(id, req.user.id);

    const exchange = await req.personaMemoryManager.addConversationExchange(
      id,
      userMessage.trim(),
      assistantResponse.trim(),
      conversationId
    );

    logger.info('Conversation exchange added via API', {
      personaId: id,
      conversationId: exchange.conversationId,
      userId: req.user.id,
      userMessageLength: userMessage.length,
      assistantResponseLength: assistantResponse.length
    });

    res.status(201).json({
      status: 'success',
      data: exchange,
      message: 'Conversation exchange added successfully'
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Get conversation history
 * GET /api/personas/:id/conversations/:conversationId
 */
router.get('/:id/conversations/:conversationId', asyncHandler(async (req, res) => {
  const { id, conversationId } = req.params;
  const { limit = 20 } = req.query;

  try {
    // Verify persona ownership
    await req.personaMemoryManager.getPersona(id, req.user.id);

    const history = await req.personaMemoryManager.getConversationHistory(
      id,
      conversationId,
      parseInt(limit)
    );

    res.json({
      status: 'success',
      data: {
        conversationId,
        history,
        count: history.length
      }
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Get persona memory statistics
 * GET /api/personas/:id/stats
 */
router.get('/:id/stats', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    // Verify persona ownership
    await req.personaMemoryManager.getPersona(id, req.user.id);

    const stats = await req.personaMemoryManager.getPersonaMemoryStats(id);

    res.json({
      status: 'success',
      data: stats
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Cleanup expired memories for a persona
 * POST /api/personas/:id/cleanup
 */
router.post('/:id/cleanup', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    // Verify persona ownership
    await req.personaMemoryManager.getPersona(id, req.user.id);

    // Enforce memory limits (which includes cleanup)
    await req.personaMemoryManager.enforceMemoryLimits(id);

    logger.info('Persona memory cleanup triggered via API', {
      personaId: id,
      userId: req.user.id
    });

    res.json({
      status: 'success',
      message: 'Memory cleanup completed'
    });

  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Access denied')) {
      res.status(404).json({
        status: 'error',
        error: 'Persona not found'
      });
      return;
    }
    throw error;
  }
}));

/**
 * Global memory cleanup (admin only)
 * POST /api/personas/_cleanup
 */
router.post('/_cleanup', asyncHandler(async (req, res) => {
  // Check if user has admin permissions
  if (!req.user.permissions.includes('admin')) {
    res.status(403).json({
      status: 'error',
      error: 'Admin access required'
    });
    return;
  }

  try {
    const result = await req.personaMemoryManager.cleanupExpiredMemories();

    logger.info('Global memory cleanup completed via API', {
      userId: req.user.id,
      totalCleaned: result.totalCleaned
    });

    res.json({
      status: 'success',
      data: result,
      message: 'Global memory cleanup completed'
    });

  } catch (error) {
    throw error;
  }
}));

module.exports = router;
