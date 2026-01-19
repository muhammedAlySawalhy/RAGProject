/**
 * API Types for RAG Chat Application
 * These types correspond to the FastAPI backend endpoints
 */

// ============================================================================
// Authentication Types
// ============================================================================

export interface UserRegister {
  username: string;
  email: string;
  password: string;
  full_name?: string;
}

export interface UserLogin {
  username: string;
  password: string;
}

export interface UserResponse {
  user_id: string;
  username: string;
  email: string;
  full_name?: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserResponse;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: UserResponse | null;
  token: string | null;
  expiresAt: number | null;
}

// ============================================================================
// User & Session Types
// ============================================================================

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  avatar?: string;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "sending" | "sent" | "error";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  status?: MessageStatus;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  jobId?: string;
  sources?: Source[];
  processingTime?: number;
  model?: string;
}

export interface Source {
  filename?: string;
  page?: number | string;
  content?: string;
  score?: number;
}

// ============================================================================
// Chat & Conversation Types
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  userId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// Document Types
// ============================================================================

export type DocumentType =
  | "pdf"
  | "excel"
  | "word"
  | "csv"
  | "text"
  | "markdown"
  | "html"
  | "unknown";

export interface DocumentInfo {
  filename: string;
  chunk_count: number;
  page_count: number;
  document_type?: DocumentType;
}

export interface SupportedFormat {
  extensions: string[];
  document_type: string;
}

export interface SupportedFormatsResponse {
  status: string;
  supported_extensions: string[];
  loaders: Record<string, SupportedFormat>;
  default_settings: {
    chunk_size: number;
    chunk_overlap: number;
  };
}

// ============================================================================
// API Request Types
// ============================================================================

export interface ChatRequest {
  query: string;
}

export interface IngestDocumentRequest {
  file: File;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ChatResponse {
  status: "queued";
  job_id: string;
  job_status: JobStatusType;
  user_id: string;
}

export type JobStatusType =
  | "queued"
  | "started"
  | "deferred"
  | "finished"
  | "stopped"
  | "scheduled"
  | "failed";

export interface JobStatusResponse {
  status: JobStatusType | "not_found";
  result?: string;
  error?: string;
}

export interface JobRecord {
  job_id: string;
  query: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface JobListResponse {
  status: string;
  user_id: string;
  count: number;
  jobs: JobRecord[];
}

export interface IngestDocumentResponse {
  status: "success" | "error";
  filename: string;
  document_type: DocumentType;
  total_pages: number;
  chunks_total: number;
  chunks_ingested: number;
  user_id: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

// Legacy type alias for backwards compatibility
export type IngestPdfResponse = IngestDocumentResponse;

export interface DocumentListResponse {
  status: string;
  user_id: string;
  document_count: number;
  documents: DocumentInfo[];
}

export interface DeleteDocumentResponse {
  status: string;
  user_id: string;
  filename: string;
  deleted_chunks: number;
  message: string;
}

export interface DeleteAllDocumentsResponse {
  status: string;
  user_id: string;
  deleted_chunks: number;
  message: string;
}

export interface ChatHistoryItem {
  content: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatHistoryResponse {
  status: string;
  user_id: string;
  count: number;
  history: ChatHistoryItem[];
}

export interface HealthResponse {
  status: string;
}

export interface AuthHealthResponse {
  status: string;
  database: string;
}

// ============================================================================
// UI State Types
// ============================================================================

export interface UIState {
  sidebarOpen: boolean;
  theme: "light" | "dark" | "system";
  uploadModalOpen: boolean;
  settingsModalOpen: boolean;
  authModalOpen: boolean;
  authModalMode: "login" | "register";
}

export interface UploadState {
  isUploading: boolean;
  progress: number;
  files: UploadFile[];
  error: string | null;
}

export interface UploadFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: DocumentType;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
  result?: IngestDocumentResponse;
}

// ============================================================================
// Polling & Job Tracking Types
// ============================================================================

export interface PendingJob {
  jobId: string;
  messageId: string;
  conversationId: string;
  query: string;
  startedAt: Date;
  pollCount: number;
}

export interface JobTracker {
  pendingJobs: Map<string, PendingJob>;
  maxPollAttempts: number;
  pollIntervalMs: number;
}

// ============================================================================
// Error Types
// ============================================================================

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
}

export class ChatError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ============================================================================
// Settings Types
// ============================================================================

export interface AppSettings {
  userId: string;
  theme: "light" | "dark" | "system";
  pollIntervalMs: number;
  maxPollAttempts: number;
  autoScroll: boolean;
  soundEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  userId: "",
  theme: "system",
  pollIntervalMs: 1000,
  maxPollAttempts: 120,
  autoScroll: true,
  soundEnabled: false,
};

// ============================================================================
// Component Props Types
// ============================================================================

export interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
}

export interface MessageBubbleProps {
  message: Message;
}

export interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export interface FileUploadProps {
  onUploadComplete?: (results: IngestDocumentResponse[]) => void;
  onError?: (error: string) => void;
  accept?: string;
  maxFiles?: number;
  maxSizeMb?: number;
}

export interface AuthFormProps {
  mode: "login" | "register";
  onSuccess?: () => void;
  onModeChange?: (mode: "login" | "register") => void;
}

export interface DocumentListProps {
  documents: DocumentInfo[];
  onDelete?: (filename: string) => void;
  isLoading?: boolean;
}

// ============================================================================
// Utility Types
// ============================================================================

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export interface AsyncState<T> {
  data: T | null;
  status: AsyncStatus;
  error: string | null;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ============================================================================
// File Type Utilities
// ============================================================================

export const SUPPORTED_FILE_EXTENSIONS: Record<DocumentType, string[]> = {
  pdf: [".pdf"],
  excel: [".xlsx", ".xls"],
  word: [".docx", ".doc"],
  csv: [".csv"],
  text: [".txt"],
  markdown: [".md", ".markdown"],
  html: [".html", ".htm"],
  unknown: [],
};

export const FILE_TYPE_LABELS: Record<DocumentType, string> = {
  pdf: "PDF Document",
  excel: "Excel Spreadsheet",
  word: "Word Document",
  csv: "CSV File",
  text: "Text File",
  markdown: "Markdown",
  html: "HTML Document",
  unknown: "Unknown",
};

export function getDocumentTypeFromFilename(filename: string): DocumentType {
  const ext = filename.toLowerCase().split(".").pop();
  if (!ext) return "unknown";

  for (const [type, extensions] of Object.entries(SUPPORTED_FILE_EXTENSIONS)) {
    if (extensions.includes(`.${ext}`)) {
      return type as DocumentType;
    }
  }
  return "unknown";
}

export function isFileTypeSupported(
  filename: string,
  supportedExtensions: string[],
): boolean {
  const ext = "." + filename.toLowerCase().split(".").pop();
  return supportedExtensions.includes(ext);
}
