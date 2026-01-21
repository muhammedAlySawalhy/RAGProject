"""
Document Ingestion API

Provides endpoints for ingesting various document types (PDF, Excel, etc.)
using a factory pattern for extensible document loading.

Supports:
    - PDF files (.pdf)
    - Excel files (.xlsx, .xls)
    - Extensible for future document types
    
Ingestion modes:
    - Sync: Small files processed immediately
    - Async: Large files queued for background processing
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, status

from api.auth import CurrentUser, get_current_user
from loaders import DocumentLoaderFactory
from memory import mem_client, qdrant_manager
from rq_queue.client.rq_client import queue
from rq_queue.queues.worker import process_document_ingestion
import logging

logger = logging.getLogger(__name__)

DOCUMENT_SOURCE = "document"


ASYNC_THRESHOLD_BYTES = 1 * 1024 * 1024  # 1MB


MAX_WORKERS = 5

router = APIRouter()


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
            infer=True,  # Fast storage - embeddings only, no LLM extraction
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


def _ingest_file_content(content: bytes, filename: str, current_user: CurrentUser):
    """
    Ingest document content into the vector store using ThreadPoolExecutor.
    
    Uses concurrent processing to embed and store chunks in parallel,
    significantly improving performance for documents with many chunks.
    """
    # Log user info for debugging
    logger.info(f"Ingesting document for user: {current_user.username} (ID: {current_user.user_id})")
    
    # Check if file type is supported
    if not DocumentLoaderFactory.is_supported(filename):
        supported = DocumentLoaderFactory.get_supported_extensions()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported extensions: {', '.join(supported)}",
        )

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    logger.info(f"Loading document: {filename} ({len(content)} bytes)")
    result = DocumentLoaderFactory.load_document(content, filename)

    if not result.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.error or "Failed to parse document",
        )

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
            "user_id": current_user.user_id,
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
                current_user.user_id,
                current_user.username,
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

    logger.info(f"Completed ingestion: {ingested}/{total_chunks} chunks stored, {failed} failed")

    return {
        "status": "success" if failed == 0 else "partial",
        "filename": filename,
        "document_type": result.document_type.value,
        "total_pages": result.total_pages,
        "chunks_total": total_chunks,
        "chunks_ingested": ingested,
        "chunks_failed": failed,
        "user_id": current_user.user_id,
        "metadata": result.metadata,
    }


def _enqueue_document_ingestion(content: bytes, filename: str, current_user: CurrentUser):
    """
    Enqueue document for background processing.
    Returns a job ID that can be polled for status.
    """
    # Validate file type first (fast check)
    if not DocumentLoaderFactory.is_supported(filename):
        supported = DocumentLoaderFactory.get_supported_extensions()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported extensions: {', '.join(supported)}",
        )

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    logger.info(f"Enqueuing document for background processing: {filename} ({len(content)} bytes)")
    
    # Enqueue the job
    job = queue.enqueue(
        process_document_ingestion,
        content,
        filename,
        current_user.user_id,
        current_user.username,
        job_timeout=600,  # 10 minute timeout for large files
    )
    
    return {
        "status": "queued",
        "job_id": job.id,
        "filename": filename,
        "file_size": len(content),
        "message": "Document queued for processing. Poll /ingest-status for progress.",
    }


# =============================================================================
# Document Ingestion Endpoints
# =============================================================================


@router.post("/ingest")
async def ingest_document(
    file: UploadFile = File(...),
    async_mode: bool = Query(False, description="Force async processing"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Ingest a document for the authenticated user.

    Supports multiple file types through the document loader factory:
        - PDF (.pdf)
        - Excel (.xlsx, .xls)

    Small files (<1MB) are processed synchronously.
    Large files are automatically queued for background processing.
    Use async_mode=true to force background processing.

    The document is chunked and stored in the user's memory space.
    Only the authenticated user can later retrieve these documents.
    """
    filename = file.filename or "unknown"
    content = await file.read()
    
    # Use async for large files or if explicitly requested
    if async_mode or len(content) > ASYNC_THRESHOLD_BYTES:
        return _enqueue_document_ingestion(content, filename, current_user)
    
    return _ingest_file_content(content, filename, current_user)


@router.post("/ingest-async")
async def ingest_document_async(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Ingest a document asynchronously (background processing).
    
    Always queues the document for background processing regardless of size.
    Returns a job_id that can be polled via /ingest-status endpoint.
    """
    filename = file.filename or "unknown"
    content = await file.read()
    return _enqueue_document_ingestion(content, filename, current_user)


@router.get("/ingest-status")
async def get_ingest_status(
    job_id: str = Query(..., description="Job ID from ingest-async"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get the status of an async document ingestion job.
    """
    from rq.job import Job, JobStatus
    from rq_queue.client.rq_client import redis_conn
    
    try:
        job = Job.fetch(job_id, connection=redis_conn)
    except Exception:
        return {
            "status": "not_found",
            "job_id": job_id,
            "error": "Job not found or expired",
        }
    
    status_map = {
        JobStatus.QUEUED: "queued",
        JobStatus.STARTED: "processing",
        JobStatus.FINISHED: "finished",
        JobStatus.FAILED: "failed",
        JobStatus.DEFERRED: "deferred",
        JobStatus.SCHEDULED: "scheduled",
        JobStatus.STOPPED: "stopped",
        JobStatus.CANCELED: "canceled",
    }
    
    job_status = status_map.get(job.get_status(), "unknown")
    
    response = {
        "status": job_status,
        "job_id": job_id,
    }
    
    if job_status == "finished":
        response["result"] = job.result
    elif job_status == "failed":
        response["error"] = str(job.exc_info) if job.exc_info else "Unknown error"
    
    return response


@router.post("/ingest-pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Ingest a PDF document for the authenticated user.

    This endpoint is kept for backwards compatibility.
    Consider using /ingest which supports multiple file types.
    """
    filename = file.filename or "document.pdf"

    # Validate PDF extension
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are accepted. Use /ingest for other file types.",
        )

    # Delegate to generic ingest
    # Reset file position after reading
    await file.seek(0)
    return await ingest_document(file=file, current_user=current_user)


@router.post("/ingest-excel")
async def ingest_excel(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):

    filename = file.filename or "document.xlsx"

    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only Excel files (.xlsx, .xls) are accepted.",
        )

    # Delegate to generic ingest
    await file.seek(0)
    return await ingest_document(file=file, current_user=current_user)


@router.post("/ingest-range")
async def ingest_document_range(
    file: UploadFile = File(...),
    upload_id: str = Query(..., description="Stable upload identifier for chunked uploads"),
    current_user: CurrentUser = Depends(get_current_user),
    content_range: str | None = Header(None, convert_underscores=False),
    x_content_range: str | None = Header(None, convert_underscores=False, alias="x-content-range"),
):
    """
    Ingest a document via chunked uploads using HTTP Content-Range.
    """
    # Accept either standard Content-Range or X-Content-Range (some proxies may rename headers)
    header_value = content_range or x_content_range
    if not header_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content-Range header is required for chunked uploads",
        )

    match = re.match(r"bytes (\d+)-(\d+)/(\d+)", header_value.strip())
    if not match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Content-Range format. Expected: bytes start-end/total",
        )

    start, end, total = map(int, match.groups())
    expected_length = end - start + 1

    content = await file.read()
    if len(content) != expected_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Chunk size mismatch. Expected {expected_length} bytes, received {len(content)} bytes",
        )

    upload_dir = os.getenv("UPLOAD_TEMP_DIR", "/tmp/rag_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    part_path = os.path.join(upload_dir, f"{upload_id}.part")

    mode = "r+b" if os.path.exists(part_path) else "wb"
    with open(part_path, mode) as f:
        f.seek(start)
        f.write(content)

    if end + 1 < total:
        return {
            "status": "partial",
            "upload_id": upload_id,
            "received": end + 1,
            "total": total,
        }

    with open(part_path, "rb") as f:
        full_content = f.read()

    filename = file.filename or "unknown"
    response = _ingest_file_content(full_content, filename, current_user)

    try:
        os.remove(part_path)
    except OSError:
        pass

    response["upload_id"] = upload_id
    response["bytes_received"] = total
    return response


# =============================================================================
# Document Management Endpoints
# =============================================================================


@router.get("/documents")
async def list_documents(
    limit: int = Query(default=100, ge=1, le=500, description="Maximum chunks to scan"),
    current_user: CurrentUser = Depends(get_current_user),
):

    result = qdrant_manager.get_user_document_list(
        user_id=current_user.user_id,
        limit=limit,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get("error", "Failed to retrieve documents"),
        )

    return {
        "status": "success",
        "user_id": current_user.user_id,
        "document_count": result["total_documents"],
        "documents": result["documents"],
    }


@router.delete("/documents/{filename:path}")
async def delete_document(
    filename: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Delete a specific document from the user's memory.

    This permanently removes all chunks associated with the filename
    from the vector database.

    Args:
        filename: The exact filename of the document to delete
    """
    result = qdrant_manager.delete_by_user_and_filename(
        user_id=current_user.user_id,
        filename=filename,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get("error", "Failed to delete document"),
        )

    return {
        "status": "success",
        "user_id": current_user.user_id,
        "filename": filename,
        "deleted_chunks": result["deleted_count"],
        "message": result["message"],
    }


@router.delete("/documents")
async def delete_all_documents(
    confirm: bool = Query(
        ...,
        description="Must be true to confirm deletion of all documents"
    ),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Delete ALL documents for the current user.

    WARNING: This is a destructive operation that removes all ingested
    documents. Chat history is preserved.

    Args:
        confirm: Must be explicitly set to true to proceed
    """
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must set confirm=true to delete all documents",
        )

    result = qdrant_manager.delete_by_source(
        user_id=current_user.user_id,
        source=DOCUMENT_SOURCE,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get("error", "Failed to delete documents"),
        )

    return {
        "status": "success",
        "user_id": current_user.user_id,
        "deleted_chunks": result["deleted_count"],
        "message": result["message"],
    }


# =============================================================================
# Utility Endpoints
# =============================================================================


@router.get("/supported-formats")
async def get_supported_formats():
    """
    Get information about supported document formats.

    Returns a list of supported file extensions and loader information.
    """
    info = DocumentLoaderFactory.get_loader_info()

    return {
        "status": "success",
        "supported_extensions": info["supported_extensions"],
        "loaders": info["loaders"],
        "default_settings": {
            "chunk_size": info["default_chunk_size"],
            "chunk_overlap": info["default_chunk_overlap"],
        },
    }
