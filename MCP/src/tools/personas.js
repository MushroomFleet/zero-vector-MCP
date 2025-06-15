/**
 * Persona Tools for Zero-Vector MCP Server
 * CRUD operations for persona management
 */

import apiClient from '../apiClient.js';
import { personaSchemas, validateInput } from '../utils/validation.js';
import { createLogger } from '../utils/logger.js';
import { formatTimestamp } from '../utils/dateHelpers.js';

const logger = createLogger('PersonaTools');

/**
 * Create a new persona
 */
export const createPersona = {
  name: 'create_persona',
  description: 'Create a new persona with specified configuration',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the persona (required)',
        minLength: 1,
        maxLength: 100
      },
      description: {
        type: 'string',
        description: 'Description of the persona (optional, max 500 characters)',
        maxLength: 500
      },
      systemPrompt: {
        type: 'string',
        description: 'System prompt defining persona behavior (optional, max 5000 characters)',
        maxLength: 5000
      },
      temperature: {
        type: 'number',
        description: 'Creativity level (0-2, default: 0.7)',
        minimum: 0,
        maximum: 2
      },
      maxTokens: {
        type: 'integer',
        description: 'Maximum response length (1-8192, default: 2048)',
        minimum: 1,
        maximum: 8192
      },
      embeddingProvider: {
        type: 'string',
        description: 'Embedding provider (local or openai, default: local)',
        enum: ['local', 'openai']
      },
      maxMemorySize: {
        type: 'integer',
        description: 'Maximum number of memories (1-10000, default: 1000)',
        minimum: 1,
        maximum: 10000
      },
      memoryDecayTime: {
        type: 'integer',
        description: 'Memory decay time in milliseconds (minimum: 3600000 = 1 hour)',
        minimum: 3600000
      }
    },
    required: ['name']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(personaSchemas.createPersona, params, 'create_persona');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const validParams = validation.value;

      // Create persona via API
      const result = await apiClient.post('/api/personas', validParams);

      if (!result.success) {
        logger.error('Persona creation failed', {
          error: result.error,
          message: result.message
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to create persona: ${result.message}\n\n💡 ${result.suggestion || 'Check your input parameters and try again.'}`
          }],
          isError: true
        };
      }

      const personaData = result.data;
      logger.info('Persona created successfully', { 
        personaId: personaData.id,
        name: personaData.name 
      });

      let resultText = `✅ **Persona "${personaData.name}" created successfully!**\n\n`;
      resultText += `🆔 **ID:** ${personaData.id}\n`;
      resultText += `📝 **Description:** ${personaData.description || 'None'}\n`;
      resultText += `🎛️ **Settings:**\n`;
      resultText += `  • Temperature: ${personaData.temperature || validParams.temperature || 0.7}\n`;
      resultText += `  • Max Tokens: ${personaData.maxTokens || validParams.maxTokens || 2048}\n`;
      resultText += `  • Embedding Provider: ${personaData.embeddingProvider || validParams.embeddingProvider || 'local'}\n`;
      resultText += `  • Max Memory Size: ${personaData.maxMemorySize || 1000}\n`;
      resultText += `  • Memory Decay: ${Math.round((personaData.memoryDecayTime || 7 * 24 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000))} days`;

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in create_persona', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * List all personas
 */
export const listPersonas = {
  name: 'list_personas',
  description: 'List all personas with optional filtering and statistics',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: 'Maximum number of personas to return (default: 50)',
        minimum: 1,
        maximum: 1000
      },
      offset: {
        type: 'integer',
        description: 'Number of personas to skip (default: 0)',
        minimum: 0
      },
      include_stats: {
        type: 'boolean',
        description: 'Include memory statistics (default: true)'
      },
      active_only: {
        type: 'boolean',
        description: 'Only return active personas (default: true)'
      }
    }
  },

  async handler(params = {}) {
    try {
      // Validate input
      const validation = validateInput(personaSchemas.listPersonas, params, 'list_personas');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const validParams = validation.value;

      // Get personas via API
      const result = await apiClient.get('/api/personas', validParams);

      if (!result.success) {
        logger.error('Persona listing failed', {
          error: result.error,
          message: result.message
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to list personas: ${result.message}\n\n💡 ${result.suggestion || 'Check server connectivity and try again.'}`
          }],
          isError: true
        };
      }

      const { personas, total } = result.data;
      logger.info('Personas listed successfully', { 
        count: personas.length,
        total
      });

      if (personas.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `📭 **No personas found**\n\n💡 Create your first persona using the \`create_persona\` tool.`
          }]
        };
      }

      let resultText = `📋 **Found ${total} persona${total !== 1 ? 's' : ''}** (showing ${personas.length})\n\n`;

      personas.forEach((persona, index) => {
        resultText += `**${index + 1}. ${persona.name}**\n`;
        resultText += `• ID: ${persona.id}\n`;
        if (persona.description) {
          resultText += `• Description: ${persona.description}\n`;
        }
        resultText += `• Status: ${persona.isActive ? '🟢 Active' : '🔴 Inactive'}\n`;
        resultText += `• Created: ${formatTimestamp(persona.createdAt, 'date')}\n`;
        
        if (validParams.include_stats && persona.stats) {
          const stats = persona.stats;
          resultText += `• Memories: ${stats.totalMemories || 0} (${stats.conversationCount || 0} conversations)\n`;
          
          if (stats.memoryTypes && Object.keys(stats.memoryTypes).length > 0) {
            resultText += `• Types: ${Object.entries(stats.memoryTypes).map(([type, count]) => `${type}: ${count}`).join(', ')}\n`;
          }
        }
        
        resultText += '\n';
      });

      if (total > personas.length) {
        const remaining = total - (validParams.offset || 0) - personas.length;
        resultText += `📄 **${remaining} more persona${remaining !== 1 ? 's' : ''} available** (use offset parameter to see more)`;
      }

      return {
        content: [{
          type: 'text',
          text: resultText.trim()
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in list_personas', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Get persona details
 */
export const getPersona = {
  name: 'get_persona',
  description: 'Get detailed information about a specific persona',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Persona ID (required)'
      },
      include_memories: {
        type: 'boolean',
        description: 'Include recent memories (default: false)'
      },
      memory_limit: {
        type: 'integer',
        description: 'Max memories to include (default: 10)',
        minimum: 1,
        maximum: 100
      }
    },
    required: ['id']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(personaSchemas.getPersona, params, 'get_persona');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const validParams = validation.value;

      // Get persona via API
      const result = await apiClient.get(`/api/personas/${validParams.id}`, {
        include_memories: validParams.include_memories,
        memory_limit: validParams.memory_limit
      });

      if (!result.success) {
        logger.error('Persona retrieval failed', {
          error: result.error,
          message: result.message,
          personaId: validParams.id
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to get persona: ${result.message}\n\n💡 ${result.suggestion || 'Check the persona ID and try again.'}`
          }],
          isError: true
        };
      }

      const persona = result.data;
      logger.info('Persona retrieved successfully', { 
        personaId: persona.id,
        name: persona.name 
      });

      let resultText = `👤 **Persona: ${persona.name}**\n\n`;
      resultText += `🆔 **ID:** ${persona.id}\n`;
      resultText += `📝 **Description:** ${persona.description || 'None'}\n`;
      resultText += `📊 **Status:** ${persona.isActive ? '🟢 Active' : '🔴 Inactive'}\n`;
      resultText += `📅 **Created:** ${formatTimestamp(persona.createdAt, 'iso')}\n`;
      resultText += `🔄 **Last Updated:** ${formatTimestamp(persona.updatedAt, 'iso')}\n`;

      if (persona.systemPrompt) {
        resultText += `\n🤖 **System Prompt:**\n${persona.systemPrompt}\n`;
      }

      if (persona.config) {
        const config = persona.config;
        resultText += `\n⚙️ **Configuration:**\n`;
        resultText += `• Temperature: ${config.temperature || 0.7}\n`;
        resultText += `• Max Tokens: ${config.maxTokens || 2048}\n`;
        resultText += `• Embedding Provider: ${config.embeddingProvider || 'local'}\n`;
      }

      resultText += `\n💾 **Memory Settings:**\n`;
      resultText += `• Max Memory Size: ${persona.maxMemorySize || 1000}\n`;
      resultText += `• Memory Decay: ${Math.round((persona.memoryDecayTime || 7 * 24 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000))} days\n`;

      if (persona.stats) {
        const stats = persona.stats;
        resultText += `\n📈 **Statistics:**\n`;
        resultText += `• Total Memories: ${stats.totalMemories || 0}\n`;
        resultText += `• Conversations: ${stats.conversationCount || 0}\n`;
        
        if (stats.memoryTypes && Object.keys(stats.memoryTypes).length > 0) {
          resultText += `• Memory Types: ${Object.entries(stats.memoryTypes).map(([type, count]) => `${type}: ${count}`).join(', ')}\n`;
        }
        
        if (stats.lastActivity) {
          resultText += `• Last Activity: ${formatTimestamp(stats.lastActivity, 'iso')}\n`;
        }
      }

      if (validParams.include_memories && persona.recentMemories && persona.recentMemories.length > 0) {
        resultText += `\n🧠 **Recent Memories (${persona.recentMemories.length}):**\n`;
        persona.recentMemories.forEach((memory, index) => {
          resultText += `${index + 1}. [${memory.contentType}] ${memory.content.substring(0, 100)}${memory.content.length > 100 ? '...' : ''}\n`;
          resultText += `   📅 ${formatTimestamp(memory.createdAt, 'time')}\n`;
        });
      }

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in get_persona', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Update persona
 */
export const updatePersona = {
  name: 'update_persona',
  description: 'Update persona configuration and settings',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Persona ID (required)'
      },
      name: {
        type: 'string',
        description: 'New name for the persona',
        minLength: 1,
        maxLength: 100
      },
      description: {
        type: 'string',
        description: 'New description',
        maxLength: 500
      },
      systemPrompt: {
        type: 'string',
        description: 'New system prompt',
        maxLength: 5000
      },
      temperature: {
        type: 'number',
        description: 'New creativity level (0-2)',
        minimum: 0,
        maximum: 2
      },
      maxTokens: {
        type: 'integer',
        description: 'New max response length (1-8192)',
        minimum: 1,
        maximum: 8192
      },
      maxMemorySize: {
        type: 'integer',
        description: 'New max memory size (1-10000)',
        minimum: 1,
        maximum: 10000
      },
      memoryDecayTime: {
        type: 'integer',
        description: 'New memory decay time in milliseconds (minimum: 3600000)',
        minimum: 3600000
      }
    },
    required: ['id']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(personaSchemas.updatePersona, params, 'update_persona');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const validParams = validation.value;
      const { id, ...updateData } = validParams;

      // Update persona via API
      const result = await apiClient.put(`/api/personas/${id}`, updateData);

      if (!result.success) {
        logger.error('Persona update failed', {
          error: result.error,
          message: result.message,
          personaId: id
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to update persona: ${result.message}\n\n💡 ${result.suggestion || 'Check the persona ID and parameters.'}`
          }],
          isError: true
        };
      }

      const persona = result.data;
      logger.info('Persona updated successfully', { 
        personaId: persona.id,
        name: persona.name 
      });

      let resultText = `✅ **Persona "${persona.name}" updated successfully!**\n\n`;
      resultText += `🆔 **ID:** ${persona.id}\n`;
      resultText += `📝 **Description:** ${persona.description || 'None'}\n`;
      resultText += `🔄 **Last Updated:** ${formatTimestamp(persona.updatedAt, 'iso')}\n`;

      if (Object.keys(updateData).length > 0) {
        resultText += `\n📋 **Updated Fields:**\n`;
        Object.keys(updateData).forEach(field => {
          resultText += `• ${field}\n`;
        });
      }

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in update_persona', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

/**
 * Delete persona
 */
export const deletePersona = {
  name: 'delete_persona',
  description: 'Delete a persona and all its associated memories',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Persona ID to delete (required)'
      }
    },
    required: ['id']
  },

  async handler(params) {
    try {
      // Validate input
      const validation = validateInput(personaSchemas.deletePersona, params, 'delete_persona');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { id } = validation.value;

      // Delete persona via API
      const result = await apiClient.delete(`/api/personas/${id}`);

      if (!result.success) {
        logger.error('Persona deletion failed', {
          error: result.error,
          message: result.message,
          personaId: id
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to delete persona: ${result.message}\n\n💡 ${result.suggestion || 'Check the persona ID and try again.'}`
          }],
          isError: true
        };
      }

      logger.info('Persona deleted successfully', { personaId: id });

      let resultText = `✅ **Persona deleted successfully!**\n\n`;
      resultText += `🗑️ **Deleted:**\n`;
      resultText += `• Persona ID: ${id}\n`;
      resultText += `\n⚠️ **This action is irreversible.**`;

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in delete_persona', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Export all persona tools
export const personaTools = [
  createPersona,
  listPersonas,
  getPersona,
  updatePersona,
  deletePersona
];
