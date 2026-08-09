'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Activity,
  Database,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useTestConnection,
  useFetchDashboards,
  useFetchAlerts,
  useImportResources,
} from '@/lib/hooks/useMigration';
import type { Provider, MigrationCredentials, ConnectionResult, MigrationResource } from '@/lib/hooks/useMigration';

const PROVIDERS: {
  id: Provider;
  name: string;
  description: string;
  icon: typeof BarChart3;
  color: string;
}[] = [
  {
    id: 'grafana',
    name: 'Grafana',
    description: 'Import dashboards and alerts from Grafana. PromQL queries are preserved as-is.',
    icon: Activity,
    color: '#F46800',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: 'Import dashboards and monitors. DQL queries are translated to PromQL.',
    icon: BarChart3,
    color: '#632CA6',
  },
  {
    id: 'newrelic',
    name: 'New Relic',
    description: 'Import dashboards and alerts. NRQL queries are translated to PromQL.',
    icon: Database,
    color: '#008C99',
  },
  {
    id: 'groundcover',
    name: 'Groundcover',
    description: 'Import dashboards and monitors from Groundcover. PromQL queries are preserved as-is.',
    icon: Activity,
    color: '#22C55E',
  },
];

const STEPS = ['Select Provider', 'Connect', 'Select Resources', 'Results'];

export default function MigrationsPage() {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [appKey, setAppKey] = useState('');
  const [endpoint, setEndpoint] = useState('http://localhost:3000');
  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<{
    imported: number;
    warnings: string[];
    results: Array<{ id: string; type: string; status: string; name: string; warnings: string[] }>;
  } | null>(null);

  const testConnection = useTestConnection();
  const importResources = useImportResources();

  const {
    data: dashboards = [],
    isLoading: dashboardsLoading,
  } = useFetchDashboards(
    provider || 'grafana',
    connectionResult ? apiKey : '',
    provider === 'grafana' ? endpoint : undefined,
    provider === 'groundcover' || provider === 'datadog' ? appKey : undefined,
  );

  const {
    data: alerts = [],
    isLoading: alertsLoading,
  } = useFetchAlerts(
    provider || 'grafana',
    connectionResult ? apiKey : '',
    provider === 'grafana' ? endpoint : undefined,
    provider === 'groundcover' || provider === 'datadog' ? appKey : undefined,
  );

  const allResources: MigrationResource[] = [...dashboards, ...alerts];
  const selectedDashboardCount = dashboards.filter((d) => selectedIds.has(d.id)).length;
  const selectedAlertCount = alerts.filter((a) => selectedIds.has(a.id)).length;

  function handleSelectProvider(p: Provider) {
    setProvider(p);
    setApiKey('');
    setAppKey('');
    setEndpoint(p === 'grafana' ? 'http://localhost:3000' : '');
    setConnectionResult(null);
    setSelectedIds(new Set());
    setImportResult(null);
    setStep(2);
  }

  async function handleTestConnection() {
    if (!provider) return;
    const creds: MigrationCredentials = { provider, apiKey };
    if (provider === 'datadog' || provider === 'groundcover') creds.appKey = appKey;
    if (provider === 'grafana') creds.endpoint = endpoint;

    try {
      const result = await testConnection.mutateAsync(creds);
      setConnectionResult(result);
      toast.success(`Connected successfully. Found ${result.dashboards} dashboards and ${result.alerts} alerts.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function handleImport() {
    if (!provider) return;
    const creds: MigrationCredentials = { provider, apiKey };
    if (provider === 'datadog' || provider === 'groundcover') creds.appKey = appKey;
    if (provider === 'grafana') creds.endpoint = endpoint;

    const resources = allResources
      .filter((r) => selectedIds.has(r.id))
      .map((r) => ({ type: r.type, id: r.id }));

    try {
      const result = await importResources.mutateAsync({ provider, credentials: creds, resources });
      setImportResult(result);
      setStep(4);
      toast.success(`Imported ${result.imported} resources`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    }
  }

  function toggleResource(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllInSection(resources: MigrationResource[]) {
    const allSelected = resources.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      resources.forEach((r) => {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      });
      return next;
    });
  }

  function resetWizard() {
    setStep(1);
    setProvider(null);
    setApiKey('');
    setAppKey('');
    setEndpoint('http://localhost:3000');
    setConnectionResult(null);
    setSelectedIds(new Set());
    setImportResult(null);
  }

  const providerInfo = PROVIDERS.find((p) => p.id === provider);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pt-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Migration Tool</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import dashboards and alerts from Grafana, Datadog, New Relic, or Groundcover into SREonCall.
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const s = i + 1;
          return (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  s < step
                    ? 'bg-emerald-500 text-white'
                    : s === step
                      ? 'bg-[#FF6B2B] text-white'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {s < step ? <Check className="h-3.5 w-3.5" /> : s}
              </div>
              <span
                className={cn(
                  'text-xs font-medium whitespace-nowrap',
                  s === step ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {s < STEPS.length && (
                <div className={cn('flex-1 h-px', s < step ? 'bg-emerald-500' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Select Provider */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PROVIDERS.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer transition-all hover:border-[#FF6B2B]/40 hover:shadow-md"
              onClick={() => handleSelectProvider(p.id)}
            >
              <CardContent className="p-5 space-y-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${p.color}15` }}
                >
                  <p.icon className="h-5 w-5" style={{ color: p.color }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{p.description}</p>
                </div>
                <div className="flex justify-end">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Step 2: Connect */}
      {step === 2 && provider && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              {providerInfo && (
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${providerInfo.color}15` }}
                >
                  <providerInfo.icon className="h-4.5 w-4.5" style={{ color: providerInfo.color }} />
                </div>
              )}
              <div>
                <h2 className="text-sm font-semibold text-foreground">Connect to {providerInfo?.name}</h2>
                <p className="text-xs text-muted-foreground">Enter your API credentials to connect.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">API Key</label>
                <Input
                  type="password"
                  placeholder="Enter your API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              {provider === 'datadog' && (
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">App Key</label>
                  <Input
                    type="password"
                    placeholder="Enter your Datadog App Key"
                    value={appKey}
                    onChange={(e) => setAppKey(e.target.value)}
                  />
                </div>
              )}

              {provider === 'groundcover' && (
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Backend ID</label>
                  <Input
                    type="text"
                    placeholder="Enter your Groundcover Backend ID"
                    value={appKey}
                    onChange={(e) => setAppKey(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Find your Backend ID in Groundcover Settings &gt; API Keys, or from the backendId parameter in your Groundcover URL.
                  </p>
                </div>
              )}

              {provider === 'grafana' && (
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Endpoint URL</label>
                  <Input
                    type="text"
                    placeholder="http://localhost:3000"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </div>
              )}

              {/* Connection status */}
              {connectionResult && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="text-xs text-emerald-600">
                    Connected. Found {connectionResult.dashboards} dashboards and {connectionResult.alerts} alerts.
                  </span>
                </div>
              )}

              {testConnection.isError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <span className="text-xs text-red-600">
                    {testConnection.error?.message || 'Connection failed. Please check your credentials.'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={!apiKey || testConnection.isPending}
                >
                  {testConnection.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Test Connection
                </Button>
                <Button
                  size="sm"
                  onClick={() => setStep(3)}
                  disabled={!connectionResult}
                  className="bg-[#FF6B2B] hover:bg-[#FF6B2B]/90 text-white"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Select Resources */}
      {step === 3 && provider && (
        <div className="space-y-4">
          {(dashboardsLoading || alertsLoading) && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading resources...</span>
            </div>
          )}

          {!dashboardsLoading && !alertsLoading && (
            <>
              {/* Dashboards Section */}
              {dashboards.length > 0 && (
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                      <h3 className="text-sm font-semibold text-foreground">
                        Dashboards
                        <Badge variant="secondary" className="ml-2">
                          {dashboards.length}
                        </Badge>
                      </h3>
                      <button
                        onClick={() => toggleAllInSection(dashboards)}
                        className="text-xs font-medium text-[#FF6B2B] hover:text-[#FF6B2B]/80 transition-colors"
                      >
                        {dashboards.every((d) => selectedIds.has(d.id)) ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="divide-y divide-border">
                      {dashboards.map((d) => (
                        <label
                          key={d.id}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(d.id)}
                            onChange={() => toggleResource(d.id)}
                            className="h-4 w-4 rounded border-border text-[#FF6B2B] focus:ring-[#FF6B2B]"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{d.title}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              {d.panelCount !== undefined && (
                                <span className="text-xs text-muted-foreground">
                                  {d.panelCount} panels
                                </span>
                              )}
                              {d.lastModified && (
                                <span className="text-xs text-muted-foreground">
                                  Modified {new Date(d.lastModified).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-[10px]">Dashboard</Badge>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Alerts Section */}
              {alerts.length > 0 && (
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                      <h3 className="text-sm font-semibold text-foreground">
                        Alerts
                        <Badge variant="secondary" className="ml-2">
                          {alerts.length}
                        </Badge>
                      </h3>
                      <button
                        onClick={() => toggleAllInSection(alerts)}
                        className="text-xs font-medium text-[#FF6B2B] hover:text-[#FF6B2B]/80 transition-colors"
                      >
                        {alerts.every((a) => selectedIds.has(a.id)) ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="divide-y divide-border">
                      {alerts.map((a) => (
                        <label
                          key={a.id}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(a.id)}
                            onChange={() => toggleResource(a.id)}
                            className="h-4 w-4 rounded border-border text-[#FF6B2B] focus:ring-[#FF6B2B]"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                            {a.lastModified && (
                              <span className="text-xs text-muted-foreground mt-0.5 block">
                                Modified {new Date(a.lastModified).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-[10px]">Alert</Badge>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {dashboards.length === 0 && alerts.length === 0 && (
                <Card>
                  <CardContent className="p-8 text-center">
                    <p className="text-sm text-muted-foreground">No resources found on the connected instance.</p>
                  </CardContent>
                </Card>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={selectedIds.size === 0 || importResources.isPending}
                  className="bg-[#FF6B2B] hover:bg-[#FF6B2B]/90 text-white"
                >
                  {importResources.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Import Selected
                  {selectedIds.size > 0 && (
                    <Badge variant="secondary" className="ml-2 bg-white/20 text-white text-[10px]">
                      {selectedIds.size}
                    </Badge>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && importResult && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Import Complete</h2>
                  <p className="text-xs text-muted-foreground">
                    Successfully imported {selectedDashboardCount > 0 ? `${selectedDashboardCount} dashboards` : ''}
                    {selectedDashboardCount > 0 && selectedAlertCount > 0 ? ' and ' : ''}
                    {selectedAlertCount > 0 ? `${selectedAlertCount} alerts` : ''}
                  </p>
                </div>
              </div>

              {importResult.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 mb-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-amber-600">Warnings</span>
                  </div>
                  <ul className="space-y-1">
                    {importResult.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-600 pl-5">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Table */}
          {importResult.results.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="px-5 py-3 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">Import Details</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Type</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                        <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Warnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {importResult.results.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-5 py-2.5 text-sm text-foreground font-medium">{r.name}</td>
                          <td className="px-5 py-2.5">
                            <Badge variant="secondary" className="text-[10px]">
                              {r.type === 'dashboard' ? 'Dashboard' : 'Alert'}
                            </Badge>
                          </td>
                          <td className="px-5 py-2.5">
                            {r.status === 'success' ? (
                              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                                Success
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
                                Warning
                              </Badge>
                            )}
                          </td>
                          <td className="px-5 py-2.5 text-xs text-muted-foreground">
                            {r.warnings.length > 0 ? r.warnings.join(', ') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={resetWizard}>
              Import More
            </Button>
            <Link href="/dashboards">
              <Button size="sm" className="bg-[#FF6B2B] hover:bg-[#FF6B2B]/90 text-white">
                View Dashboards
                <ChevronRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
