'use client';

import {
  Activity,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useSystemHealth, usePlatformSettings, useUpdatePlatformSettings } from '@/lib/hooks/usePlatformAdmin';
import { toast } from 'sonner';

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  up: <CheckCircle2 className="h-5 w-5 text-green-500" />,
  degraded: <AlertTriangle className="h-5 w-5 text-yellow-500" />,
  down: <XCircle className="h-5 w-5 text-red-500" />,
};

const STATUS_BADGE: Record<string, { variant: 'success' | 'warning' | 'destructive'; label: string }> = {
  up: { variant: 'success', label: 'Operational' },
  degraded: { variant: 'warning', label: 'Degraded' },
  down: { variant: 'destructive', label: 'Down' },
};

export default function SystemPage() {
  const { data: health, isLoading: healthLoading, refetch } = useSystemHealth(15000);
  const { data: settings, isLoading: settingsLoading } = usePlatformSettings();
  const updateSettings = useUpdatePlatformSettings();

  function toggleMaintenance() {
    if (!settings) return;
    updateSettings.mutate(
      { maintenance_mode: !settings.maintenance_mode },
      {
        onSuccess: (result) =>
          toast.success(
            result.maintenance_mode
              ? 'Maintenance mode enabled'
              : 'Maintenance mode disabled',
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function toggleSignup() {
    if (!settings) return;
    updateSettings.mutate(
      { signup_enabled: !settings.signup_enabled },
      {
        onSuccess: (result) =>
          toast.success(
            result.signup_enabled ? 'Signups enabled' : 'Signups disabled',
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Infrastructure status and platform settings
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Overall Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Overall Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : health ? (
            <div className="flex items-center gap-4">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full ${
                  health.status === 'healthy'
                    ? 'bg-green-100'
                    : health.status === 'degraded'
                      ? 'bg-yellow-100'
                      : 'bg-red-100'
                }`}
              >
                {health.status === 'healthy' ? (
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                ) : health.status === 'degraded' ? (
                  <AlertTriangle className="h-8 w-8 text-yellow-600" />
                ) : (
                  <XCircle className="h-8 w-8 text-red-600" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-bold capitalize text-foreground">{health.status}</h3>
                <p className="text-sm text-muted-foreground">
                  {health.services.filter((s) => s.status === 'up').length} of{' '}
                  {health.services.length} services operational
                </p>
                <p className="text-xs text-muted-foreground">
                  Last checked: {new Date(health.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : health ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {health.services.map((service) => {
                const badge = STATUS_BADGE[service.status] || STATUS_BADGE.down;
                return (
                  <div
                    key={service.name}
                    className="flex items-center justify-between rounded-lg border border-border p-4"
                  >
                    <div className="flex items-center gap-3">
                      {SERVICE_ICONS[service.status]}
                      <div>
                        <p className="font-medium capitalize text-foreground">{service.name}</p>
                        {service.latency_ms !== undefined && (
                          <p className="text-xs text-muted-foreground">
                            Latency: {service.latency_ms}ms
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Platform Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {settingsLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : settings ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium text-foreground">Maintenance Mode</p>
                  <p className="text-sm text-muted-foreground">
                    When enabled, only platform admins can access the system
                  </p>
                </div>
                <Button
                  variant={settings.maintenance_mode ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={toggleMaintenance}
                  disabled={updateSettings.isPending}
                >
                  {settings.maintenance_mode ? 'Disable' : 'Enable'}
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium text-foreground">New Signups</p>
                  <p className="text-sm text-muted-foreground">
                    Allow new tenant registrations
                  </p>
                </div>
                <Button
                  variant={settings.signup_enabled ? 'outline' : 'destructive'}
                  size="sm"
                  onClick={toggleSignup}
                  disabled={updateSettings.isPending}
                >
                  {settings.signup_enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium text-foreground">Default Plan</p>
                  <p className="text-sm text-muted-foreground">
                    Plan assigned to new tenants
                  </p>
                </div>
                <Badge className="bg-gray-100 text-gray-700">{settings.default_plan}</Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium text-foreground">Max Tenants</p>
                  <p className="text-sm text-muted-foreground">
                    Maximum number of tenants allowed on the platform
                  </p>
                </div>
                <span className="text-lg font-bold text-foreground">{settings.max_tenants}</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
