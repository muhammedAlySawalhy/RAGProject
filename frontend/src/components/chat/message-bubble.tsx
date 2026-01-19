'use client';

import * as React from 'react';
import { Check, Copy, RefreshCw, AlertCircle, User, Bot } from 'lucide-react';
import { cn, formatTime, copyToClipboard } from '@/lib/utils';
import { Message, MessageStatus } from '@/types';
import { Button } from '@/components/ui/button';

export interface MessageBubbleProps {
  /** The message to display */
  message: Message;
  /** Callback to retry a failed message */
  onRetry?: (messageId: string) => void;
  /** Whether to show the timestamp */
  showTimestamp?: boolean;
  /** Whether to show the avatar */
  showAvatar?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * MessageBubble component for rendering individual chat messages
 *
 * Features:
 * - Different styling for user vs assistant messages
 * - Loading state with animated dots
 * - Error state with retry option
 * - Copy message functionality
 * - Markdown rendering support
 * - Timestamp display
 */
export function MessageBubble({
  message,
  onRetry,
  showTimestamp = true,
  showAvatar = true,
  className,
}: MessageBubbleProps) {
  const [copied, setCopied] = React.useState(false);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isLoading = message.status === 'sending' && message.content === '...';
  const isError = message.status === 'error';

  // Handle copy to clipboard
  const handleCopy = React.useCallback(async () => {
    const success = await copyToClipboard(message.content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [message.content]);

  // Handle retry
  const handleRetry = React.useCallback(() => {
    onRetry?.(message.id);
  }, [message.id, onRetry]);

  return (
    <div
      className={cn(
        'group flex gap-3 px-4 py-2',
        isUser ? 'flex-row-reverse' : 'flex-row',
        className
      )}
    >
      {/* Avatar */}
      {showAvatar && (
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {isUser ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </div>
      )}

      {/* Message content container */}
      <div
        className={cn(
          'flex max-w-[80%] flex-col gap-1',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {/* Message bubble */}
        <div
          className={cn(
            'relative rounded-2xl px-4 py-2.5 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-muted text-foreground rounded-bl-md',
            isError && 'border-2 border-destructive/50 bg-destructive/10'
          )}
        >
          {/* Loading state */}
          {isLoading ? (
            <LoadingDots />
          ) : (
            <>
              {/* Message content */}
              <div
                className={cn(
                  'prose prose-sm max-w-none break-words',
                  isUser
                    ? 'prose-invert'
                    : 'prose-neutral dark:prose-invert',
                  'prose-p:my-1 prose-p:leading-relaxed',
                  'prose-pre:my-2 prose-pre:rounded-lg',
                  'prose-code:rounded prose-code:px-1 prose-code:py-0.5',
                  'prose-ul:my-1 prose-ol:my-1',
                  'prose-li:my-0.5'
                )}
              >
                <MessageContent content={message.content} />
              </div>

              {/* Error indicator */}
              {isError && (
                <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  <span>Failed to send</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Message footer: timestamp and actions */}
        <div
          className={cn(
            'flex items-center gap-2 text-xs text-muted-foreground',
            'opacity-0 transition-opacity group-hover:opacity-100',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          {/* Timestamp */}
          {showTimestamp && !isLoading && (
            <span>{formatTime(message.timestamp)}</span>
          )}

          {/* Actions */}
          {!isLoading && (
            <div className="flex items-center gap-1">
              {/* Copy button */}
              {!isError && message.content && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCopy}
                  aria-label={copied ? 'Copied' : 'Copy message'}
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              )}

              {/* Retry button for errors */}
              {isError && isUser && onRetry && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={handleRetry}
                  aria-label="Retry message"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Sources/metadata (for assistant messages with context) */}
        {isAssistant && message.metadata?.sources && message.metadata.sources.length > 0 && (
          <MessageSources sources={message.metadata.sources} />
        )}
      </div>
    </div>
  );
}

/**
 * Loading dots animation for pending messages
 */
function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span
        className="h-2 w-2 rounded-full bg-current animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="h-2 w-2 rounded-full bg-current animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="h-2 w-2 rounded-full bg-current animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}

/**
 * Message content renderer
 * Handles plain text and basic formatting
 */
function MessageContent({ content }: { content: string }) {
  // For now, render as plain text with preserved whitespace
  // In a production app, you'd use a markdown renderer here
  return (
    <div className="whitespace-pre-wrap">
      {content.split('\n').map((line, index) => (
        <React.Fragment key={index}>
          {line}
          {index < content.split('\n').length - 1 && <br />}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Sources display for messages with document context
 */
function MessageSources({ sources }: { sources: Array<{ filename?: string; page?: number | string }> }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {sources.slice(0, 3).map((source, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          {source.filename && (
            <span className="max-w-[100px] truncate">{source.filename}</span>
          )}
          {source.page !== undefined && source.page !== null && (
            <span className="text-muted-foreground/70">p.{source.page}</span>
          )}
        </span>
      ))}
      {sources.length > 3 && (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          +{sources.length - 3} more
        </span>
      )}
    </div>
  );
}

/**
 * System message variant for displaying system notifications
 */
export function SystemMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex justify-center px-4 py-2',
        className
      )}
    >
      <div className="rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
        {content}
      </div>
    </div>
  );
}

/**
 * Date separator for grouping messages by date
 */
export function DateSeparator({
  date,
  className,
}: {
  date: Date | string;
  className?: string;
}) {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const isToday = new Date().toDateString() === dateObj.toDateString();
  const isYesterday = new Date(Date.now() - 86400000).toDateString() === dateObj.toDateString();

  let displayDate: string;
  if (isToday) {
    displayDate = 'Today';
  } else if (isYesterday) {
    displayDate = 'Yesterday';
  } else {
    displayDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3',
        className
      )}
    >
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium text-muted-foreground">
        {displayDate}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export default MessageBubble;
