'use client';

import { useState } from 'react';
import {
  Webhook,
  Plus,
  Copy,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  Clock,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  useExternalAlertSources,
  useCreateExternalAlertSource,
  useDeleteExternalAlertSource,
  useRotateExternalAlertSourceToken,
  type ExternalAlertPlatform,
  type CreatedExternalAlertSource,
} from '@/lib/hooks/useExternalAlertSources';
import { useServices } from '@/lib/hooks/useServices';

const PLATFORMS: { value: ExternalAlertPlatform; label: string }[] = [
  { value: 'groundcover', label: 'Groundcover' },
  { value: 'alertmanager', label: 'Alertmanager / Prometheus' },
  { value: 'grafana', label: 'Grafana' },
  { value: 'datadog', label: 'Datadog' },
  { value: 'generic', label: 'Generic Webhook' },
];

const SEVERITY_LABELS: Record<number, { label: string; className: string }> = {
  1: { label: 'Critical', className: 'bg-red-100 text-red-700' },
  2: { label: 'High', className: 'bg-orange-100 text-orange-700' },
  3: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700' },
  4: { label: 'Low', className: 'bg-blue-100 text-blue-700' },
};

function platformLabel(platform: ExternalAlertPlatform) {
  return PLATFORMS.find((p) => p.value === platform)?.label ?? platform;
}

function TokenRevealDialog({
  source,
  onClose,
}: {
  source: CreatedExternalAlertSource;
  onClose: () => void;
}) {
  const [show, setShow] = useState(false);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogContent>
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            Integration Created
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-6 pb-6">
          <p className="text-sm text-muted-foreground">
            Save the token now — it will <strong>not</strong> be shown again.
          </p>

          {/* Token */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Token
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
              <code className="flex-1 break-all font-mono text-sm text-foreground">
                {show ? source.token : source.token.replace(/./g, '•')}
              </code>
              <button
                onClick={() => setShow(!show)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={() => copy(source.token)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Webhook URL
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
              <code className="flex-1 break-all font-mono text-xs text-foreground">
                {source.webhook_url}
              </code>
              <button
                onClick={() => copy(source.webhook_url)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this URL directly into your monitoring platform&apos;s webhook configuration.
              The token is embedded in the URL — no separate auth header needed.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExternalAlertSourcesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platform, setPlatform] = useState<ExternalAlertPlatform>('groundcover');
  const [defaultSeverity, setDefaultSeverity] = useState(2);
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoResolve, setAutoResolve] = useState(true);
  const [serviceId, setServiceId] = useState('');

  const { data: servicesData } = useServices();
  const services = servicesData?.data ?? [];

  const [createdSource, setCreatedSource] = useState<CreatedExternalAlertSource | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);

  const { data, isLoading } = useExternalAlertSources();
  const createSource = useCreateExternalAlertSource();
  const deleteSource = useDeleteExternalAlertSource();
  const rotateToken = useRotateExternalAlertSourceToken();

  const sources = data?.data ?? [];

  function resetForm() {
    setName('');
    setDescription('');
    setPlatform('groundcover');
    setDefaultSeverity(2);
    setAutoCreate(true);
    setAutoResolve(true);
    setServiceId('');
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    try {
      const result = await createSource.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        platform,
        default_severity: defaultSeverity,
        auto_create_incident: autoCreate,
        auto_resolve: autoResolve,
        service_id: serviceId || null,
      });
      setCreatedSource(result.data);
      setShowCreate(false);
      resetForm();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create integration');
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteSource.mutateAsync(deleteId);
      toast.success('Integration deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete integration');
    }
  }

  async function handleRotate() {
    if (!rotateId) return;
    try {
      const result = await rotateToken.mutateAsync(rotateId);
      setCreatedSource(result.data);
      setRotateId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to rotate token');
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Webhook className="h-5 w-5" />
            External Alert Sources
          </h2>
          <p className="text-sm text-muted-foreground">
            Receive alerts from Groundcover, Alertmanager, Grafana, Datadog and other monitoring
            platforms. Firing alerts auto-create incidents; resolved alerts auto-close them.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Integration
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : sources.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <Webhook className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No integrations yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Platform</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Token</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Default Sev</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Last Used</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Webhook URL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sources.map((source) => {
                    const sev = SEVERITY_LABELS[source.default_severity];
                    return (
                      <tr key={source.id} className="transition-colors hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{source.name}</div>
                          {source.description && (
                            <div className="text-xs text-muted-foreground">{source.description}</div>
                          )}
                          <div className="mt-1 flex gap-1">
                            {source.auto_create_incident && (
                              <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">auto-create</span>
                            )}
                            {source.auto_resolve && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">auto-resolve</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="text-xs">
                            {platformLabel(source.platform)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                            {source.token_prefix}...
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          {sev && (
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${sev.className}`}>
                              {sev.label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {source.last_used_at ? (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(source.last_used_at).toLocaleDateString()}
                            </span>
                          ) : (
                            'Never'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => copy(source.webhook_url)}
                            className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                            title="Copy webhook URL"
                          >
                            <Link2 className="h-3 w-3" />
                            Copy URL
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              onClick={() => setRotateId(source.id)}
                              title="Rotate token"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                            <button
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeleteId(source.id)}
                              title="Delete integration"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onClose={() => { setShowCreate(false); resetForm(); }}>
        <DialogContent>
          <DialogClose onClose={() => { setShowCreate(false); resetForm(); }} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Add Alert Integration
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Name <span className="text-destructive">*</span></label>
              <Input
                placeholder="e.g., Groundcover Production"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Description</label>
              <Input
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Affected Service</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                <option value="">None</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Incidents created by this source will be linked to this service.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Platform <span className="text-destructive">*</span></label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as ExternalAlertPlatform)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Default Severity</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={defaultSeverity}
                onChange={(e) => setDefaultSeverity(Number(e.target.value))}
              >
                <option value={1}>1 — Critical</option>
                <option value={2}>2 — High</option>
                <option value={3}>3 — Medium</option>
                <option value={4}>4 — Low</option>
              </select>
              <p className="text-xs text-muted-foreground">Used when the platform doesn&apos;t send a severity field.</p>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={autoCreate}
                  onChange={(e) => setAutoCreate(e.target.checked)}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">Auto-create incidents</div>
                  <div className="text-xs text-muted-foreground">Firing alerts automatically open new incidents</div>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={autoResolve}
                  onChange={(e) => setAutoResolve(e.target.checked)}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">Auto-resolve incidents</div>
                  <div className="text-xs text-muted-foreground">Resolved alerts automatically close open incidents</div>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createSource.isPending}>
                {createSource.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Integration
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Token reveal after create/rotate */}
      {createdSource && (
        <TokenRevealDialog source={createdSource} onClose={() => setCreatedSource(null)} />
      )}

      {/* Rotate confirm */}
      <ConfirmDialog
        open={!!rotateId}
        onClose={() => setRotateId(null)}
        onConfirm={handleRotate}
        title="Rotate Token"
        description="The existing token will stop working immediately. You will need to update the webhook URL in your monitoring platform."
        confirmLabel="Rotate Token"
        variant="destructive"
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Integration"
        description="This will permanently delete the integration and invalidate its token. Monitoring platforms using this token will stop creating incidents."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
