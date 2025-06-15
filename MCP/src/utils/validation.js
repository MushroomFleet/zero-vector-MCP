/**
 * Input validation schemas for Zero-Vector MCP tools
 * Simplified validation for persona, memory, and utility operations
 */

import joi from 'joi';

// Common validation patterns
const patterns = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
};

// Persona operation schemas
export const personaSchemas = {
  createPersona: joi.object({
    name: joi.string().min(1).max(100).required(),
    description: joi.string().max(500).optional(),
    systemPrompt: joi.string().max(5000).optional(),
    temperature: joi.number().min(0).max(2).default(0.7),
    maxTokens: joi.number().integer().min(1).max(8192).default(2048),
    embeddingProvider: joi.string().valid('openai', 'local').default('local'),
    embeddingModel: joi.string().max(100).optional(),
    maxMemorySize: joi.number().integer().min(1).max(10000).default(1000),
    memoryDecayTime: joi.number().integer().min(3600000).default(604800000) // 1 hour to 7 days in ms
  }),

  listPersonas: joi.object({
    limit: joi.number().integer().min(1).max(100).default(50),
    offset: joi.number().integer().min(0).default(0),
    include_stats: joi.boolean().default(false)
  }),

  getPersona: joi.object({
    id: joi.string().pattern(patterns.uuid).required(),
    include_stats: joi.boolean().default(true)
  }),

  updatePersona: joi.object({
    id: joi.string().pattern(patterns.uuid).required(),
    name: joi.string().min(1).max(100).optional(),
    description: joi.string().max(500).optional(),
    systemPrompt: joi.string().max(5000).optional(),
    temperature: joi.number().min(0).max(2).optional(),
    maxTokens: joi.number().integer().min(1).max(8192).optional(),
    maxMemorySize: joi.number().integer().min(1).max(10000).optional(),
    memoryDecayTime: joi.number().integer().min(3600000).optional(),
    isActive: joi.boolean().optional()
  }),

  deletePersona: joi.object({
    id: joi.string().pattern(patterns.uuid).required()
  })
};

// Memory operation schemas
export const memorySchemas = {
  addMemory: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    content: joi.string().min(1).max(10000).required(),
    type: joi.string().valid('conversation', 'fact', 'preference', 'context', 'system').default('conversation'),
    importance: joi.number().min(0).max(1).default(0.5),
    context: joi.object().optional()
  }),

  searchPersonaMemories: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    query: joi.string().min(1).max(1000).required(),
    limit: joi.number().integer().min(1).max(100).default(10),
    threshold: joi.number().min(0).max(1).default(0.3),
    memoryTypes: joi.array().items(
      joi.string().valid('conversation', 'fact', 'preference', 'context', 'system')
    ).optional(),
    include_context: joi.boolean().default(false)
  }),

  addConversation: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    userMessage: joi.string().min(1).max(5000).required(),
    assistantResponse: joi.string().min(1).max(5000).required(),
    conversationId: joi.string().pattern(patterns.uuid).optional(),
    context: joi.object().optional()
  }),

  getConversationHistory: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    conversationId: joi.string().pattern(patterns.uuid).required(),
    limit: joi.number().integer().min(1).max(1000).default(100),
    include_context: joi.boolean().default(true)
  }),

  cleanupPersonaMemories: joi.object({
    personaId: joi.string().pattern(patterns.uuid).required(),
    olderThan: joi.number().integer().min(3600000).optional(), // Minimum 1 hour
    memoryTypes: joi.array().items(
      joi.string().valid('conversation', 'fact', 'preference', 'context', 'system')
    ).optional(),
    dryRun: joi.boolean().default(false)
  })
};

// System/utility operation schemas
export const utilitySchemas = {
  getSystemHealth: joi.object({
    detailed: joi.boolean().default(false)
  }),

  getPersonaStats: joi.object({
    personaId: joi.string().pattern(patterns.uuid).optional(),
    include_memory_breakdown: joi.boolean().default(true)
  }),

  testConnection: joi.object({})
};

/**
 * Validate input parameters against a schema
 */
export function validateInput(schema, input, toolName = 'unknown') {
  const { error, value } = schema.validate(input, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });

  if (error) {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: `Invalid input parameters for ${toolName}`,
      details
    };
  }

  return {
    valid: true,
    value
  };
}

/**
 * Validate UUID format
 */
export function validateUUID(id, fieldName = 'id') {
  if (!id || typeof id !== 'string') {
    return {
      valid: false,
      error: `${fieldName} must be a string`
    };
  }

  if (!patterns.uuid.test(id)) {
    return {
      valid: false,
      error: `${fieldName} must be a valid UUID`
    };
  }

  return { valid: true };
}
