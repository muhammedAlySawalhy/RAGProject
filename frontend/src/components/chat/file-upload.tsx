"use client";

import * as React from "react";
import { useCallback, useState, useEffect } from "react";
import { useDropzone, FileRejection } from "react-dropzone";
import { cn, formatFileSize, generateId } from "@/lib/utils";
import { documentApi } from "@/lib/api";
import {
  IngestDocumentResponse,
  DocumentType,
  getDocumentTypeFromFilename,
  FILE_TYPE_LABELS,
} from "@/types";
import { Button } from "@/components/ui/button";

/**
 * File upload status
 */
type UploadStatus = "pending" | "uploading" | "success" | "error";

/**
 * Tracked file with upload state
 */
interface TrackedFile {
  id: string;
  file: File;
  type: DocumentType;
  status: UploadStatus;
  progress: number;
  error?: string;
  result?: IngestDocumentResponse;
}

export interface FileUploadProps {
  /** Callback when all uploads complete */
  onUploadComplete?: (results: IngestDocumentResponse[]) => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
  /** Accepted file types (default: PDF and Excel) */
  accept?: Record<string, string[]>;
  /** Maximum number of files (default: 10) */
  maxFiles?: number;
  /** Maximum file size in MB (default: 50) */
  maxSizeMb?: number;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Additional class names */
  className?: string;
}

// Default accepted file types
const DEFAULT_ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.ms-excel": [".xls"],
};

/**
 * FileUpload component for uploading documents
 *
 * Supports:
 * - PDF files (.pdf)
 * - Excel files (.xlsx, .xls)
 *
 * Features:
 * - Drag and drop support
 * - Multiple file upload
 * - Progress tracking
 * - Error handling
 * - File type and size validation
 */
export function FileUpload({
  onUploadComplete,
  onError,
  accept = DEFAULT_ACCEPT,
  maxFiles = 10,
  maxSizeMb = 50,
  disabled = false,
  className,
}: FileUploadProps) {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [supportedExtensions, setSupportedExtensions] = useState<string[]>([
    ".pdf",
    ".xlsx",
    ".xls",
  ]);

  const CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5MB chunks
  const CHUNK_THRESHOLD_BYTES = 4 * 1024 * 1024; // switch to chunked upload above 4MB
  const CHUNK_CONCURRENCY = 4;

  // Fetch supported formats on mount
  useEffect(() => {
    documentApi
      .getSupportedFormats()
      .then((response) => {
        setSupportedExtensions(response.supported_extensions);
      })
      .catch(() => {
        // Use defaults on error
      });
  }, []);

  // Handle file drop/selection
  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      // Handle rejected files
      if (rejectedFiles.length > 0) {
        const errors = rejectedFiles.map((rejection) => {
          const error = rejection.errors[0];
          if (error.code === "file-too-large") {
            return `${rejection.file.name}: File too large (max ${maxSizeMb}MB)`;
          }
          if (error.code === "file-invalid-type") {
            return `${rejection.file.name}: Invalid file type. Supported: ${supportedExtensions.join(", ")}`;
          }
          return `${rejection.file.name}: ${error.message}`;
        });
        onError?.(errors.join("\n"));
      }

      // Add accepted files to the list
      const newFiles: TrackedFile[] = acceptedFiles.map((file) => ({
        id: generateId(),
        file,
        type: getDocumentTypeFromFilename(file.name),
        status: "pending",
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
    },
    [maxSizeMb, onError, supportedExtensions],
  );

  // Configure dropzone
  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    onDrop,
    accept,
    maxFiles,
    maxSize: maxSizeMb * 1024 * 1024,
    disabled: disabled || isUploading,
    multiple: true,
  });

  // Upload a single file
  const uploadFile = async (trackedFile: TrackedFile): Promise<TrackedFile> => {
    // Update status to uploading
    setFiles((prev) =>
      prev.map((f) =>
        f.id === trackedFile.id
          ? { ...f, status: "uploading" as UploadStatus, progress: 0 }
          : f,
      ),
    );

    try {
      const result = await documentApi.ingest(trackedFile.file, {
        useChunking: true,
        chunkSize: CHUNK_SIZE_BYTES,
        thresholdBytes: CHUNK_THRESHOLD_BYTES,
        concurrency: CHUNK_CONCURRENCY,
        uploadId: `${trackedFile.id}-${trackedFile.file.name}`,
        onChunkProgress: (uploadedBytes, totalBytes) => {
          const pct = Math.min(
            99,
            Math.round((uploadedBytes / totalBytes) * 100),
          );
          setFiles((prev) =>
            prev.map((f) =>
              f.id === trackedFile.id ? { ...f, progress: pct } : f,
            ),
          );
        },
      });

      setFiles((prev) =>
        prev.map((f) =>
          f.id === trackedFile.id
            ? { ...f, status: "success" as UploadStatus, progress: 100, result }
            : f,
        ),
      );

      return { ...trackedFile, status: "success", progress: 100, result };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";

      setFiles((prev) =>
        prev.map((f) =>
          f.id === trackedFile.id
            ? { ...f, status: "error" as UploadStatus, error: errorMessage }
            : f,
        ),
      );

      return { ...trackedFile, status: "error", error: errorMessage };
    }
  };

  // Upload all pending files
  const handleUpload = async () => {
    const pendingFiles = files.filter((f) => f.status === "pending");
    if (pendingFiles.length === 0) return;

    setIsUploading(true);

    const results: IngestDocumentResponse[] = [];

    // Upload files sequentially to avoid overwhelming the server
    for (const trackedFile of pendingFiles) {
      const result = await uploadFile(trackedFile);
      if (result.result) {
        results.push(result.result);
      }
    }

    setIsUploading(false);

    // Notify parent of completed uploads
    if (results.length > 0) {
      onUploadComplete?.(results);
    }
  };

  // Remove a file from the list
  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Clear all files
  const clearFiles = () => {
    setFiles([]);
  };

  // Calculate stats
  const pendingCount = files.filter((f) => f.status === "pending").length;
  const uploadingCount = files.filter((f) => f.status === "uploading").length;
  const successCount = files.filter((f) => f.status === "success").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const totalChunks = files
    .filter((f) => f.result)
    .reduce((sum, f) => sum + (f.result?.chunks_ingested || 0), 0);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center",
          "rounded-lg border-2 border-dashed p-8",
          "cursor-pointer transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDragActive && "border-primary bg-primary/5",
          isDragAccept && "border-green-500 bg-green-500/5",
          isDragReject && "border-destructive bg-destructive/5",
          !isDragActive && "border-border hover:border-muted-foreground/50",
          (disabled || isUploading) && "cursor-not-allowed opacity-50",
        )}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-2 text-center">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              isDragActive ? "bg-primary/10" : "bg-muted",
            )}
          >
            <UploadIcon
              className={cn(
                "h-6 w-6",
                isDragActive ? "text-primary" : "text-muted-foreground",
              )}
            />
          </div>

          <div>
            <p className="text-sm font-medium">
              {isDragActive
                ? "Drop files here"
                : "Drag & drop files here, or click to select"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF and Excel files up to {maxSizeMb}MB (max {maxFiles} files)
            </p>
          </div>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {files.length} file{files.length !== 1 ? "s" : ""} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFiles}
              disabled={isUploading}
            >
              Clear all
            </Button>
          </div>

          <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
            {files.map((trackedFile) => (
              <FileItem
                key={trackedFile.id}
                file={trackedFile}
                onRemove={() => removeFile(trackedFile.id)}
                disabled={isUploading}
              />
            ))}
          </div>
        </div>
      )}

      {/* Upload button and stats */}
      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {successCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircleIcon className="h-4 w-4" />
                {successCount} uploaded ({totalChunks} chunks)
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircleIcon className="h-4 w-4" />
                {errorCount} failed
              </span>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={pendingCount === 0 || isUploading}
          >
            {isUploading ? (
              <span className="flex items-center gap-2">
                <LoaderIcon className="h-4 w-4 animate-spin" />
                Uploading ({uploadingCount}/{pendingCount + uploadingCount})
              </span>
            ) : (
              `Upload ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Individual file item in the upload list
 */
interface FileItemProps {
  file: TrackedFile;
  onRemove: () => void;
  disabled?: boolean;
}

function FileItem({ file, onRemove, disabled }: FileItemProps) {
  const isUploading = file.status === "uploading";
  const isSuccess = file.status === "success";
  const isError = file.status === "error";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3",
        isSuccess &&
          "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
        isError && "border-destructive/50 bg-destructive/5",
      )}
    >
      {/* File icon */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          isSuccess
            ? "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
            : isError
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
        )}
      >
        {isUploading ? (
          <LoaderIcon className="h-5 w-5 animate-spin" />
        ) : isSuccess ? (
          <CheckCircleIcon className="h-5 w-5" />
        ) : isError ? (
          <AlertCircleIcon className="h-5 w-5" />
        ) : (
          <FileTypeIcon type={file.type} className="h-5 w-5" />
        )}
      </div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.file.name}</p>
        <p className="text-xs text-muted-foreground">
          {isSuccess && file.result
            ? `${file.result.total_pages} pages, ${file.result.chunks_ingested} chunks`
            : isError && file.error
              ? file.error
              : `${FILE_TYPE_LABELS[file.type]} • ${formatFileSize(file.file.size)}`}
        </p>
      </div>

      {/* Remove button */}
      {!isUploading && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onRemove}
          disabled={disabled}
        >
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Remove file</span>
        </Button>
      )}
    </div>
  );
}

/**
 * Compact file upload button variant
 */
export function FileUploadButton({
  onUploadComplete,
  onError,
  disabled,
  className,
}: Omit<FileUploadProps, "accept" | "maxFiles" | "maxSizeMb">) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsUploading(true);
    const results: IngestDocumentResponse[] = [];

    for (const file of files) {
      try {
        const result = await documentApi.ingest(file);
        results.push(result);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Upload failed");
      }
    }

    setIsUploading(false);

    if (results.length > 0) {
      onUploadComplete?.(results);
    }

    // Reset input
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isUploading}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading}
        className={className}
      >
        <UploadIcon className="mr-2 h-4 w-4" />
        {isUploading ? "Uploading..." : "Upload Documents"}
      </Button>
    </>
  );
}

// =============================================================================
// Icons
// =============================================================================

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function FileTypeIcon({
  type,
  className,
}: {
  type: DocumentType;
  className?: string;
}) {
  if (type === "pdf") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    );
  }

  if (type === "excel") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
        <line x1="8" y1="9" x2="16" y2="9" />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default FileUpload;
