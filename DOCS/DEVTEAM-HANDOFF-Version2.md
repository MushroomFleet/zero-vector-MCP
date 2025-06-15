# DEVTEAM-HANDOFF.md: Zero Vector 2 Development Guide

## Project Overview

Zero Vector 2 is a Vector-Graph hybrid server system designed for sophisticated memory management and persona development. This document provides comprehensive guidance for building the first fully working version, combining vector databases with knowledge graphs for enhanced AI memory capabilities.

## Core Architecture

### Hybrid Vector-Graph System Design

**Architectural Pattern**: Layered hybrid architecture separating vector and graph storage with unified query interfaces

```python
class ZeroVector2System:
    def __init__(self):
        self.vector_store = ChromaDB()  # Semantic similarity search
        self.graph_store = Neo4j()      # Relationship modeling
        self.memory_manager = MemoryManager()
        self.persona_engine = PersonaEngine()
        
    async def hybrid_query(self, query: str, context_depth: int = 2):
        # Vector similarity search
        vector_results = await self.vector_store.search(query, k=10)
        
        # Graph context expansion
        graph_context = await self.graph_store.expand_context(
            [r.entity_id for r in vector_results], 
            depth=context_depth
        )
        
        # Fuse results with importance scoring
        return self.memory_manager.fuse_contexts(vector_results, graph_context)
```

### Recommended File Structure

```
zero-vector-2/
├── src/
│   ├── core/
│   │   ├── vector_engine.py          # Vector similarity operations
│   │   ├── graph_engine.py           # Graph traversal and relationships
│   │   ├── hybrid_retriever.py       # Unified retrieval system
│   │   └── memory_manager.py         # Memory lifecycle management
│   ├── persona/
│   │   ├── persona_engine.py         # Persona development logic
│   │   ├── memory_importance.py      # Importance scoring algorithms
│   │   ├── context_preservation.py   # Long-term memory systems
│   │   └── associative_memory.py     # Memory association patterns
│   ├── api/
│   │   ├── health_endpoints.py       # Health check implementations
│   │   ├── memory_endpoints.py       # Memory CRUD operations
│   │   ├── conversation_endpoints.py # Conversation management
│   │   └── mcp_server.py             # MCP protocol server
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── init.py              # System initialization
│   │   │   ├── ingest.py            # Data ingestion
│   │   │   ├── query.py             # Query operations
│   │   │   └── serve.py             # Server management
│   │   └── main.py                  # CLI entry point
│   ├── config/
│   │   ├── database.yaml            # Database configurations
│   │   ├── embeddings.yaml          # Model configurations
│   │   └── server.yaml              # Server settings
│   └── utils/
│       ├── logging.py               # Structured logging
│       ├── monitoring.py            # Performance monitoring
│       └── cleanup.py               # Memory cleanup routines
├── tests/
│   ├── unit/                        # Unit tests
│   ├── integration/                 # Integration tests
│   └── performance/                 # Load testing
└── requirements.txt
```

## Memory Systems Implementation

### Hierarchical Memory Architecture

**Three-Tier Memory System**:
1. **Short-Term Memory**: Active conversation context (seconds to minutes)
2. **Long-Term Memory**: Persistent experiences and learned patterns
3. **Perpetual Memory**: Core personality traits and fundamental knowledge

```python
class MemoryHierarchy:
    def __init__(self):
        self.stm = ShortTermMemory(capacity=50)  # Rolling buffer
        self.ltm = LongTermMemory()              # Vector storage
        self.perpetual = PerpetualMemory()       # Core traits
        
    async def add_memory(self, content: str, importance: float = 0.5):
        # Add to STM immediately
        memory_item = MemoryItem(
            content=content,
            timestamp=datetime.utcnow(),
            importance=importance
        )
        self.stm.add(memory_item)
        
        # Consolidate to LTM based on importance
        if importance > 0.7:
            await self.ltm.consolidate(memory_item)
```

### Memory Importance Scoring Algorithm

```python
class MemoryImportanceScorer:
    def __init__(self):
        self.recency_weight = 0.3
        self.frequency_weight = 0.3
        self.emotional_weight = 0.2
        self.relevance_weight = 0.2
        
    def calculate_importance(self, memory: MemoryItem, context: str = "") -> float:
        # Recency score (exponential decay)
        age_hours = (datetime.utcnow() - memory.timestamp).total_seconds() / 3600
        recency_score = math.exp(-0.1 * age_hours)
        
        # Frequency score (access count)
        frequency_score = min(memory.access_count / 10.0, 1.0)
        
        # Emotional significance
        emotional_score = self._analyze_sentiment(memory.content)
        
        # Contextual relevance
        relevance_score = self._calculate_similarity(memory.content, context)
        
        return (
            self.recency_weight * recency_score +
            self.frequency_weight * frequency_score +
            self.emotional_weight * emotional_score +
            self.relevance_weight * relevance_score
        )
```

### Associative Memory Implementation

```python
class AssociativeMemory:
    def __init__(self, vector_store, graph_store):
        self.vector_store = vector_store
        self.graph_store = graph_store
        
    async def create_associations(self, memory_item: MemoryItem):
        # Extract entities and concepts
        entities = await self.extract_entities(memory_item.content)
        
        # Find similar memories through vector search
        similar_memories = await self.vector_store.similarity_search(
            memory_item.embedding, 
            threshold=0.8
        )
        
        # Create relationship edges in graph
        for similar in similar_memories:
            await self.graph_store.create_relationship(
                memory_item.id,
                similar.id,
                relationship_type="SIMILAR_TO",
                strength=similar.similarity_score
            )
```

## API Design Implementation

### Health Check Endpoints

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import time

app = FastAPI(title="Zero Vector 2 API", version="1.0.0")

@app.get("/health")
async def basic_health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.get("/health/detailed")
async def detailed_health():
    checks = {
        "vector_db": await check_vector_db_health(),
        "graph_db": await check_graph_db_health(),
        "memory_usage": get_memory_usage_percent(),
        "disk_space": get_disk_space_percent()
    }
    
    overall_status = "healthy" if all(checks.values()) else "degraded"
    
    return {
        "status": overall_status,
        "timestamp": datetime.utcnow().isoformat(),
        "checks": checks,
        "version": "1.0.0"
    }

@app.get("/health/ready")
async def readiness_probe():
    if await all_systems_ready():
        return {"status": "ready"}
    raise HTTPException(status_code=503, detail="System not ready")

@app.get("/health/live")
async def liveness_probe():
    return {"status": "alive"}
```

### Memory Management Endpoints

```python
class MemoryCreate(BaseModel):
    content: str
    metadata: Dict[str, Any] = {}
    importance: float = 0.5
    tags: List[str] = []

class MemorySearch(BaseModel):
    query: str
    limit: int = 10
    similarity_threshold: float = 0.7
    use_graph_context: bool = True

@app.post("/api/v1/memories")
async def add_memory(
    memory: MemoryCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user)
):
    # Generate embedding
    embedding = await embedding_service.generate(memory.content)
    
    # Store in vector database
    memory_id = await vector_store.add({
        "content": memory.content,
        "embedding": embedding,
        "metadata": memory.metadata,
        "user_id": current_user.id,
        "importance": memory.importance
    })
    
    # Create graph relationships asynchronously
    background_tasks.add_task(
        create_memory_associations, 
        memory_id, 
        memory.content
    )
    
    return {"id": memory_id, "status": "created"}

@app.post("/api/v1/memories/search")
async def search_memory(search: MemorySearch):
    # Vector similarity search
    vector_results = await vector_store.search(
        search.query,
        limit=search.limit,
        threshold=search.similarity_threshold
    )
    
    # Graph context expansion
    if search.use_graph_context:
        graph_context = await graph_store.expand_context(
            [r.id for r in vector_results]
        )
        results = merge_vector_graph_results(vector_results, graph_context)
    else:
        results = vector_results
    
    return {
        "results": results,
        "total": len(results),
        "query": search.query
    }
```

### MCP Server Implementation

```python
from mcp import types
from mcp.server import Server

class ZeroVector2MCPServer:
    def __init__(self, memory_manager: MemoryManager):
        self.server = Server("zero-vector-2")
        self.memory_manager = memory_manager
        self.setup_tools()
        
    def setup_tools(self):
        @self.server.call_tool()
        async def add_memory(arguments: dict) -> list[types.TextContent]:
            content = arguments.get("content")
            importance = arguments.get("importance", 0.5)
            
            memory_id = await self.memory_manager.add_memory(
                content=content,
                importance=importance
            )
            
            return [types.TextContent(
                type="text",
                text=f"Memory added with ID: {memory_id}"
            )]
        
        @self.server.call_tool()
        async def search_memory(arguments: dict) -> list[types.TextContent]:
            query = arguments.get("query")
            limit = arguments.get("limit", 5)
            
            results = await self.memory_manager.search(query, limit=limit)
            
            return [types.TextContent(
                type="text",
                text=json.dumps([{
                    "id": r.id,
                    "content": r.content,
                    "similarity": r.similarity_score,
                    "importance": r.importance
                } for r in results])
            )]
```

## CLI Implementation

### Command-Line Interface

```python
import typer
from rich.console import Console
from rich.progress import track

app = typer.Typer(help="Zero Vector 2 CLI")
console = Console()

@app.command()
def init(
    config_path: Path = typer.Option("./config", help="Configuration directory"),
    vector_db: str = typer.Option("chroma", help="Vector database (chroma/pinecone/weaviate)"),
    graph_db: str = typer.Option("neo4j", help="Graph database (neo4j/arangodb)")
):
    """Initialize Zero Vector 2 system"""
    
    console.print(f"[green]Initializing Zero Vector 2 with {vector_db} + {graph_db}[/green]")
    
    # Initialize vector database
    if vector_db == "chroma":
        setup_chroma_db(config_path)
    elif vector_db == "pinecone":
        setup_pinecone_db(config_path)
    
    # Initialize graph database
    if graph_db == "neo4j":
        setup_neo4j_db(config_path)
    elif graph_db == "arangodb":
        setup_arangodb(config_path)
    
    # Create schema and indexes
    create_hybrid_schema()
    
    console.print("[green]✓ System initialized successfully[/green]")

@app.command()
def ingest(
    data_path: Path = typer.Argument(..., help="Path to data files"),
    batch_size: int = typer.Option(100, help="Batch processing size"),
    importance_threshold: float = typer.Option(0.5, help="Minimum importance score")
):
    """Ingest data into Zero Vector 2"""
    
    files = list(data_path.glob("**/*.json"))
    
    for file_path in track(files, description="Processing files..."):
        process_file(file_path, batch_size, importance_threshold)

@app.command()
def query(
    query_text: str = typer.Argument(..., help="Query text"),
    hybrid: bool = typer.Option(True, help="Use hybrid vector-graph retrieval"),
    k: int = typer.Option(5, help="Number of results"),
    context_depth: int = typer.Option(2, help="Graph traversal depth")
):
    """Execute query against Zero Vector 2"""
    
    system = ZeroVector2System()
    results = system.hybrid_query(
        query_text, 
        use_graph=hybrid,
        k=k,
        context_depth=context_depth
    )
    
    display_results(results)

@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", help="Server host"),
    port: int = typer.Option(8000, help="Server port"),
    workers: int = typer.Option(4, help="Number of workers"),
    enable_mcp: bool = typer.Option(True, help="Enable MCP server")
):
    """Start Zero Vector 2 server"""
    
    if enable_mcp:
        start_mcp_server()
    
    import uvicorn
    uvicorn.run(
        "src.api.main:app",
        host=host,
        port=port,
        workers=workers,
        log_level="info"
    )

if __name__ == "__main__":
    app()
```

## Database Implementation

### Vector Database Setup (Chroma)

```python
import chromadb
from chromadb.config import Settings

class VectorStore:
    def __init__(self, persist_directory: str = "./chroma_db"):
        self.client = chromadb.Client(Settings(
            chroma_db_impl="duckdb+parquet",
            persist_directory=persist_directory,
            anonymized_telemetry=False
        ))
        
        self.collection = self.client.get_or_create_collection(
            name="zero_vector_memories",
            metadata={"description": "Zero Vector 2 memory storage"}
        )
    
    async def add_memory(self, content: str, embedding: List[float], 
                        metadata: Dict[str, Any]) -> str:
        memory_id = str(uuid.uuid4())
        
        self.collection.add(
            ids=[memory_id],
            embeddings=[embedding],
            documents=[content],
            metadatas=[metadata]
        )
        
        return memory_id
    
    async def search(self, query_embedding: List[float], 
                    k: int = 10, threshold: float = 0.7) -> List[Dict]:
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=k
        )
        
        return [
            {
                "id": results["ids"][0][i],
                "content": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "similarity": 1 - results["distances"][0][i]  # Convert distance to similarity
            }
            for i in range(len(results["ids"][0]))
            if (1 - results["distances"][0][i]) >= threshold
        ]
```

### Graph Database Setup (Neo4j)

```python
from neo4j import GraphDatabase

class GraphStore:
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.create_schema()
    
    def create_schema(self):
        """Create optimized schema for Zero Vector 2"""
        with self.driver.session() as session:
            # Create constraints
            session.run("""
                CREATE CONSTRAINT memory_id IF NOT EXISTS 
                FOR (m:Memory) REQUIRE m.id IS UNIQUE
            """)
            
            # Create indexes
            session.run("""
                CREATE INDEX memory_importance_idx IF NOT EXISTS 
                FOR (m:Memory) ON (m.importance)
            """)
            
            session.run("""
                CREATE INDEX memory_timestamp_idx IF NOT EXISTS 
                FOR (m:Memory) ON (m.timestamp)
            """)
    
    async def create_memory_node(self, memory_id: str, content: str, 
                                importance: float, metadata: Dict[str, Any]):
        """Create memory node in graph"""
        with self.driver.session() as session:
            session.run("""
                CREATE (m:Memory {
                    id: $memory_id,
                    content: $content,
                    importance: $importance,
                    timestamp: datetime(),
                    metadata: $metadata
                })
            """, memory_id=memory_id, content=content, 
                importance=importance, metadata=metadata)
    
    async def create_association(self, memory_id1: str, memory_id2: str, 
                               relationship_type: str, strength: float):
        """Create association between memories"""
        with self.driver.session() as session:
            session.run(f"""
                MATCH (m1:Memory {{id: $memory_id1}})
                MATCH (m2:Memory {{id: $memory_id2}})
                CREATE (m1)-[:{relationship_type} {{
                    strength: $strength,
                    created: datetime()
                }}]->(m2)
            """, memory_id1=memory_id1, memory_id2=memory_id2, strength=strength)
    
    async def expand_context(self, memory_ids: List[str], 
                           depth: int = 2) -> List[Dict]:
        """Expand context through graph traversal"""
        with self.driver.session() as session:
            result = session.run("""
                MATCH (start:Memory)
                WHERE start.id IN $memory_ids
                CALL apoc.path.subgraphAll(start, {
                    maxLevel: $depth,
                    relationshipFilter: "SIMILAR_TO|ASSOCIATED_WITH|FOLLOWS"
                })
                YIELD nodes, relationships
                RETURN nodes, relationships
            """, memory_ids=memory_ids, depth=depth)
            
            return [{"nodes": record["nodes"], 
                    "relationships": record["relationships"]} 
                   for record in result]
```

## Testing Framework

### Comprehensive Test Suite

```python
import pytest
import asyncio
from unittest.mock import Mock, patch

class TestZeroVector2System:
    @pytest.fixture
    async def system(self):
        """Create test system instance"""
        config = {
            "vector_db": "chroma",
            "graph_db": "neo4j",
            "test_mode": True
        }
        return ZeroVector2System(config)
    
    @pytest.mark.asyncio
    async def test_memory_creation(self, system):
        """Test memory creation and storage"""
        content = "Test memory content"
        importance = 0.8
        
        memory_id = await system.add_memory(content, importance)
        
        assert memory_id is not None
        assert len(memory_id) > 0
        
        # Verify storage in both vector and graph stores
        vector_result = await system.vector_store.get(memory_id)
        graph_result = await system.graph_store.get_node(memory_id)
        
        assert vector_result is not None
        assert graph_result is not None
    
    @pytest.mark.asyncio
    async def test_hybrid_retrieval(self, system):
        """Test hybrid vector-graph retrieval"""
        # Add test memories
        memory_ids = []
        for i in range(5):
            memory_id = await system.add_memory(
                f"Test memory {i}", 
                importance=0.5 + i * 0.1
            )
            memory_ids.append(memory_id)
        
        # Test hybrid query
        results = await system.hybrid_query("Test memory", k=3)
        
        assert len(results) <= 3
        assert all('similarity' in result for result in results)
        assert all('graph_context' in result for result in results)
    
    @pytest.mark.asyncio
    async def test_importance_scoring(self, system):
        """Test memory importance scoring"""
        scorer = MemoryImportanceScorer()
        
        memory = MemoryItem(
            content="Important system event",
            timestamp=datetime.utcnow(),
            access_count=5
        )
        
        importance = scorer.calculate_importance(memory, "system")
        
        assert 0.0 <= importance <= 1.0
        assert importance > 0.5  # Should be high for important content
    
    def test_performance_benchmarks(self, system):
        """Performance regression tests"""
        import time
        
        # Test query performance
        queries = ["test query 1", "test query 2", "test query 3"]
        times = []
        
        for query in queries:
            start = time.time()
            asyncio.run(system.hybrid_query(query))
            times.append(time.time() - start)
        
        avg_time = sum(times) / len(times)
        assert avg_time < 1.0  # Should respond within 1 second
```

## MVP Development Strategy

### Phase 1: Core MVP (Weeks 1-4)

**Essential Components:**
- Basic vector similarity search using Chroma
- Simple graph relationships with Neo4j
- Core memory CRUD operations
- Basic CLI interface
- Health check endpoints

**Success Metrics:**
- 80% retrieval accuracy
- <500ms response time
- Handle 100 concurrent users
- Store 10,000+ memories

**Implementation Priority:**
1. Set up vector database with Chroma
2. Implement basic embedding generation
3. Create simple memory storage/retrieval
4. Add basic CLI commands
5. Implement health checks

### Phase 2: Enhanced Features (Weeks 5-8)

**Advanced Capabilities:**
- Hybrid vector-graph retrieval
- Memory importance scoring
- Associative memory patterns
- MCP protocol integration
- Enhanced API endpoints

**Success Metrics:**
- 90% retrieval accuracy
- Graph traversal under 200ms
- Support for complex queries
- MCP tool integration

### Phase 3: Production Ready (Weeks 9-12)

**Production Features:**
- Performance optimization
- Comprehensive monitoring
- Scalability improvements
- Security enhancements
- Documentation and deployment

**Success Metrics:**
- 99% uptime
- Support 1000+ concurrent users
- Comprehensive test coverage
- Production deployment ready

## Deployment and Configuration

### Docker Configuration

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/
COPY config/ ./config/

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Configuration Files

**config/database.yaml**
```yaml
vector_database:
  type: "chroma"
  persist_directory: "./data/chroma"
  collection_name: "zero_vector_memories"
  
graph_database:
  type: "neo4j"
  uri: "bolt://localhost:7687"
  user: "${NEO4J_USER}"
  password: "${NEO4J_PASSWORD}"
  database: "zero_vector"

embedding_model:
  name: "sentence-transformers/all-MiniLM-L6-v2"
  batch_size: 32
  max_length: 512
```

**requirements.txt**
```
fastapi==0.104.1
uvicorn[standard]==0.24.0
chromadb==0.4.18
neo4j==5.14.0
sentence-transformers==2.2.2
typer[all]==0.9.0
pydantic==2.5.0
python-jose[cryptography]==3.3.0
redis==5.0.1
prometheus-client==0.19.0
structlog==23.2.0
pytest==7.4.3
pytest-asyncio==0.21.1
rich==13.7.0
```

## Monitoring and Observability

### Key Metrics to Track

```python
# Prometheus metrics
from prometheus_client import Counter, Histogram, Gauge

MEMORY_OPERATIONS = Counter('memory_operations_total', 'Total memory operations', ['operation'])
QUERY_DURATION = Histogram('query_duration_seconds', 'Query processing time')
ACTIVE_MEMORIES = Gauge('active_memories_count', 'Number of active memories')
SYSTEM_MEMORY_USAGE = Gauge('system_memory_usage_bytes', 'System memory usage')
```

### Structured Logging

```python
import structlog

logger = structlog.get_logger()

# Log memory operations
logger.info(
    "memory_added",
    memory_id=memory_id,
    importance=importance,
    user_id=user_id,
    content_length=len(content)
)

# Log query performance
logger.info(
    "hybrid_query_completed",
    query=query,
    results_count=len(results),
    duration=duration,
    vector_time=vector_time,
    graph_time=graph_time
)
```

## Development Workflow

### Getting Started

1. **Clone and Setup**
   ```bash
   git clone https://github.com/your-org/zero-vector-2.git
   cd zero-vector-2
   pip install -r requirements.txt
   ```

2. **Initialize System**
   ```bash
   python -m src.cli.main init --vector-db chroma --graph-db neo4j
   ```

3. **Start Development Server**
   ```bash
   python -m src.cli.main serve --port 8000 --workers 1
   ```

4. **Run Tests**
   ```bash
   pytest tests/ -v --asyncio-mode=auto
   ```

### Development Best Practices

- **Code Quality**: Use black, isort, and flake8 for consistent formatting
- **Testing**: Maintain >90% test coverage
- **Documentation**: Update docstrings and API documentation
- **Performance**: Monitor query performance and optimize bottlenecks
- **Security**: Implement proper authentication and input validation

## Conclusion

This comprehensive development handoff document provides everything needed to build Zero Vector 2's first working version. The hybrid vector-graph architecture enables sophisticated memory management while maintaining performance and scalability. Follow the MVP phased approach to deliver value quickly while building toward a production-ready system.

Key success factors:
- Start with proven technologies (Chroma + Neo4j)
- Implement comprehensive testing from day one
- Focus on developer experience with clear CLI tools
- Design for scalability and production deployment
- Maintain high code quality and documentation standards

The combination of vector similarity search, graph relationship modeling, and sophisticated memory management creates a powerful foundation for advanced AI applications with evolving personas and long-term memory capabilities.