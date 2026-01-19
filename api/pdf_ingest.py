"""
Document Ingestion API

Provides endpoints for ingesting various document types (PDF, Excel, etc.)
using a factory pattern for extensible document loading.

Supports:
    - PDF files (.pdf)
    - Excel files (.xlsx, .xls)
    - Extensible for future document types
"""

import os
import re

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, status

from api.auth import CurrentUser, get_current_user
from loaders import DocumentLoaderFactory
from memory import mem_client, qdrant_manager

DOCUMENT_SOURCE = "document"

router = APIRouter()


def _ingest_file_content(content: bytes, filename: str, current_user: CurrentUser):
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

    result = DocumentLoaderFactory.load_document(content, filename)

    if not result.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.error or "Failed to parse document",
        )

    ingested = 0
    for doc in result.documents:
        if doc.is_empty():
            continue

        message = {
            "role": "user",
            "content": (
                f"Document: {filename}\n"
                f"Page/Sheet: {doc.page}\n"
                f"Content:\n{doc.content}"
            ),
        }

        # Store with user_id from authenticated user - ensuring data isolation
        mem_client.add(
            [message],
            user_id=current_user.user_id,
            infer=False,
            metadata={
                "source": DOCUMENT_SOURCE,
                "filename": filename,
                "page": doc.page,
                "document_type": result.document_type.value,
                "owner_id": current_user.user_id,
                "owner_username": current_user.username,
                **doc.metadata,  # Include any loader-specific metadata
            },
        )
        ingested += 1

    return {
        "status": "success",
        "filename": filename,
        "document_type": result.document_type.value,
        "total_pages": result.total_pages,
        "chunks_total": len(result.documents),
        "chunks_ingested": ingested,
        "user_id": current_user.user_id,
        "metadata": result.metadata,
    }


# =============================================================================
# Document Ingestion Endpoints
# =============================================================================


@router.post("/ingest")
async def ingest_document(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Ingest a document for the authenticated user.

    Supports multiple file types through the document loader factory:
        - PDF (.pdf)
        - Excel (.xlsx, .xls)

    The document is chunked and stored in the user's memory space.
    Only the authenticated user can later retrieve these documents.
    """
    filename = file.filename or "unknown"
    content = await file.read()
    return _ingest_file_content(content, filename, current_user)


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
