'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Settings,
  Copy,
  Trash2,
  Plus,
  X,
  Clock,
  Variable,
  GripVertical,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import {
  useDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useCloneDashboard,
  type DashboardPanel,
  type DashboardVariable,
} from '@/lib/hooks/useDashboards';
import PanelRenderer from '@/components/dashboards/PanelRenderer';
import DashboardVariablesBar, { type VariableSelections } from '@/components/dashboards/DashboardVariablesBar';
import ManageVariablesDialog from '@/components/dashboards/ManageVariablesDialog';
import ResourceScopePicker from '@/components/dashboards/ResourceScopePicker';
import { QueryEditor } from '@/components/shared/DynamicQueryEditor';
import { useResourceScopeStore } from '@/lib/stores/resource-scope';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Sortable panel card ──────────────────────────────────────────────
function SortablePanelCard({
  panel,
  timeRange,
  refreshIntervalSeconds,
  variables,
  scope,
  onRemove,
  onExpand,
  isExpanded,
  staggerIndex,
}: {
  panel: DashboardPanel;
  timeRange: { from: string; to: string };
  refreshIntervalSeconds: number;
  variables: Record<string, string[]>;
  scope: Record<string, string | undefined>;
  onRemove: (id: string) => void;
  onExpand: (panel: DashboardPanel | null) => void;
  isExpanded: boolean;
  staggerIndex: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: panel.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    gridColumn: `span ${Math.min(panel.grid.w, 12)}`,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground/50 hover:text-muted-foreground focus:outline-none"
                title="Drag to reorder"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <CardTitle className="text-sm truncate">{panel.title}</CardTitle>
            </div>
            <div className="flex items-center gap-1 ml-2 shrink-0">
              <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-medium">
                {PANEL_TYPE_ICONS[panel.type] || panel.type}
              </span>
              <button
                onClick={() => onExpand(isExpanded ? null : panel)}
                className={cn('rounded p-0.5 hover:text-foreground', isExpanded ? 'text-primary' : 'text-muted-foreground')}
                title={isExpanded ? 'Collapse panel' : 'Expand panel'}
              >
                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </button>
              <button
                onClick={() => onRemove(panel.id)}
                className="rounded p-0.5 text-muted-foreground hover:text-red-400"
                title="Remove panel"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PanelRenderer
            panel={panel}
            timeRange={timeRange}
            refreshIntervalSeconds={refreshIntervalSeconds}
            variables={variables}
            scope={scope}
            staggerIndex={staggerIndex}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const PANEL_TYPE_ICONS: Record<string, string> = {
  line_chart: 'Line Chart',
  bar_chart: 'Bar Chart',
  gauge: 'Gauge',
  stat: 'Stat',
  table: 'Table',
  heatmap: 'Heatmap',
  log_viewer: 'Log Viewer',
  trace_waterfall: 'Trace Waterfall',
};

const TIME_RANGE_OPTIONS = [
  { label: '1M',  from: 'now-1m',  to: 'now' },
  { label: '5M',  from: 'now-5m',  to: 'now' },
  { label: '12H', from: 'now-12h', to: 'now' },
  { label: '24H', from: 'now-24h', to: 'now' },
  { label: '7D',  from: 'now-7d',  to: 'now' },
];

function formatDisplayDate(secOrRelative: string): string {
  const now = Date.now();
  let ms: number;
  if (secOrRelative === 'now') {
    ms = now;
  } else {
    const asNum = Number(secOrRelative);
    if (!isNaN(asNum) && asNum > 1_000_000_000) {
      ms = asNum * 1000;
    } else {
      const m = secOrRelative.match(/^now-(\d+)([smhd])$/);
      if (m) {
        const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        ms = now - parseInt(m[1], 10) * (mult[m[2]] ?? 1);
      } else {
        ms = now;
      }
    }
  }
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDatetimeLocal(secOrRelative: string): string {
  const now = Math.floor(Date.now() / 1000);
  let sec: number;
  if (secOrRelative === 'now') {
    sec = now;
  } else {
    const asNum = Number(secOrRelative);
    if (!isNaN(asNum) && asNum > 1_000_000_000) {
      sec = asNum;
    } else {
      const m = secOrRelative.match(/^now-(\d+)([smhd])$/);
      const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      sec = m ? now - parseInt(m[1], 10) * (multipliers[m[2]] || 1) : now;
    }
  }
  const d = new Date(sec * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DashboardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const { data: dashboard, isLoading, error } = useDashboard(id);
  const updateDashboard = useUpdateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const cloneDashboard = useCloneDashboard();

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showManageVariables, setShowManageVariables] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<DashboardPanel | null>(null);
  const [panelTitle, setPanelTitle] = useState('');
  const [panelType, setPanelType] = useState<string>('stat');
  const [panelQuery, setPanelQuery] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !dashboard) return;
    const oldIdx = dashboard.panels.findIndex((p) => p.id === active.id);
    const newIdx = dashboard.panels.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(dashboard.panels, oldIdx, newIdx);
    updateDashboard.mutate({ id, input: { panels: reordered } });
  }

  // Time range state — seeded from dashboard.default_time_range on first load
  const [timeRange, setTimeRange] = useState<{ from: string; to: string }>({
    from: 'now-24h',
    to: 'now',
  });
  const timeRangeSeeded = useRef(false);
  useEffect(() => {
    if (dashboard && !timeRangeSeeded.current) {
      timeRangeSeeded.current = true;
      const from = dashboard.default_time_range || 'now-24h';
      setTimeRange({ from, to: 'now' });
    }
  }, [dashboard]);

  // Custom time range picker state
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // isCustomActive: true only when an absolute Unix timestamp has been applied (not while picker is just open)
  const isCustomActive = !timeRange.from.startsWith('now') && !isNaN(Number(timeRange.from)) && Number(timeRange.from) > 1_000_000_000;

  function openCustomPicker() {
    setCustomFrom(toDatetimeLocal(timeRange.from));
    setCustomTo(toDatetimeLocal(timeRange.to));
    setShowCustomPicker(true);
  }

  function applyCustomRange() {
    if (!customFrom || !customTo) return;
    const fromSec = Math.floor(new Date(customFrom).getTime() / 1000).toString();
    const toSec = Math.floor(new Date(customTo).getTime() / 1000).toString();
    setTimeRange({ from: fromSec, to: toSec });
    setShowCustomPicker(false);
  }

  const effectiveTimeRange = timeRange;

  const refreshInterval = dashboard?.refresh_interval_seconds || 30;

  // Dashboard variable selections — seeded from URL search params when present,
  // falling back to each variable's `default`. URL is the source of truth so
  // copy-pasted links reproduce the same scope.
  const variables: DashboardVariable[] = dashboard?.variables ?? [];
  const variableSelections: VariableSelections = useMemo(() => {
    const out: VariableSelections = {};
    for (const v of variables) {
      const urlVal = searchParams.get(`var-${v.name}`);
      if (urlVal !== null) {
        out[v.name] = urlVal === '' ? [] : urlVal.split('|');
      } else {
        out[v.name] = v.default ?? [];
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variables, searchParams]);

  function handleVariableChange(next: VariableSelections) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const v of variables) {
      const values = next[v.name] ?? [];
      sp.set(`var-${v.name}`, values.join('|'));
    }
    router.replace(`?${sp.toString()}`, { scroll: false });
  }

  // Platform-wide resource scope (cluster/namespace/region/service) applied to
  // every panel query as label matchers post-substitution.
  const scope = useResourceScopeStore((s) => s.scope);

  // Reduce variable selections to single-string values for the substitution
  // lib's VariableValues type (already string[], just pass through).
  const substitutionVars = variableSelections;

  function handleAddPanel(e: React.FormEvent) {
    e.preventDefault();
    if (!dashboard) return;

    const newPanel: DashboardPanel = {
      id: `panel-${Date.now()}`,
      title: panelTitle,
      type: panelType as DashboardPanel['type'],
      grid: { x: 0, y: (dashboard.panels.length) * 4, w: 6, h: 4 },
      data_source: { type: 'managed', provider: null, service_id: null },
      query: panelQuery,
      options: {},
      thresholds: [],
    };

    updateDashboard.mutate(
      { id, input: { panels: [...dashboard.panels, newPanel] } },
      {
        onSuccess: () => {
          toast.success('Panel added');
          setShowAddPanel(false);
          setPanelTitle('');
          setPanelQuery('');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleRemovePanel(panelId: string) {
    if (!dashboard) return;
    const updated = dashboard.panels.filter((p) => p.id !== panelId);
    updateDashboard.mutate(
      { id, input: { panels: updated } },
      { onSuccess: () => toast.success('Panel removed') },
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-destructive">{error?.message || 'Dashboard not found'}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/dashboards')}>
          Back to Dashboards
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <button
        onClick={() => router.push('/dashboards')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Dashboards
      </button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{dashboard.name}</h1>
          {dashboard.description && (
            <p className="text-sm text-muted-foreground mt-1">{dashboard.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
            <span>{dashboard.panels.length} panels</span>
            <span>Auto-refresh: {refreshInterval}s</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowManageVariables(true)}
          >
            <Variable className="h-3.5 w-3.5 mr-1.5" />
            Variables
            {variables.length > 0 && (
              <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                {variables.length}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddPanel(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Panel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              cloneDashboard.mutate(id, {
                onSuccess: (d) => {
                  toast.success('Dashboard cloned');
                  router.push(`/dashboards/${d.id}`);
                },
              })
            }
          >
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Clone
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm('Delete this dashboard?')) {
                deleteDashboard.mutate(id, {
                  onSuccess: () => {
                    toast.success('Deleted');
                    router.push('/dashboards');
                  },
                });
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Resource scope picker + per-dashboard variables + time range — all in one row */}
      {(() => {
        const showScope = !(dashboard.hide_scope || dashboard.source_template_id === 'k8s-full-observability');
        return (
          <div className="flex flex-col gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2">
            {showScope && <ResourceScopePicker />}
            {showScope && variables.length > 0 && <div className="h-px bg-border/40" />}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {variables.length > 0 && (
                <DashboardVariablesBar
                  variables={variables}
                  selections={variableSelections}
                  onChange={handleVariableChange}
                />
              )}
              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex items-center rounded-md border border-input overflow-hidden">
                  {TIME_RANGE_OPTIONS.map((opt) => {
                    const active = timeRange.from === opt.from && timeRange.to === opt.to && !isCustomActive;
                    return (
                      <button
                        key={opt.label}
                        onClick={() => { setTimeRange({ from: opt.from, to: opt.to }); setShowCustomPicker(false); }}
                        className={cn(
                          'px-2.5 py-1 text-[11px] font-medium border-r border-input last:border-r-0 transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={openCustomPicker}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-medium transition-colors',
                      isCustomActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {isCustomActive
                      ? `${formatDisplayDate(timeRange.from)} → ${formatDisplayDate(timeRange.to)}`
                      : 'Custom'}
                  </button>
                </div>
                {!isCustomActive && (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDisplayDate(timeRange.from)} → {formatDisplayDate(timeRange.to)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Custom date range picker — inline below the filter bar */}
      {showCustomPicker && (
        <div className="flex items-center gap-3 rounded-md border border-input bg-muted/30 px-3 py-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">From</span>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">To</span>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground"
              />
            </div>
            <Button size="sm" onClick={applyCustomRange} disabled={!customFrom || !customTo}>
              Apply
            </Button>
            <button
              onClick={() => setShowCustomPicker(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Panels grid */}
      {dashboard.panels.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Settings className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No panels yet</h3>
            <p className="text-[12px] text-muted-foreground mb-4">
              Add panels to visualize your metrics, logs, and traces.
            </p>
            <Button size="sm" onClick={() => setShowAddPanel(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add First Panel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={dashboard.panels.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-12 gap-4">
              {dashboard.panels.map((panel, idx) => (
                <SortablePanelCard
                  key={panel.id}
                  panel={panel}
                  timeRange={effectiveTimeRange}
                  refreshIntervalSeconds={refreshInterval}
                  variables={substitutionVars}
                  scope={scope as Record<string, string | undefined>}
                  onRemove={handleRemovePanel}
                  onExpand={setExpandedPanel}
                  isExpanded={expandedPanel?.id === panel.id}
                  staggerIndex={idx}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Manage Variables Dialog */}
      <ManageVariablesDialog
        open={showManageVariables}
        onClose={() => setShowManageVariables(false)}
        variables={variables}
        onSave={(next) => {
          updateDashboard.mutate(
            { id, input: { variables: next } },
            {
              onSuccess: () => {
                toast.success('Variables updated');
                setShowManageVariables(false);
              },
              onError: (err) => toast.error(err.message),
            },
          );
        }}
        saving={updateDashboard.isPending}
      />

      {/* Add Panel Dialog */}
      <Dialog open={showAddPanel} onClose={() => setShowAddPanel(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Panel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddPanel} className="space-y-4 px-6 pb-6">
            <div>
              <label className="text-sm font-medium text-foreground">Title</label>
              <input
                value={panelTitle}
                onChange={(e) => setPanelTitle(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                placeholder="e.g. Request Rate"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Type</label>
              <select
                value={panelType}
                onChange={(e) => setPanelType(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                {Object.entries(PANEL_TYPE_ICONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Query (PromQL / LogQL)</label>
              <div className="mt-1">
              <QueryEditor
                value={panelQuery}
                onChange={setPanelQuery}
                language={panelType === 'log_viewer' ? 'logql' : 'promql'}
                height="72px"
                placeholder={panelType === 'log_viewer' ? '{service_name="api"} |= "error"' : 'rate(http_requests_total[5m])'}
              />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddPanel(false)}>Cancel</Button>
              <Button type="submit" disabled={updateDashboard.isPending || !panelTitle}>
                {updateDashboard.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Add Panel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Expanded panel — full-screen view */}
      {expandedPanel && (
        <Dialog
          open={!!expandedPanel}
          onClose={() => setExpandedPanel(null)}
          wrapperClassName="max-w-[92vw] max-h-[92vh]"
        >
          <DialogContent className="flex flex-col overflow-hidden" style={{ height: '88vh' }}>
            <DialogClose onClose={() => setExpandedPanel(null)} />
            <DialogHeader>
              <div className="flex flex-col gap-1 min-w-0">
                <button
                  onClick={() => setExpandedPanel(null)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground w-fit"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to {dashboard.name}
                </button>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-medium shrink-0">
                    {PANEL_TYPE_ICONS[expandedPanel.type] || expandedPanel.type}
                  </span>
                  <DialogTitle className="truncate">{expandedPanel.title}</DialogTitle>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] text-muted-foreground">
                  {effectiveTimeRange.from} → {effectiveTimeRange.to}
                </span>
                <button
                  onClick={() => setExpandedPanel(null)}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  Collapse
                </button>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-auto p-6">
              <PanelRenderer
                panel={expandedPanel}
                timeRange={effectiveTimeRange}
                refreshIntervalSeconds={refreshInterval}
                variables={substitutionVars}
                scope={scope as Record<string, string | undefined>}
                height={480}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
