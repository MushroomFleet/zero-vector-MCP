# Zero-Vector MCP: AI Persona Memory & Vector Database System

A complete AI persona memory management system combining a high-performance vector database server with a Model Context Protocol (MCP) interface for seamless integration with AI development tools like Cline.

🔗 **GitHub Repository:** [https://github.com/MushroomFleet/zero-vector-MCP](https://github.com/MushroomFleet/zero-vector-MCP)

## 🎯 Overview

Zero-Vector MCP provides a production-ready solution for AI persona management and vector similarity search, featuring:

- **High-Performance Vector Database** - Sub-50ms query times with 349k+ vector capacity
- **AI Persona Memory Management** - Context-aware memory storage with semantic search
- **MCP Integration** - Seamless integration with AI tools through Model Context Protocol
- **Production-Ready Architecture** - Comprehensive security, monitoring, and scalability features

## 🏗️ System Architecture

```mermaid
graph TB
    subgraph "AI Development Environment"
        A[Cline AI Assistant] --> B[MCP Client]
    end
    
    subgraph "Zero-Vector MCP System"
        B --> C[MCP Server]
        C --> D[Zero-Vector API]
        D --> E[Vector Database]
        D --> F[SQLite Metadata]
        
        subgraph "Core Services"
            G[Persona Manager]
            H[Memory Service]
            I[Embedding Service]
        end
        
        D --> G
        D --> H
        D --> I
    end
    
    subgraph "External Services"
        J[OpenAI Embeddings]
        K[Local Transformers]
    end
    
    I --> J
    I --> K
    
    style A fill:#e1f5fe
    style C fill:#f3e5f5
    style E fill:#e8f5e8
    style G fill:#fff3e0
    style H fill:#fff3e0
    style I fill:#fff3e0
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- 2GB+ available RAM (recommended)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/MushroomFleet/zero-vector-MCP.git
cd zero-vector-MCP

# 1. Set up the Zero-Vector server
cd zero-vector/server
npm install
npm run setup:database
npm run generate:api-key  # Generate API key for MCP
cp env.example .env  # Add your Open AI API key
npm start

# 2. Set up the MCP server (in a new terminal)
cd MCP
npm install
cp env.example .env
# Edit .env with your Zero-Vector server URL and API key
npm start
```

### Quick Test

```bash
# Test the vector database
curl http://localhost:3000/health

# Test MCP server connection
cd MCP
npm run test:connection
```

## 📚 Component Documentation

This system consists of two main components, each with detailed documentation:

### 🗄️ Zero-Vector Server
**Location:** [`zero-vector/README.md`](zero-vector/README.md)

The core vector database server providing:
- High-performance vector storage and similarity search
- RESTful API for vector operations
- SQLite metadata persistence
- Authentication and security middleware
- Real-time monitoring and health checks

### 🔌 MCP Server
**Location:** [`MCP/README.md`](MCP/README.md)

The Model Context Protocol interface providing:
- 13 specialized tools for persona and memory management
- Seamless integration with AI development tools
- Comprehensive error handling and validation
- Structured logging and performance monitoring

## ✨ Key Features

### Vector Database Performance
- **Memory Efficiency**: 2GB optimized storage supporting 349,525+ vectors
- **High-Speed Search**: Sub-50ms query times with cosine similarity
- **Scalable Architecture**: Three-tier design with comprehensive monitoring
- **Multiple Metrics**: Cosine, Euclidean, and dot product similarity

### AI Persona Management
- **Persona Creation**: Configurable AI personas with custom behavior settings
- **Memory Storage**: Context-aware memory with importance scoring
- **Semantic Search**: Find relevant memories using vector similarity
- **Conversation History**: Complete conversation tracking and retrieval
- **Memory Cleanup**: Automated cleanup of old or low-importance memories

### MCP Integration Tools
- **Persona Tools**: `create_persona`, `list_personas`, `get_persona`, `update_persona`, `delete_persona`
- **Memory Tools**: `add_memory`, `search_persona_memories`, `add_conversation`, `get_conversation_history`, `cleanup_persona_memories`
- **Utility Tools**: `get_system_health`, `get_persona_stats`, `test_connection`

### Security & Production Features
- **API Key Authentication**: Secure key generation with role-based permissions
- **Rate Limiting**: Multi-tier rate limiting (global, per-key, per-endpoint)
- **Input Validation**: Comprehensive request validation and sanitization
- **Structured Logging**: Winston-based logging with performance metrics
- **Health Monitoring**: Multiple health check endpoints for different monitoring needs

## 🎮 Use Cases

### AI Assistant Memory
```javascript
// Create a persona for an AI assistant
const persona = await mcpClient.createPersona({
  name: "Technical Assistant",
  description: "Helpful coding assistant with memory",
  systemPrompt: "You are a helpful technical assistant...",
  maxMemorySize: 1000
});

// Add important information to memory
await mcpClient.addMemory({
  personaId: persona.id,
  content: "User prefers TypeScript over JavaScript",
  type: "preference",
  importance: 0.8
});

// Search for relevant memories during conversation
const relevantMemories = await mcpClient.searchPersonaMemories({
  personaId: persona.id,
  query: "coding preferences",
  limit: 5
});
```

### Vector Similarity Search
```javascript
// Direct vector operations through the API
const response = await fetch('http://localhost:3000/api/vectors/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    query: [0.1, 0.2, 0.3, /* ... 1536 dimensions */],
    limit: 10,
    threshold: 0.7
  })
});
```

### Integration with Cline
```json
{
  "mcpServers": {
    "zero-vector": {
      "command": "node",
      "args": ["C:/path/to/zero-vector-MCP/MCP/src/index.js"],
      "env": {
        "ZERO_VECTOR_BASE_URL": "http://localhost:3000",
        "ZERO_VECTOR_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## 🛠️ Development

### Project Structure
```
zero-vector-MCP/
├── zero-vector/                 # Vector database server
│   ├── server/                  # Node.js backend
│   │   ├── src/                 # Source code
│   │   ├── scripts/             # Setup scripts
│   │   ├── data/                # Database files
│   │   └── README.md            # Server documentation
│   └── README.md                # Server overview
├── MCP/                         # Model Context Protocol server
│   ├── src/                     # MCP server source
│   │   ├── tools/               # MCP tool implementations
│   │   └── utils/               # Utilities
│   ├── .env.example             # Environment template
│   └── README.md                # MCP documentation
├── DOCS/                        # Internal documentation
└── README.md                    # This file
```

### Development Setup

```bash
# Start Zero-Vector server in development mode
cd zero-vector/server
npm run dev

# Start MCP server in development mode (new terminal)
cd MCP
npm run dev

# Run tests
npm test
```

### Environment Configuration

**Zero-Vector Server:**
```bash
NODE_ENV=development
PORT=3000
MAX_MEMORY_MB=2048
DEFAULT_DIMENSIONS=1536
LOG_LEVEL=info
```

**MCP Server:**
```bash
ZERO_VECTOR_BASE_URL=http://localhost:3000
ZERO_VECTOR_API_KEY=your_api_key_here
MCP_SERVER_NAME=zero-vector-mcp
LOG_LEVEL=info
```

## 📊 Performance Characteristics

- **Vector Storage**: ~6MB per 1000 vectors (1536 dimensions)
- **Search Performance**: <50ms for 10,000+ vector corpus
- **Memory Efficiency**: 99.9% utilization of allocated buffer space
- **Throughput**: 1000+ vectors/second insertion rate
- **Capacity**: 349,525 vectors in 2GB configuration

## 🔒 Security Features

- **Authentication**: API key-based authentication with secure generation
- **Authorization**: Role-based access control with granular permissions
- **Rate Limiting**: Multiple rate limiting layers (global, per-key, per-endpoint)
- **Input Validation**: Comprehensive request validation and sanitization
- **Security Headers**: Helmet.js implementation with CSP policies
- **Audit Logging**: Complete audit trail for all operations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Guidelines

- Follow existing code style and patterns
- Add comprehensive tests for new features
- Update documentation for any API changes
- Ensure all tests pass before submitting PR
- Include performance considerations for vector operations

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Documentation
- **Vector Database**: See [`zero-vector/README.md`](zero-vector/README.md) for detailed server documentation
- **MCP Server**: See [`MCP/README.md`](MCP/README.md) for MCP setup and tool documentation

### Troubleshooting

**Connection Issues:**
```bash
# Check Zero-Vector server health
curl http://localhost:3000/health

# Test MCP server connection
cd MCP && npm run test:connection
```

**Common Issues:**
- Ensure Node.js 18+ is installed
- Verify API key configuration in MCP `.env` file
- Check Zero-Vector server is running before starting MCP server
- Ensure sufficient memory allocation (2GB+ recommended)

### Getting Help

- **GitHub Issues**: Report bugs and feature requests
- **Discussions**: Ask questions and share ideas
- **Wiki**: Additional documentation and examples

---

**Zero-Vector MCP** - *Production-ready AI persona memory management with high-performance vector search*
