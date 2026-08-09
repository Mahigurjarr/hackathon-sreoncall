'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  Check,
  CheckCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  useThreadMessages,
  useSendProviderReply,
  useUpdateThread,
  type CommMessage,
} from '@/lib/hooks/useCommunications';
import { MentionPicker } from '@/components/comms/MentionPicker';

const TAG_COLORS: Record<string, string> = {
  question: 'bg-blue-100 text-blue-700',
  request: 'bg-purple-100 text-purple-700',
  update: 'bg-green-100 text-green-700',
  fyi: 'bg-gray-100 text-gray-700',
};

function DeliveryIndicator({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-3 w-3 text-muted-foreground animate-pulse" />;
    case 'delivered':
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    case 'failed':
      return <XCircle className="h-3 w-3 text-destructive" />;
    default:
      return null;
  }
}

export default function ThreadDetailPage() {
  const params = useParams();
  const consumerId = params.consumerId as string;
  const threadId = params.threadId as string;

  const [replyBody, setReplyBody] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useThreadMessages(threadId);
  const sendReply = useSendProviderReply();
  const updateThread = useUpdateThread();

  const messages = data?.data ?? [];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    if (!replyBody.trim()) return;

    try {
      await sendReply.mutateAsync({
        threadId,
        body: replyBody,
        tag: selectedTag || undefined,
      });
      setReplyBody('');
      setSelectedTag('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send message');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleCloseThread() {
    try {
      await updateThread.mutateAsync({ threadId, status: 'closed' });
      toast.success('Thread closed');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to close thread');
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/consumers/communications/${consumerId}`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h2 className="font-semibold text-foreground">Thread</h2>
            <p className="text-xs text-muted-foreground">
              {messages.length} message{messages.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleCloseThread} disabled={updateThread.isPending}>
          {updateThread.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
          Close Thread
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages in this thread yet.
          </div>
        ) : (
          messages.map((message: CommMessage) => {
            const isProvider = message.origin === 'provider';
            return (
              <div
                key={message._id}
                className={cn('flex', isProvider ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[70%] rounded-lg px-4 py-3 space-y-1',
                    isProvider
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-medium', isProvider ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                      {message.sender_display_name}
                    </span>
                    {message.tag && (
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium ${TAG_COLORS[message.tag] || TAG_COLORS.fyi}`}>
                        {message.tag}
                      </span>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                  <div className={cn('flex items-center gap-1.5 text-[10px]', isProvider ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                    <span>{new Date(message.sent_at).toLocaleTimeString()}</span>
                    {isProvider && <DeliveryIndicator status={message.delivery_status} />}
                    {!isProvider && (
                      <>
                        {message.read_by_provider ? (
                          <CheckCheck className="h-3 w-3 text-blue-500" />
                        ) : (
                          <Check className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className="capitalize">
                          via {message.origin.replace('consumer_', '')}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply composer */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2 mb-2">
          {['question', 'request', 'update', 'fyi'].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                selectedTag === tag
                  ? TAG_COLORS[tag]
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="relative flex gap-2">
          <MentionPicker
            threadId={threadId}
            textareaRef={textareaRef}
            value={replyBody}
            onChange={setReplyBody}
          />
          <textarea
            ref={textareaRef}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            rows={2}
            placeholder="Type a reply... (@ to mention, Cmd+Enter to send)"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            onClick={handleSend}
            disabled={!replyBody.trim() || sendReply.isPending}
            className="self-end"
          >
            {sendReply.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
