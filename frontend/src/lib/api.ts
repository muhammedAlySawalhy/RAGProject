import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from "axios";
import {
  ChatResponse,
  JobStatusResponse,
  IngestDocumentResponse,
  HealthResponse,
  ChatError,
  AuthError,
  TokenResponse,
  UserLogin,
  UserRegister,
  UserResponse,
  DocumentListResponse,
  DeleteDocumentResponse,
  DeleteAllDocumentsResponse,
  SupportedFormatsResponse,
  JobListResponse,
  ChatHistoryResponse,
  AuthHealthResponse,
} from "@/types";

/**
 * API Configuration
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

const API_CONFIG = {
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
};

/**
 * Token management
 */
let getAuthToken: (() => string | null) | null = null;
let onAuthError: (() => void) | null = null;

export function setAuthTokenGetter(getter: () => string | null) {
  getAuthToken = getter;
}

export function setOnAuthError(callback: () => void) {
  onAuthError = callback;
}

/**
 * Create configured Axios instance
 */
function createApiClient(): AxiosInstance {
  const client = axios.create(API_CONFIG);

  // Request interceptor for auth and logging
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // Add auth token if available
      if (getAuthToken) {
        const token = getAuthToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }

      if (process.env.NODE_ENV === "development") {
        console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
      }

      return config;
    },
    (error) => {
      console.error("[API] Request error:", error);
      return Promise.reject(error);
    },
  );

  // Response interceptor for error handling
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      // Handle 401 errors (unauthorized)
      if (error.response?.status === 401) {
        onAuthError?.();
      }

      const apiError = handleApiError(error);
      return Promise.reject(apiError);
    },
  );

  return client;
}

/**
 * Convert Axios errors to ChatError or AuthError
 */
function handleApiError(error: AxiosError): ChatError | AuthError {
  if (error.response) {
    const data = error.response.data as Record<string, unknown>;
    const message =
      (data?.message as string) ||
      (data?.detail as string) ||
      `Server error: ${error.response.status}`;

    const code = (data?.code as string) || "SERVER_ERROR";

    // Return AuthError for auth-related endpoints
    if (
      error.config?.url?.includes("/auth/") ||
      error.response.status === 401
    ) {
      return new AuthError(message, code, error.response.status);
    }

    return new ChatError(message, code, error.response.status, data);
  }

  if (error.request) {
    return new ChatError(
      "Unable to connect to server. Please check your connection.",
      "NETWORK_ERROR",
    );
  }

  return new ChatError(
    error.message || "An unexpected error occurred",
    "UNKNOWN_ERROR",
  );
}

// Create singleton API client
const apiClient = createApiClient();

/**
 * Authentication API
 */
export const authApi = {
  /**
   * Register a new user
   */
  async register(data: UserRegister): Promise<TokenResponse> {
    const response = await apiClient.post<TokenResponse>(
      "/auth/register",
      data,
    );
    return response.data;
  },

  /**
   * Login user
   */
  async login(data: UserLogin): Promise<TokenResponse> {
    const response = await apiClient.post<TokenResponse>("/auth/login", data);
    return response.data;
  },

  /**
   * Get current user profile
   */
  async getMe(): Promise<UserResponse> {
    const response = await apiClient.get<UserResponse>("/auth/me");
    return response.data;
  },

  /**
   * Refresh access token
   */
  async refresh(): Promise<TokenResponse> {
    const response = await apiClient.post<TokenResponse>("/auth/refresh");
    return response.data;
  },

  /**
   * Check auth service health
   */
  async health(): Promise<AuthHealthResponse> {
    const response = await apiClient.get<AuthHealthResponse>("/auth/health");
    return response.data;
  },
};

/**
 * Chat API
 */
export const chatApi = {
  /**
   * Send a chat message
   * Enqueues the message for processing by a worker
   */
  async sendMessage(query: string): Promise<ChatResponse> {
    const response = await apiClient.post<ChatResponse>("/chat", null, {
      params: { query },
    });
    return response.data;
  },

  /**
   * Get job status and result
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await apiClient.get<JobStatusResponse>("/job-status", {
      params: { job_id: jobId },
    });
    return response.data;
  },

  /**
   * List user's jobs
   */
  async listJobs(limit: number = 20): Promise<JobListResponse> {
    const response = await apiClient.get<JobListResponse>("/jobs", {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Get chat history from memory
   */
  async getChatHistory(limit: number = 20): Promise<ChatHistoryResponse> {
    const response = await apiClient.get<ChatHistoryResponse>("/chat-history", {
      params: { limit },
    });
    return response.data;
  },
};

/**
 * Document API
 */
export const documentApi = {
  /**
   * Ingest a document (auto-detects type). Uses ranged/chunked upload when the file is large
   * or when explicitly requested. Falls back to single multipart upload for small files.
   */
  async ingest(
    file: File,
    options?: {
      useChunking?: boolean;
      chunkSize?: number;
      concurrency?: number;
      thresholdBytes?: number;
      uploadId?: string;
      onChunkProgress?: (
        uploadedBytes: number,
        totalBytes: number,
        chunk: { start: number; end: number },
      ) => void;
    },
  ): Promise<IngestDocumentResponse> {
    return this.ingestSmart(file, options);
  },

  /**
   * Smart ingest: decide between single multipart and ranged upload.
   */
  async ingestSmart(
    file: File,
    options: {
      useChunking?: boolean;
      chunkSize?: number;
      concurrency?: number;
      thresholdBytes?: number;
      uploadId?: string;
      onChunkProgress?: (
        uploadedBytes: number,
        totalBytes: number,
        chunk: { start: number; end: number },
      ) => void;
    } = {},
  ): Promise<IngestDocumentResponse> {
    const chunkSize = options.chunkSize ?? 5 * 1024 * 1024; // 5MB
    const threshold = options.thresholdBytes ?? chunkSize;
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));

    if (options.useChunking || file.size > threshold) {
      return this.ingestRange(file, {
        chunkSize,
        concurrency,
        uploadId: options.uploadId,
        onChunkProgress: options.onChunkProgress,
      });
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await apiClient.post<IngestDocumentResponse>(
      "/ingest",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 300000, // 5 minutes for large files
      },
    );

    return response.data;
  },

  /**
   * Chunked/ranged ingest with concurrent part uploads.
   */
  async ingestRange(
    file: File,
    options: {
      chunkSize?: number;
      concurrency?: number;
      uploadId?: string;
      onChunkProgress?: (
        uploadedBytes: number,
        totalBytes: number,
        chunk: { start: number; end: number },
      ) => void;
    } = {},
  ): Promise<IngestDocumentResponse> {
    const chunkSize = options.chunkSize ?? 5 * 1024 * 1024; // 5MB
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
    const uploadId =
      options.uploadId ??
      `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const total = file.size;

    const chunks: { start: number; end: number; blob: Blob }[] = [];
    for (let start = 0; start < total; start += chunkSize) {
      const end = Math.min(start + chunkSize, total) - 1;
      chunks.push({ start, end, blob: file.slice(start, end + 1) });
    }

    let uploaded = 0;
    let finalResponse: IngestDocumentResponse | null = null;

    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency).map(async (chunk) => {
        const formData = new FormData();
        formData.append(
          "file",
          new File([chunk.blob], file.name, {
            type: file.type || "application/octet-stream",
          }),
        );

        const resp = await apiClient.post<IngestDocumentResponse>(
          "/ingest-range",
          formData,
          {
            params: { upload_id: uploadId },
            headers: {
              "Content-Type": "multipart/form-data",
              "Content-Range": `bytes ${chunk.start}-${chunk.end}/${total}`,
              "X-Content-Range": `bytes ${chunk.start}-${chunk.end}/${total}`,
            },
            timeout: 300000, // allow for large files
          },
        );

        uploaded += chunk.blob.size;
        options.onChunkProgress?.(uploaded, total, {
          start: chunk.start,
          end: chunk.end,
        });

        if (chunk.end + 1 === total && resp.data?.status === "success") {
          finalResponse = resp.data;
        }
      });

      await Promise.all(batch);
    }

    if (!finalResponse) {
      throw new Error("Upload did not complete. No final response received.");
    }

    return finalResponse;
  },

  /**
   * Ingest a PDF document
   */
  async ingestPdf(file: File): Promise<IngestDocumentResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await apiClient.post<IngestDocumentResponse>(
      "/ingest-pdf",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 300000,
      },
    );

    return response.data;
  },

  /**
   * Ingest an Excel document
   */
  async ingestExcel(file: File): Promise<IngestDocumentResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await apiClient.post<IngestDocumentResponse>(
      "/ingest-excel",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 300000,
      },
    );

    return response.data;
  },

  /**
   * List user's documents
   */
  async listDocuments(limit: number = 100): Promise<DocumentListResponse> {
    const response = await apiClient.get<DocumentListResponse>("/documents", {
      params: { limit },
    });
    return response.data;
  },

  /**
   * Delete a specific document
   */
  async deleteDocument(filename: string): Promise<DeleteDocumentResponse> {
    const response = await apiClient.delete<DeleteDocumentResponse>(
      `/documents/${encodeURIComponent(filename)}`,
    );
    return response.data;
  },

  /**
   * Delete all documents
   */
  async deleteAllDocuments(): Promise<DeleteAllDocumentsResponse> {
    const response = await apiClient.delete<DeleteAllDocumentsResponse>(
      "/documents",
      {
        params: { confirm: true },
      },
    );
    return response.data;
  },

  /**
   * Get supported file formats
   */
  async getSupportedFormats(): Promise<SupportedFormatsResponse> {
    const response =
      await apiClient.get<SupportedFormatsResponse>("/supported-formats");
    return response.data;
  },

  /**
   * Upload multiple documents
   */
  async ingestMultiple(
    files: File[],
    onProgress?: (completed: number, total: number, current: File) => void,
  ): Promise<IngestDocumentResponse[]> {
    const results: IngestDocumentResponse[] = [];
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i, total, file);

      const result = await this.ingest(file);
      results.push(result);

      onProgress?.(i + 1, total, file);
    }

    return results;
  },
};

/**
 * Health API
 */
export const healthApi = {
  /**
   * Health check endpoint
   */
  async check(): Promise<HealthResponse> {
    const response = await apiClient.get<HealthResponse>("/");
    return response.data;
  },
};

/**
 * Job Polling Service
 */
export interface PollOptions {
  initialInterval?: number;
  maxInterval?: number;
  timeout?: number;
  onPoll?: (attempt: number, status: JobStatusResponse) => void;
}

export async function pollJobUntilComplete(
  jobId: string,
  options: PollOptions = {},
): Promise<JobStatusResponse> {
  const {
    initialInterval = 500,
    maxInterval = 3000,
    timeout = 120000,
    onPoll,
  } = options;

  const startTime = Date.now();
  let attempt = 0;
  let interval = initialInterval;

  while (Date.now() - startTime < timeout) {
    attempt++;

    const status = await chatApi.getJobStatus(jobId);
    onPoll?.(attempt, status);

    if (status.status === "finished") {
      return status;
    }

    if (status.status === "failed") {
      throw new ChatError(
        status.error || "Job processing failed",
        "JOB_FAILED",
      );
    }

    if (status.status === "not_found") {
      throw new ChatError(
        "Job not found. It may have expired.",
        "JOB_NOT_FOUND",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(interval * 1.5, maxInterval);
  }

  throw new ChatError(
    "Job polling timed out. Please try again.",
    "POLL_TIMEOUT",
  );
}

/**
 * Send message and wait for response
 */
export async function sendMessageAndWait(
  query: string,
  options?: PollOptions,
): Promise<string> {
  const chatResponse = await chatApi.sendMessage(query);
  const jobResult = await pollJobUntilComplete(chatResponse.job_id, options);

  if (jobResult.result) {
    return jobResult.result;
  }

  throw new ChatError("No result returned from job", "NO_RESULT");
}

/**
 * Combined API export
 */
export const api = {
  auth: authApi,
  chat: chatApi,
  documents: documentApi,
  health: healthApi,
};

/**
 * Export types for external use
 */
export type {
  ChatResponse,
  JobStatusResponse,
  IngestDocumentResponse,
  TokenResponse,
  UserResponse,
  DocumentListResponse,
};

export default api;
