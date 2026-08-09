'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Trash2, Loader2, ExternalLink, Settings2, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import {
  useFilteredNotifications,
  useNotificationStats,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useSendTestNotification,
  type Notification,
  type NotificationPreferences as NotifPrefs,
} from '@/lib/hooks/useNotifications';

type FilterTab = 'all' | 'unread' | 'info' | 'warning' | 'error' | 'critical';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'info', label: 'Info' },
  { key: 'warning', label: 'Warning' },
  { key: 'error', label: 'Error' },
  { key: 'critical', label: 'Critical' },
];

const priorityBorderColors: Record<string, string> = {
  info: 'border-l-blue-500',
  warning: 'border-l-yellow-500',
  error: 'border-l-orange-500',
  critical: 'border-l-red-600',
};

const priorityBadgeColors: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  error: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const typeLabels: Record<string, string> = {
  incident: 'Incident',
  ticket: 'Ticket',
  alert: 'Alert',
  system: 'System',
  team: 'Team',
  sla: 'SLA',
  change: 'Change',
};

function getResourceLink(resourceType: string | null, resourceId: string | null): string | null {
  if (!resourceType || !resourceId) return null;
  const routes: Record<string, string> = {
    ticket: '/tickets',
    incident: '/incidents',
    runbook: '/runbooks',
    postmortem: '/postmortems',
    change: '/changes',
  };
  const base = routes[resourceType];
  if (!base) return null;
  return `${base}/${resourceId}`;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  );
}

function PreferencesPanel() {
  const { data: prefs, isLoading } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const sendTest = useSendTestNotification();
  const [expanded, setExpanded] = useState(false);

  function handleToggle(key: string, value: boolean) {
    updatePrefs.mutate({ [key]: value } as any, {
      onError: () => toast.error('Failed to update preference'),
    });
  }

  function handleChannelToggle(channel: string, value: boolean) {
    updatePrefs.mutate({ channels: { [channel]: value } } as any, {
      onError: () => toast.error('Failed to update preference'),
    });
  }

  function handleQuietHoursToggle(enabled: boolean) {
    updatePrefs.mutate({ quiet_hours: { enabled } } as any, {
      onError: () => toast.error('Failed to update preference'),
    });
  }

  function handleQuietHoursField(field: string, value: string) {
    updatePrefs.mutate({ quiet_hours: { [field]: value } } as any, {
      onError: () => toast.error('Failed to update preference'),
    });
  }

  if (isLoading || !prefs) return null;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Notification Preferences</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-6">
          {/* Delivery Methods */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Delivery Methods</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Email notifications</p>
                  <p className="text-xs text-muted-foreground">Receive notifications via email</p>
                </div>
                <Toggle checked={prefs.email} onChange={(v) => handleToggle('email', v)} disabled={updatePrefs.isPending} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">In-app notifications</p>
                  <p className="text-xs text-muted-foreground">Show notifications in the app</p>
                </div>
                <Toggle checked={prefs.in_app} onChange={(v) => handleToggle('in_app', v)} disabled={updatePrefs.isPending} />
              </div>
            </div>
          </div>

          {/* Channel Types */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Channel Types</h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'incident', label: 'Incidents', desc: 'Incident alerts & updates' },
                { key: 'ticket', label: 'Tickets', desc: 'Ticket assignments & changes' },
                { key: 'oncall', label: 'On-Call', desc: 'Schedule & escalation alerts' },
                { key: 'system', label: 'System', desc: 'System & maintenance notices' },
              ].map((ch) => (
                <div key={ch.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{ch.label}</p>
                    <p className="text-xs text-muted-foreground">{ch.desc}</p>
                  </div>
                  <Toggle
                    checked={(prefs.channels as any)?.[ch.key] ?? true}
                    onChange={(v) => handleChannelToggle(ch.key, v)}
                    disabled={updatePrefs.isPending}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Event Types */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Event Types</h4>
            <div className="space-y-3">
              {[
                { key: 'ticket_assigned', label: 'Ticket assigned to me' },
                { key: 'ticket_updated', label: 'Ticket I\'m watching is updated' },
                { key: 'ticket_commented', label: 'New comment on my ticket' },
                { key: 'mention', label: 'Someone mentions me' },
                { key: 'sla_breach', label: 'SLA breach warning' },
              ].map((evt) => (
                <div key={evt.key} className="flex items-center justify-between">
                  <p className="text-sm text-foreground">{evt.label}</p>
                  <Toggle
                    checked={(prefs as any)[evt.key] ?? true}
                    onChange={(v) => handleToggle(evt.key, v)}
                    disabled={updatePrefs.isPending}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Quiet Hours */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quiet Hours</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Enable quiet hours</p>
                  <p className="text-xs text-muted-foreground">Suppress non-critical notifications during set hours</p>
                </div>
                <Toggle
                  checked={prefs.quiet_hours?.enabled ?? false}
                  onChange={handleQuietHoursToggle}
                  disabled={updatePrefs.isPending}
                />
              </div>
              {prefs.quiet_hours?.enabled && (
                <div className="flex items-center gap-3 pl-1">
                  <div>
                    <label className="text-xs text-muted-foreground">From</label>
                    <input
                      type="time"
                      value={prefs.quiet_hours.start || '22:00'}
                      onChange={(e) => handleQuietHoursField('start', e.target.value)}
                      className="block mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">To</label>
                    <input
                      type="time"
                      value={prefs.quiet_hours.end || '08:00'}
                      onChange={(e) => handleQuietHoursField('end', e.target.value)}
                      className="block mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Timezone</label>
                    <select
                      value={prefs.quiet_hours.timezone || 'UTC'}
                      onChange={(e) => handleQuietHoursField('timezone', e.target.value)}
                      className="block mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    >
                      {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'].map((tz) => (
                        <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Test notification */}
          <div className="border-t border-border pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendTest.mutate(undefined, {
                onSuccess: () => toast.success('Test notification sent!'),
                onError: () => toast.error('Failed to send test notification'),
              })}
              disabled={sendTest.isPending}
            >
              {sendTest.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-2 h-3.5 w-3.5" />
              )}
              Send Test Notification
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filters = {
    ...(activeTab === 'unread' ? { read: false } : {}),
    ...(['info', 'warning', 'error', 'critical'].includes(activeTab)
      ? { type: activeTab }
      : {}),
    limit: 50,
  };

  const { data, isLoading } = useFilteredNotifications(filters);
  const { data: stats } = useNotificationStats();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotification = useDeleteNotification();

  function handleMarkRead(id: string) {
    markRead.mutate(id, {
      onError: () => toast.error('Failed to mark notification as read'),
    });
  }

  function handleMarkAllRead() {
    markAllRead.mutate(undefined, {
      onSuccess: () => toast.success('All notifications marked as read'),
      onError: () => toast.error('Failed to mark all as read'),
    });
  }

  function handleDelete(id: string) {
    deleteNotification.mutate(id, {
      onError: () => toast.error('Failed to delete notification'),
    });
  }

  const notifications = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            In-app notification center
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleMarkAllRead}
          disabled={markAllRead.isPending || !stats?.unread}
        >
          {markAllRead.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="mr-2 h-4 w-4" />
          )}
          Mark All Read
        </Button>
      </div>

      {/* Notification Preferences */}
      <PreferencesPanel />

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {tab.label}
            {tab.key === 'unread' && stats?.unread ? (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground/20 px-1 text-xs">
                {stats.unread}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{stats.unread}</span> unread
          </span>
          <span className="text-border">|</span>
          <span>
            <span className="font-semibold text-foreground">{stats.total}</span> total
          </span>
          {Object.keys(stats.by_type).length > 0 && (
            <>
              <span className="text-border">|</span>
              {Object.entries(stats.by_type).map(([type, count]) => (
                <span key={type}>
                  {typeLabels[type] || type}: {count}
                </span>
              ))}
            </>
          )}
        </div>
      )}

      {/* Notification List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description={
            activeTab === 'all'
              ? 'You have no notifications yet.'
              : `No ${activeTab} notifications found.`
          }
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onMarkRead={handleMarkRead}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Pagination info */}
      {data?.pagination?.has_more && (
        <p className="text-center text-sm text-muted-foreground">
          Showing {notifications.length} of {data.pagination.total ?? 'many'} notifications
        </p>
      )}
    </div>
  );
}

function NotificationCard({
  notification: n,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const resourceLink = getResourceLink(n.resource_type, n.resource_id);
  const borderColor = priorityBorderColors[n.priority] || 'border-l-border';
  const badgeColor = priorityBadgeColors[n.priority] || 'bg-muted text-muted-foreground';

  return (
    <Card
      className={cn(
        'group relative border-l-4 transition-colors',
        borderColor,
        n.read ? 'bg-card' : 'bg-muted/40'
      )}
    >
      <div className="flex items-start gap-4 p-4">
        {/* Content */}
        <div
          className={cn('min-w-0 flex-1', !n.read && 'cursor-pointer')}
          onClick={() => !n.read && onMarkRead(n.id)}
        >
          <div className="flex items-center gap-2">
            {/* Unread dot */}
            {!n.read && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
            )}

            {/* Priority badge */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                badgeColor
              )}
            >
              {n.priority}
            </span>

            {/* Type badge */}
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {typeLabels[n.type] || n.type}
            </span>

            {/* Timestamp */}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
            </span>
          </div>

          <h4 className="mt-1.5 text-sm font-semibold text-foreground">
            {n.title}
          </h4>

          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {n.body}
          </p>

          {/* Resource link */}
          {resourceLink && (
            <Link
              href={resourceLink}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              View {typeLabels[n.resource_type!] || n.resource_type}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onDelete(n.id)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="Delete notification"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Card>
  );
}
