
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import BinaryIO, Optional


class DocumentType(Enum):
    """Supported document types."""

    PDF = "pdf"
    EXCEL = "excel"
    WORD = "word"
    CSV = "csv"
    TEXT = "text"
    MARKDOWN = "markdown"
    HTML = "html"
    UNKNOWN = "unknown"


@dataclass
class LoadedDocument:

    content: str
    page: Optional[int | str] = None
    metadata: dict = field(default_factory=dict)

    def is_empty(self) -> bool:
        """Check if the document chunk has meaningful content."""
        return not self.content or not self.content.strip()


@dataclass
class LoaderResult:


    success: bool
    documents: list[LoadedDocument]
    filename: str
    document_type: DocumentType
    total_pages: int = 0
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    @property
    def chunk_count(self) -> int:
        """Return the number of non-empty chunks."""
        return sum(1 for doc in self.documents if not doc.is_empty())


class BaseDocumentLoader(ABC):
    """
    Base class for document loaders.
    
    Increased chunk size (2000) for better performance with large documents.
    Larger chunks = fewer vectors = faster ingestion and search.
    """

    DEFAULT_CHUNK_SIZE = 2000  # Increased from 1000 for better performance
    DEFAULT_CHUNK_OVERLAP = 200

    def __init__(
        self,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    ):

        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    @property
    @abstractmethod
    def supported_extensions(self) -> list[str]:

        pass

    @property
    @abstractmethod
    def document_type(self) -> DocumentType:

        pass

    @abstractmethod
    def load(self, file_content: bytes, filename: str) -> LoaderResult:

        pass

    @abstractmethod
    def validate(self, file_content: bytes, filename: str) -> tuple[bool, Optional[str]]:

        pass

    def can_handle(self, filename: str) -> bool:

        ext = os.path.splitext(filename.lower())[1]
        return ext in self.supported_extensions

    def get_extension(self, filename: str) -> str:
        """Extract the file extension from a filename."""
        return os.path.splitext(filename.lower())[1]
