'use client';

import * as React from 'react';
import { MessageCircle, ArrowDown } from 'lucide-react';
import { cn, scrollToBottom, isNearBottom } from '@/lib/utils';
import { Message } from '@/types';
import { MessageBubble, DateSeparator, SystemMessage } from './message-bubble';
import { Button } from '@/components/ui/button';

export interface MessageListProps {
  /** Array of messages to display */
  messages: Message[];
  /** Whether a new message is being processed */
  isLoading?: boolean;
  /** Callback to retry a failed message */
  onRetry?: (messageId: string) => void;
  /** Whether to show avatars on messages */
  showAvatars?: boolean;
  /** Whether to show timestamps on messages */
  showTimestamps?: boolean;
  /** Whether to group messages by date */
  showDateSeparators?: boolean;
  /** Whether to auto-scroll to bottom on new messages */
  autoScroll?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * MessageList component for rendering a scrollable list of chat messages
 *
 * Features:
 * - Auto-scroll to bottom on new messages
 * - "Scroll to bottom" button when scrolled up
 * - Empty state display
 * - Date separators between message groups
 * - Loading indicator for pending responses
 */
export function MessageList({
  messages,
  isLoading = false,
  onRetry,
  showAvatars = true,
  showTimestamps = true,
  showDateSeparators = true,
  autoScroll = true,
  className,
}: MessageListProps) {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = React.useState(false);
  const [userHasScrolled, setUserHasScrolled] = React.useState(false);

  // Handle scroll events to show/hide scroll button
  const handleScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = isNearBottom(container, 150);
    setShowScrollButton(!nearBottom);

    // Track if user has manually scrolled up
    if (!nearBottom) {
      setUserHasScrolled(true);
    } else {
      setUserHasScrolled(false);
    }
  }, []);

  // Scroll to bottom function
  const scrollToBottomHandler = React.useCallback(() => {
    scrollToBottom(scrollContainerRef.current);
    setShowScrollButton(false);
    setUserHasScrolled(false);
  }, []);

  // Auto-scroll when new messages arrive or content changes
  React.useEffect(() => {
    if (autoScroll && !userHasScrolled && messages.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      const frameId = requestAnimationFrame(() => {
        scrollToBottom(scrollContainerRef.current, false);
      });

      return () => cancelAnimationFrame(frameId);
    }
  }, [messages, autoScroll, userHasScrolled]);

  // Set up scroll listener
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Group messages by date for date separators
  const groupedMessages = React.useMemo(() => {
    if (!showDateSeparators) {
      return [{ date: null, messages }];
    }

    const groups: Array<{ date: Date | null; messages: Message[] }> = [];
    let currentDate: string | null = null;

    messages.forEach((message) => {
      const messageDate = new Date(message.timestamp).toDateString();

      if (messageDate !== currentDate) {
        currentDate = messageDate;
        groups.push({
          date: new Date(message.timestamp),
          messages: [message],
        });
      } else {
        groups[groups.length - 1].messages.push(message);
      }
    });

    return groups;
  }, [messages, showDateSeparators]);

  // Empty state
  if (messages.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center p-8',
          className
        )}
      >
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={cn('relative flex-1 min-h-0 h-full flex flex-col', className)}>
      {/* Scrollable message container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto max-w-3xl py-4 px-4">
          {/* Message groups */}
          {groupedMessages.map((group, groupIndex) => (
            <React.Fragment key={groupIndex}>
              {/* Date separator */}
              {showDateSeparators && group.date && (
                <DateSeparator date={group.date} />
              )}

              {/* Messages in this group */}
              {group.messages.map((message, messageIndex) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onRetry={onRetry}
                  showAvatar={showAvatars}
                  showTimestamp={showTimestamps}
                />
              ))}
            </React.Fragment>
          ))}

          {/* Loading indicator for pending response */}
          {isLoading && (
            <div className="px-4 py-2">
              <TypingIndicator />
            </div>
          )}

          {/* Scroll anchor */}
          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full shadow-lg"
            onClick={scrollToBottomHandler}
          >
            <ArrowDown className="mr-1 h-4 w-4" />
            New messages
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state component shown when there are no messages
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <MessageCircle className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">Start a conversation</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask a question about your documents or start a new chat.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <SuggestionChip text="Summarize the main points" />
        <SuggestionChip text="What does this document cover?" />
        <SuggestionChip text="Find specific information" />
      </div>
    </div>
  );
}

/**
 * Suggestion chip for empty state
 */
function SuggestionChip({ text }: { text: string }) {
  return (
    <button
      className={cn(
        'rounded-full border border-border bg-background px-3 py-1.5',
        'text-sm text-muted-foreground',
        'transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      {text}
    </button>
  );
}

/**
 * Typing indicator shown when assistant is generating a response
 */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        <div className="flex items-center gap-1">
          <span
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
      <span className="text-sm text-muted-foreground">
        Thinking...
      </span>
    </div>
  );
}

/**
 * Virtualized message list for large conversations
 * Use this when dealing with thousands of messages
 */
export function VirtualizedMessageList({
  messages,
  ...props
}: MessageListProps) {
  // For now, fall back to regular list
  // In production, implement with react-window or react-virtualized
  return <MessageList messages={messages} {...props} />;
}

export default MessageList;
