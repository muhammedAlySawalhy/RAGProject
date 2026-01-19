import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
import Pipeline
from memory import mem_client
from loaders import DocumentLoaderFactory

logger = logging.getLogger(__name__)

DOCUMENT_SOURCE = "document"

# Thread pool configuration
MAX_WORKERS = 5  # Number of threads for concurrent embedding/storage


def process_query(query: str, usr_id: str):
    """Process a chat query through the RAG pipeline."""
    res = Pipeline.main(query, usr_id)
    return res


def _store_single_chunk(
    doc,
    filename: str,
    user_id: str,
    username: str,
    document_type: str,
    chunk_index: int,
) -> tuple[int, bool, str | None]:
    """
    Store a single document chunk to mem0.
    Returns: (chunk_index, success, error_message)
    """
    if doc.is_empty():
        return (chunk_index, True, None)

    message = {
        "role": "user",
        "content": (
            f"Document: {filename}\n"
            f"Page/Sheet: {doc.page}\n"
            f"Content:\n{doc.content}"
        ),
    }

    try:
        mem_client.add(
            [message],
            user_id=user_id,
           
            metadata={
                "source": DOCUMENT_SOURCE,
                "filename": filename,
                "page": doc.page,
                "document_type": document_type,
                "owner_id": user_id,
                "owner_username": username,
                **doc.metadata,
            },
        )
        return (chunk_index, True, None)
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to store chunk {chunk_index}: {error_msg}")
        return (chunk_index, False, error_msg)


def process_document_ingestion(
    file_content: bytes,
    filename: str,
    user_id: str,
    username: str,
) -> dict:
    """
    Background worker to process document ingestion using ThreadPoolExecutor.
    
    Uses a thread pool to concurrently embed and store document chunks,
    significantly improving performance for large documents.
    """
    logger.info(f"Starting background ingestion for {filename} ({len(file_content)} bytes)")
    
    # Load and parse the document
    result = DocumentLoaderFactory.load_document(file_content, filename)
    
    if not result.success:
        logger.error(f"Failed to parse document: {result.error}")
        return {
            "status": "error",
            "error": result.error or "Failed to parse document",
            "filename": filename,
        }

    total_chunks = len(result.documents)
    logger.info(f"Document loaded: {total_chunks} chunks from {result.total_pages} pages")
    
    if total_chunks == 0:
        return {
            "status": "success",
            "filename": filename,
            "document_type": result.document_type.value,
            "total_pages": result.total_pages,
            "chunks_total": 0,
            "chunks_ingested": 0,
            "user_id": user_id,
            "metadata": result.metadata,
        }

    # Process chunks concurrently using ThreadPoolExecutor
    ingested = 0
    failed = 0
    
    logger.info(f"Starting concurrent ingestion with {MAX_WORKERS} threads")
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all chunks to the thread pool
        futures = {
            executor.submit(
                _store_single_chunk,
                doc,
                filename,
                user_id,
                username,
                result.document_type.value,
                idx,
            ): idx
            for idx, doc in enumerate(result.documents)
        }
        
        # Process completed futures as they finish
        completed = 0
        for future in as_completed(futures):
            chunk_idx, success, error = future.result()
            completed += 1
            
            if success:
                ingested += 1
            else:
                failed += 1
            
            # Log progress every 10% or every 20 chunks
            if completed % max(1, total_chunks // 10) == 0 or completed % 20 == 0:
                progress = (completed / total_chunks) * 100
                logger.info(
                    f"Ingestion progress: {progress:.1f}% "
                    f"({ingested} stored, {failed} failed, {completed}/{total_chunks} processed)"
                )

    logger.info(
        f"Completed ingestion: {ingested}/{total_chunks} chunks stored, {failed} failed"
    )
    
    return {
        "status": "success" if failed == 0 else "partial",
        "filename": filename,
        "document_type": result.document_type.value,
        "total_pages": result.total_pages,
        "chunks_total": total_chunks,
        "chunks_ingested": ingested,
        "chunks_failed": failed,
        "user_id": user_id,
        "metadata": result.metadata,
    }
