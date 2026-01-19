'use client';

import * as React from 'react';
import { Send, Paperclip, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ChatInputProps {
  /** Callback when a message is submitted */
  onSend: (message: string) => void;
  /** Callback when attachment button is clicked */
  onAttachmentClick?: () => void;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether a message is currently being sent */
  isLoading?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Maximum character length */
  maxLength?: number;
  /** Whether to show the attachment button */
  showAttachment?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * ChatInput component for composing and sending messages
 *
 * Features:
 * - Auto-resizing textarea
 * - Enter to send (Shift+Enter for new line)
 * - Loading state during message sending
 * - Optional attachment button
 * - Character limit support
 */
export function ChatInput({
  onSend,
  onAttachmentClick,
  disabled = false,
  isLoading = false,
  placeholder = 'Type a message...',
  maxLength = 4000,
  showAttachment = true,
  className,
}: ChatInputProps) {
  const [message, setMessage] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set the height to scrollHeight, with a max of 200px
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // Adjust height when message changes
  React.useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  // Handle form submission
  const handleSubmit = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();

      const trimmedMessage = message.trim();
      if (!trimmedMessage || disabled || isLoading) return;

      onSend(trimmedMessage);
      setMessage('');

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
    [message, disabled, isLoading, onSend]
  );

  // Handle keyboard events
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Handle input change
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= maxLength) {
        setMessage(value);
      }
    },
    [maxLength]
  );

  // Focus input when component mounts
  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isDisabled = disabled || isLoading;
  const hasMessage = message.trim().length > 0;
  const characterCount = message.length;
  const isNearLimit = characterCount > maxLength * 0.9;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className={cn(
        'relative flex items-end gap-2 p-4 border-t bg-background',
        className
      )}
    >
      {/* Attachment button */}
      {showAttachment && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
          onClick={onAttachmentClick}
          disabled={isDisabled}
          aria-label="Attach file"
        >
          <Paperclip className="h-5 w-5" />
        </Button>
      )}

      {/* Input container */}
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          rows={1}
          className={cn(
            'w-full resize-none rounded-2xl border border-input bg-background px-4 py-3 pr-12',
            'text-sm ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'min-h-[48px] max-h-[200px]',
            'scrollbar-hide'
          )}
          aria-label="Message input"
          aria-describedby={isNearLimit ? 'char-count' : undefined}
        />

        {/* Character count (shown when near limit) */}
        {isNearLimit && (
          <span
            id="char-count"
            className={cn(
              'absolute bottom-1 right-14 text-xs',
              characterCount >= maxLength
                ? 'text-destructive'
                : 'text-muted-foreground'
            )}
          >
            {characterCount}/{maxLength}
          </span>
        )}
      </div>

      {/* Send button */}
      <Button
        type="submit"
        size="icon"
        className={cn(
          'h-10 w-10 shrink-0 rounded-full transition-all',
          hasMessage && !isDisabled
            ? 'bg-primary hover:bg-primary/90'
            : 'bg-muted text-muted-foreground'
        )}
        disabled={!hasMessage || isDisabled}
        aria-label={isLoading ? 'Sending message' : 'Send message'}
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Send className="h-5 w-5" />
        )}
      </Button>
    </form>
  );
}

/**
 * Minimal version of ChatInput for compact layouts
 */
export function ChatInputCompact({
  onSend,
  disabled = false,
  isLoading = false,
  placeholder = 'Message...',
  className,
}: Omit<ChatInputProps, 'showAttachment' | 'onAttachmentClick' | 'maxLength'>) {
  const [message, setMessage] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedMessage = message.trim();
      if (!trimmedMessage || disabled || isLoading) return;
      onSend(trimmedMessage);
      setMessage('');
    },
    [message, disabled, isLoading, onSend]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex items-center gap-2 p-2', className)}
    >
      <input
        ref={inputRef}
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || isLoading}
        className={cn(
          'flex-1 rounded-full border border-input bg-background px-4 py-2',
          'text-sm placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      />
      <Button
        type="submit"
        size="icon"
        className="h-9 w-9 rounded-full"
        disabled={!message.trim() || disabled || isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
}

export default ChatInput;
