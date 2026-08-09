'use client';

import { useState } from 'react';
import { Loader2, Check, X, Ticket, BookOpen, ListPlus, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import {
  useNotetakerSession,
  useNotetakerTranscript,
  useAcceptSuggestion,
  useDismissSuggestion,
  useRegenerateSummary,
  type NotetakerSuggestion,
} from '@/lib/hooks/useNotetaker';
import { NotetakerStatusBadge, platformLabel, formatDuration, isInFlight } from './notetaker-helpers';

const TYPE_ICON: Record<string, any> = {
  ticket: Ticket,
  runbook: BookOpen,
  incident_timeline: ListPlus,
};

function SuggestionRow({ sessionId, s }: { sessionId: string; s: NotetakerSuggestion }) {
  const accept = useAcceptSuggestion(sessionId);
  const dismiss = useDismissSuggestion(sessionId);
  const Icon = TYPE_ICON[s.type] || FileText;
  const p = s.payload as any;

  const busy = accept.isPending || dismiss.isPending;

  async function onAccept() {
    try {
      const res = await accept.mutateAsync({ suggestionId: s.id });
      toast.success(`Created ${res.resource_type.replace('_', ' ')}.`);
    } catch (err: any) {
      toast.error(err?.body?.detail || 'Failed to accept suggestion.');
    }
  }
  async function onDismiss() {
    try {
      await dismiss.mutateAsync(s.id);
    } catch (err: any) {
      toast.error(err?.body?.detail || 'Failed to dismiss.');
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-[8px] border border-border p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#7C3AED]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {p.title || p.note || p.text || s.type}
          </span>
          <Badge variant="outline" className="capitalize">{s.type.replace('_', ' ')}</Badge>
          {s.type === 'ticket' && p.priority && <Badge variant="secondary" className="capitalize">{p.priority}</Badge>}
        </div>
        {(p.description || p.note) && (
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{p.description || p.note}</p>
        )}
        {Array.isArray(p.steps) && p.steps.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{p.steps.length} step{p.steps.length === 1 ? '' : 's'}</p>
        )}

        {s.status !== 'suggested' && (
          <div className="mt-2">
            <Badge variant={s.status === 'accepted' ? 'success' : 'secondary'} className="capitalize">{s.status}</Badge>
          </div>
        )}
      </div>

      {s.status === 'suggested' && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={onAccept} disabled={busy}>
            {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            <span className="ml-1">Accept</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function NotetakerSessionView({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading } = useNotetakerSession(sessionId, { poll: true });
  const { data: transcript } = useNotetakerTranscript(sessionId);
  const regenerate = useRegenerateSummary(sessionId);
  const [showTranscript, setShowTranscript] = useState(false);

  if (isLoading || !session) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading session…
      </div>
    );
  }

  const pending = session.suggestions.filter((s) => s.status === 'suggested');
  const decided = session.suggestions.filter((s) => s.status !== 'suggested');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{session.title}</h2>
        <NotetakerStatusBadge status={session.status} />
        <Badge variant="outline">{platformLabel(session.platform)}</Badge>
        <span className="text-xs text-muted-foreground">{formatDuration(session.duration_seconds)}</span>
      </div>

      {session.status === 'failed' && (
        <Card className="flex items-start gap-2 border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#DC2626]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{session.error || 'This session failed to process.'}</span>
        </Card>
      )}

      {isInFlight(session.status) && session.status !== 'failed' && (
        <Card className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {session.status === 'recording'
            ? 'Capturing the call — transcript appears live below.'
            : 'Processing the recording. The summary and suggestions will appear here when ready.'}
        </Card>
      )}

      {/* Summary */}
      {session.summary && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Summary</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerate.isPending ? 'animate-spin' : ''}`} />
              <span className="ml-1">Regenerate</span>
            </Button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{session.summary}</p>

          {session.decisions.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Decisions</h4>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {session.decisions.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {session.key_points.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Key points</h4>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {session.key_points.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {session.participants.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Participants: {session.participants.join(', ')}
            </p>
          )}
        </Card>
      )}

      {/* Suggestions */}
      {session.suggestions.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Suggested follow-ups {pending.length > 0 && <Badge variant="ai" className="ml-1">{pending.length} to review</Badge>}
          </h3>
          <div className="space-y-2">
            {pending.map((s) => <SuggestionRow key={s.id} sessionId={sessionId} s={s} />)}
            {decided.map((s) => <SuggestionRow key={s.id} sessionId={sessionId} s={s} />)}
          </div>
        </Card>
      )}

      {/* Transcript */}
      {transcript && transcript.length > 0 && (
        <Card className="p-4">
          <button
            className="flex w-full items-center justify-between text-sm font-bold uppercase tracking-wide text-muted-foreground"
            onClick={() => setShowTranscript((v) => !v)}
          >
            <span>Transcript ({transcript.length} segments)</span>
            <span className="text-xs">{showTranscript ? 'Hide' : 'Show'}</span>
          </button>
          {showTranscript && (
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
              {transcript.map((seg) => (
                <div key={seg.id} className="text-sm">
                  <span className="font-semibold text-[#E85D1C]">{seg.speaker}: </span>
                  <span className={seg.is_final ? '' : 'text-muted-foreground italic'}>{seg.text}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
