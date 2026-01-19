"use client";

import * as React from "react";
import {
  MessageSquarePlus,
  Trash2,
  MoreHorizontal,
  Upload,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  MessageCircle,
  FileText,
} from "lucide-react";
import { cn, formatDate, truncate } from "@/lib/utils";
import { Conversation } from "@/types";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chat-store";

export interface SidebarProps {
  /** Array of conversations */
  conversations: Conversation[];
  /** Currently active conversation ID */
  activeConversationId: string | null;
  /** Callback when a conversation is selected */
  onSelectConversation: (id: string) => void;
  /** Callback to create a new conversation */
  onNewConversation: () => void;
  /** Callback to delete a conversation */
  onDeleteConversation: (id: string) => void;
  /** Callback when upload button is clicked */
  onUploadClick?: () => void;
  /** Callback when settings button is clicked */
  onSettingsClick?: () => void;
  /** Whether the sidebar is open */
  isOpen?: boolean;
  /** Callback to toggle sidebar */
  onToggle?: () => void;
  /** Additional class names */
  className?: string;
}

/**
 * Sidebar component for conversation management
 *
 * Features:
 * - List of conversations with timestamps
 * - New conversation button
 * - Delete conversation functionality
 * - Search/filter conversations
 * - Collapsible design
 * - Upload documents shortcut
 */
export function Sidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onUploadClick,
  onSettingsClick,
  isOpen = true,
  onToggle,
  className,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  // Filter conversations based on search query
  const filteredConversations = React.useMemo(() => {
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (conv) =>
        conv.title.toLowerCase().includes(query) ||
        conv.messages.some((msg) => msg.content.toLowerCase().includes(query)),
    );
  }, [conversations, searchQuery]);

  // Group conversations by date
  const groupedConversations = React.useMemo(() => {
    const groups: { label: string; conversations: Conversation[] }[] = [];
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    const lastWeek = new Date(Date.now() - 7 * 86400000);

    const todayConvs: Conversation[] = [];
    const yesterdayConvs: Conversation[] = [];
    const lastWeekConvs: Conversation[] = [];
    const olderConvs: Conversation[] = [];

    filteredConversations.forEach((conv) => {
      const convDate = new Date(conv.updatedAt);
      if (convDate.toDateString() === today.toDateString()) {
        todayConvs.push(conv);
      } else if (convDate.toDateString() === yesterday.toDateString()) {
        yesterdayConvs.push(conv);
      } else if (convDate > lastWeek) {
        lastWeekConvs.push(conv);
      } else {
        olderConvs.push(conv);
      }
    });

    if (todayConvs.length > 0)
      groups.push({ label: "Today", conversations: todayConvs });
    if (yesterdayConvs.length > 0)
      groups.push({ label: "Yesterday", conversations: yesterdayConvs });
    if (lastWeekConvs.length > 0)
      groups.push({ label: "Last 7 days", conversations: lastWeekConvs });
    if (olderConvs.length > 0)
      groups.push({ label: "Older", conversations: olderConvs });

    return groups;
  }, [filteredConversations]);

  // Handle conversation deletion with confirmation
  const handleDelete = React.useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      // In a real app, you'd show a confirmation dialog
      onDeleteConversation(id);
    },
    [onDeleteConversation],
  );

  if (!isOpen) {
    return (
      <CollapsedSidebar
        onToggle={onToggle}
        onNewConversation={onNewConversation}
        className={className}
      />
    );
  }

  return (
    <aside
      className={cn("flex h-full w-64 flex-col border-r bg-card", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Chats</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onNewConversation}
            aria-label="New conversation"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
          {onToggle && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onToggle}
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3",
              "text-sm placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </div>
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <EmptyState
            hasSearch={searchQuery.trim().length > 0}
            onNewConversation={onNewConversation}
          />
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {groupedConversations.map((group) => (
              <div key={group.label}>
                {/* Group label */}
                <div className="px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {group.label}
                  </span>
                </div>

                {/* Conversations in group */}
                {group.conversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeConversationId}
                    isHovered={conversation.id === hoveredId}
                    onSelect={() => onSelectConversation(conversation.id)}
                    onDelete={(e) => handleDelete(e, conversation.id)}
                    onMouseEnter={() => setHoveredId(conversation.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-3">
        <div className="flex flex-col gap-2">
          {/* Upload button */}
          {onUploadClick && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onUploadClick}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Documents
            </Button>
          )}

          {/* Settings button */}
          {onSettingsClick && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={onSettingsClick}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * Individual conversation item in the sidebar
 */
interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function ConversationItem({
  conversation,
  isActive,
  isHovered,
  onSelect,
  onDelete,
  onMouseEnter,
  onMouseLeave,
}: ConversationItemProps) {
  // Get the last message preview
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const preview = lastMessage
    ? truncate(lastMessage.content, 50)
    : "No messages yet";

  // Count messages
  const messageCount = conversation.messages.length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-2",
        "transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
      )}
    >
      {/* Title and timestamp */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {conversation.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(conversation.updatedAt)}
        </span>
      </div>

      {/* Preview and message count */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {preview}
        </span>
        {messageCount > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {messageCount} msg{messageCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Delete button (shown on hover) */}
      {(isHovered || isActive) && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute right-1 top-1 h-6 w-6",
            "opacity-0 transition-opacity group-hover:opacity-100",
            "hover:bg-destructive/10 hover:text-destructive",
          )}
          onClick={onDelete}
          aria-label="Delete conversation"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * Empty state for the conversations list
 */
function EmptyState({
  hasSearch,
  onNewConversation,
}: {
  hasSearch: boolean;
  onNewConversation: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <MessageCircle className="h-6 w-6 text-muted-foreground" />
      </div>
      {hasSearch ? (
        <>
          <p className="text-sm font-medium">No conversations found</p>
          <p className="text-xs text-muted-foreground">
            Try a different search term
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">No conversations yet</p>
          <p className="text-xs text-muted-foreground">
            Start a new conversation to begin
          </p>
          <Button size="sm" onClick={onNewConversation}>
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Collapsed sidebar variant
 */
function CollapsedSidebar({
  onToggle,
  onNewConversation,
  className,
}: {
  onToggle?: () => void;
  onNewConversation: () => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex h-full w-14 flex-col items-center border-r bg-card py-4",
        className,
      )}
    >
      {/* Expand button */}
      {onToggle && (
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          onClick={onToggle}
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      )}

      {/* New conversation */}
      <Button
        variant="ghost"
        size="icon"
        className="mt-2 h-10 w-10"
        onClick={onNewConversation}
        aria-label="New conversation"
      >
        <MessageSquarePlus className="h-5 w-5" />
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom icons */}
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          aria-label="Upload documents"
        >
          <Upload className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>
    </aside>
  );
}

/**
 * Connected Sidebar that uses the chat store directly
 */
export function ConnectedSidebar({
  onUploadClick,
  onSettingsClick,
  className,
}: {
  onUploadClick?: () => void;
  onSettingsClick?: () => void;
  className?: string;
}) {
  const {
    conversations,
    activeConversationId,
    sidebarOpen,
    setActiveConversation,
    createConversation,
    deleteConversation,
    toggleSidebar,
  } = useChatStore();

  return (
    <Sidebar
      conversations={conversations}
      activeConversationId={activeConversationId}
      onSelectConversation={setActiveConversation}
      onNewConversation={createConversation}
      onDeleteConversation={deleteConversation}
      onUploadClick={onUploadClick}
      onSettingsClick={onSettingsClick}
      isOpen={sidebarOpen}
      onToggle={toggleSidebar}
      className={className}
    />
  );
}

export default Sidebar;
