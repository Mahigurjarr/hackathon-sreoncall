'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Plus,
  Pencil,
  Trash2,
  Play,
  FlaskConical,
  X,
  ChevronDown,
  ChevronUp,
  ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { useServices } from '@/lib/hooks/useServices';

// ─── Types (match packages/api validation-suite backend contract) ──────────────

type CheckType = 'http' | 'tcp' | 'custom_script';
type Trigger = 'manual' | 'on_resolution' | 'both';

interface ValidationCheck {
  name: string;
  type: CheckType;
  config: Record<string, string>;
}

interface ValidationSuite {
  id: string;
  name: string;
  description: string | null;
  service_ids: string[];
  checks: ValidationCheck[];
  trigger: Trigger;
  created_at: string;
  updated_at: string;
}

interface SuiteFormData {
  name: string;
  description: string;
  service_ids: string[];
  checks: ValidationCheck[];
  trigger: Trigger;
}

const EMPTY_FORM: SuiteFormData = {
  name: '',
  description: '',
  service_ids: [],
  checks: [],
  trigger: 'manual',
};

const CHECK_TYPES: { value: CheckType; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'tcp', label: 'TCP' },
  { value: 'custom_script', label: 'Custom Script' },
];

const TRIGGER_OPTIONS: { value: Trigger; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'on_resolution', label: 'On Resolution' },
  { value: 'both', label: 'Both' },
];

// Config fields per check type. `numeric` keys are sent to the API as numbers.
const CONFIG_FIELDS: Record<
  CheckType,
  { key: string; label: string; placeholder: string; numeric?: boolean }[]
> = {
  http: [
    { key: 'url', label: 'URL', placeholder: 'https://api.example.com/health' },
    { key: 'method', label: 'Method', placeholder: 'GET' },
    { key: 'expected_status', label: 'Expected Status', placeholder: '200', numeric: true },
    { key: 'expected_body_contains', label: 'Body Contains', placeholder: 'ok' },
    { key: 'timeout_ms', label: 'Timeout (ms)', placeholder: '5000', numeric: true },
  ],
  tcp: [
    { key: 'host', label: 'Host', placeholder: 'db.example.com' },
    { key: 'port', label: 'Port', placeholder: '5432', numeric: true },
    { key: 'timeout_ms', label: 'Timeout (ms)', placeholder: '3000', numeric: true },
  ],
  custom_script: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.example.com/run' },
    { key: 'timeout_ms', label: 'Timeout (ms)', placeholder: '30000', numeric: true },
  ],
};

const NUMERIC_CONFIG_KEYS = new Set(['expected_status', 'port', 'timeout_ms']);

function triggerVariant(trigger: string) {
  switch (trigger) {
    case 'both':
      return 'destructive' as const;
    case 'on_resolution':
      return 'info' as const;
    default:
      return 'secondary' as const;
  }
}

/** Convert a form check's string config into the typed payload the API expects. */
function toApiConfig(config: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value == null || value.trim() === '') continue;
    out[key] = NUMERIC_CONFIG_KEYS.has(key) ? Number(value) : value.trim();
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ValidationSuitesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SuiteFormData>(EMPTY_FORM);
  const [expandedCheck, setExpandedCheck] = useState<number | null>(null);

  const { data: suites = [], isLoading } = useQuery<ValidationSuite[]>({
    queryKey: ['validation-suites'],
    queryFn: async () => {
      const res = await api.get<{ data: Array<Record<string, any>> }>(
        '/api/v1/validation-suites',
      );
      // Backend returns Mongo docs with `_id`; normalise to `id` for the UI.
      return (res.data ?? []).map((s) => ({
        id: s.id ?? s._id?.toString?.() ?? s._id,
        name: s.name,
        description: s.description ?? null,
        service_ids: (s.service_ids ?? []).map((sid: any) => sid?.toString?.() ?? sid),
        checks: (s.checks ?? []).map((c: any) => ({
          name: c.name ?? '',
          type: c.type as CheckType,
          config: Object.fromEntries(
            Object.entries(c.config ?? {})
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)]),
          ),
        })),
        trigger: (s.trigger ?? 'manual') as Trigger,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
    },
  });

  const { data: servicesRes } = useServices();
  const services = servicesRes?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
      if (editingId) {
        return api.patch(`/api/v1/validation-suites/${editingId}`, payload);
      }
      return api.post('/api/v1/validation-suites', payload);
    },
    onSuccess: () => {
      toast.success(editingId ? 'Suite updated' : 'Suite created');
      queryClient.invalidateQueries({ queryKey: ['validation-suites'] });
      closeDialog();
    },
    onError: () => {
      toast.error('Failed to save validation suite');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/validation-suites/${id}`),
    onSuccess: () => {
      toast.success('Suite deleted');
      queryClient.invalidateQueries({ queryKey: ['validation-suites'] });
    },
    onError: () => {
      toast.error('Failed to delete suite');
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/v1/validation-suites/${id}/run`, {}),
    onSuccess: () => {
      toast.success('Validation suite run started');
    },
    onError: () => {
      toast.error('Failed to run validation suite');
    },
  });

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setExpandedCheck(null);
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(suite: ValidationSuite) {
    setEditingId(suite.id);
    setForm({
      name: suite.name,
      description: suite.description ?? '',
      service_ids: [...suite.service_ids],
      checks: suite.checks.map((c) => ({ ...c, config: { ...c.config } })),
      trigger: suite.trigger,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('Suite name is required');
      return;
    }
    if (form.checks.some((c) => !c.name.trim())) {
      toast.error('Every check needs a name');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      service_ids: form.service_ids,
      trigger: form.trigger,
      checks: form.checks.map((c, i) => ({
        name: c.name.trim(),
        type: c.type,
        config: toApiConfig(c.config),
        order: i,
      })),
    };
    saveMutation.mutate(payload);
  }

  function addCheck() {
    setForm((f) => ({
      ...f,
      checks: [...f.checks, { name: '', type: 'http', config: {} }],
    }));
    setExpandedCheck(form.checks.length);
  }

  function removeCheck(index: number) {
    setForm((f) => ({
      ...f,
      checks: f.checks.filter((_, i) => i !== index),
    }));
    setExpandedCheck(null);
  }

  function updateCheck(index: number, updates: Partial<ValidationCheck>) {
    setForm((f) => ({
      ...f,
      checks: f.checks.map((c, i) =>
        i === index ? { ...c, ...updates } : c,
      ),
    }));
  }

  function updateCheckConfig(index: number, key: string, value: string) {
    setForm((f) => ({
      ...f,
      checks: f.checks.map((c, i) =>
        i === index ? { ...c, config: { ...c.config, [key]: value } } : c,
      ),
    }));
  }

  function toggleService(serviceId: string) {
    setForm((f) => ({
      ...f,
      service_ids: f.service_ids.includes(serviceId)
        ? f.service_ids.filter((id) => id !== serviceId)
        : [...f.service_ids, serviceId],
    }));
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Validation Suites
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage end-to-end validation test suites for your services
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create Suite
        </Button>
      </div>

      {/* Suites List */}
      {suites.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center text-center">
              <ListChecks className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">
                No validation suites yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create test suites to validate your services during incidents or deployments
              </p>
              <Button className="mt-4" size="sm" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create First Suite
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {suites.map((suite) => (
            <Card key={suite.id}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground truncate">
                        {suite.name}
                      </h3>
                      <Badge variant={triggerVariant(suite.trigger)}>
                        {suite.trigger.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {suite.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {suite.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {suite.service_ids.length} service{suite.service_ids.length !== 1 ? 's' : ''}
                      </span>
                      <span>
                        {suite.checks.length} check{suite.checks.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={runMutation.isPending}
                      onClick={() => runMutation.mutate(suite.id)}
                    >
                      {runMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Run
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(suite)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm('Delete this validation suite?')) {
                          deleteMutation.mutate(suite.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog}>
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Validation Suite' : 'Create Validation Suite'}
            </DialogTitle>
            <DialogClose onClose={closeDialog} />
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto space-y-5 px-6 py-5">
            {/* Name */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input
                placeholder="e.g. Post-Deploy Health Check"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                className="flex min-h-[70px] w-full rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated px-4 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/12 transition-[border-color,box-shadow] duration-150"
                placeholder="Describe what this suite validates..."
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>

            {/* Trigger */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Trigger
              </label>
              <Select
                value={form.trigger}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    trigger: e.target.value as Trigger,
                  }))
                }
              >
                {TRIGGER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Service Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Services
              </label>
              <div className="max-h-[140px] overflow-y-auto rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated p-2 space-y-1">
                {services.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground text-center">
                    No services available
                  </p>
                ) : (
                  services.map((svc) => (
                    <label
                      key={svc.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={form.service_ids.includes(svc.id)}
                        onChange={() => toggleService(svc.id)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-foreground">{svc.name}</span>
                      <Badge variant="secondary" className="ml-auto text-[9px]">
                        {svc.type}
                      </Badge>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {form.service_ids.length} service{form.service_ids.length !== 1 ? 's' : ''} selected
              </p>
            </div>

            {/* Checks */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  Checks
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCheck}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Check
                </Button>
              </div>

              {form.checks.length === 0 ? (
                <p className="rounded-[8px] border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  No checks added yet. Click &quot;Add Check&quot; to define validation steps.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.checks.map((check, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-background"
                    >
                      {/* Check header */}
                      <div
                        className="flex cursor-pointer items-center justify-between px-3 py-2.5"
                        onClick={() =>
                          setExpandedCheck(expandedCheck === i ? null : i)
                        }
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="info" className="text-[9px]">
                            {check.type.toUpperCase()}
                          </Badge>
                          <span className="text-sm text-foreground">
                            {check.name || `Check ${i + 1}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCheck(i);
                            }}
                            className="p-1 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                          {expandedCheck === i ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      {/* Check details (expanded) */}
                      {expandedCheck === i && (
                        <div className="space-y-3 border-t border-border px-3 py-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">
                                Name
                              </label>
                              <Input
                                placeholder="Check name"
                                value={check.name}
                                onChange={(e) =>
                                  updateCheck(i, { name: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">
                                Type
                              </label>
                              <Select
                                value={check.type}
                                onChange={(e) =>
                                  updateCheck(i, {
                                    type: e.target.value as CheckType,
                                    config: {},
                                  })
                                }
                              >
                                {CHECK_TYPES.map((ct) => (
                                  <option key={ct.value} value={ct.value}>
                                    {ct.label}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          </div>

                          {/* Dynamic config fields */}
                          {CONFIG_FIELDS[check.type]?.map((field) => (
                            <div key={field.key} className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">
                                {field.label}
                              </label>
                              <Input
                                type={field.numeric ? 'number' : 'text'}
                                placeholder={field.placeholder}
                                value={check.config[field.key] ?? ''}
                                onChange={(e) =>
                                  updateCheckConfig(i, field.key, e.target.value)
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {editingId ? 'Update Suite' : 'Create Suite'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
