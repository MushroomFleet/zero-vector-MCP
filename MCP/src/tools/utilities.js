/**
 * Utility Tools for Zero-Vector MCP Server
 * System health, statistics, and connectivity tools
 */

import apiClient from '../apiClient.js';
import { utilitySchemas, validateInput } from '../utils/validation.js';
import { createLogger } from '../utils/logger.js';
import { formatTimestamp } from '../utils/dateHelpers.js';

const logger = createLogger('UtilityTools');

/**
 * Get system health information
 */
export const getSystemHealth = {
  name: 'get_system_health',
  description: 'Check Zero-Vector server health and connectivity status',
  inputSchema: {
    type: 'object',
    properties: {
      detailed: {
        type: 'boolean',
        description: 'Include detailed system metrics (default: false)'
      }
    }
  },

  async handler(params = {}) {
    try {
      // Validate input
      const validation = validateInput(utilitySchemas.getSystemHealth, params, 'get_system_health');
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `❌ ${validation.message}\n\nDetails:\n${validation.details.map(d => `• ${d.field}: ${d.message}`).join('\n')}`
          }],
          isError: true
        };
      }

      const { detailed } = validation.value;

      // Get health information via API
      const endpoint = detailed ? '/health/detailed' : '/health';
      const result = await apiClient.get(endpoint);

      if (!result.success) {
        logger.error('Health check failed', {
          error: result.error,
          message: result.message
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Zero-Vector server health check failed: ${result.message}\n\n💡 ${result.suggestion || 'Check if the Zero-Vector server is running and accessible.'}`
          }],
          isError: true
        };
      }

      const healthData = result.data;
      logger.info('Health check completed', { status: healthData.status });

      let resultText = `🏥 **Zero-Vector Server Health**\n\n`;
      resultText += `📊 **Status:** ${(healthData.status === 'healthy' || healthData.status === 'ok') ? '🟢 Healthy' : '🔴 Unhealthy'}\n`;
      resultText += `⏰ **Timestamp:** ${formatTimestamp(healthData.timestamp, 'iso')}\n`;
      
      if (healthData.uptime) {
        const uptimeHours = Math.floor(healthData.uptime / 3600);
        const uptimeMinutes = Math.floor((healthData.uptime % 3600) / 60);
        resultText += `⏱️ **Uptime:** ${uptimeHours}h ${uptimeMinutes}m\n`;
      }

      if (detailed && healthData.system) {
        const sys = healthData.system;
        resultText += `\n💻 **System Information:**\n`;
        resultText += `• Node.js: ${sys.nodeVersion}\n`;
        resultText += `• Platform: ${sys.platform} ${sys.arch}\n`;
        resultText += `• Memory Usage: ${(sys.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(sys.memoryUsage.heapTotal / 1024 / 1024).toFixed(1)}MB\n`;
        if (sys.cpuUsage) {
          resultText += `• CPU Usage: ${(sys.cpuUsage * 100).toFixed(1)}%\n`;
        }
      }

      if (detailed && healthData.database) {
        const db = healthData.database;
        resultText += `\n🗄️ **Database:**\n`;
        resultText += `• Status: ${db.connected ? '🟢 Connected' : '🔴 Disconnected'}\n`;
        if (db.path) {
          resultText += `• Path: ${db.path}\n`;
        }
        if (db.size) {
          resultText += `• Size: ${(db.size / 1024 / 1024).toFixed(2)}MB\n`;
        }
      }

      if (detailed && healthData.vectorStore) {
        const vs = healthData.vectorStore;
        resultText += `\n🧮 **Vector Store:**\n`;
        resultText += `• Vector Count: ${vs.vectorCount}/${vs.maxVectors}\n`;
        resultText += `• Memory Usage: ${vs.memoryUtilization.toFixed(1)}%\n`;
        resultText += `• Dimensions: ${vs.dimensions}\n`;
        if (vs.index && vs.index.enabled) {
          resultText += `• Index: ${vs.index.type} (${vs.index.nodeCount} nodes)\n`;
        }
      }

      if (healthData.performance) {
        const perf = healthData.performance;
        resultText += `\n⚡ **Performance:**\n`;
        resultText += `• Avg Response Time: ${perf.avgResponseTime}ms\n`;
        resultText += `• Requests/min: ${perf.requestsPerMinute}\n`;
        if (detailed && perf.searchPerformance) {
          resultText += `• Avg Search Time: ${perf.searchPerformance.avgTime}ms\n`;
        }
      }

      return {
        content: [{
          type: 'text',
          text: resultText.trim()
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in get_system_health', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ Unexpected error: ${error.message}\n\n💡 This might indicate a connection issue with the Zero-Vector server.`
        }],
        isError: true
      };
    }
  }
};

/**
 * Get persona statistics
 */
export const getPersonaStats = {
  name: 'get_persona_stats',
  description: 'Get statistics about personas and their memory usage',
  inputSchema: {
    type: 'object',
    properties: {
      personaId: {
        type: 'string',
        description: 'Get stats for specific persona (optional)'
      },
      include_memory_breakdown: {
        type: 'boolean',
        description: 'Include memory type breakdown (default: true)'
      }
    }
  },

  async handler(params = {}) {
    try {
      // Validate input
      const validation = validateInput(utilitySchemas.getPersonaStats, params, 'get_persona_stats');
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

      // Get persona statistics via API
      const endpoint = validParams.personaId 
        ? `/api/personas/${validParams.personaId}/stats`
        : '/api/personas/_stats';
      
      const result = await apiClient.get(endpoint, { 
        include_memory_breakdown: validParams.include_memory_breakdown 
      });

      if (!result.success) {
        logger.error('Persona stats retrieval failed', {
          error: result.error,
          message: result.message
        });

        return {
          content: [{
            type: 'text',
            text: `❌ Failed to get persona statistics: ${result.message}\n\n💡 ${result.suggestion || 'Check the persona ID and try again.'}`
          }],
          isError: true
        };
      }

      const stats = result.data;
      logger.info('Persona stats retrieved successfully', { 
        personaId: validParams.personaId || 'all' 
      });

      let resultText = validParams.personaId 
        ? `👤 **Persona Statistics: ${validParams.personaId}**\n\n`
        : `👥 **All Personas Statistics**\n\n`;

      if (validParams.personaId) {
        // Single persona stats
        resultText += `📊 **Memory Overview:**\n`;
        resultText += `• Total Memories: ${stats.totalMemories}\n`;
        resultText += `• Conversations: ${stats.conversationCount}\n`;
        resultText += `• Active Conversations: ${stats.activeConversations || 0}\n`;
        resultText += `• Last Activity: ${stats.lastActivity ? formatTimestamp(stats.lastActivity, 'iso') : 'Never'}\n`;
        
        if (stats.memoryTypeBreakdown && validParams.include_memory_breakdown) {
          resultText += `\n🏷️ **Memory Types:**\n`;
          Object.entries(stats.memoryTypeBreakdown).forEach(([type, count]) => {
            resultText += `• ${type}: ${count}\n`;
          });
        }
        
        if (stats.averageImportance !== undefined) {
          resultText += `\n⭐ **Quality:**\n`;
          resultText += `• Average Importance: ${stats.averageImportance.toFixed(3)}\n`;
        }
        
        if (stats.memoryUsage) {
          resultText += `• Memory Usage: ${stats.memoryUsage.toFixed(1)}% of limit\n`;
        }
        
      } else {
        // All personas stats
        resultText += `📊 **Overview:**\n`;
        resultText += `• Total Personas: ${stats.totalPersonas}\n`;
        resultText += `• Active Personas: ${stats.activePersonas}\n`;
        resultText += `• Total Memories: ${stats.totalMemories || 0}\n`;
        resultText += `• Total Conversations: ${stats.totalConversations}\n`;
        
        if (stats.topPersonas) {
          resultText += `\n🏆 **Most Active Personas:**\n`;
          stats.topPersonas.slice(0, 5).forEach((persona, index) => {
            resultText += `${index + 1}. ${persona.name}: ${persona.memoryCount} memories\n`;
          });
        }
        
        if (stats.memoryDistribution && validParams.include_memory_breakdown) {
          resultText += `\n🏷️ **Memory Distribution:**\n`;
          Object.entries(stats.memoryDistribution).forEach(([type, count]) => {
            resultText += `• ${type}: ${count || 0}\n`;
          });
        }
        
        if (stats.recentActivity) {
          resultText += `\n📈 **Recent Activity (24h):**\n`;
          resultText += `• New Memories: ${stats.recentActivity.newMemories}\n`;
          resultText += `• New Conversations: ${stats.recentActivity.newConversations}\n`;
          resultText += `• Memory Searches: ${stats.recentActivity.searches}\n`;
        }
      }

      resultText += `\n📅 **Generated:** ${formatTimestamp(Date.now(), 'iso')}`;

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in get_persona_stats', { error: error.message });
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
 * Test connection to Zero-Vector server
 */
export const testConnection = {
  name: 'test_connection',
  description: 'Test connectivity and authentication with the Zero-Vector server',
  inputSchema: {
    type: 'object',
    properties: {}
  },

  async handler() {
    try {
      logger.info('Testing Zero-Vector connection');

      // Test basic connectivity
      const connectionTest = await apiClient.testConnection();

      if (!connectionTest.connected) {
        return {
          content: [{
            type: 'text',
            text: `❌ **Connection Failed**\n\nUnable to connect to Zero-Vector server.\n\n🔧 **Troubleshooting:**\n• Check if Zero-Vector server is running\n• Verify ZERO_VECTOR_BASE_URL is correct\n• Check network connectivity\n• Review firewall settings\n\n**Error:** ${connectionTest.error}`
          }],
          isError: true
        };
      }

      // Test API key authentication by trying to access a protected endpoint
      const authTest = await apiClient.get('/api/personas');

      let resultText = `✅ **Connection Successful**\n\n`;
      resultText += `🌐 **Server URL:** ${apiClient.baseURL}\n`;
      resultText += `🏥 **Health:** ${connectionTest.health?.status || 'Unknown'}\n`;
      
      if (authTest.success) {
        resultText += `🔑 **Authentication:** ✅ Valid API Key\n`;
        resultText += `🔓 **API Access:** ✅ Permissions verified\n`;
      } else {
        resultText += `🔑 **Authentication:** ❌ ${authTest.message}\n`;
        resultText += `\n💡 **Fix:** Check your ZERO_VECTOR_API_KEY environment variable`;
      }

      if (connectionTest.health) {
        const health = connectionTest.health;
        resultText += `\n🖥️ **Server Info:**\n`;
        if (health.uptime) {
          const hours = Math.floor(health.uptime / 3600);
          const minutes = Math.floor((health.uptime % 3600) / 60);
          resultText += `• Uptime: ${hours}h ${minutes}m\n`;
        }
        if (health.version) {
          resultText += `• Version: ${health.version}\n`;
        }
        resultText += `• Timestamp: ${formatTimestamp(health.timestamp, 'time')}`;
      }

      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };

    } catch (error) {
      logger.error('Unexpected error in test_connection', { error: error.message });
      return {
        content: [{
          type: 'text',
          text: `❌ **Connection Test Failed**\n\nUnexpected error: ${error.message}\n\n💡 This indicates a network or configuration issue.`
        }],
        isError: true
      };
    }
  }
};

// Export all utility tools
export const utilityTools = [
  getSystemHealth,
  getPersonaStats,
  testConnection
];
