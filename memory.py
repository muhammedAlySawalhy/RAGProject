import os
import time
import logging
from typing import Optional

from mem0 import Memory
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# Configuration from environment
# =============================================================================

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

NEO4J_HOST = os.getenv("NEO4J_HOST", "neo4j")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "neo4jpassword")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
MEM0_COLLECTION = os.getenv("MEM0_COLLECTION", "mem0")

# =============================================================================
# Mem0 Configuration
# =============================================================================

config = {
    "version": "v1.1",
    "vector_store": {
        "provider": "qdrant",
        "config": {
            "host": QDRANT_HOST,
            "port": QDRANT_PORT,
            "collection_name": MEM0_COLLECTION,
            "embedding_model_dims": 768,
            "on_disk": True,
        },
    },
    "embedder": {
        "provider": "ollama",
        "config": {
            "model": "embeddinggemma:latest",
            "embedding_dims": 768,
            "ollama_base_url": OLLAMA_HOST,
        },
    },
    "llm": {
        "provider": "ollama",
        "config": {"model": "llama3.2:1b", "ollama_base_url": OLLAMA_HOST},
    },
    "graph_store": {
        "provider": "neo4j",
        "config": {
           
            "url": "bolt://neo4j:7687",
            "username": NEO4J_USER,
            "password": NEO4J_PASSWORD,
            
        },
    },
}







# =============================================================================
# Qdrant Manager for Direct Operations
# =============================================================================


class QdrantManager:
    """
    Manager for direct Qdrant operations like deletion.

    Provides operations that aren't directly available through Mem0,
    such as deleting documents by metadata filters.
    """

    def __init__(self, client: QdrantClient, collection_name: str = MEM0_COLLECTION):
        self.client = client
        self.collection_name = collection_name

    def delete_by_user_and_filename(self, user_id: str, filename: str) -> dict:
        """Delete all vectors associated with a specific user and filename."""
        try:
            scroll_result = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_models.Filter(
                    must=[
                        qdrant_models.FieldCondition(
                            key="metadata.owner_id",
                            match=qdrant_models.MatchValue(value=user_id),
                        ),
                        qdrant_models.FieldCondition(
                            key="metadata.filename",
                            match=qdrant_models.MatchValue(value=filename),
                        ),
                    ]
                ),
                limit=10000,
                with_payload=False,
                with_vectors=False,
            )

            points = scroll_result[0]
            point_ids = [point.id for point in points]

            if not point_ids:
                return {
                    "success": True,
                    "deleted_count": 0,
                    "message": f"No documents found for filename '{filename}'",
                }

            self.client.delete(
                collection_name=self.collection_name,
                points_selector=qdrant_models.PointIdsList(points=point_ids),
            )

            return {
                "success": True,
                "deleted_count": len(point_ids),
                "message": f"Successfully deleted {len(point_ids)} chunks for '{filename}'",
            }

        except Exception as e:
            logger.error(f"Failed to delete documents: {e}")
            return {
                "success": False,
                "deleted_count": 0,
                "error": str(e),
            }

    def delete_by_user(self, user_id: str) -> dict:
        """Delete ALL vectors associated with a specific user."""
        try:
            scroll_result = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_models.Filter(
                    must=[
                        qdrant_models.FieldCondition(
                            key="metadata.owner_id",
                            match=qdrant_models.MatchValue(value=user_id),
                        ),
                    ]
                ),
                limit=10000,
                with_payload=False,
                with_vectors=False,
            )

            points = scroll_result[0]
            point_ids = [point.id for point in points]

            if not point_ids:
                return {
                    "success": True,
                    "deleted_count": 0,
                    "message": "No documents found for this user",
                }

            self.client.delete(
                collection_name=self.collection_name,
                points_selector=qdrant_models.PointIdsList(points=point_ids),
            )

            return {
                "success": True,
                "deleted_count": len(point_ids),
                "message": f"Successfully deleted {len(point_ids)} items for user",
            }

        except Exception as e:
            logger.error(f"Failed to delete user data: {e}")
            return {
                "success": False,
                "deleted_count": 0,
                "error": str(e),
            }

    def delete_by_source(self, user_id: str, source: str) -> dict:
        """Delete vectors by source type (e.g., 'document', 'chat') for a user."""
        try:
            scroll_result = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_models.Filter(
                    must=[
                        qdrant_models.FieldCondition(
                            key="metadata.owner_id",
                            match=qdrant_models.MatchValue(value=user_id),
                        ),
                        qdrant_models.FieldCondition(
                            key="metadata.source",
                            match=qdrant_models.MatchValue(value=source),
                        ),
                    ]
                ),
                limit=10000,
                with_payload=False,
                with_vectors=False,
            )

            points = scroll_result[0]
            point_ids = [point.id for point in points]

            if not point_ids:
                return {
                    "success": True,
                    "deleted_count": 0,
                    "message": f"No items found with source '{source}'",
                }

            self.client.delete(
                collection_name=self.collection_name,
                points_selector=qdrant_models.PointIdsList(points=point_ids),
            )

            return {
                "success": True,
                "deleted_count": len(point_ids),
                "message": f"Successfully deleted {len(point_ids)} items with source '{source}'",
            }

        except Exception as e:
            logger.error(f"Failed to delete by source: {e}")
            return {
                "success": False,
                "deleted_count": 0,
                "error": str(e),
            }

    def get_user_document_list(self, user_id: str, limit: int = 100) -> dict:
        """Get a list of unique documents for a user."""
        try:
            scroll_result = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_models.Filter(
                    must=[
                        qdrant_models.FieldCondition(
                            key="metadata.owner_id",
                            match=qdrant_models.MatchValue(value=user_id),
                        ),
                        qdrant_models.FieldCondition(
                            key="metadata.source",
                            match=qdrant_models.MatchValue(value="document"),
                        ),
                    ]
                ),
                limit=limit,
                with_payload=True,
                with_vectors=False,
            )

            points = scroll_result[0]

            # Aggregate by filename
            documents: dict[str, dict] = {}
            for point in points:
                payload = point.payload or {}
                metadata = payload.get("metadata", {})
                filename = metadata.get("filename", "unknown")

                if filename not in documents:
                    documents[filename] = {
                        "filename": filename,
                        "chunks": 0,
                        "pages": set(),
                    }

                documents[filename]["chunks"] += 1
                page = metadata.get("page")
                if page is not None:
                    documents[filename]["pages"].add(page)

            # Convert to list
            doc_list = [
                {
                    "filename": info["filename"],
                    "chunk_count": info["chunks"],
                    "page_count": len(info["pages"]),
                }
                for info in documents.values()
            ]

            return {
                "success": True,
                "documents": doc_list,
                "total_documents": len(doc_list),
            }

        except Exception as e:
            logger.error(f"Failed to get document list: {e}")
            return {
                "success": False,
                "documents": [],
                "error": str(e),
            }


mem_client =Memory.from_config(config)
qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
qdrant_manager = QdrantManager(qdrant_client, MEM0_COLLECTION)
