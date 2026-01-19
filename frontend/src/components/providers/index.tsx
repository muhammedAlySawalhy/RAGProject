"use client";

import { ApiProvider } from "./api-provider";

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Client-side Providers Wrapper
 *
 * This component wraps all client-side providers that need to be
 * initialized at the root of the application.
 *
 * Providers included:
 * - ApiProvider: Sets up auth token handling for API requests
 */
export function Providers({ children }: ProvidersProps) {
  return <ApiProvider>{children}</ApiProvider>;
}

export { ApiProvider };
export default Providers;
