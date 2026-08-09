'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Network, Upload, Radar, ArrowRight, Check, X, Loader2, Plus,
  GitBranch, Zap, Database, Radio, HardDrive, Globe, MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { TopologyMap } from '@/components/command-center/TopologyMap';
import {
  useServiceTopology,
  useServiceDependencies,
  useApproveDependency,
  useRejectDependency,
  useDeleteDependency,
  useCreateDependency,
  useBulkApproveDependencies,
  type ServiceDependency,
  type DependencyType,
} from '@/lib/hooks/useServiceDependencies';
import { useServices } from '@/lib/hooks/useServices';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPENDENCY_TYPE_CONFIG: Record<DependencyType, { label: string; icon: typeof GitBranch }> = {
  http:     { label: 'HTTP',     icon: Zap },
  grpc:     { label: 'gRPC',     icon: Radio },
  tcp:      { label: 'TCP',      icon: GitBranch },
  database: { label: 'Database', icon: Database },
  queue:    { label: 'Queue',    icon: Radio },
  cache:    { label: 'Cache',    icon: HardDrive },
  dns:      { label: 'DNS',      icon: Globe },
  file:     { label: 'File',     icon: MoreHorizontal },
  custom:   { label: 'Custom',   icon: MoreHorizontal },
};

const DISCOVERY_BADGE: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'ai' }> = {
  manual:          { label: 'Manual',      variant: 'info' },
  auto_otel:       { label: 'OTel Auto',   variant: 'ai' },
  auto_network:    { label: 'Network',     variant: 'success' },
  document_upload: { label: 'Doc Upload',  variant: 'warning' },
  ai_parsed:       { label: 'AI Parsed',   variant: 'ai' },
};

// ─── Proposed Dependency Row ──────────────────────────────────────────────────

function ProposedDependencyRow({ dep, cycleConflict }: { dep: ServiceDependency; cycleConflict?: boolean }) {
  const approveMutation = useApproveDependency();
  const rejectMutation = useRejectDependency();
  const isPending = approveMutation.isPending || rejectMutation.isPending;

  const typeConfig = DEPENDENCY_TYPE_CONFIG[dep.dependency_type] ?? DEPENDENCY_TYPE_CONFIG.custom;
  const TypeIcon = typeConfig.icon;
  const discoveryConfig = DISCOVERY_BADGE[dep.discovery_method] ?? DISCOVERY_BADGE.manual;

  async function handleApprove() {
    try {
      await approveMutation.mutateAsync(dep.id);
      toast.success(`Approved: ${dep.source_service_name} → ${dep.target_service_name}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to approve dependency');
    }
  }

  async function handleReject() {
    try {
      await rejectMutation.mutateAsync(dep.id);
      toast.success(`Rejected: ${dep.source_service_name} → ${dep.target_service_name}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to reject dependency');
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card dark:bg-navy-surface px-4 py-3 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Source → Target */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{dep.source_service_name || 'Unknown'}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate">{dep.target_service_name || 'Unknown'}</span>
        </div>

        {/* Type badge */}
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground shrink-0">
          <TypeIcon className="h-3 w-3" />
          {typeConfig.label}
        </span>

        {/* Discovery method badge */}
        <Badge variant={discoveryConfig.variant} className="shrink-0">
          {discoveryConfig.label}
        </Badge>

        {/* Cycle-conflict warning from the last bulk-approve attempt */}
        {cycleConflict && (
          <Badge variant="warning" className="shrink-0">
            Would create a cycle with existing topology
          </Badge>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleApprove}
          disabled={isPending}
          className="text-success hover:bg-success/10 hover:text-success"
        >
          {approveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          <span className="ml-1.5">Approve</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReject}
          disabled={isPending}
          className="text-error hover:bg-error/10 hover:text-error"
        >
          {rejectMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
          <span className="ml-1.5">Reject</span>
        </Button>
      </div>
    </div>
  );
}

// ─── Approved Dependency Row ──────────────────────────────────────────────────

function ApprovedDependencyRow({ dep }: { dep: ServiceDependency }) {
  const deleteMutation = useDeleteDependency();

  const typeConfig = DEPENDENCY_TYPE_CONFIG[dep.dependency_type] ?? DEPENDENCY_TYPE_CONFIG.custom;
  const TypeIcon = typeConfig.icon;

  async function handleDelete() {
    if (!confirm(`Remove dependency: ${dep.source_service_name} → ${dep.target_service_name}?`)) return;
    try {
      await deleteMutation.mutateAsync(dep.id);
      toast.success(`Removed: ${dep.source_service_name} → ${dep.target_service_name}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to remove dependency');
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card dark:bg-navy-surface px-4 py-3 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{dep.source_service_name || 'Unknown'}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate">{dep.target_service_name || 'Unknown'}</span>
        </div>

        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground shrink-0">
          <TypeIcon className="h-3 w-3" />
          {typeConfig.label}
        </span>

        <Badge
          variant={dep.criticality === 'critical' ? 'destructive' : dep.criticality === 'high' ? 'warning' : 'info'}
          className="shrink-0"
        >
          {dep.criticality}
        </Badge>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="text-error hover:bg-error/10 hover:text-error"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
          <span className="ml-1.5">Remove</span>
        </Button>
      </div>
    </div>
  );
}

// ─── Dependency Type & Criticality options ──────────────────────────────────

const DEP_TYPE_OPTIONS: { value: DependencyType; label: string }[] = [
  { value: 'http',     label: 'HTTP' },
  { value: 'grpc',     label: 'gRPC' },
  { value: 'tcp',      label: 'TCP' },
  { value: 'database', label: 'Database' },
  { value: 'queue',    label: 'Queue' },
  { value: 'cache',    label: 'Cache' },
  { value: 'dns',      label: 'DNS' },
  { value: 'file',     label: 'File' },
  { value: 'custom',   label: 'Custom' },
];

const CRITICALITY_OPTIONS = ['critical', 'high', 'medium', 'low'] as const;

// ─── Add Dependency Dialog ──────────────────────────────────────────────────

interface AddDependencyDialogProps {
  open: boolean;
  onClose: () => void;
}

function AddDependencyDialog({ open, onClose }: AddDependencyDialogProps) {
  const { data: servicesRes } = useServices();
  const createMutation = useCreateDependency();

  const services = servicesRes?.data ?? [];

  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [type, setType] = useState<DependencyType>('http');
  const [criticality, setCriticality] = useState<string>('medium');
  const [port, setPort] = useState('');
  const [path, setPath] = useState('');
  const [notes, setNotes] = useState('');

  const resetForm = useCallback(() => {
    setSourceId('');
    setTargetId('');
    setType('http');
    setCriticality('medium');
    setPort('');
    setPath('');
    setNotes('');
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const isValid = sourceId && targetId && sourceId !== targetId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    try {
      await createMutation.mutateAsync({
        source_service_id: sourceId,
        target_service_id: targetId,
        dependency_type: type,
        criticality,
        protocol_details: {
          ...(port ? { port: Number(port) } : {}),
          ...(path ? { path } : {}),
        },
        ...(notes ? { notes } : {}),
      });
      toast.success('Dependency added successfully');
      handleClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to add dependency');
    }
  }

  // Filter target options to exclude the selected source
  const targetServices = services.filter((s) => s.id !== sourceId);

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Dependency</DialogTitle>
          <DialogClose onClose={handleClose} />
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Source Service */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Source Service <span className="text-error">*</span>
            </label>
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
              <option value="">Select source service...</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>

          {/* Target Service */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Target Service <span className="text-error">*</span>
            </label>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">Select target service...</option>
              {targetServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            {sourceId && targetId && sourceId === targetId && (
              <p className="text-xs text-error">Source and target must be different services.</p>
            )}
          </div>

          {/* Type + Criticality row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Dependency Type</label>
              <Select value={type} onChange={(e) => setType(e.target.value as DependencyType)}>
                {DEP_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Criticality</label>
              <Select value={criticality} onChange={(e) => setCriticality(e.target.value)}>
                {CRITICALITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Port + Path row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Port</label>
              <Input
                type="number"
                placeholder="e.g. 8080"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                min={1}
                max={65535}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Path</label>
              <Input
                type="text"
                placeholder="/api/v1/..."
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Notes</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-[8px] border-[1.5px] border-border bg-card dark:bg-navy-elevated px-4 py-2 text-[13px] text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/12 disabled:cursor-not-allowed disabled:opacity-50 transition-[border-color,box-shadow] duration-150 resize-none"
              placeholder="Optional notes about this dependency..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add Dependency
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ServiceTopologyPage() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [cycleConflictIds, setCycleConflictIds] = useState<Set<string>>(new Set());
  const { data: topology, isLoading: topoLoading } = useServiceTopology();
  const { data: proposed, isLoading: proposedLoading } = useServiceDependencies({ status: 'proposed' });
  const { data: approved, isLoading: approvedLoading } = useServiceDependencies({ status: 'approved' });
  const bulkApproveMutation = useBulkApproveDependencies();

  // Convert topology map data to TopologyMap component format
  const topoNodes = (topology?.nodes ?? []).map((n) => ({
    service_id: n.id,
    name: n.name,
    type: n.type,
    status: (n.current_status === 'operational' ? 'healthy' : n.current_status === 'degraded' ? 'degraded' : n.current_status === 'down' ? 'down' : 'unknown') as 'healthy' | 'degraded' | 'down' | 'unknown',
    is_root_cause: false,
    is_affected: false,
    health: {
      error_rate_percent: null,
      latency_p99_ms: null,
      cpu_percent: null,
      memory_percent: null,
    },
    owner_team: null,
    oncall_user: null,
  }));

  const topoEdges = (topology?.edges ?? []).map((e) => ({
    source_service_id: e.source_service_id,
    target_service_id: e.target_service_id,
    dependency_type: e.dependency_type,
    criticality: e.criticality ?? 'medium',
    traffic: {
      requests_per_minute: e.traffic_metadata?.avg_requests_per_minute ?? null,
      error_rate_percent: e.traffic_metadata?.error_rate_percent ?? null,
      latency_ms: e.traffic_metadata?.avg_latency_ms ?? null,
    },
  }));

  const proposedDeps = proposed ?? [];
  const approvedDeps = approved ?? [];

  async function handleApproveAll() {
    setCycleConflictIds(new Set());
    try {
      const result = await bulkApproveMutation.mutateAsync({ ids: proposedDeps.map((d) => d.id) });
      if (result.skipped_cycle.length > 0) {
        setCycleConflictIds(new Set(result.skipped_cycle));
        toast.warning(
          `${result.modified} approved, ${result.skipped_cycle.length} skipped (would create a cycle)`,
        );
      } else {
        toast.success(`Approved ${result.modified} dependencies`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to bulk-approve dependencies');
    }
  }

  return (
    <div className="space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Service Topology</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visualize, approve, and manage service dependencies
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/services/topology/upload">
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Upload Diagram
            </Button>
          </Link>
          <Link href="/services/topology/discovery">
            <Button variant="outline">
              <Radar className="mr-2 h-4 w-4" />
              Trigger Discovery
            </Button>
          </Link>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Dependency
          </Button>
        </div>
      </div>

      {/* Topology Map */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5 text-muted-foreground" />
            Approved Topology
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topoLoading ? (
            <div className="flex h-[500px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : topoNodes.length === 0 ? (
            <div className="flex h-[500px] items-center justify-center">
              <EmptyState
                icon={Network}
                title="No topology data"
                description="Upload an architecture diagram or trigger auto-discovery to build your service topology."
              />
            </div>
          ) : (
            <div className="h-[500px] w-full rounded-lg border border-border overflow-hidden">
              <TopologyMap
                nodes={topoNodes}
                edges={topoEdges}
                hoverDepth="full"
                interactive={true}
                showMascot={false}
                mascotMode="hidden"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approved Dependencies */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5 text-muted-foreground" />
            Approved Dependencies
            {approvedDeps.length > 0 && (
              <Badge variant="info" className="ml-2">{approvedDeps.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {approvedLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : approvedDeps.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No approved dependencies"
              description="Approve proposed dependencies or add one manually to see it here."
            />
          ) : (
            <div className="space-y-2">
              {approvedDeps.map((dep) => (
                <ApprovedDependencyRow key={dep.id} dep={dep} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Proposed Dependencies */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              Proposed Dependencies
              {proposedDeps.length > 0 && (
                <Badge variant="warning" className="ml-2">{proposedDeps.length}</Badge>
              )}
            </CardTitle>
            {proposedDeps.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleApproveAll}
                disabled={bulkApproveMutation.isPending}
              >
                {bulkApproveMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                Approve All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {proposedLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : proposedDeps.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="No pending dependencies"
              description="All discovered dependencies have been reviewed. New edges will appear here when discovered."
            />
          ) : (
            <div className="space-y-2">
              {proposedDeps.map((dep) => (
                <ProposedDependencyRow key={dep.id} dep={dep} cycleConflict={cycleConflictIds.has(dep.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dependency Dialog */}
      <AddDependencyDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} />
    </div>
  );
}
