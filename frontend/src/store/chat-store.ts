import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  Conversation,
  Message,
  MessageRole,
  MessageStatus,
  PendingJob,
  AppSettings,
  DEFAULT_SETTINGS,
} from "@/types";
import { generateId, extractConversationTitle } from "@/lib/utils";
import { useAuthStore } from "./auth-store";

// ============================================================================
// State Types
// ============================================================================

interface ChatState {
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;

  // Loading & Error States
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  // Pending Jobs (for async polling)
  pendingJobs: Record<string, PendingJob>;

  // User Settings
  settings: AppSettings;

  // UI State
  sidebarOpen: boolean;
  uploadModalOpen: boolean;
}

interface ChatActions {
  // Conversation Actions
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  updateConversationTitle: (id: string, title: string) => void;
  clearConversations: () => void;

  // Message Actions
  addMessage: (
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ) => string;
  updateMessage: (
    conversationId: string,
    messageId: string,
    updates: Partial<Message>,
  ) => void;
  updateMessageStatus: (
    conversationId: string,
    messageId: string,
    status: MessageStatus,
  ) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;

  // Job Tracking Actions
  addPendingJob: (job: PendingJob) => void;
  removePendingJob: (jobId: string) => void;
  updatePendingJob: (jobId: string, updates: Partial<PendingJob>) => void;
  getPendingJob: (jobId: string) => PendingJob | undefined;

  // Loading & Error Actions
  setLoading: (loading: boolean) => void;
  setSending: (sending: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;

  // Settings Actions
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;

  // UI Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setUploadModalOpen: (open: boolean) => void;

  // Utility Actions
  getActiveConversation: () => Conversation | undefined;
  getConversation: (id: string) => Conversation | undefined;
  getMessages: (conversationId: string) => Message[];
}

type ChatStore = ChatState & ChatActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: ChatState = {
  conversations: [],
  activeConversationId: null,
  isLoading: false,
  isSending: false,
  error: null,
  pendingJobs: {},
  settings: DEFAULT_SETTINGS,
  sidebarOpen: true,
  uploadModalOpen: false,
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useChatStore = create<ChatStore>()(
  persist(
    immer((set, get) => ({
      // Initial State
      ...initialState,

      // ========================================================================
      // Conversation Actions
      // ========================================================================

      createConversation: () => {
        const id = generateId();
        const now = new Date();

        // Get user ID from auth store if authenticated, otherwise use settings
        const authUser = useAuthStore.getState().user;
        const userId =
          authUser?.user_id || get().settings.userId || "anonymous";

        const newConversation: Conversation = {
          id,
          title: "New Conversation",
          userId: userId,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };

        set((state) => {
          state.conversations.unshift(newConversation);
          state.activeConversationId = id;
          state.error = null;
        });

        return id;
      },

      deleteConversation: (id: string) => {
        set((state) => {
          const index = state.conversations.findIndex((c) => c.id === id);
          if (index !== -1) {
            state.conversations.splice(index, 1);
          }

          // If we deleted the active conversation, select another one
          if (state.activeConversationId === id) {
            state.activeConversationId =
              state.conversations.length > 0 ? state.conversations[0].id : null;
          }
        });
      },

      setActiveConversation: (id: string | null) => {
        set((state) => {
          state.activeConversationId = id;
          state.error = null;
        });
      },

      updateConversationTitle: (id: string, title: string) => {
        set((state) => {
          const conversation = state.conversations.find((c) => c.id === id);
          if (conversation) {
            conversation.title = title;
            conversation.updatedAt = new Date();
          }
        });
      },

      clearConversations: () => {
        set((state) => {
          state.conversations = [];
          state.activeConversationId = null;
          state.pendingJobs = {};
        });
      },

      // ========================================================================
      // Message Actions
      // ========================================================================

      addMessage: (
        conversationId: string,
        role: MessageRole,
        content: string,
        metadata?: Record<string, unknown>,
      ) => {
        const messageId = generateId();
        const now = new Date();

        const newMessage: Message = {
          id: messageId,
          role,
          content,
          timestamp: now,
          status: role === "user" ? "sent" : undefined,
          metadata: metadata as Message["metadata"],
        };

        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.id === conversationId,
          );

          if (conversation) {
            conversation.messages.push(newMessage);
            conversation.updatedAt = now;

            // Auto-update title from first user message
            if (
              role === "user" &&
              conversation.messages.filter((m) => m.role === "user").length ===
              1
            ) {
              conversation.title = extractConversationTitle(content);
            }
          }
        });

        return messageId;
      },

      updateMessage: (
        conversationId: string,
        messageId: string,
        updates: Partial<Message>,
      ) => {
        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.id === conversationId,
          );

          if (conversation) {
            const message = conversation.messages.find(
              (m) => m.id === messageId,
            );

            if (message) {
              Object.assign(message, updates);
              conversation.updatedAt = new Date();
            }
          }
        });
      },

      updateMessageStatus: (
        conversationId: string,
        messageId: string,
        status: MessageStatus,
      ) => {
        get().updateMessage(conversationId, messageId, { status });
      },

      deleteMessage: (conversationId: string, messageId: string) => {
        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.id === conversationId,
          );

          if (conversation) {
            const index = conversation.messages.findIndex(
              (m) => m.id === messageId,
            );
            if (index !== -1) {
              conversation.messages.splice(index, 1);
              conversation.updatedAt = new Date();
            }
          }
        });
      },

      // ========================================================================
      // Job Tracking Actions
      // ========================================================================

      addPendingJob: (job: PendingJob) => {
        set((state) => {
          state.pendingJobs[job.jobId] = job;
        });
      },

      removePendingJob: (jobId: string) => {
        set((state) => {
          delete state.pendingJobs[jobId];
        });
      },

      updatePendingJob: (jobId: string, updates: Partial<PendingJob>) => {
        set((state) => {
          const job = state.pendingJobs[jobId];
          if (job) {
            Object.assign(job, updates);
          }
        });
      },

      getPendingJob: (jobId: string) => {
        return get().pendingJobs[jobId];
      },

      // ========================================================================
      // Loading & Error Actions
      // ========================================================================

      setLoading: (loading: boolean) => {
        set((state) => {
          state.isLoading = loading;
        });
      },

      setSending: (sending: boolean) => {
        set((state) => {
          state.isSending = sending;
        });
      },

      setError: (error: string | null) => {
        set((state) => {
          state.error = error;
        });
      },

      clearError: () => {
        set((state) => {
          state.error = null;
        });
      },

      // ========================================================================
      // Settings Actions
      // ========================================================================

      updateSettings: (settings: Partial<AppSettings>) => {
        set((state) => {
          Object.assign(state.settings, settings);
        });
      },

      resetSettings: () => {
        set((state) => {
          state.settings = { ...DEFAULT_SETTINGS };
        });
      },

      // ========================================================================
      // UI Actions
      // ========================================================================

      toggleSidebar: () => {
        set((state) => {
          state.sidebarOpen = !state.sidebarOpen;
        });
      },

      setSidebarOpen: (open: boolean) => {
        set((state) => {
          state.sidebarOpen = open;
        });
      },

      setUploadModalOpen: (open: boolean) => {
        set((state) => {
          state.uploadModalOpen = open;
        });
      },

      // ========================================================================
      // Utility Actions
      // ========================================================================

      getActiveConversation: () => {
        const state = get();
        if (!state.activeConversationId) return undefined;
        return state.conversations.find(
          (c) => c.id === state.activeConversationId,
        );
      },

      getConversation: (id: string) => {
        return get().conversations.find((c) => c.id === id);
      },

      getMessages: (conversationId: string) => {
        const conversation = get().conversations.find(
          (c) => c.id === conversationId,
        );
        return conversation?.messages || [];
      },
    })),
    {
      name: "rag-chat-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        settings: state.settings,
        sidebarOpen: state.sidebarOpen,
      }),
      // Handle date serialization and user filtering
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Get current user from auth store
          const authState = useAuthStore.getState();
          const currentUserId = authState.user?.user_id;

          // Convert date strings back to Date objects
          let conversations = state.conversations.map((conv) => ({
            ...conv,
            createdAt: new Date(conv.createdAt),
            updatedAt: new Date(conv.updatedAt),
            messages: conv.messages.map((msg) => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
            })),
          }));

          // SECURITY: Filter conversations to only show current user's data
          // If no user is logged in, clear all conversations
          if (currentUserId) {
            conversations = conversations.filter(
              (conv) => conv.userId === currentUserId || conv.userId === 'anonymous'
            );
          } else {
            // Not logged in - don't show any persisted conversations
            conversations = [];
          }

          state.conversations = conversations;

          // Reset active conversation if it doesn't belong to current user
          if (state.activeConversationId) {
            const activeConv = conversations.find(c => c.id === state.activeConversationId);
            if (!activeConv) {
              state.activeConversationId = null;
            }
          }
        }
      },
    },
  ),
);

// ============================================================================
// Selectors (for performance optimization)
// ============================================================================

export const selectConversations = (state: ChatStore) => state.conversations;
export const selectActiveConversationId = (state: ChatStore) =>
  state.activeConversationId;
export const selectActiveConversation = (state: ChatStore) =>
  state.getActiveConversation();
export const selectIsLoading = (state: ChatStore) => state.isLoading;
export const selectIsSending = (state: ChatStore) => state.isSending;
export const selectError = (state: ChatStore) => state.error;
export const selectSettings = (state: ChatStore) => state.settings;
export const selectSidebarOpen = (state: ChatStore) => state.sidebarOpen;
export const selectUploadModalOpen = (state: ChatStore) =>
  state.uploadModalOpen;
export const selectPendingJobs = (state: ChatStore) => state.pendingJobs;

// ============================================================================
// Hooks for common patterns
// ============================================================================

export function useActiveConversation() {
  return useChatStore((state) => state.getActiveConversation());
}

export function useConversations() {
  return useChatStore((state) => state.conversations);
}

export function useSettings() {
  return useChatStore((state) => state.settings);
}

export function useUserId() {
  // Prefer auth user ID over settings user ID
  const authUserId = useAuthStore((state) => state.user?.user_id);
  const settingsUserId = useChatStore((state) => state.settings.userId);
  return authUserId || settingsUserId || null;
}

export function useCurrentUserId() {
  return useAuthStore((state) => state.user?.user_id ?? null);
}
