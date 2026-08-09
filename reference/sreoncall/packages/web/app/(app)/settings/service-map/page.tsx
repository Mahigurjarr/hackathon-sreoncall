'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Scan,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import { useObservabilityConnections } from '@/lib/hooks/useObservabilityConnections';
import { TopologySettingsCard } from '@/components/settings/TopologySettingsCard';

interface AutoDiscoverySettings {
  otel_trace_scanning_enabled: boolean;
  schedule_interval: '1h' | '6h' | '12h' | '24h';
  observability_connection_id: string | null;
}

interface DiscoveryJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: {
    edges_discovered: number;
    edges_new: number;
    edges_updated: number;
    edges_stale: number;
    services_discovered: number;
    processing_time_ms: number;
  } | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const INTERVAL_OPTIONS = [
  { value: '1h', label: 'Every 1 hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Every 24 hours' },
];

export default function ServiceMapSettingsPage() {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<AutoDiscoverySettings>({
    otel_trace_scanning_enabled: false,
    schedule_interval: '6h',
    observability_connection_id: null,
  });
  const [initialized, setInitialized] = useState(false);

  const { data: fetchedSettings, isLoading } = useQuery({
    queryKey: ['service-map-settings'],
    queryFn: async () => {
      const res = await api.get<AutoDiscoverySettings>(
        '/api/v1/service-dependencies/discovery/settings',
      );
      return res;
    },
  });

  useEffect(() => {
    if (fetchedSettings && !initialized) {
      setSettings(fetchedSettings);
      setInitialized(true);
    }
  }, [fetchedSettings, initialized]);

  const { data: connectionsRes } = useObservabilityConnections();
  const connections = (connectionsRes?.data ?? []).filter((c) => c.status === 'connected');

  const { data: discoveryJobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['discovery-jobs'],
    queryFn: async () => {
      const res = await api.get<{ data: DiscoveryJob[] }>(
        '/api/v1/service-dependencies/discovery/jobs',
      );
      return res.data;
    },
  });

  const triggerDiscovery = useMutation({
    mutationFn: () =>
      api.post('/api/v1/service-dependencies/discovery/trigger', { type: 'otel_trace_scan' }),
    onSuccess: () => {
      toast.success('Discovery job started');
      queryClient.invalidateQueries({ queryKey: ['discovery-jobs'] });
    },
    onError: () => {
      toast.error('Failed to start discovery job');
    },
  });

  async function handleSave() {
    setIsSaving(true);
    try {
      await api.patch('/api/v1/service-dependencies/discovery/settings', settings);
      toast.success('Auto-discovery settings saved');
      queryClient.invalidateQueries({ queryKey: ['service-map-settings'] });
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Auto-Discovery Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5 text-primary" />
            Auto-Discovery Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* OTel Trace Scanning Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                OTel Trace Scanning
              </label>
              <p className="text-xs text-muted-foreground">
                Automatically discover service dependencies from OpenTelemetry trace data
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.otel_trace_scanning_enabled}
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  otel_trace_scanning_enabled: !s.otel_trace_scanning_enabled,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                settings.otel_trace_scanning_enabled
                  ? 'bg-primary'
                  : 'bg-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  settings.otel_trace_scanning_enabled
                    ? 'translate-x-5'
                    : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Schedule Interval */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Schedule Interval
            </label>
            <Select
              value={settings.schedule_interval}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  schedule_interval: e.target.value as AutoDiscoverySettings['schedule_interval'],
                }))
              }
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              How often the auto-discovery job scans for new dependencies
            </p>
          </div>

          {/* Observability Connection Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Observability Connection
            </label>
            <Select
              value={settings.observability_connection_id ?? ''}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  observability_connection_id: e.target.value || null,
                }))
              }
            >
              <option value="">Select a connection...</option>
              {connections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.name} ({conn.vendor ?? conn.mode})
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              The observability data source used for trace-based discovery
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      <TopologySettingsCard />

      {/* Discovery History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Discovery History
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={triggerDiscovery.isPending}
            onClick={() => triggerDiscovery.mutate()}
          >
            {triggerDiscovery.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run Now
          </Button>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : discoveryJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Scan className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">
                No discovery jobs yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enable auto-discovery or click &quot;Run Now&quot; to start scanning
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {discoveryJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-background p-3"
                >
                  <div className="flex items-center gap-3">
                    {job.status === 'completed' && (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                    {job.status === 'failed' && (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    {job.status === 'running' && (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {new Date(job.started_at ?? job.created_at).toLocaleString()}
                      </p>
                      {job.error_message && (
                        <p className="text-xs text-destructive">{job.error_message}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.status === 'completed' && (
                      <span className="text-xs text-muted-foreground">
                        {job.results?.edges_discovered ?? 0} dependencies found
                      </span>
                    )}
                    <Badge
                      variant={
                        job.status === 'completed'
                          ? 'success'
                          : job.status === 'failed'
                            ? 'destructive'
                            : 'info'
                      }
                    >
                      {job.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
