"""
Document Loaders Module

Provides a factory pattern for loading different document types.
Extensible architecture for adding new document formats.
"""

from .base import BaseDocumentLoader, LoadedDocument, LoaderResult
from .factory import DocumentLoaderFactory
from .pdf_loader import PDFLoader
from .excel_loader import ExcelLoader

__all__ = [
    "BaseDocumentLoader",
    "LoadedDocument",
    "LoaderResult",
    "DocumentLoaderFactory",
    "PDFLoader",
    "ExcelLoader",
]
