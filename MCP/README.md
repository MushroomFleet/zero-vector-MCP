# Zero-Vector MCP Server (Clean)

A streamlined Model Context Protocol (MCP) server for Zero-Vector persona and memory management. This clean implementation focuses on essential persona and memory operations without direct vector manipulation, providing a simpler and more efficient interface.

## Features

### Persona Management (5 tools)
- **create_persona** - Create AI personas with configurable memory and behavior settings
- **list_personas** - List all personas with optional statistics
- **get_persona** - Retrieve detailed persona information
- **update_persona** - Update persona configuration and settings
- **delete_persona** - Delete personas and associated memories

### Memory Management (5 tools)
- **add_memory** - Add memories to personas with context and importance
- **search_persona_memories** - Semantic search through persona memories
- **add_conversation** - Add user/assistant conversation exchanges
- **get_conversation_history** - Retrieve complete conversation history
- **cleanup_persona_memories** - Clean up old or low-importance memories

### Utilities (3 tools)
- **get_system_health** - Check Zero-Vector server health and status
- **get_persona_stats** - Get persona and memory usage statistics
- **test_connection** - Test connectivity and authentication

## Installation

### Prerequisites
- Node.js 18.0.0 or higher
- Zero-Vector server running and accessible
- Valid Zero-Vector API key

### Setup

1. **Install dependencies:**
   ```bash
   cd MCP
   npm install
   ```

2. **Configure environment:**
   ```bash
   # Copy and edit .env file
   cp .env.example .env
   ```

3. **Set environment variables in `.env`:**
   ```env
   # Zero-Vector Server Configuration
   ZERO_VECTOR_BASE_URL=http://localhost:3000
   ZERO_VECTOR_API_KEY=your_api_key_here
   
   # Optional configurations
   MCP_SERVER_NAME=zero-vector-mcp-clean
   MCP_SERVER_VERSION=1.0.0
   LOG_LEVEL=info
   NODE_ENV=development
   ```

## Usage

### Testing the Server

```bash
# Test connection to Zero-Vector server
npm run test:connection

# List available tools
npm run list:tools

# Check version
npm run version
```

### Running the Server

```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start
```

### Integration with Cline

Add to your Cline MCP configuration:

```json
{
  "mcpServers": {
    "zero-vector-clean": {
      "command": "node",
      "args": ["C:/path/to/your/MCP/src/index.js"],
      "env": {
        "ZERO_VECTOR_BASE_URL": "http://localhost:3000",
        "ZERO_VECTOR_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Tool Examples

### Create a Persona
```javascript
{
  "name": "Assistant",
  "description": "Helpful AI assistant",
  "systemPrompt": "You are a helpful assistant.",
  "temperature": 0.7,
  "maxTokens": 2048,
  "maxMemorySize": 1000
}
```

### Add a Memory
```javascript
{
  "personaId": "uuid-here",
  "content": "User prefers concise explanations",
  "type": "preference",
  "importance": 0.8
}
```

### Search Memories
```javascript
{
  "personaId": "uuid-here",
  "query": "user preferences",
  "limit": 10,
  "threshold": 0.3
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZERO_VECTOR_BASE_URL` | `http://localhost:3000` | Zero-Vector server URL |
| `ZERO_VECTOR_API_KEY` | *required* | API key for authentication |
| `ZERO_VECTOR_TIMEOUT` | `30000` | Request timeout (ms) |
| `ZERO_VECTOR_RETRY_ATTEMPTS` | `3` | Retry attempts for failed requests |
| `MCP_SERVER_NAME` | `zero-vector-mcp-clean` | MCP server name |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

### Memory Types
- **conversation** - Chat exchanges
- **fact** - Factual information
- **preference** - User preferences
- **context** - Contextual information
- **system** - System-generated content

## Error Handling

The server provides comprehensive error handling with:
- **Input validation** - All parameters validated against schemas
- **API error mapping** - Clear error messages with suggestions
- **Retry logic** - Automatic retries for transient failures
- **Graceful degradation** - Informative error responses

## Logging

Structured logging with Winston:
- **Console output** - Colored logs for development
- **Configurable levels** - Debug, info, warn, error
- **Context tracking** - Tool execution and performance metrics

## Performance

Optimized for efficiency:
- **Streamlined codebase** - Focused on essential operations
- **Efficient API client** - Connection pooling and retry logic
- **Minimal dependencies** - Reduced overhead and faster startup

## Differences from Original MCP

This clean version:
- ✅ **Simplified** - Only persona, memory, and utility tools
- ✅ **Focused** - No direct vector operations
- ✅ **Streamlined** - Reduced complexity and dependencies
- ✅ **Efficient** - Faster startup and execution
- ✅ **Maintainable** - Cleaner codebase structure

## Troubleshooting

### Connection Issues
```bash
# Test connectivity
npm run test:connection

# Check Zero-Vector server status
curl http://localhost:3000/health
```

### Authentication Problems
- Verify `ZERO_VECTOR_API_KEY` in `.env`
- Check API key is active in Zero-Vector server
- Ensure proper permissions

### Memory/Persona Not Found
- Verify UUID format and existence
- Check persona is active
- Ensure API key has access permissions

## Development

### Project Structure
```
MCP/
├── src/
│   ├── index.js          # Main MCP server
│   ├── config.js         # Configuration
│   ├── apiClient.js      # HTTP client
│   ├── tools/
│   │   ├── personas.js   # Persona management
│   │   ├── memories.js   # Memory operations
│   │   └── utilities.js  # System utilities
│   └── utils/
│       ├── logger.js     # Logging utility
│       └── validation.js # Input validation
├── .env                  # Environment config
├── package.json         # Dependencies
└── README.md           # Documentation
```

### Adding New Tools
1. Define tool in appropriate module
2. Add validation schema
3. Implement handler function
4. Export in tool array
5. Update documentation

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check Zero-Vector server logs
2. Verify configuration and connectivity
3. Review tool documentation
4. Enable debug logging for detailed output
