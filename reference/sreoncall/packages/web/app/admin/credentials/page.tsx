'use client';

import { useState } from 'react';
import {
  KeyRound,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Settings,
  Shield,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useCredentials,
  useRotateCredential,
  useUpdateCredential,
  useSeedCredentials,
} from '@/lib/hooks/useCredentials';
import type { Credential, RotationHistoryEntry } from '@/lib/hooks/useCredentials';

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor(absDiff / 3600000);
  if (days > 0) return diff > 0 ? `${days}d ago` : `in ${days}d`;
  if (hours > 0) return diff > 0 ? `${hours}h ago` : `in ${hours}h`;
  return 'just now';
}

const STATUS_CONFIG: Record<string, { variant: 'success' | 'warning' | 'destructive' | 'default'; icon: React.ReactNode }> = {
  healthy:  { variant: 'success',     icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  due:      { variant: 'warning',     icon: <Clock className="h-3.5 w-3.5" /> },
  overdue:  { variant: 'destructive', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  rotating: { variant: 'default',     icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  failed:   { variant: 'destructive', icon: <XCircle className="h-3.5 w-3.5" /> },
};

export default function CredentialsPage() {
  const { data: credentials, isLoading, refetch } = useCredentials();
  const rotateCredential = useRotateCredential();
  const updateCredential = useUpdateCredential();
  const seedCredentials = useSeedCredentials();

  const [rotateTarget, setRotateTarget] = useState<Credential | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Credential | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Settings form state
  const [settingsForm, setSettingsForm] = useState({
    rotation_interval_days: 0,
    notify_before_days: 0,
    rotation_mode: 'manual' as 'auto' | 'manual',
  });

  const creds = credentials ?? [];
  const healthyCount = creds.filter((c) => c.status === 'healthy').length;
  const dueCount = creds.filter((c) => c.status === 'due').length;
  const problemCount = creds.filter((c) => c.status === 'overdue' || c.status === 'failed').length;

  function openSettings(cred: Credential) {
    setSettingsForm({
      rotation_interval_days: cred.rotation_interval_days,
      notify_before_days: cred.notify_before_days,
      rotation_mode: cred.rotation_mode,
    });
    setSettingsTarget(cred);
  }

  function handleSaveSettings() {
    if (!settingsTarget) return;
    updateCredential.mutate(
      { key: settingsTarget.key, updates: settingsForm },
      {
        onSuccess: () => {
          toast.success(`Settings updated for ${settingsTarget.name}`);
          setSettingsTarget(null);
          refetch();
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
  }

  function handleRotate() {
    if (!rotateTarget) return;
    rotateCredential.mutate(rotateTarget.key, {
      onSuccess: () => {
        toast.success(`Rotation initiated for ${rotateTarget.name}`);
        setRotateTarget(null);
        refetch();
      },
      onError: (err: Error) => toast.error(err.message),
    });
  }

  function handleSeed() {
    seedCredentials.mutate(undefined, {
      onSuccess: () => {
        toast.success('Credential registry seeded');
        refetch();
      },
      onError: (err: Error) => toast.error(err.message),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Credential Rotation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage and rotate platform credentials
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && creds.length === 0 && (
            <Button
              variant="outline"
              onClick={handleSeed}
              disabled={seedCredentials.isPending}
            >
              {seedCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Shield className="mr-2 h-4 w-4" />
              Seed Registry
            </Button>
          )}
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                <KeyRound className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Credentials</p>
                <p className="text-2xl font-bold text-foreground">{creds.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Healthy</p>
                <p className="text-2xl font-bold text-green-600">{healthyCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Due Soon</p>
                <p className="text-2xl font-bold text-yellow-600">{dueCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue / Failed</p>
                <p className="text-2xl font-bold text-red-600">{problemCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Credentials Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Credentials
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : creds.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
              <Shield className="mb-2 h-8 w-8" />
              <p>No credentials registered. Use &quot;Seed Registry&quot; to populate.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">Category</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 pr-4 font-medium">Last Rotated</th>
                    <th className="pb-3 pr-4 font-medium">Next Due</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {creds.map((cred) => {
                    const statusCfg = STATUS_CONFIG[cred.status] ?? STATUS_CONFIG.healthy;
                    const isExpanded = expandedKey === cred.key;

                    return (
                      <CredentialRow
                        key={cred.key}
                        cred={cred}
                        statusCfg={statusCfg}
                        isExpanded={isExpanded}
                        onToggleExpand={() => setExpandedKey(isExpanded ? null : cred.key)}
                        onRotate={() => setRotateTarget(cred)}
                        onSettings={() => openSettings(cred)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rotate Confirmation Dialog */}
      <Dialog open={!!rotateTarget} onClose={() => setRotateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate Credential</DialogTitle>
          </DialogHeader>
          {rotateTarget && (
            <div className="space-y-4">
              {rotateTarget.category === 'internal' && rotateTarget.rotation_mode === 'auto' ? (
                <p className="text-sm text-muted-foreground">
                  This will rotate <span className="font-semibold text-foreground">{rotateTarget.name}</span> and
                  restart services (~30s downtime). Proceed?
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Manual rotation required for <span className="font-semibold text-foreground">{rotateTarget.name}</span>.
                  </p>
                  {rotateTarget.rotation_instructions && (
                    <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                      {rotateTarget.rotation_instructions}
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={rotateCredential.isPending} onClick={() => setRotateTarget(null)}>
                    Cancel
                  </Button>
                <Button
                  variant="default"
                  onClick={handleRotate}
                  disabled={rotateCredential.isPending}
                >
                  {rotateCredential.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {rotateTarget.category === 'internal' && rotateTarget.rotation_mode === 'auto'
                    ? 'Rotate'
                    : 'Confirm Rotation Complete'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={!!settingsTarget} onClose={() => setSettingsTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Settings &mdash; {settingsTarget?.name}
            </DialogTitle>
          </DialogHeader>
          {settingsTarget && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Rotation Interval (days)
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={settingsForm.rotation_interval_days}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      rotation_interval_days: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Notify Before (days)
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={settingsForm.notify_before_days}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      notify_before_days: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              {settingsTarget.category === 'internal' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Rotation Mode
                  </label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    value={settingsForm.rotation_mode}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        rotation_mode: e.target.value as 'auto' | 'manual',
                      }))
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSettingsTarget(null)}>Cancel</Button>
                <Button onClick={handleSaveSettings} disabled={updateCredential.isPending}>
                  {updateCredential.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Credential Row ────────────────────────────────────────────────── */

interface CredentialRowProps {
  cred: Credential;
  statusCfg: { variant: string; icon: React.ReactNode };
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRotate: () => void;
  onSettings: () => void;
}

function CredentialRow({ cred, statusCfg, isExpanded, onToggleExpand, onRotate, onSettings }: CredentialRowProps) {
  const history: RotationHistoryEntry[] = cred.history?.slice(0, 10) ?? [];

  return (
    <>
      <tr className="border-b border-border">
        <td className="py-3 pr-4">
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-1.5 text-left font-medium text-foreground hover:text-[#FF6B2B] transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            {cred.name}
          </button>
          <p className="ml-5.5 text-xs text-muted-foreground">{cred.key}</p>
        </td>
        <td className="py-3 pr-4">
          <Badge
            variant="default"
            className={cn(
              cred.category === 'internal'
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-100',
            )}
          >
            {cred.category === 'internal' ? (
              <Shield className="mr-1 h-3 w-3" />
            ) : (
              <ExternalLink className="mr-1 h-3 w-3" />
            )}
            {cred.category}
          </Badge>
        </td>
        <td className="py-3 pr-4">
          <Badge variant={statusCfg.variant as 'success' | 'warning' | 'destructive' | 'default'}>
            <span className="mr-1">{statusCfg.icon}</span>
            {cred.status}
          </Badge>
        </td>
        <td className="py-3 pr-4 text-muted-foreground">
          {relativeTime(cred.last_rotated_at)}
        </td>
        <td className="py-3 pr-4 text-muted-foreground">
          {relativeTime(cred.next_rotation_at)}
        </td>
        <td className="py-3">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={cred.status === 'due' || cred.status === 'overdue' ? 'default' : 'outline'}
              onClick={onRotate}
              disabled={cred.status === 'rotating'}
            >
              {cred.status === 'rotating' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              Rotate
            </Button>
            <Button size="sm" variant="ghost" onClick={onSettings}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
      {isExpanded && history.length > 0 && (
        <tr>
          <td colSpan={6} className="bg-muted/30 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Rotation History (last {history.length})
            </p>
            <div className="space-y-1.5">
              {history.map((entry, i) => {
                const entryCfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.healthy;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded border border-border bg-background px-3 py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground">{relativeTime(entry.rotated_at)}</span>
                    <Badge variant={entryCfg.variant as 'success' | 'warning' | 'destructive' | 'default'} className="text-[10px]">
                      {entry.status}
                    </Badge>
                    <span className="text-muted-foreground">{entry.rotated_by || 'system'}</span>
                    {entry.error && (
                      <span className="text-red-500 truncate max-w-[300px]">{entry.error}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
      {isExpanded && history.length === 0 && (
        <tr>
          <td colSpan={6} className="bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
            No rotation history
          </td>
        </tr>
      )}
    </>
  );
}
