'use client';

import { useState } from 'react';
import {
  Search, Server, Plus, Loader2, Pencil, Trash2, X, Tag,
  Activity, CheckCircle2, AlertTriangle, WrenchIcon, HelpCircle, FolderKanban,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useUpdateServiceStatus,
  type Service,
  type ServiceStatus,
  type ServiceType,
  type ServiceClassification,
} from '@/lib/hooks/useServices';
import { useProjects } from '@/lib/hooks/useProjects';
import { useEscalationPolicies } from '@/lib/hooks/useEscalationPolicies';
import { useOnCallSchedules } from '@/lib/hooks/useOnCallSchedules';
import { useUsers } from '@/lib/hooks/useUsers';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ServiceStatus, { label: string; color: string; icon: any }> = {
  operational:   { label: 'Operational',   color: 'text-success bg-success/10 border-success/20',        icon: CheckCircle2 },
  degraded:      { label: 'Degraded',      color: 'text-warning bg-warning/10 border-warning/20',       icon: AlertTriangle },
  partial_outage:{ label: 'Partial Outage',color: 'text-brand bg-brand/10 border-brand/20',             icon: AlertTriangle },
  major_outage:  { label: 'Major Outage',  color: 'text-error bg-error/10 border-error/20',             icon: Activity },
  maintenance:   { label: 'Maintenance',   color: 'text-info bg-info/10 border-info/20',                icon: WrenchIcon },
  unknown:       { label: 'Unknown',       color: 'text-muted-foreground bg-muted border-border',       icon: HelpCircle },
};

const SERVICE_TYPES: ServiceType[] = ['web', 'api', 'database', 'queue', 'cache', 'worker', 'storage', 'other'];

const SERVICE_CLASSIFICATIONS: ServiceClassification[] = ['app', 'platform', 'infrastructure', 'monitoring', 'system'];

const CLASSIFICATION_CONFIG: Record<ServiceClassification, { label: string; color: string }> = {
  app:            { label: 'Application',    color: 'text-blue-600 bg-blue-50 border-blue-200' },
  platform:       { label: 'Platform',       color: 'text-purple-600 bg-purple-50 border-purple-200' },
  infrastructure: { label: 'Infrastructure', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  monitoring:     { label: 'Monitoring',     color: 'text-green-600 bg-green-50 border-green-200' },
  system:         { label: 'System',         color: 'text-gray-600 bg-gray-50 border-gray-200' },
};
const SERVICE_STATUSES: ServiceStatus[] = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'];

function StatusBadge({ status }: { status: ServiceStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ─── Service dialog ────────────────────────────────────────────────────────────

interface ServiceFormData {
  name: string;
  description: string;
  type: ServiceType;
  project_id: string;
  escalation_policy_id: string;
  oncall_schedule_id: string;
  owner_id: string;
  enabled: boolean;
  tags: string;
}

function ServiceDialog({
  open,
  onClose,
  service,
}: {
  open: boolean;
  onClose: () => void;
  service?: Service | null;
}) {
  const isEdit = !!service;
  const createService = useCreateService();
  const updateService = useUpdateService();

  const { data: projectsData } = useProjects();
  const { data: epData } = useEscalationPolicies({ status: 'active' });
  const { data: schedules = [] } = useOnCallSchedules();
  const { data: users = [] } = useUsers();

  const projects = projectsData?.data ?? [];
  const policies = epData ?? [];

  const [form, setForm] = useState<ServiceFormData>({
    name:                  service?.name ?? '',
    description:           service?.description ?? '',
    type:                  service?.type ?? 'web',
    project_id:            service?.project_id ?? '',
    escalation_policy_id:  service?.escalation_policy_id ?? '',
    oncall_schedule_id:    service?.oncall_schedule_id ?? '',
    owner_id:              service?.owner_id ?? '',
    enabled:               service?.enabled ?? true,
    tags:                  service?.tags?.join(', ') ?? '',
  });

  const [lastService, setLastService] = useState(service);
  if (service !== lastService) {
    setLastService(service);
    setForm({
      name:                  service?.name ?? '',
      description:           service?.description ?? '',
      type:                  service?.type ?? 'web',
      project_id:            service?.project_id ?? '',
      escalation_policy_id:  service?.escalation_policy_id ?? '',
      oncall_schedule_id:    service?.oncall_schedule_id ?? '',
      owner_id:              service?.owner_id ?? '',
      enabled:               service?.enabled ?? true,
      tags:                  service?.tags?.join(', ') ?? '',
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.project_id) { toast.error('Project is required'); return; }
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const payload = {
      name: form.name,
      description: form.description,
      type: form.type,
      project_id: form.project_id,
      escalation_policy_id: form.escalation_policy_id || null,
      oncall_schedule_id: form.oncall_schedule_id || null,
      owner_id: form.owner_id || null,
      enabled: form.enabled,
      tags,
    };
    try {
      if (isEdit && service) {
        await updateService.mutateAsync({ id: service.id, input: payload });
        toast.success('Service updated');
      } else {
        await createService.mutateAsync(payload);
        toast.success('Service created');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save service');
    }
  }

  const isPending = createService.isPending || updateService.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {isEdit ? 'Edit Service' : 'Add Service'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input placeholder="e.g. Payment API" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <Input placeholder="Brief description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Project *</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={form.project_id}
              onChange={(e) => setForm((f) => ({ ...f, project_id: e.target.value }))}
              required
            >
              <option value="">Select a project...</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Type</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ServiceType }))}
              >
                {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Enabled</label>
              <div className="flex items-center gap-2 h-[38px]">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.enabled}
                  onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    form.enabled ? 'bg-success' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                      form.enabled ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </button>
                <span className="text-sm text-muted-foreground">{form.enabled ? 'Active' : 'Disabled'}</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Escalation Policy</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={form.escalation_policy_id}
              onChange={(e) => setForm((f) => ({ ...f, escalation_policy_id: e.target.value }))}
            >
              <option value="">None</option>
              {policies.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">On-Call Schedule</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={form.oncall_schedule_id}
                onChange={(e) => setForm((f) => ({ ...f, oncall_schedule_id: e.target.value }))}
              >
                <option value="">None</option>
                {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Owner</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={form.owner_id}
                onChange={(e) => setForm((f) => ({ ...f, owner_id: e.target.value }))}
              >
                <option value="">None</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Tags</label>
            <Input placeholder="payments, critical, external (comma-separated)" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Add Service'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Quick status dropdown ────────────────────────────────────────────────────

function QuickStatusMenu({ service }: { service: Service }) {
  const [open, setOpen] = useState(false);
  const updateStatus = useUpdateServiceStatus();

  async function change(status: ServiceStatus) {
    setOpen(false);
    if (status === service.current_status) return;
    try {
      await updateStatus.mutateAsync({ id: service.id, status });
      toast.success(`Status updated to ${STATUS_CONFIG[status].label}`);
    } catch {
      toast.error('Failed to update status');
    }
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
        title="Change status"
      >
        <StatusBadge status={service.current_status} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-md border border-border bg-popover shadow-lg py-1">
          {SERVICE_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => change(s)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors ${s === service.current_status ? 'font-semibold' : ''}`}
            >
              <StatusBadge status={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const [search, setSearch] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<string>('app');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editService, setEditService] = useState<Service | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: projectsData } = useProjects();
  const projects = projectsData?.data ?? [];

  // Build a quick lookup for project names
  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]));

  const { data, isLoading } = useServices({
    search:         search || undefined,
    classification: classificationFilter || undefined,
    status:         statusFilter || undefined,
    type:           typeFilter || undefined,
    project_id:     projectFilter || undefined,
  });
  const deleteService = useDeleteService();

  const services = data?.data ?? [];
  const total = data?.pagination.total ?? 0;

  const counts = {
    total:       total,
    operational: services.filter((s) => s.current_status === 'operational').length,
    degraded:    services.filter((s) => ['degraded', 'partial_outage', 'major_outage'].includes(s.current_status)).length,
    maintenance: services.filter((s) => s.current_status === 'maintenance').length,
  };

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteService.mutateAsync(deleteId);
      toast.success('Service deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete service');
    }
  }

  return (
    <div className="space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Service Catalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">Monitor and manage your service inventory</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Service
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Services',  value: counts.total,       color: 'text-foreground' },
          { label: 'Operational',     value: counts.operational, color: 'text-success' },
          { label: 'Degraded/Outage', value: counts.degraded,    color: 'text-error' },
          { label: 'Maintenance',     value: counts.maintenance, color: 'text-info' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{isLoading ? '...' : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          containerClassName="flex-1 sm:max-w-xs"
          placeholder="Search services..."
          value={search}
          onChange={setSearch}
        />
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={classificationFilter}
          onChange={(e) => setClassificationFilter(e.target.value)}
        >
          <option value="">All classifications</option>
          {SERVICE_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>{CLASSIFICATION_CONFIG[c].label}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {SERVICE_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {SERVICE_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        {(classificationFilter !== 'app' || statusFilter || typeFilter || projectFilter) && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => { setClassificationFilter('app'); setStatusFilter(''); setTypeFilter(''); setProjectFilter(''); }}
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : services.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No services found"
          description={search || classificationFilter || statusFilter || typeFilter || projectFilter ? 'No services match your filters.' : 'Add your first service to start tracking.'}
          actionLabel="Add Service"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <Card key={service.id} className={cn('transition-shadow hover:shadow-md', !service.enabled && 'opacity-50')}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <CardTitle className="text-base truncate">{service.name}</CardTitle>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setEditService(service)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteId(service.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {service.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{service.description}</p>
                )}

                <QuickStatusMenu service={service} />

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 capitalize">{service.type}</span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', CLASSIFICATION_CONFIG[service.classification ?? 'app']?.color)}>
                    {CLASSIFICATION_CONFIG[service.classification ?? 'app']?.label}
                  </span>
                  {service.auto_discovered && (
                    <span className="rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-[10px] text-muted-foreground/60">Auto-discovered</span>
                  )}
                  {service.project_id && projectNameMap.get(service.project_id) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5">
                      <FolderKanban className="h-3 w-3" />
                      {projectNameMap.get(service.project_id)}
                    </span>
                  )}
                </div>

                {service.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {service.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ServiceDialog
        open={showCreate || !!editService}
        onClose={() => { setShowCreate(false); setEditService(null); }}
        service={editService}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Service"
        description="Are you sure you want to delete this service? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
