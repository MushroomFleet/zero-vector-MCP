const { logger, logError } = require('../../utils/logger');

/**
 * OpenAI Embedding Provider
 * Uses OpenAI's embedding API for generating embeddings
 */
class OpenAIProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = options.baseURL || 'https://api.openai.com/v1';
    this.model = options.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    this.supportsDimensions = true;
    this.supportsNormalization = false; // OpenAI embeddings are already normalized
    this.maxBatchSize = 2048;
    this.maxTokens = 8191;
    
    // Model configurations
    this.modelConfigs = {
      'text-embedding-3-small': { dimensions: 1536, maxTokens: 8191, costPer1k: 0.00002 },
      'text-embedding-3-large': { dimensions: 3072, maxTokens: 8191, costPer1k: 0.00013 },
      'text-embedding-ada-002': { dimensions: 1536, maxTokens: 8191, costPer1k: 0.0001 }
    };
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    logger.info(`OpenAI provider initialized with model: ${this.model}`);
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        model = this.model,
        dimensions = null,
        user = null
      } = options;

      // Validate input
      if (!text || typeof text !== 'string') {
        throw new Error('Text input is required and must be a string');
      }

      // Check token limits
      const estimatedTokens = this.estimateTokens(text);
      const modelConfig = this.modelConfigs[model] || this.modelConfigs[this.model];
      
      if (estimatedTokens > modelConfig.maxTokens) {
        throw new Error(`Text too long: ${estimatedTokens} tokens exceeds limit of ${modelConfig.maxTokens}`);
      }

      // Prepare request body
      const requestBody = {
        input: text,
        model: model
      };

      // Add dimensions if supported and specified
      if (dimensions && this.modelSupportsCustomDimensions(model)) {
        requestBody.dimensions = dimensions;
      }

      if (user) {
        requestBody.user = user;
      }

      // Make API request
      const response = await this.makeAPIRequest('embeddings', requestBody);

      // Extract embedding data
      const embeddingData = response.data[0];
      const usage = response.usage;

      const result = {
        vector: embeddingData.embedding,
        model: model,
        usage: {
          promptTokens: usage.prompt_tokens,
          totalTokens: usage.total_tokens
        },
        metadata: {
          provider: 'openai',
          textLength: text.length,
          estimatedCost: this.estimateCost(usage.total_tokens, model),
          processingTime: Date.now() - startTime
        }
      };

      logger.info('OpenAI embedding generated successfully', {
        model,
        dimensions: result.vector.length,
        textLength: text.length,
        tokens: usage.total_tokens,
        processingTime: result.metadata.processingTime
      });

      return result;

    } catch (error) {
      logError(error, {
        operation: 'generateEmbedding',
        provider: 'openai',
        model: options.model || this.model,
        textLength: text?.length
      });
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateBatchEmbeddings(texts, options = {}) {
    const startTime = Date.now();
    
    try {
      const {
        model = this.model,
        dimensions = null,
        user = null,
        batchSize = this.maxBatchSize
      } = options;

      if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Texts must be a non-empty array');
      }

      const results = [];
      const errors = [];

      // Process in batches
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        
        try {
          // Prepare request body
          const requestBody = {
            input: batch,
            model: model
          };

          if (dimensions && this.modelSupportsCustomDimensions(model)) {
            requestBody.dimensions = dimensions;
          }

          if (user) {
            requestBody.user = user;
          }

          // Make API request
          const response = await this.makeAPIRequest('embeddings', requestBody);

          // Process results
          response.data.forEach((embeddingData, index) => {
            results.push({
              vector: embeddingData.embedding,
              model: model,
              usage: {
                promptTokens: Math.round(response.usage.prompt_tokens / batch.length),
                totalTokens: Math.round(response.usage.total_tokens / batch.length)
              },
              metadata: {
                provider: 'openai',
                textLength: batch[index].length,
                batchIndex: i + index
              }
            });
          });

        } catch (batchError) {
          // If batch fails, try individual processing
          for (let j = 0; j < batch.length; j++) {
            try {
              const result = await this.generateEmbedding(batch[j], { model, dimensions, user });
              results.push(result);
            } catch (individualError) {
              errors.push({
                text: batch[j],
                index: i + j,
                error: individualError.message
              });
            }
          }
        }
      }

      const duration = Date.now() - startTime;
      
      logger.info('OpenAI batch embedding completed', {
        model,
        totalTexts: texts.length,
        successful: results.length,
        errors: errors.length,
        duration
      });

      return results;

    } catch (error) {
      logError(error, {
        operation: 'generateBatchEmbeddings',
        provider: 'openai',
        textCount: texts?.length
      });
      throw error;
    }
  }

  /**
   * Make API request to OpenAI
   */
  async makeAPIRequest(endpoint, body) {
    const url = `${this.baseURL}/${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Zero-Vector-Server/1.0.0'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Check if model supports custom dimensions
   */
  modelSupportsCustomDimensions(model) {
    return model.startsWith('text-embedding-3');
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(text) {
    // Rough approximation: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate cost based on token usage
   */
  estimateCost(tokens, model) {
    const modelConfig = this.modelConfigs[model] || this.modelConfigs[this.model];
    return (tokens / 1000) * modelConfig.costPer1k;
  }

  /**
   * Get supported models
   */
  getSupportedModels() {
    return Object.keys(this.modelConfigs).map(model => ({
      name: model,
      dimensions: this.modelConfigs[model].dimensions,
      maxTokens: this.modelConfigs[model].maxTokens,
      costPer1k: this.modelConfigs[model].costPer1k,
      supportsCustomDimensions: this.modelSupportsCustomDimensions(model)
    }));
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const testResult = await this.generateEmbedding('health check test');
      
      return {
        status: 'healthy',
        model: this.model,
        dimensions: testResult.vector.length,
        lastChecked: new Date().toISOString(),
        provider: 'openai'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        lastChecked: new Date().toISOString(),
        provider: 'openai'
      };
    }
  }

  /**
   * Get model info
   */
  getModelInfo() {
    return {
      currentModel: this.model,
      supportedModels: Object.keys(this.modelConfigs),
      features: {
        batchProcessing: true,
        customDimensions: this.supportsDimensions,
        normalization: this.supportsNormalization
      },
      limits: {
        maxBatchSize: this.maxBatchSize,
        maxTokens: this.maxTokens
      }
    };
  }
}

module.exports = OpenAIProvider;
