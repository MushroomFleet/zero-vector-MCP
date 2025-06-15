#!/usr/bin/env node

const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

// Load environment and dependencies
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DatabaseRepository = require('../src/repositories/database');
const ApiKeyService = require('../src/services/apiKeyService');
const { logger } = require('../src/utils/logger');

/**
 * CLI API Key Generator
 * Interactive script for generating API keys for the Zero-Vector MCP server
 */
class ApiKeyGenerator {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.database = null;
    this.apiKeyService = null;
  }

  /**
   * Initialize database connection and services
   */
  async initialize() {
    try {
      console.log('🔧 Initializing Zero-Vector API Key Generator...\n');
      
      this.database = new DatabaseRepository();
      await this.database.initialize();
      
      this.apiKeyService = new ApiKeyService(this.database);
      
      console.log('✅ Connected to Zero-Vector database\n');
    } catch (error) {
      console.error('❌ Failed to initialize:', error.message);
      process.exit(1);
    }
  }

  /**
   * Prompt user for input
   */
  async prompt(question, defaultValue = null) {
    return new Promise((resolve) => {
      const displayQuestion = defaultValue 
        ? `${question} (default: ${defaultValue}): `
        : `${question}: `;
        
      this.rl.question(displayQuestion, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  /**
   * Get user selection from a list
   */
  async selectFromList(question, options, defaultIndex = 0) {
    console.log(`\n${question}`);
    options.forEach((option, index) => {
      const marker = index === defaultIndex ? '→' : ' ';
      console.log(`${marker} ${index + 1}. ${option}`);
    });
    
    const answer = await this.prompt(`Select option (1-${options.length})`, defaultIndex + 1);
    const index = parseInt(answer) - 1;
    
    if (index >= 0 && index < options.length) {
      return { index, value: options[index] };
    }
    
    console.log('Invalid selection, using default.');
    return { index: defaultIndex, value: options[defaultIndex] };
  }

  /**
   * Get or create a user for the API key
   */
  async getUserId() {
    try {
      // Check if there are any users
      const users = await this.database.db.prepare('SELECT id, email, role FROM users WHERE is_active = 1').all();
      
      if (users.length === 0) {
        console.log('⚠️  No active users found. Creating default admin user...');
        return await this.createDefaultUser();
      }
      
      if (users.length === 1) {
        const user = users[0];
        console.log(`📝 Using existing user: ${user.email} (${user.role})`);
        return user.id;
      }
      
      // Multiple users - let them choose
      console.log('\n👥 Multiple users found:');
      const userOptions = users.map(user => `${user.email} (${user.role})`);
      const { index } = await this.selectFromList('Select user for API key', userOptions);
      
      return users[index].id;
      
    } catch (error) {
      console.error('❌ Error getting user:', error.message);
      throw error;
    }
  }

  /**
   * Create a default admin user
   */
  async createDefaultUser() {
    try {
      const bcrypt = require('bcrypt');
      const userId = crypto.randomUUID();
      const email = 'admin@zero-vector.com';
      const password = 'admin123';
      const hashedPassword = await bcrypt.hash(password, 12);
      
      await this.database.insertUser({
        id: userId,
        email: email,
        passwordHash: hashedPassword,
        role: 'admin'
      });
      
      console.log(`✅ Created default admin user: ${email}`);
      console.log(`🔑 Default password: ${password}`);
      console.log('⚠️  Please change this password after first login!\n');
      
      return userId;
      
    } catch (error) {
      console.error('❌ Failed to create default user:', error.message);
      throw error;
    }
  }

  /**
   * Interactive API key generation
   */
  async generateApiKeyInteractive() {
    try {
      console.log('🔐 API Key Generation Wizard\n');
      console.log('This will create a new API key for the Zero-Vector MCP server.\n');
      
      // Get user
      const userId = await this.getUserId();
      
      // Get key name
      const keyName = await this.prompt('Enter API key name', 'Zero-Vector MCP Key');
      
      // Select permissions
      const permissionOptions = [
        'read, write (recommended for MCP)',
        'read, write, vectors:read, vectors:write (vectors only)',
        'read, write, personas:read, personas:write (personas only)', 
        'admin (full access - use with caution)',
        'read (read-only access)',
        'Custom (specify manually)'
      ];
      
      const { index: permIndex } = await this.selectFromList(
        'Select permissions for this API key', 
        permissionOptions
      );
      
      let permissions;
      switch (permIndex) {
        case 0:
          permissions = ['read', 'write'];
          break;
        case 1:
          permissions = ['read', 'write', 'vectors:read', 'vectors:write'];
          break;
        case 2:
          permissions = ['read', 'write', 'personas:read', 'personas:write'];
          break;
        case 3:
          permissions = ['admin'];
          break;
        case 4:
          permissions = ['read'];
          break;
        case 5:
          const customPerms = await this.prompt(
            'Enter permissions (comma-separated)', 
            'read,write'
          );
          permissions = customPerms.split(',').map(p => p.trim());
          break;
      }
      
      // Get rate limit
      const rateLimitInput = await this.prompt('Rate limit (requests per hour)', '1000');
      const rateLimit = parseInt(rateLimitInput) || 1000;
      
      // Get expiration
      const expirationOptions = [
        '1 year (recommended)',
        '6 months',
        '3 months', 
        '1 month',
        'Custom days'
      ];
      
      const { index: expIndex } = await this.selectFromList(
        'Select expiration period',
        expirationOptions
      );
      
      let expiresInDays;
      switch (expIndex) {
        case 0:
          expiresInDays = 365;
          break;
        case 1:
          expiresInDays = 180;
          break;
        case 2:
          expiresInDays = 90;
          break;
        case 3:
          expiresInDays = 30;
          break;
        case 4:
          const customDays = await this.prompt('Enter number of days', '365');
          expiresInDays = parseInt(customDays) || 365;
          break;
      }
      
      // Summary
      console.log('\n📋 API Key Summary:');
      console.log(`   Name: ${keyName}`);
      console.log(`   Permissions: ${permissions.join(', ')}`);
      console.log(`   Rate Limit: ${rateLimit} requests/hour`);
      console.log(`   Expires: ${expiresInDays} days from now`);
      
      const confirm = await this.prompt('\nGenerate this API key? (y/N)', 'N');
      
      if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log('❌ API key generation cancelled.');
        return null;
      }
      
      // Generate the API key
      console.log('\n🔄 Generating API key...');
      
      const apiKeyData = await this.apiKeyService.createApiKey(userId, {
        name: keyName,
        permissions: permissions,
        rateLimit: rateLimit,
        expiresInDays: expiresInDays
      });
      
      return apiKeyData;
      
    } catch (error) {
      console.error('❌ API key generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate API key from command line arguments
   */
  async generateApiKeyFromArgs(args) {
    try {
      const userId = await this.getUserId();
      
      const keyData = {
        name: args.name || 'CLI Generated Key',
        permissions: args.permissions ? args.permissions.split(',').map(p => p.trim()) : ['read', 'write'],
        rateLimit: args.rateLimit || 1000,
        expiresInDays: args.expiresInDays || 365
      };
      
      console.log('🔄 Generating API key with provided parameters...');
      
      const apiKeyData = await this.apiKeyService.createApiKey(userId, keyData);
      return apiKeyData;
      
    } catch (error) {
      console.error('❌ API key generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Display the generated API key
   */
  displayApiKey(apiKeyData) {
    console.log('\n🎉 API Key Generated Successfully!\n');
    console.log('═'.repeat(80));
    console.log(`📛 Key ID: ${apiKeyData.id}`);
    console.log(`🏷️  Name: ${apiKeyData.name}`);
    console.log(`🔑 API Key: ${apiKeyData.key}`);
    console.log(`🛡️  Permissions: ${apiKeyData.permissions.join(', ')}`);
    console.log(`⚡ Rate Limit: ${apiKeyData.rateLimit} requests/hour`);
    console.log(`⏰ Expires: ${new Date(apiKeyData.expiresAt).toLocaleString()}`);
    console.log('═'.repeat(80));
    
    console.log('\n🔧 Setup Instructions:');
    console.log('1. Copy the API key above (this is the only time it will be shown)');
    console.log('2. Set it as an environment variable for your MCP server:');
    console.log(`   export ZERO_VECTOR_API_KEY="${apiKeyData.key}"`);
    console.log('3. Start your Zero-Vector MCP server');
    
    console.log('\n💡 For Windows users:');
    console.log(`   set ZERO_VECTOR_API_KEY=${apiKeyData.key}`);
    
    console.log('\n⚠️  Security Notes:');
    console.log('• Store this API key securely');
    console.log('• Do not commit it to version control');
    console.log('• Use environment variables or secure configuration');
    console.log('• Monitor API key usage in server logs');
  }

  /**
   * Show usage help
   */
  showHelp() {
    console.log('Zero-Vector API Key Generator\n');
    console.log('Usage:');
    console.log('  node generate-api-key.js [options]\n');
    console.log('Options:');
    console.log('  --name <string>              API key name');
    console.log('  --permissions <string>       Comma-separated permissions (e.g., "read,write")');
    console.log('  --rate-limit <number>        Rate limit per hour (default: 1000)');
    console.log('  --expires-in-days <number>   Expiration in days (default: 365)');
    console.log('  --help                       Show this help message\n');
    console.log('Examples:');
    console.log('  node generate-api-key.js');
    console.log('  node generate-api-key.js --name "MCP Key" --permissions "read,write"');
    console.log('  node generate-api-key.js --name "Production" --rate-limit 5000 --expires-in-days 180');
  }

  /**
   * Parse command line arguments
   */
  parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--help' || arg === '-h') {
        this.showHelp();
        process.exit(0);
      } else if (arg === '--name' && i + 1 < args.length) {
        parsed.name = args[++i];
      } else if (arg === '--permissions' && i + 1 < args.length) {
        parsed.permissions = args[++i];
      } else if (arg === '--rate-limit' && i + 1 < args.length) {
        parsed.rateLimit = parseInt(args[++i]);
      } else if (arg === '--expires-in-days' && i + 1 < args.length) {
        parsed.expiresInDays = parseInt(args[++i]);
      }
    }
    
    return parsed;
  }

  /**
   * Main execution function
   */
  async run() {
    try {
      await this.initialize();
      
      const args = this.parseArgs();
      const hasArgs = Object.keys(args).length > 0;
      
      let apiKeyData;
      
      if (hasArgs) {
        // Generate from command line arguments
        apiKeyData = await this.generateApiKeyFromArgs(args);
      } else {
        // Interactive mode
        apiKeyData = await this.generateApiKeyInteractive();
      }
      
      if (apiKeyData) {
        this.displayApiKey(apiKeyData);
      }
      
    } catch (error) {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    } finally {
      if (this.database) {
        await this.database.close();
      }
      this.rl.close();
    }
  }
}

// Run the generator if this script is executed directly
if (require.main === module) {
  const generator = new ApiKeyGenerator();
  generator.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = ApiKeyGenerator;
