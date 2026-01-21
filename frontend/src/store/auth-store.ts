import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  AuthState,
  UserResponse,
  TokenResponse,
  UserLogin,
  UserRegister,
} from "@/types";

// ============================================================================
// State Types
// ============================================================================

interface AuthStoreState extends AuthState {
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

interface AuthStoreActions {
  // Auth Actions
  login: (response: TokenResponse) => void;
  logout: () => void;
  setUser: (user: UserResponse) => void;
  setToken: (token: string, expiresIn: number) => void;

  // Loading & Error Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;

  // Utility Actions
  isTokenExpired: () => boolean;
  getAuthHeader: () => Record<string, string> | null;
  initialize: () => void;
}

type AuthStore = AuthStoreState & AuthStoreActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: AuthStoreState = {
  isAuthenticated: false,
  user: null,
  token: null,
  expiresAt: null,
  isLoading: false,
  isInitialized: false,
  error: null,
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useAuthStore = create<AuthStore>()(
  persist(
    immer((set, get) => ({
      // Initial State
      ...initialState,

      // ========================================================================
      // Auth Actions
      // ========================================================================

      login: (response: TokenResponse) => {
        const expiresAt = Date.now() + response.expires_in * 1000;

        // Check if this is a different user than before - if so, clear chat data
        const currentState = get();
        const previousUserId = currentState.user?.user_id;
        const newUserId = response.user.user_id;

        if (previousUserId && previousUserId !== newUserId) {
          // Different user logging in - clear previous user's chat data
          localStorage.removeItem('rag-chat-storage');
        }

        set((state) => {
          state.isAuthenticated = true;
          state.user = response.user;
          state.token = response.access_token;
          state.expiresAt = expiresAt;
          state.error = null;
          state.isLoading = false;
        });
      },

      logout: () => {
        // Clear chat data when logging out (import dynamically to avoid circular deps)
        // This prevents the next user from seeing previous user's data
        const chatStorage = localStorage.getItem('rag-chat-storage');
        if (chatStorage) {
          localStorage.removeItem('rag-chat-storage');
        }

        set((state) => {
          state.isAuthenticated = false;
          state.user = null;
          state.token = null;
          state.expiresAt = null;
          state.error = null;
        });
      },

      setUser: (user: UserResponse) => {
        set((state) => {
          state.user = user;
        });
      },

      setToken: (token: string, expiresIn: number) => {
        const expiresAt = Date.now() + expiresIn * 1000;

        set((state) => {
          state.token = token;
          state.expiresAt = expiresAt;
          state.isAuthenticated = true;
        });
      },

      // ========================================================================
      // Loading & Error Actions
      // ========================================================================

      setLoading: (loading: boolean) => {
        set((state) => {
          state.isLoading = loading;
        });
      },

      setError: (error: string | null) => {
        set((state) => {
          state.error = error;
          state.isLoading = false;
        });
      },

      clearError: () => {
        set((state) => {
          state.error = null;
        });
      },

      // ========================================================================
      // Utility Actions
      // ========================================================================

      isTokenExpired: () => {
        const { expiresAt, token } = get();
        if (!token || !expiresAt) return true;

        // Add 30 second buffer before actual expiry
        return Date.now() >= expiresAt - 30000;
      },

      getAuthHeader: () => {
        const { token, isAuthenticated } = get();
        const isExpired = get().isTokenExpired();

        if (!isAuthenticated || !token || isExpired) {
          return null;
        }

        return {
          Authorization: `Bearer ${token}`,
        };
      },

      initialize: () => {
        set((state) => {
          state.isInitialized = true;

          // Check if token is expired on initialization
          if (state.token && state.expiresAt) {
            if (Date.now() >= state.expiresAt) {
              // Token expired, clear auth state
              state.isAuthenticated = false;
              state.user = null;
              state.token = null;
              state.expiresAt = null;
            }
          }
        });
      },
    })),
    {
      name: "rag-auth-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        token: state.token,
        expiresAt: state.expiresAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Mark as initialized after rehydration
          state.isInitialized = true;

          // Check if token is expired
          if (state.token && state.expiresAt) {
            if (Date.now() >= state.expiresAt) {
              // Token expired, clear auth state
              state.isAuthenticated = false;
              state.user = null;
              state.token = null;
              state.expiresAt = null;
            }
          }
        }
      },
    },
  ),
);

// ============================================================================
// Selectors
// ============================================================================

export const selectIsAuthenticated = (state: AuthStore) => state.isAuthenticated;
export const selectUser = (state: AuthStore) => state.user;
export const selectToken = (state: AuthStore) => state.token;
export const selectAuthError = (state: AuthStore) => state.error;
export const selectAuthLoading = (state: AuthStore) => state.isLoading;
export const selectIsInitialized = (state: AuthStore) => state.isInitialized;

// ============================================================================
// Hooks
// ============================================================================

export function useAuth() {
  return useAuthStore((state) => ({
    isAuthenticated: state.isAuthenticated,
    user: state.user,
    token: state.token,
    isLoading: state.isLoading,
    error: state.error,
    login: state.login,
    logout: state.logout,
    clearError: state.clearError,
    getAuthHeader: state.getAuthHeader,
    isTokenExpired: state.isTokenExpired,
  }));
}

export function useUser() {
  return useAuthStore((state) => state.user);
}

export function useIsAuthenticated() {
  return useAuthStore((state) => state.isAuthenticated);
}

export function useAuthHeader() {
  return useAuthStore((state) => state.getAuthHeader());
}

export function useUserId() {
  return useAuthStore((state) => state.user?.user_id ?? null);
}
