

import os
from typing import Optional, Type

from .base import BaseDocumentLoader, DocumentType, LoaderResult


class DocumentLoaderFactory:


    # Registry of loader classes
    _loaders: dict[str, Type[BaseDocumentLoader]] = {}

    # Default loader settings
    _default_chunk_size: int = 2000
    _default_chunk_overlap: int = 200

    @classmethod
    def register_loader(cls, loader_class: Type[BaseDocumentLoader]) -> None:

        if not issubclass(loader_class, BaseDocumentLoader):
            raise ValueError(
                f"Loader class must inherit from BaseDocumentLoader, got {loader_class}"
            )

        # Create a temporary instance to get supported extensions
        temp_instance = loader_class()
        for ext in temp_instance.supported_extensions:
            ext_lower = ext.lower()
            cls._loaders[ext_lower] = loader_class

    @classmethod
    def unregister_loader(cls, extension: str) -> bool:

        ext_lower = extension.lower()
        if ext_lower in cls._loaders:
            del cls._loaders[ext_lower]
            return True
        return False

    @classmethod
    def get_loader(
        cls,
        filename: str,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
        **kwargs,
    ) -> Optional[BaseDocumentLoader]:

        ext = os.path.splitext(filename.lower())[1]

        loader_class = cls._loaders.get(ext)
        if loader_class is None:
            return None


        chunk_size = chunk_size or cls._default_chunk_size
        chunk_overlap = chunk_overlap or cls._default_chunk_overlap

        return loader_class(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            **kwargs,
        )

    @classmethod
    def load_document(
        cls,
        file_content: bytes,
        filename: str,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
        **kwargs,
    ) -> LoaderResult:

        loader = cls.get_loader(filename, chunk_size, chunk_overlap, **kwargs)

        if loader is None:
            ext = os.path.splitext(filename.lower())[1]
            return LoaderResult(
                success=False,
                documents=[],
                filename=filename,
                document_type=DocumentType.UNKNOWN,
                error=f"No loader available for extension '{ext}'. Supported: {cls.get_supported_extensions()}",
            )

        return loader.load(file_content, filename)

    @classmethod
    def is_supported(cls, filename: str) -> bool:

        ext = os.path.splitext(filename.lower())[1]
        return ext in cls._loaders

    @classmethod
    def get_supported_extensions(cls) -> list[str]:

        return sorted(cls._loaders.keys())

    @classmethod
    def get_supported_types(cls) -> list[DocumentType]:

        types = set()
        for loader_class in cls._loaders.values():
            temp_instance = loader_class()
            types.add(temp_instance.document_type)
        return sorted(types, key=lambda x: x.value)

    @classmethod
    def set_defaults(cls, chunk_size: int = 1000, chunk_overlap: int = 200) -> None:

        cls._default_chunk_size = chunk_size
        cls._default_chunk_overlap = chunk_overlap

    @classmethod
    def get_loader_info(cls) -> dict:

        info = {
            "supported_extensions": cls.get_supported_extensions(),
            "default_chunk_size": cls._default_chunk_size,
            "default_chunk_overlap": cls._default_chunk_overlap,
            "loaders": {},
        }


        loader_classes_seen = set()
        for ext, loader_class in cls._loaders.items():
            class_name = loader_class.__name__
            if class_name not in loader_classes_seen:
                loader_classes_seen.add(class_name)
                temp_instance = loader_class()
                info["loaders"][class_name] = {
                    "extensions": temp_instance.supported_extensions,
                    "document_type": temp_instance.document_type.value,
                }

        return info



def _register_builtin_loaders():

    from .pdf_loader import PDFLoader
    from .excel_loader import ExcelLoader

    DocumentLoaderFactory.register_loader(PDFLoader)
    DocumentLoaderFactory.register_loader(ExcelLoader)


# Register loaders when module is imported
_register_builtin_loaders()
