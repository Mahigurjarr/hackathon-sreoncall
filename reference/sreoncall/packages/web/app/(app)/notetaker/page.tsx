'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useNotetakerSessions } from '@/lib/hooks/useNotetaker';
import { StartNotetakerDialog } from '@/components/notetaker/StartNotetakerDialog';
import { NotetakerStatusBadge, platformLabel, formatDuration } from '@/components/notetaker/notetaker-helpers';

export default function NotetakerListPage() {
  const router = useRouter();
  const { data: sessions, isLoading } = useNotetakerSessions();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Mic className="h-6 w-6 text-[#7C3AED]" /> AI Notetaker
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture war-room calls — transcribe, summarize, and turn discussion into tickets and runbooks.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> <span className="ml-1">New session</span>
        </Button>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      ) : !sessions || sessions.length === 0 ? (
        <Card className="p-10 text-center">
          <Mic className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No sessions yet. Send a notetaker bot into a Zoom / Meet / Teams / Slack call, or upload a recording.
          </p>
          <Button className="mt-4" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> <span className="ml-1">Start your first session</span>
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => router.push(`/notetaker/${s.id}`)}
              className="flex w-full items-center justify-between rounded-[10px] border border-border bg-card p-4 text-left transition hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{s.title}</p>
                <p className="text-xs text-muted-foreground">
                  {platformLabel(s.platform)} · {formatDuration(s.duration_seconds)} ·{' '}
                  {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                  {s.pending_suggestions > 0 && ` · ${s.pending_suggestions} to review`}
                </p>
              </div>
              <NotetakerStatusBadge status={s.status} />
            </button>
          ))}
        </div>
      )}

      <StartNotetakerDialog open={dialogOpen} onOpenChange={setDialogOpen} onStarted={(session) => router.push(`/notetaker/${session.id}`)} />
    </div>
  );
}
