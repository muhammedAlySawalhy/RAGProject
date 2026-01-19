"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { documentApi } from "@/lib/api";
import { DocumentInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import { FileText, Trash2, RefreshCw, AlertCircle } from "lucide-react";

export interface DocumentListProps {
    /** Callback when a document is deleted */
    onDocumentDeleted?: (filename: string) => void;
    /** Additional class names */
    className?: string;
}

/**
 * DocumentList component for viewing and managing uploaded documents
 *
 * Features:
 * - List all uploaded documents
 * - Show document metadata (filename, pages, chunks)
 * - Delete individual documents
 * - Refresh document list
 */
export function DocumentList({
    onDocumentDeleted,
    className,
}: DocumentListProps) {
    const [documents, setDocuments] = useState<DocumentInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Fetch documents on mount
    const fetchDocuments = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await documentApi.listDocuments();
            setDocuments(response.documents || []);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load documents";
            setError(message);
            console.error("Failed to fetch documents:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    // Delete a document
    const handleDelete = async (filename: string) => {
        if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
            return;
        }

        setDeletingId(filename);
        try {
            await documentApi.deleteDocument(filename);
            setDocuments((prev) => prev.filter((doc) => doc.filename !== filename));
            onDocumentDeleted?.(filename);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to delete document";
            setError(message);
            console.error("Failed to delete document:", err);
        } finally {
            setDeletingId(null);
        }
    };

    // Get icon based on document type
    const getDocumentIcon = (doc: DocumentInfo) => {
        const type = doc.document_type || "unknown";
        switch (type) {
            case "pdf":
                return "📄";
            case "excel":
                return "📊";
            case "word":
                return "📝";
            default:
                return "📁";
        }
    };

    if (isLoading) {
        return (
            <div className={cn("flex items-center justify-center py-8", className)}>
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading documents...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className={cn("rounded-lg border border-destructive/50 bg-destructive/10 p-4", className)}>
                <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    <span>{error}</span>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={fetchDocuments}
                >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                </Button>
            </div>
        );
    }

    if (documents.length === 0) {
        return (
            <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
                <FileText className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-2 text-muted-foreground">No documents uploaded yet</p>
                <p className="text-sm text-muted-foreground/70">
                    Upload documents to start asking questions
                </p>
            </div>
        );
    }

    return (
        <div className={cn("space-y-2", className)}>
            {/* Header with refresh button */}
            <div className="flex items-center justify-between pb-2">
                <span className="text-sm text-muted-foreground">
                    {documents.length} document{documents.length !== 1 ? "s" : ""} uploaded
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchDocuments}
                    disabled={isLoading}
                >
                    <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
            </div>

            {/* Document list */}
            <div className="space-y-2">
                {documents.map((doc) => (
                    <div
                        key={doc.filename}
                        className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="text-2xl flex-shrink-0">{getDocumentIcon(doc)}</span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium" title={doc.filename}>
                                    {doc.filename}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {doc.page_count > 0 && `${doc.page_count} pages • `}
                                    {doc.chunk_count} chunks
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
                            onClick={() => handleDelete(doc.filename)}
                            disabled={deletingId === doc.filename}
                            title="Delete document"
                        >
                            {deletingId === doc.filename ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <Trash2 className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default DocumentList;
