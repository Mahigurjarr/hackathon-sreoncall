'use client';

import { useState } from 'react';
import { Mic, Plus, ChevronLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useNotetakerSessions } from '@/lib/hooks/useNotetaker';
import { StartNotetakerDialog } from './StartNotetakerDialog';
import { NotetakerSessionView } from './NotetakerSessionView';
import { NotetakerStatusBadge, platformLabel } from './notetaker-helpers';

interface Props {
  channelId?: string;
  incidentId?: string;
}

/**
 * Embeddable AI Notetaker panel for a war room. Lists this channel's sessions,
 * lets a responder start a new capture, and opens any session for review.
 */
export function NotetakerPanel({ channelId, incidentId }: Props) {
  const { data: sessions, isLoading } = useNotetakerSessions(channelId ? { channel_id: channelId } : undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
          <ChevronLeft className="h-4 w-4" /> <span className="ml-1">Back to sessions</span>
        </Button>
        <NotetakerSessionView sessionId={selectedId} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Mic className="h-4 w-4 text-[#7C3AED]" /> AI Notetaker
        </h3>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> <span className="ml-1">New</span>
        </Button>
      </div>

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !sessions || sessions.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No notes yet. Send a bot into the call or upload a recording to capture decisions and action items.
        </Card>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className="flex w-full items-center justify-between rounded-[8px] border border-border p-3 text-left transition hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-muted-foreground">
                  {platformLabel(s.platform)} · {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                  {s.pending_suggestions > 0 && ` · ${s.pending_suggestions} to review`}
                </p>
              </div>
              <NotetakerStatusBadge status={s.status} />
            </button>
          ))}
        </div>
      )}

      <StartNotetakerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channelId={channelId}
        incidentId={incidentId}
        onStarted={(session) => setSelectedId(session.id)}
      />
    </div>
  );
}
