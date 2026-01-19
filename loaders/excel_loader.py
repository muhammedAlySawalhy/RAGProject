
import io
from typing import Optional

import pandas as pd

from .base import BaseDocumentLoader, DocumentType, LoadedDocument, LoaderResult


class ExcelLoader(BaseDocumentLoader):



    DEFAULT_ROWS_PER_CHUNK = 50

    def __init__(
        self,
        chunk_size: int = BaseDocumentLoader.DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = BaseDocumentLoader.DEFAULT_CHUNK_OVERLAP,
        rows_per_chunk: int = DEFAULT_ROWS_PER_CHUNK,
        include_headers: bool = True,
    ):

        super().__init__(chunk_size, chunk_overlap)
        self.rows_per_chunk = rows_per_chunk
        self.include_headers = include_headers

    @property
    def supported_extensions(self) -> list[str]:

        return [".xlsx", ".xls"]

    @property
    def document_type(self) -> DocumentType:
        """Return Excel document type."""
        return DocumentType.EXCEL

    def validate(self, file_content: bytes, filename: str) -> tuple[bool, Optional[str]]:

        if not file_content:
            return False, "File is empty"

        if not self.can_handle(filename):
            return False, f"File extension not supported. Expected: {self.supported_extensions}"

        try:
            # Try to read the Excel file
            excel_file = pd.ExcelFile(io.BytesIO(file_content))

            if len(excel_file.sheet_names) == 0:
                return False, "Excel file has no sheets"

            # Check if at least one sheet has data
            has_data = False
            for sheet_name in excel_file.sheet_names:
                df = pd.read_excel(excel_file, sheet_name=sheet_name)
                if not df.empty:
                    has_data = True
                    break

            if not has_data:
                return False, "Excel file has no data in any sheet"

            return True, None

        except Exception as e:
            return False, f"Invalid Excel file: {str(e)}"

    def _dataframe_to_text(self, df: pd.DataFrame, sheet_name: str) -> str:

        if df.empty:
            return ""

        lines = []


        headers = df.columns.tolist()
        if headers:
            lines.append("Columns: " + " | ".join(str(h) for h in headers))
            lines.append("-" * 50)

        for idx, row in df.iterrows():
            row_values = []
            for col in headers:
                value = row[col]

                if pd.isna(value):
                    value = ""
                row_values.append(f"{col}: {value}")
            lines.append(" | ".join(row_values))

        return "\n".join(lines)

    def _chunk_dataframe(
        self, df: pd.DataFrame, sheet_name: str, filename: str
    ) -> list[LoadedDocument]:

        if df.empty:
            return []

        documents = []
        total_rows = len(df)
        headers = df.columns.tolist()


        for start_idx in range(0, total_rows, self.rows_per_chunk):
            end_idx = min(start_idx + self.rows_per_chunk, total_rows)
            chunk_df = df.iloc[start_idx:end_idx]

            lines = []

            # Add headers to each chunk if configured
            if self.include_headers and headers:
                lines.append("Columns: " + " | ".join(str(h) for h in headers))
                lines.append("-" * 50)


            for _, row in chunk_df.iterrows():
                row_parts = []
                for col in headers:
                    value = row[col]
                    if pd.isna(value):
                        value = ""
                    row_parts.append(f"{col}: {value}")
                lines.append(" | ".join(row_parts))

            content = "\n".join(lines)


            if not content.strip():
                continue


            if len(content) > self.chunk_size:

                current_chunk = []
                current_size = 0

                for line in lines:
                    line_size = len(line) + 1  # +1 for newline
                    if current_size + line_size > self.chunk_size and current_chunk:
                        documents.append(
                            LoadedDocument(
                                content="\n".join(current_chunk),
                                page=sheet_name,
                                metadata={
                                    "sheet": sheet_name,
                                    "row_start": start_idx + 1,
                                    "row_end": end_idx,
                                    "source": filename,
                                },
                            )
                        )
                        current_chunk = []
                        current_size = 0

                    current_chunk.append(line)
                    current_size += line_size

                # Add remaining content
                if current_chunk:
                    documents.append(
                        LoadedDocument(
                            content="\n".join(current_chunk),
                            page=sheet_name,
                            metadata={
                                "sheet": sheet_name,
                                "row_start": start_idx + 1,
                                "row_end": end_idx,
                                "source": filename,
                            },
                        )
                    )
            else:
                documents.append(
                    LoadedDocument(
                        content=content,
                        page=sheet_name,
                        metadata={
                            "sheet": sheet_name,
                            "row_start": start_idx + 1,
                            "row_end": end_idx,
                            "source": filename,
                        },
                    )
                )

        return documents

    def load(self, file_content: bytes, filename: str) -> LoaderResult:


        is_valid, error = self.validate(file_content, filename)
        if not is_valid:
            return LoaderResult(
                success=False,
                documents=[],
                filename=filename,
                document_type=self.document_type,
                error=error,
            )

        try:
            excel_file = pd.ExcelFile(io.BytesIO(file_content))
            sheet_names = excel_file.sheet_names
            total_sheets = len(sheet_names)

            all_documents = []
            sheet_info = {}

            for sheet_name in sheet_names:
                df = pd.read_excel(excel_file, sheet_name=sheet_name)

                # Store sheet info
                sheet_info[sheet_name] = {
                    "rows": len(df),
                    "columns": len(df.columns),
                    "column_names": df.columns.tolist(),
                }

                # Skip empty sheets
                if df.empty:
                    continue

                # Chunk the dataframe
                sheet_docs = self._chunk_dataframe(df, sheet_name, filename)
                all_documents.extend(sheet_docs)

            return LoaderResult(
                success=True,
                documents=all_documents,
                filename=filename,
                document_type=self.document_type,
                total_pages=total_sheets,
                metadata={
                    "sheets": sheet_info,
                    "sheet_names": sheet_names,
                    "rows_per_chunk": self.rows_per_chunk,
                    "include_headers": self.include_headers,
                },
            )

        except Exception as e:
            return LoaderResult(
                success=False,
                documents=[],
                filename=filename,
                document_type=self.document_type,
                error=f"Failed to parse Excel file: {str(e)}",
            )
