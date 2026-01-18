from mem0 import Memory
import os

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
MEMGRAPH_HOST = os.getenv("MEMGRAPH_HOST", "localhost")

config = {
    "version": "v1.1",
    "embedder": {
        "provider": "ollama",
        "config": {
            "model": "embeddinggemma:latest",
            "embedding_dims": 768,
            "ollama_base_url": OLLAMA_HOST
        },
    },
    "llm": {
        "provider": "ollama",
        "config": {
            "model": "qwen3:8b",
            "ollama_base_url": OLLAMA_HOST
        },
    },
    "graph_store": {
        "provider": "memgraph",
        "config": {
            "url": f"bolt://{MEMGRAPH_HOST}:7687",
            "username": "memgraph",
            "password": "password",
        },
    },
}

mem_client = Memory.from_config(config)