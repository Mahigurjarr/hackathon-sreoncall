'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MessageSquare,
  Plus,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useConsumerThreads,
  useCreateProviderThread,
  useConsumerChannels,
  type CommThread,
} from '@/lib/hooks/useCommunications';

const TAG_COLORS: Record<string, string> = {
  question: 'bg-blue-100 text-blue-700',
  request: 'bg-purple-100 text-purple-700',
  update: 'bg-green-100 text-green-700',
  fyi: 'bg-gray-100 text-gray-700',
};

const newThreadSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(500),
  body: z.string().min(1, 'Message is required').max(10000),
});

type NewThreadForm = z.infer<typeof newThreadSchema>;

export default function ConsumerThreadsPage() {
  const params = useParams();
  const router = useRouter();
  const consumerId = params.consumerId as string;

  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>('');

  const { data, isLoading } = useConsumerThreads(consumerId, { status: statusFilter });
  const createThread = useCreateProviderThread();
  const { data: channelsData } = useConsumerChannels();

  const threads = data?.data ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewThreadForm>({
    resolver: zodResolver(newThreadSchema),
  });

  async function onSubmit(formData: NewThreadForm) {
    // Need at least one channel to send to
    const channels = channelsData?.data;
    if (!channels || channels.length === 0) {
      toast.error('No communication channels available for this consumer');
      return;
    }

    try {
      const result = await createThread.mutateAsync({
        consumerId,
        channel_id: channels[0]._id,
        subject: formData.subject,
        body: formData.body,
        tag: selectedTag || undefined,
      });
      toast.success('Thread created');
      setShowCreate(false);
      reset();
      setSelectedTag('');
      router.push(`/consumers/communications/${consumerId}/${result.thread._id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create thread');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/consumers/communications" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Threads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Communication threads with this consumer
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Thread
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {['open', 'closed'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              statusFilter === status
                ? 'bg-primary text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Thread list */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={`No ${statusFilter} threads`}
          description={statusFilter === 'open' ? 'Start a new conversation with this consumer.' : 'No closed threads found.'}
          actionLabel={statusFilter === 'open' ? 'New Thread' : undefined}
          onAction={statusFilter === 'open' ? () => setShowCreate(true) : undefined}
        />
      ) : (
        <div className="space-y-3">
          {threads.map((thread: CommThread) => (
            <Link
              key={thread._id}
              href={`/consumers/communications/${consumerId}/${thread._id}`}
            >
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">{thread.subject}</p>
                        {thread.tag && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${TAG_COLORS[thread.tag] || TAG_COLORS.fyi}`}>
                            {thread.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {thread.initiated_by === 'provider' ? 'You started' : 'Consumer started'}
                        {' · '}
                        Last message {new Date(thread.last_message_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {thread.unread_by_provider > 0 && (
                        <Badge variant="default" className="bg-primary text-white">
                          {thread.unread_by_provider}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Create Thread Dialog */}
      <Dialog open={showCreate} onClose={() => { setShowCreate(false); reset(); setSelectedTag(''); }}>
        <DialogContent>
          <DialogClose onClose={() => { setShowCreate(false); reset(); setSelectedTag(''); }} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              New Thread
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Subject</label>
              <Input placeholder="What is this about?" {...register('subject')} />
              {errors.subject && <p className="text-xs text-destructive">{errors.subject.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Message</label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                rows={4}
                placeholder="Type your message..."
                {...register('body')}
              />
              {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Tag <span className="text-muted-foreground">(optional)</span>
              </label>
              <div className="flex gap-2">
                {['question', 'request', 'update', 'fyi'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      selectedTag === tag
                        ? TAG_COLORS[tag]
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => { setShowCreate(false); reset(); setSelectedTag(''); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={createThread.isPending}>
                {createThread.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Thread
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
