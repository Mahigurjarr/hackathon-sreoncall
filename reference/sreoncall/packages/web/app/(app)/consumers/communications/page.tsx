'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MessageSquare, Loader2, Inbox, Search, Clock, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { useCommsInbox, type InboxItem } from '@/lib/hooks/useCommunications';
import { cn } from '@/lib/utils';

function getWaitingMinutes(oldestUnanswered: string | null): number {
  if (!oldestUnanswered) return 0;
  return Math.floor((Date.now() - new Date(oldestUnanswered).getTime()) / 60000);
}

function formatWaiting(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getPriorityBorder(minutes: number): string {
  if (minutes >= 60) return 'border-l-4 border-l-[#DC2626]';
  if (minutes >= 30) return 'border-l-4 border-l-[#EA580C]';
  if (minutes >= 15) return 'border-l-4 border-l-[#A16207]';
  return '';
}

function relativeTime(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

type SortMode = 'recent' | 'unread_desc' | 'oldest_unanswered';

export default function CommunicationsInboxPage() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);

  const { data, isLoading } = useCommsInbox({
    search: search || undefined,
    sort,
    has_unread: showOnlyUnread || undefined,
  });
  const consumers = data?.data ?? [];

  // Summary stats
  const stats = useMemo(() => {
    const withUnread = consumers.filter((c) => c.total_unread > 0);
    const totalUnread = consumers.reduce((sum, c) => sum + c.total_unread, 0);
    const waitingOver1h = consumers.filter(
      (c) => c.oldest_unanswered_at && getWaitingMinutes(c.oldest_unanswered_at) >= 60
    ).length;
    const longestWaiting = consumers.reduce<InboxItem | null>((longest, c) => {
      if (!c.oldest_unanswered_at) return longest;
      if (!longest?.oldest_unanswered_at) return c;
      return new Date(c.oldest_unanswered_at) < new Date(longest.oldest_unanswered_at) ? c : longest;
    }, null);
    return { consumersWithUnread: withUnread.length, totalUnread, waitingOver1h, longestWaiting };
  }, [consumers]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Communications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Unified inbox for all consumer communications
        </p>
      </div>

      {/* Needs Attention Summary */}
      {stats.totalUnread > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#FED7AA] bg-[#FFF7ED] dark:border-orange-900/50 dark:bg-orange-950/20 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-[#EA580C] dark:text-orange-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Needs attention</span>
          </div>
          <span className="text-muted-foreground">
            {stats.consumersWithUnread} consumer{stats.consumersWithUnread !== 1 ? 's' : ''} with unread
          </span>
          <span className="text-muted-foreground">
            {stats.totalUnread} total unread
          </span>
          {stats.waitingOver1h > 0 && (
            <span className="text-[#DC2626] dark:text-red-400 font-medium">
              {stats.waitingOver1h} waiting &gt; 1h
            </span>
          )}
          {stats.longestWaiting && (
            <Link
              href={`/consumers/communications/${stats.longestWaiting.consumer_tenant_id}`}
              className="ml-auto text-primary hover:underline font-medium"
            >
              {stats.longestWaiting.consumer_name} — waiting {formatWaiting(getWaitingMinutes(stats.longestWaiting.oldest_unanswered_at))}
            </Link>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          containerClassName="flex-1 min-w-[200px] max-w-sm"
          placeholder="Search consumers..."
          value={search}
          onChange={setSearch}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="recent">Most Recent</option>
          <option value="unread_desc">Most Unread</option>
          <option value="oldest_unanswered">Longest Waiting</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyUnread}
            onChange={(e) => setShowOnlyUnread(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Unread only
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {consumers.length} consumer{consumers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Consumer List */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : consumers.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={search || showOnlyUnread ? 'No matching consumers' : 'No communications yet'}
          description={
            search || showOnlyUnread
              ? 'Try adjusting your search or filters.'
              : 'When consumers send messages from Slack or Teams, they\'ll appear here.'
          }
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {consumers.map((consumer, idx) => {
            const waitingMin = getWaitingMinutes(consumer.oldest_unanswered_at);
            const borderClass = consumer.total_unread > 0 ? getPriorityBorder(waitingMin) : '';

            return (
              <Link
                key={consumer.consumer_tenant_id}
                href={`/consumers/communications/${consumer.consumer_tenant_id}`}
              >
                <div
                  className={cn(
                    'flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/30',
                    idx > 0 && 'border-t border-border',
                    borderClass,
                    consumer.total_unread > 0 && 'bg-muted/10',
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <MessageSquare className="h-4 w-4 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{consumer.consumer_name}</span>
                      {consumer.total_unread > 0 && (
                        <Badge variant="default" className="bg-red-500 text-white text-[10px] px-1.5 py-0">
                          {consumer.total_unread}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {consumer.thread_count} thread{consumer.thread_count !== 1 ? 's' : ''}
                      {' · '}
                      {relativeTime(consumer.last_message_at)}
                    </p>
                  </div>

                  {/* Waiting time indicator */}
                  {consumer.total_unread > 0 && consumer.oldest_unanswered_at && (
                    <div className={cn(
                      'flex items-center gap-1 text-xs shrink-0',
                      waitingMin >= 60 ? 'text-[#DC2626]' : waitingMin >= 30 ? 'text-[#EA580C]' : 'text-muted-foreground'
                    )}>
                      <Clock className="h-3 w-3" />
                      <span>waiting {formatWaiting(waitingMin)}</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
