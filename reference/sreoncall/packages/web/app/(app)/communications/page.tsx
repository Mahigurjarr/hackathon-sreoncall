'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Siren,
  Users,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { useChannels, type Channel, type ChannelType } from '@/lib/hooks/useChannels';

const TYPE_CONFIG: Record<string, { label: string; badge: string; icon: typeof MessageSquare }> = {
  incident_war_room:    { label: 'War Room', badge: 'bg-red-500/10 text-red-400 border-red-500/20', icon: Siren },
  general:              { label: 'General', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: MessageSquare },
  dm:                   { label: 'DM', badge: 'bg-muted text-muted-foreground border-border', icon: Users },
  customer:             { label: 'Customer', badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Users },
  topic:                { label: 'Topic', badge: 'bg-teal-500/10 text-teal-400 border-teal-500/20', icon: MessageSquare },
  broadcast:            { label: 'Broadcast', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: MessageSquare },
  internal_escalation:  { label: 'Escalation', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20', icon: Siren },
};

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CommunicationsPage() {
  const { data: channels, isLoading } = useChannels();

  const warRooms = (channels || []).filter((c) => c.type === 'incident_war_room');
  const generalChannels = (channels || []).filter((c) => c.type === 'general');
  const dms = (channels || []).filter((c) => c.type === 'dm');

  const totalCount = channels?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of all communication channels
          </p>
        </div>
        <Link href="/channels">
          <Button size="sm">
            Open Channels
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </Link>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Channels</p>
            <p className="text-2xl font-bold text-foreground mt-1">{totalCount}</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">War Rooms</p>
            <p className={cn('text-2xl font-bold mt-1', warRooms.length > 0 ? 'text-red-400' : 'text-muted-foreground')}>
              {warRooms.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">General Channels</p>
            <p className="text-2xl font-bold text-foreground mt-1">{generalChannels.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && totalCount === 0 && (
        <EmptyState
          icon={MessageSquare}
          title="No channels yet"
          description="Create your first channel to start communicating with your team."
          actionLabel="Open Channels"
          onAction={() => window.location.href = '/channels'}
        />
      )}

      {/* Active War Rooms */}
      {warRooms.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Siren className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-semibold text-foreground">Active War Rooms</h2>
            <span className="rounded-full bg-red-500/10 text-red-400 px-2 py-0.5 text-[10px] font-bold">
              {warRooms.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {warRooms.map((ch) => (
              <ChannelCard key={ch._id} channel={ch} />
            ))}
          </div>
        </section>
      )}

      {/* General Channels */}
      {generalChannels.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-foreground">General Channels</h2>
            <span className="rounded-full bg-blue-500/10 text-blue-400 px-2 py-0.5 text-[10px] font-bold">
              {generalChannels.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {generalChannels.map((ch) => (
              <ChannelCard key={ch._id} channel={ch} />
            ))}
          </div>
        </section>
      )}

      {/* Direct Messages */}
      {dms.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Direct Messages</h2>
            <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-bold">
              {dms.length}
            </span>
          </div>
          <div className="space-y-1">
            {dms.map((ch) => (
              <Link
                key={ch._id}
                href="/channels"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{ch.name}</span>
                {ch.description && (
                  <span className="text-[11px] text-muted-foreground truncate">{ch.description}</span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">{formatDate(ch.created_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChannelCard({ channel }: { channel: Channel }) {
  const config = TYPE_CONFIG[channel.type] || TYPE_CONFIG.general;
  const Icon = config.icon;

  return (
    <Card className={cn(channel.type === 'incident_war_room' && 'border-red-500/20')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground truncate">{channel.name}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold border', config.badge)}>
              {config.label}
            </span>
            {(channel as any).slack_integration && (
              <span className="rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold">
                Slack
              </span>
            )}
            {(channel as any).teams_integration && (
              <span className="rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 text-[9px] font-bold">
                Teams
              </span>
            )}
          </div>
        </div>
        {channel.description && (
          <p className="text-[11px] text-muted-foreground mb-3 line-clamp-2">{channel.description}</p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{formatDate(channel.created_at)}</span>
          <Link href="/channels">
            <Button variant="ghost" size="sm" className="text-[11px] h-7 px-2">
              Open <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
