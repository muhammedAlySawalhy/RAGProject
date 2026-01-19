

import io
import os
import tempfile
from typing import Optional

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from .base import BaseDocumentLoader, DocumentType, LoadedDocument, LoaderResult


class PDFLoader(BaseDocumentLoader):
    """
    PDF document loader using PyPDFLoader and pypdf.

    Supports:
        - Single and multi-page PDFs
        - Text extraction with page tracking
        - Automatic chunking with configurable size and overlap
    """

    @property
    def supported_extensions(self) -> list[str]:
        """PDF files only."""
        return [".pdf"]

    @property
    def document_type(self) -> DocumentType:
        """Return PDF document type."""
        return DocumentType.PDF

    def validate(self, file_content: bytes, filename: str) -> tuple[bool, Optional[str]]:
        """
        Validate that the file is a valid PDF.

        Checks:
            - File is not empty
            - File can be parsed as PDF
            - PDF has at least one page
        """
        if not file_content:
            return False, "File is empty"

        if not self.can_handle(filename):
            return False, f"File extension not supported. Expected: {self.supported_extensions}"

        try:
            pdf_reader = PdfReader(io.BytesIO(file_content))
            if len(pdf_reader.pages) == 0:
                return False, "PDF has no pages"
            return True, None
        except Exception as e:
            return False, f"Invalid PDF file: {str(e)}"

    def load(self, file_content: bytes, filename: str) -> LoaderResult:
        """
        Load and parse a PDF document.

        Process:
            1. Validate the PDF
            2. Extract text using PyPDFLoader
            3. Split into chunks with overlap
            4. Return structured result with page information
        """
        # Validate first
        is_valid, error = self.validate(file_content, filename)
        if not is_valid:
            return LoaderResult(
                success=False,
                documents=[],
                filename=filename,
                document_type=self.document_type,
                error=error,
            )

        # Get page count
        try:
            pdf_reader = PdfReader(io.BytesIO(file_content))
            total_pages = len(pdf_reader.pages)
        except Exception as e:
            return LoaderResult(
                success=False,
                documents=[],
                filename=filename,
                document_type=self.document_type,
                error=f"Failed to read PDF: {str(e)}",
            )

        # Write to temp file for PyPDFLoader
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(file_content)
                tmp_path = tmp.name

            # Load with PyPDFLoader
            loader = PyPDFLoader(tmp_path)
            docs = loader.load()

        except Exception as e:
            return LoaderResult(
                success=False,
                documents=[],
                filename=filename,
                document_type=self.document_type,
                total_pages=total_pages,
                error=f"Failed to parse PDF: {str(e)}",
            )
        finally:
            # Clean up temp file
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

        # Split into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
        )
        chunks = text_splitter.split_documents(documents=docs)

        # Convert to LoadedDocument instances
        documents = []
        for chunk in chunks:
            page = chunk.metadata.get("page", None)
            # Convert to 1-indexed page number
            page_label = page + 1 if isinstance(page, int) else page

            content = chunk.page_content.strip()
            if not content:
                continue

            documents.append(
                LoadedDocument(
                    content=content,
                    page=page_label,
                    metadata={
                        "source": chunk.metadata.get("source", filename),
                        "page": page_label,
                    },
                )
            )

        return LoaderResult(
            success=True,
            documents=documents,
            filename=filename,
            document_type=self.document_type,
            total_pages=total_pages,
            metadata={
                "chunk_size": self.chunk_size,
                "chunk_overlap": self.chunk_overlap,
                "raw_chunk_count": len(chunks),
            },
        )
