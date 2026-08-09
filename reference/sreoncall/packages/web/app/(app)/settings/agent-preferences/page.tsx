'use client';

import { useState, useEffect } from 'react';
import { Bot, Save, Shield, Bell, Clock } from 'lucide-react';
import {
  useConsumerAgentPreferences,
  useUpdateConsumerAgentPreferences,
} from '@/lib/hooks/useAgents';
import { cn } from '@/lib/utils';

interface AgentPrefs {
  notifications_enabled: boolean;
  notify_on: string[];
  max_autonomy_allowed: string;
  quiet_hours: {
    enabled: boolean;
    start_hour: number;
    end_hour: number;
  };
}

const NOTIFY_OPTIONS = [
  { value: 'execution_completed', label: 'Execution completed' },
  { value: 'execution_failed', label: 'Execution failed' },
  { value: 'approval_requested', label: 'Approval requested' },
  { value: 'high_risk_action', label: 'High risk action taken' },
] as const;

const AUTONOMY_OPTIONS = [
  { value: 'observe', label: 'Observe only', desc: 'Agents can only monitor, no actions' },
  { value: 'recommend', label: 'Recommend', desc: 'Agents can suggest but not act' },
  { value: 'auto_low', label: 'Auto (Low Risk)', desc: 'Allow low-risk automated actions' },
  { value: 'auto_full', label: 'Auto (Full)', desc: 'Allow all automated actions' },
] as const;

export default function ConsumerAgentPreferencesPage() {
  const { data: prefs, isLoading } = useConsumerAgentPreferences();
  const updatePrefs = useUpdateConsumerAgentPreferences();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifyOn, setNotifyOn] = useState<string[]>(['execution_completed', 'execution_failed', 'high_risk_action']);
  const [maxAutonomy, setMaxAutonomy] = useState('auto_low');
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(6);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (prefs) {
      const p = prefs as AgentPrefs;
      setNotificationsEnabled(p.notifications_enabled ?? true);
      setNotifyOn(p.notify_on ?? ['execution_completed', 'execution_failed']);
      setMaxAutonomy(p.max_autonomy_allowed ?? 'auto_low');
      setQuietEnabled(p.quiet_hours?.enabled ?? false);
      setQuietStart(p.quiet_hours?.start_hour ?? 22);
      setQuietEnd(p.quiet_hours?.end_hour ?? 6);
    }
  }, [prefs]);

  function markDirty() { setDirty(true); }

  function toggleNotifyOn(value: string) {
    setNotifyOn((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    markDirty();
  }

  function handleSave() {
    updatePrefs.mutate(
      {
        notifications_enabled: notificationsEnabled,
        notify_on: notifyOn,
        max_autonomy_allowed: maxAutonomy,
        quiet_hours: {
          enabled: quietEnabled,
          start_hour: quietStart,
          end_hour: quietEnd,
        },
      },
      { onSuccess: () => setDirty(false) },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Bot className="h-5 w-5" /> Agent Preferences
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Control how your provider&apos;s AI agents can interact with your environment
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || updatePrefs.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" /> {updatePrefs.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Max Autonomy */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
          <Shield className="h-4 w-4 text-primary" /> Maximum Autonomy Allowed
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Set the maximum level of autonomy your provider&apos;s agents can use on your environment
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AUTONOMY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setMaxAutonomy(opt.value); markDirty(); }}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                maxAutonomy === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30',
              )}
            >
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bell className="h-4 w-4 text-primary" /> Notifications
          </h3>
          <button
            onClick={() => { setNotificationsEnabled(!notificationsEnabled); markDirty(); }}
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              notificationsEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span className={cn(
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform',
              notificationsEnabled && 'translate-x-5',
            )} />
          </button>
        </div>
        {notificationsEnabled && (
          <div className="space-y-2">
            {NOTIFY_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyOn.includes(opt.value)}
                  onChange={() => toggleNotifyOn(opt.value)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-foreground">{opt.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Quiet Hours */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 text-primary" /> Quiet Hours
          </h3>
          <button
            onClick={() => { setQuietEnabled(!quietEnabled); markDirty(); }}
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              quietEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span className={cn(
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform',
              quietEnabled && 'translate-x-5',
            )} />
          </button>
        </div>
        {quietEnabled && (
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Start hour (0-23)</span>
              <input
                type="number" min={0} max={23} value={quietStart}
                onChange={(e) => { setQuietStart(Number(e.target.value)); markDirty(); }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">End hour (0-23)</span>
              <input
                type="number" min={0} max={23} value={quietEnd}
                onChange={(e) => { setQuietEnd(Number(e.target.value)); markDirty(); }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
