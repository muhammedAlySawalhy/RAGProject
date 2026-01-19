'use client';

import dynamic from 'next/dynamic';

// Dynamically import Chat component to avoid SSR issues with localStorage
// The chat store uses localStorage for persistence which is not available on the server
const Chat = dynamic(() => import('@/components/chat/chat'), {
  ssr: false,
  loading: () => <LoadingScreen />,
});

/**
 * Main page component
 *
 * This is the entry point for the RAG Chat application.
 * It renders the main Chat interface which includes:
 * - Sidebar for conversation management
 * - Message list for chat history
 * - Input for sending messages
 * - File upload for document ingestion
 */
export default function HomePage() {
  return (
    <main className="h-screen w-full">
      <Chat />
    </main>
  );
}

/**
 * Loading screen shown while the Chat component loads
 */
function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        {/* Animated logo/spinner */}
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border-4 border-muted" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>

        {/* Loading text */}
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-lg font-semibold text-foreground">
            RAG Assistant
          </h2>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    </div>
  );
}
