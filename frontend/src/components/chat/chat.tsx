"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useAuthStore } from "@/store/auth-store";
import { useChat } from "@/hooks/use-chat";
import { ChatInput } from "./chat-input";
import { MessageList } from "./message-list";
import { ConnectedSidebar } from "./sidebar";
import { FileUpload } from "./file-upload";
import { DocumentList } from "./document-list";
import { Button } from "@/components/ui/button";
import { AuthModal, AuthMode } from "@/components/auth";

/**
 * Main Chat component
 *
 * This is the primary interface for the RAG chat application.
 * It combines the sidebar, message list, and input components
 * into a cohesive chat experience.
 *
 * Features:
 * - Conversation management via sidebar
 * - Real-time message display
 * - Async job polling for responses
 * - Document upload modal
 * - Authentication integration
 * - Responsive design
 */
export function Chat() {
  // Auth state
  const { isAuthenticated, user, logout } = useAuthStore();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  // Store state
  const {
    activeConversationId,
    uploadModalOpen,
    sidebarOpen,
    setUploadModalOpen,
    setSidebarOpen,
  } = useChatStore();

  // Chat hook for message handling
  const {
    sendMessage,
    retryMessage,
    isSending,
    isPolling,
    error,
    clearError,
    messages,
    startNewConversation,
  } = useChat({
    onError: (err) => {
      console.error("Chat error:", err);
    },
  });

  // Handle sending a message
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!isAuthenticated) {
        setAuthModalOpen(true);
        return;
      }
      await sendMessage(content);
    },
    [sendMessage, isAuthenticated],
  );

  // Handle opening upload modal
  const handleUploadClick = useCallback(() => {
    if (!isAuthenticated) {
      setAuthModalOpen(true);
      return;
    }
    setUploadModalOpen(true);
  }, [setUploadModalOpen, isAuthenticated]);

  // Handle closing upload modal
  const handleCloseUpload = useCallback(() => {
    setUploadModalOpen(false);
  }, [setUploadModalOpen]);

  // Handle upload completion
  const handleUploadComplete = useCallback((results: unknown[]) => {
    console.log("Upload complete:", results);
  }, []);

  // Handle retry
  const handleRetry = useCallback(
    (messageId: string) => {
      retryMessage(messageId);
    },
    [retryMessage],
  );

  // Handle settings click
  const handleSettingsClick = useCallback(() => {
    console.log("Settings clicked");
  }, []);

  // Handle login click
  const handleLoginClick = useCallback(() => {
    setAuthMode("login");
    setAuthModalOpen(true);
  }, []);

  // Handle auth success
  const handleAuthSuccess = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  // Get the active conversation title
  const activeConversation = useChatStore((state) =>
    state.conversations.find((c) => c.id === state.activeConversationId),
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <ConnectedSidebar
        onUploadClick={handleUploadClick}
        onSettingsClick={handleSettingsClick}
      />

      {/* Main chat area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <ChatHeader
          title={activeConversation?.title || "New Conversation"}
          isSidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onUploadClick={handleUploadClick}
          isAuthenticated={isAuthenticated}
          userName={user?.username}
          onLoginClick={handleLoginClick}
          onLogoutClick={logout}
        />

        {/* Error banner */}
        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeConversationId ? (
            <MessageList
              messages={messages}
              isLoading={isSending || isPolling}
              onRetry={handleRetry}
              showAvatars={true}
              showTimestamps={true}
              autoScroll={true}
            />
          ) : (
            <WelcomeScreen
              onNewConversation={startNewConversation}
              onUploadClick={handleUploadClick}
              isAuthenticated={isAuthenticated}
              onLoginClick={handleLoginClick}
            />
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSendMessage}
          onAttachmentClick={handleUploadClick}
          disabled={!activeConversationId || !isAuthenticated}
          isLoading={isSending}
          placeholder={
            !isAuthenticated
              ? "Please sign in to start chatting"
              : activeConversationId
                ? "Ask a question about your documents..."
                : "Start a new conversation first"
          }
          showAttachment={true}
        />
      </main>

      {/* Upload Modal */}
      {uploadModalOpen && (
        <UploadModal
          onClose={handleCloseUpload}
          onUploadComplete={handleUploadComplete}
        />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        mode={authMode}
        onClose={() => setAuthModalOpen(false)}
        onModeChange={setAuthMode}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}

/**
 * Chat header component
 */
interface ChatHeaderProps {
  title: string;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onUploadClick: () => void;
  isAuthenticated: boolean;
  userName?: string;
  onLoginClick: () => void;
  onLogoutClick: () => void;
}

function ChatHeader({
  title,
  isSidebarOpen,
  onToggleSidebar,
  onUploadClick,
  isAuthenticated,
  userName,
  onLoginClick,
  onLogoutClick,
}: ChatHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <div className="flex items-center gap-3">
        {/* Toggle sidebar button (shown when sidebar is collapsed) */}
        {!isSidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleSidebar}
            aria-label="Open sidebar"
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
        )}
        <h1 className="truncate text-lg font-semibold">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        {isAuthenticated ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onUploadClick}
              className="hidden sm:flex"
            >
              <UploadIcon className="mr-2 h-4 w-4" />
              Upload
            </Button>
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground md:inline">
                {userName}
              </span>
              <Button variant="ghost" size="sm" onClick={onLogoutClick}>
                Sign Out
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={onLoginClick} size="sm">
            Sign In
          </Button>
        )}
      </div>
    </header>
  );
}

/**
 * Error banner component
 */
interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="flex items-center justify-between bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <span>{message}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-destructive hover:text-destructive"
        onClick={onDismiss}
      >
        <XIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Welcome screen shown when no conversation is active
 */
interface WelcomeScreenProps {
  onNewConversation: () => void;
  onUploadClick: () => void;
  isAuthenticated: boolean;
  onLoginClick: () => void;
}

function WelcomeScreen({
  onNewConversation,
  onUploadClick,
  isAuthenticated,
  onLoginClick,
}: WelcomeScreenProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        {/* Logo/Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="mb-2 text-2xl font-bold">Welcome to RAG Assistant</h2>
        <p className="mb-6 text-muted-foreground">
          Upload your documents and ask questions. I&apos;ll help you find the
          information you need.
        </p>

        {/* Action buttons */}
        {isAuthenticated ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button onClick={onNewConversation} size="lg">
              Start New Chat
            </Button>
            <Button variant="outline" onClick={onUploadClick} size="lg">
              <UploadIcon className="mr-2 h-4 w-4" />
              Upload Documents
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button onClick={onLoginClick} size="lg">
              Sign In to Get Started
            </Button>
          </div>
        )}

        {/* Features */}
        <div className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
          <FeatureCard
            icon="📄"
            title="Document Analysis"
            description="Upload PDFs and Excel files for instant insights"
          />
          <FeatureCard
            icon="💬"
            title="Smart Q&A"
            description="Ask questions in natural language"
          />
          <FeatureCard
            icon="🔍"
            title="Source Citations"
            description="See exactly where answers come from"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Feature card for welcome screen
 */
function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 text-2xl">{icon}</div>
      <h3 className="mb-1 font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * Upload modal component
 */
interface UploadModalProps {
  onClose: () => void;
  onUploadComplete?: (results: unknown[]) => void;
}

function UploadModal({ onClose, onUploadComplete }: UploadModalProps) {
  // Handle click outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-lg bg-background shadow-xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Upload Documents</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Modal content */}
        <div className="p-4">
          <FileUpload
            onUploadComplete={onUploadComplete}
            onError={(error) => console.error("Upload error:", error)}
          />
        </div>

        {/* Modal footer */}
        <div className="flex justify-end border-t p-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Icons
// =============================================================================

function MenuIcon({ className }: { className?: string }) {
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
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

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

export default Chat;
