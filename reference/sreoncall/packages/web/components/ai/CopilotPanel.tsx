'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Bot, X, Send, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useCopilotChat, type CopilotMessage } from '@/lib/hooks/useAI';

interface CopilotPanelProps {
  incidentId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CopilotPanel({ incidentId, isOpen, onClose }: CopilotPanelProps) {
  const { messages, isStreaming, sendMessage, reset } = useCopilotChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    sendMessage(trimmed, incidentId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] max-w-full bg-white dark:bg-navy-surface border-l border-[#E2E8F0] dark:border-[#1E293B] shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] dark:border-[#1E293B] bg-[#F5F3FF] dark:bg-[#7C3AED]/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-[#7C3AED]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">AI Copilot</h3>
            <p className="text-[11px] text-gray-500">Incident assistant</p>
          </div>
          <Badge variant="ai" className="ml-1">Beta</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => reset()}
            title="New conversation"
            className="text-gray-400 hover:text-[#7C3AED]"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-14 h-14 rounded-full bg-[#7C3AED]/10 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-[#7C3AED]" />
            </div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
              SREonCall AI Copilot
            </h4>
            <p className="text-xs text-gray-500 max-w-[280px]">
              Ask me about this incident — I can help with investigation, suggest runbooks, or analyze root causes.
            </p>
            <div className="mt-4 space-y-2 w-full max-w-[300px]">
              {[
                'What are the likely root causes?',
                'Suggest remediation steps',
                'Which runbooks should we follow?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion, incidentId)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] hover:border-[#7C3AED] hover:bg-[#F5F3FF] dark:hover:bg-[#7C3AED]/5 transition-colors text-gray-600 dark:text-gray-400"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#E2E8F0] dark:border-[#1E293B] p-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI Copilot..."
            className="flex-1 resize-none rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-navy-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/50 focus:border-[#7C3AED] min-h-[40px] max-h-[120px]"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white px-3 self-end"
            size="sm"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          AI responses may not always be accurate. Verify critical information.
        </p>
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isStreaming,
}: {
  message: CopilotMessage;
  isStreaming: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-[#7C3AED] text-white rounded-2xl rounded-br-sm px-3.5 py-2.5">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#7C3AED]/10 flex items-center justify-center mt-0.5">
        <Bot className="w-4 h-4 text-[#7C3AED]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : isStreaming ? (
            <div className="flex items-center gap-2 py-1">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-[#7C3AED] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-[#7C3AED] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-[#7C3AED] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-[#7C3AED]">Thinking...</span>
            </div>
          ) : null}
        </div>
        {isStreaming && message.content && (
          <div className="flex items-center gap-1 mt-1 ml-1">
            <div className="w-1 h-1 bg-[#7C3AED] rounded-full animate-pulse" />
            <span className="text-[10px] text-[#7C3AED]">Streaming...</span>
          </div>
        )}
      </div>
    </div>
  );
}
