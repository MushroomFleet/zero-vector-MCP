/**
 * Zero-Vector MCP Server Configuration
 * Simplified configuration with essential settings
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Load configuration from environment variables
 */
const config = {
  zeroVector: {
    baseUrl: process.env.ZERO_VECTOR_BASE_URL || 'http://localhost:3000',
    apiKey: process.env.ZERO_VECTOR_API_KEY,
    timeout: parseInt(process.env.ZERO_VECTOR_TIMEOUT) || 30000,
    retryAttempts: parseInt(process.env.ZERO_VECTOR_RETRY_ATTEMPTS) || 3,
    retryDelay: parseInt(process.env.ZERO_VECTOR_RETRY_DELAY) || 1000
  },
  server: {
    name: process.env.MCP_SERVER_NAME || 'zero-vector-mcp-clean',
    version: process.env.MCP_SERVER_VERSION || '1.0.0'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Validate required configuration
if (!config.zeroVector.apiKey) {
  console.error('❌ ZERO_VECTOR_API_KEY environment variable is required');
  console.error('💡 Set it in your .env file or environment variables');
  process.exit(1);
}

export default config;
