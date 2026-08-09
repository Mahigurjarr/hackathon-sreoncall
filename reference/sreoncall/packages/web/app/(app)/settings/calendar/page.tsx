'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Calendar, Loader2, Trash2, CheckCircle2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  useCalendarConnections,
  useDisconnectCalendar,
  startCalendarConnect,
  type CalendarPlatform,
} from '@/lib/hooks/useCalendarConnections';

const PROVIDER_LABEL: Record<CalendarPlatform, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft / Outlook',
};

export default function CalendarSettingsPage() {
  const params = useSearchParams();
  const { data, isLoading } = useCalendarConnections();
  const disconnect = useDisconnectCalendar();
  const [connecting, setConnecting] = useState<CalendarPlatform | null>(null);

  // Surface the OAuth callback result.
  useEffect(() => {
    const ok = params.get('calendar_connected');
    const err = params.get('calendar_error');
    if (ok) toast.success(`${PROVIDER_LABEL[ok as CalendarPlatform] || ok} connected.`);
    if (err) toast.error(`Calendar connection failed: ${err.replace(/_/g, ' ')}`);
  }, [params]);

  async function handleConnect(platform: CalendarPlatform) {
    setConnecting(platform);
    try {
      await startCalendarConnect(platform); // redirects away
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start calendar connection.');
      setConnecting(null);
    }
  }

  async function handleDisconnect(id: string) {
    try {
      await disconnect.mutateAsync(id);
      toast.success('Calendar disconnected.');
    } catch (e: any) {
      toast.error(e?.body?.detail || 'Failed to disconnect.');
    }
  }

  const providers = data?.providers || { google: false, microsoft: false };
  const connections = data?.data || [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-1">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Calendar className="h-5 w-5 text-[#7C3AED]" /> Calendar auto-capture
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a calendar so the AI Notetaker can auto-join scheduled meetings. Only meetings linked to an
          incident (an <code>INC-####</code> in the invite title) get a bot — nothing else is recorded.
        </p>
      </div>

      {/* Connect */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Connect a calendar</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['google', 'microsoft'] as CalendarPlatform[]).map((p) => (
            <div key={p} className="flex items-center justify-between rounded-[10px] border border-border p-3">
              <div>
                <p className="text-sm font-semibold">{PROVIDER_LABEL[p]}</p>
                {!providers[p] && <p className="text-xs text-muted-foreground">Not configured on this workspace</p>}
              </div>
              <Button size="sm" onClick={() => handleConnect(p)} disabled={!providers[p] || connecting === p}>
                {connecting === p ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                <span className="ml-1">Connect</span>
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* Connected */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Connected calendars</h3>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No calendars connected yet.</p>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-[8px] border border-border p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />
                  <div>
                    <p className="text-sm font-medium">{c.email || PROVIDER_LABEL[c.platform]}</p>
                    <p className="text-xs text-muted-foreground">{PROVIDER_LABEL[c.platform]}</p>
                  </div>
                  {c.status !== 'connected' && <Badge variant="warning" className="capitalize">{c.status}</Badge>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => handleDisconnect(c.id)} disabled={disconnect.isPending}>
                  <Trash2 className="h-4 w-4" /> <span className="ml-1">Disconnect</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
