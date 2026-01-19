"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/auth-store";
import { setAuthTokenGetter, setOnAuthError } from "@/lib/api";

interface ApiProviderProps {
  children: React.ReactNode;
}

/**
 * API Provider Component
 *
 * This component initializes the API client with:
 * - Auth token getter from the auth store
 * - Auth error handler to logout on 401 errors
 *
 * Must wrap the application to ensure API calls include auth tokens.
 */
export function ApiProvider({ children }: ApiProviderProps) {
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    // Set up the token getter to read from auth store
    setAuthTokenGetter(() => {
      const state = useAuthStore.getState();
      if (!state.isAuthenticated || state.isTokenExpired()) {
        return null;
      }
      return state.token;
    });

    // Set up auth error handler
    setOnAuthError(() => {
      console.warn("Authentication error - logging out");
      logout();
    });

    // Cleanup on unmount
    return () => {
      setAuthTokenGetter(null as unknown as () => string | null);
      setOnAuthError(null as unknown as () => void);
    };
  }, [logout]);

  return <>{children}</>;
}

export default ApiProvider;
