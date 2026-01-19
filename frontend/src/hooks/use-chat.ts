import { useCallback, useRef, useEffect } from "react";
import { useChatStore } from "@/store/chat-store";
import { useAuthStore } from "@/store/auth-store";
import { chatApi, pollJobUntilComplete, PollOptions } from "@/lib/api";
import { ChatError, PendingJob, Message } from "@/types";

/**
 * Options for the useChat hook
 */
export interface UseChatOptions {
  /** Polling options for job status checks */
  pollOptions?: PollOptions;
  /** Callback when a message is successfully sent */
  onMessageSent?: (messageId: string, jobId: string) => void;
  /** Callback when a response is received */
  onResponseReceived?: (messageId: string, content: string) => void;
  /** Callback when an error occurs */
  onError?: (error: ChatError) => void;
}

/**
 * Return type for the useChat hook
 */
export interface UseChatReturn {
  /** Send a message in the active conversation */
  sendMessage: (content: string) => Promise<void>;
  /** Retry a failed message */
  retryMessage: (messageId: string) => Promise<void>;
  /** Cancel a pending job */
  cancelJob: (jobId: string) => void;
  /** Whether a message is currently being sent */
  isSending: boolean;
  /** Whether there are pending jobs being polled */
  isPolling: boolean;
  /** Current error, if any */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
  /** Active conversation messages */
  messages: Message[];
  /** Create a new conversation and set it as active */
  startNewConversation: () => string;
}

/**
 * Custom hook for chat functionality with async job polling
 */
export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    pollOptions = {},
    onMessageSent,
    onResponseReceived,
    onError,
  } = options;

  // Auth state
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Store state and actions
  const {
    activeConversationId,
    isSending,
    error,
    createConversation,
    addMessage,
    updateMessage,
    addPendingJob,
    removePendingJob,
    setSending,
    setError,
    clearError,
    getActiveConversation,
  } = useChatStore();

  // Track active polling operations
  const pollingRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Get messages from active conversation
  const activeConversation = getActiveConversation();
  const messages = activeConversation?.messages || [];

  // Check if any jobs are being polled
  const isPolling = pollingRef.current.size > 0;

  /**
   * Poll for job completion and update the assistant message
   */
  const pollForResponse = useCallback(
    async (
      jobId: string,
      conversationId: string,
      assistantMessageId: string,
    ) => {
      pollingRef.current.add(jobId);

      try {
        const result = await pollJobUntilComplete(jobId, {
          initialInterval: pollOptions.initialInterval ?? 500,
          maxInterval: pollOptions.maxInterval ?? 3000,
          timeout: pollOptions.timeout ?? 120000,
          onPoll: (attempt, status) => {
            // Update pending job with poll count
            useChatStore.getState().updatePendingJob(jobId, {
              pollCount: attempt,
            });
            pollOptions.onPoll?.(attempt, status);
          },
        });

        // Update the assistant message with the result
        if (result.result) {
          updateMessage(conversationId, assistantMessageId, {
            content: result.result,
            status: "sent",
            metadata: {
              jobId,
              processingTime:
                Date.now() -
                (useChatStore
                  .getState()
                  .getPendingJob(jobId)
                  ?.startedAt?.getTime() || Date.now()),
            },
          });

          onResponseReceived?.(assistantMessageId, result.result);
        }
      } catch (err) {
        const chatError =
          err instanceof ChatError
            ? err
            : new ChatError(
                err instanceof Error ? err.message : "Unknown error",
                "POLL_ERROR",
              );

        // Update message with error status
        updateMessage(conversationId, assistantMessageId, {
          content: `Error: ${chatError.message}`,
          status: "error",
        });

        setError(chatError.message);
        onError?.(chatError);
      } finally {
        pollingRef.current.delete(jobId);
        removePendingJob(jobId);
        abortControllersRef.current.delete(jobId);
      }
    },
    [
      pollOptions,
      updateMessage,
      removePendingJob,
      setError,
      onResponseReceived,
      onError,
    ],
  );

  /**
   * Send a message in the active conversation
   */
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmedContent = content.trim();
      if (!trimmedContent) return;

      // Check authentication
      if (!isAuthenticated) {
        setError("Please sign in to send messages");
        return;
      }

      // Ensure we have an active conversation
      let conversationId = activeConversationId;
      if (!conversationId) {
        conversationId = createConversation();
      }

      setSending(true);
      clearError();

      // Add user message to the conversation
      const userMessageId = addMessage(conversationId, "user", trimmedContent);

      // Create placeholder assistant message
      const assistantMessageId = addMessage(conversationId, "assistant", "", {
        status: "sending",
      });

      // Update assistant message to show loading state
      updateMessage(conversationId, assistantMessageId, {
        content: "...",
        status: "sending",
      });

      try {
        // Send message to API (no userId needed, it comes from JWT)
        const response = await chatApi.sendMessage(trimmedContent);

        // Track the pending job
        const pendingJob: PendingJob = {
          jobId: response.job_id,
          messageId: assistantMessageId,
          conversationId,
          query: trimmedContent,
          startedAt: new Date(),
          pollCount: 0,
        };
        addPendingJob(pendingJob);

        onMessageSent?.(userMessageId, response.job_id);

        // Start polling for the response
        pollForResponse(response.job_id, conversationId, assistantMessageId);
      } catch (err) {
        const chatError =
          err instanceof ChatError
            ? err
            : new ChatError(
                err instanceof Error ? err.message : "Failed to send message",
                "SEND_ERROR",
              );

        // Update assistant message with error
        updateMessage(conversationId, assistantMessageId, {
          content: `Error: ${chatError.message}`,
          status: "error",
        });

        setError(chatError.message);
        onError?.(chatError);
      } finally {
        setSending(false);
      }
    },
    [
      activeConversationId,
      isAuthenticated,
      createConversation,
      addMessage,
      updateMessage,
      addPendingJob,
      setSending,
      clearError,
      setError,
      pollForResponse,
      onMessageSent,
      onError,
    ],
  );

  /**
   * Retry a failed message
   */
  const retryMessage = useCallback(
    async (messageId: string) => {
      const conversation = getActiveConversation();
      if (!conversation) return;

      // Check authentication
      if (!isAuthenticated) {
        setError("Please sign in to retry messages");
        return;
      }

      // Find the failed message
      const messageIndex = conversation.messages.findIndex(
        (m) => m.id === messageId,
      );
      if (messageIndex === -1) return;

      const message = conversation.messages[messageIndex];

      // Only retry user messages that have a corresponding error assistant message
      if (message.role !== "user") return;

      // Find the corresponding assistant message (should be the next one)
      const assistantMessage = conversation.messages[messageIndex + 1];
      if (!assistantMessage || assistantMessage.role !== "assistant") return;

      // Get the original query
      const query = message.content;

      // Update assistant message to show retrying
      updateMessage(conversation.id, assistantMessage.id, {
        content: "...",
        status: "sending",
      });

      setSending(true);
      clearError();

      try {
        // Resend the message
        const response = await chatApi.sendMessage(query);

        // Track the pending job
        const pendingJob: PendingJob = {
          jobId: response.job_id,
          messageId: assistantMessage.id,
          conversationId: conversation.id,
          query,
          startedAt: new Date(),
          pollCount: 0,
        };
        addPendingJob(pendingJob);

        // Start polling
        pollForResponse(response.job_id, conversation.id, assistantMessage.id);
      } catch (err) {
        const chatError =
          err instanceof ChatError
            ? err
            : new ChatError(
                err instanceof Error ? err.message : "Failed to retry message",
                "RETRY_ERROR",
              );

        updateMessage(conversation.id, assistantMessage.id, {
          content: `Error: ${chatError.message}`,
          status: "error",
        });

        setError(chatError.message);
        onError?.(chatError);
      } finally {
        setSending(false);
      }
    },
    [
      getActiveConversation,
      isAuthenticated,
      updateMessage,
      addPendingJob,
      setSending,
      clearError,
      setError,
      pollForResponse,
      onError,
    ],
  );

  /**
   * Cancel a pending job
   */
  const cancelJob = useCallback(
    (jobId: string) => {
      // Cancel the abort controller if it exists
      const controller = abortControllersRef.current.get(jobId);
      controller?.abort();

      // Remove from tracking
      pollingRef.current.delete(jobId);
      abortControllersRef.current.delete(jobId);
      removePendingJob(jobId);

      // Update the message to show cancelled
      const job = useChatStore.getState().getPendingJob(jobId);
      if (job) {
        updateMessage(job.conversationId, job.messageId, {
          content: "Request cancelled",
          status: "error",
        });
      }
    },
    [removePendingJob, updateMessage],
  );

  /**
   * Start a new conversation
   */
  const startNewConversation = useCallback(() => {
    return createConversation();
  }, [createConversation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel all pending operations
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
      pollingRef.current.clear();
    };
  }, []);

  return {
    sendMessage,
    retryMessage,
    cancelJob,
    isSending,
    isPolling,
    error,
    clearError,
    messages,
    startNewConversation,
  };
}

export default useChat;
