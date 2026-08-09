'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Plus, Copy, Trash2, LayoutDashboard, Loader2, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import {
  useDashboards,
  useCreateDashboard,
  useCloneDashboard,
  useDeleteDashboard,
  useDeduplicateDashboards,
  useDashboardTemplates,
  useInstantiateDashboardTemplate,
  type CreateDashboardInput,
  type Dashboard,
  type DashboardTemplate,
  type InstantiateResult,
} from '@/lib/hooks/useDashboards';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const PANEL_TYPE_LABELS: Record<string, string> = {
  line_chart: 'Line',
  bar_chart: 'Bar',
  gauge: 'Gauge',
  stat: 'Stat',
  table: 'Table',
  heatmap: 'Heatmap',
  log_viewer: 'Logs',
  trace_waterfall: 'Traces',
};

// ── Standard Dashboards Tab ──────────────────────────────────────────

function StandardDashboardsTab({ myDashboards }: { myDashboards: Dashboard[] }) {
  const router = useRouter();
  const { data: templatesData, isLoading } = useDashboardTemplates();
  const instantiate = useInstantiateDashboardTemplate();

  const templates = templatesData?.data ?? [];

  const clonedTemplateIds = useMemo(
    () => new Set(myDashboards.map((d) => d.source_template_id).filter(Boolean)),
    [myDashboards],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, DashboardTemplate[]> = {};
    for (const t of templates) {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    }
    return groups;
  }, [templates]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 flex flex-col items-center justify-center text-center">
          <LayoutDashboard className="h-10 w-10 text-muted-foreground/30 mb-4" />
          <h3 className="text-sm font-semibold text-foreground mb-1">No templates available</h3>
          <p className="text-[12px] text-muted-foreground max-w-sm">
            Connect a data source to unlock standard dashboard templates.
          </p>
        </CardContent>
      </Card>
    );
  }

  const categoryColors: Record<string, string> = {
    'Infrastructure': 'bg-blue-500/10 text-blue-400',
    'Application': 'bg-emerald-500/10 text-emerald-400',
    'Kubernetes': 'bg-purple-500/10 text-purple-400',
    'AWS': 'bg-orange-500/10 text-orange-400',
    'Logs': 'bg-amber-500/10 text-amber-400',
    'SLO': 'bg-pink-500/10 text-pink-400',
    'Database': 'bg-cyan-500/10 text-cyan-400',
    'Containers': 'bg-indigo-500/10 text-indigo-400',
    'Networking': 'bg-sky-500/10 text-sky-400',
    'Message Queues': 'bg-violet-500/10 text-violet-400',
    'On-Call': 'bg-rose-500/10 text-rose-400',
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Based on your connected data sources, these dashboards are ready to use. Clone to customize.
      </p>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-3">
            <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase', categoryColors[category] || 'bg-muted text-muted-foreground')}>
              {category}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(items as DashboardTemplate[]).map((t) => (
              <Card key={t.template_id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <LayoutDashboard className="h-4 w-4 text-primary/60" />
                    <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3 line-clamp-2">
                    {t.description}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-3">
                    <span>{t.panels.length} panel{t.panels.length !== 1 ? 's' : ''}</span>
                    {t.tags.slice(0, 3).map((tag: string) => (
                      <span key={tag} className="rounded bg-muted px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {clonedTemplateIds.has(t.template_id) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[11px] opacity-60"
                        onClick={() => {
                          const existing = myDashboards.find((d) => d.source_template_id === t.template_id);
                          if (existing) router.push(`/dashboards/${existing.id}`);
                        }}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Already cloned
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[11px]"
                        onClick={() =>
                          instantiate.mutate(t.template_id, {
                            onSuccess: (result: InstantiateResult) => {
                              if (result.already_existed) {
                                toast.info(`${t.name} already in My Dashboards`);
                                router.push(`/dashboards/${result.dashboard.id}`);
                              } else {
                                toast.success(`${t.name} dashboard created`);
                              }
                            },
                            onError: (e: Error) => toast.error(e.message),
                          })
                        }
                        disabled={instantiate.isPending}
                      >
                        {instantiate.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                        Clone
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboards Page ────────────────────────────────────────────

export default function DashboardsListPage() {
  const [activeTab, setActiveTab] = useState<'standard' | 'my'>('standard');
  const { data, isLoading, error } = useDashboards();
  const createDashboard = useCreateDashboard();
  const cloneDashboard = useCloneDashboard();
  const deleteDashboard = useDeleteDashboard();
  const deduplicateDashboards = useDeduplicateDashboards();
  const dedupRan = useRef(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (activeTab === 'my' && !dedupRan.current) {
      dedupRan.current = true;
      deduplicateDashboards.mutate();
    }
  }, [activeTab]);

  const dashboards = data?.data ?? [];

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createDashboard.mutate(
      { name, description: description || undefined },
      {
        onSuccess: () => {
          toast.success('Dashboard created');
          setShowCreate(false);
          setName('');
          setDescription('');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTab === 'standard' ? 'Pre-built templates for common use cases' : `${dashboards.length} custom dashboard${dashboards.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {activeTab === 'my' && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Dashboard
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {([
          { key: 'standard', label: 'Standard Dashboards' },
          { key: 'my', label: 'My Dashboards' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2.5 text-[12px] font-semibold transition-colors border-b-2 -mb-[1px]',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'standard' && <StandardDashboardsTab myDashboards={dashboards} />}

      {activeTab === 'my' && (
        <>
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-400">
              {(error as Error).message}
            </div>
          )}

          {!isLoading && dashboards.length === 0 && (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                <LayoutDashboard className="h-10 w-10 text-muted-foreground/30 mb-4" />
                <h3 className="text-sm font-semibold text-foreground mb-1">No dashboards yet</h3>
                <p className="text-[12px] text-muted-foreground mb-4 max-w-sm">
                  Create custom dashboards or clone from standard templates to get started.
                </p>
                <Button size="sm" onClick={() => setShowCreate(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Create First Dashboard
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboards.map((d) => (
              <Link key={d.id} href={`/dashboards/${d.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{d.name}</h3>
                        {d.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{d.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1 ml-2 shrink-0" onClick={(e) => e.preventDefault()}>
                        <button
                          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Clone"
                          onClick={() =>
                            cloneDashboard.mutate(d.id, {
                              onSuccess: () => toast.success('Dashboard cloned'),
                            })
                          }
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                          title="Delete"
                          onClick={() => {
                            if (confirm('Delete this dashboard?')) {
                              deleteDashboard.mutate(d.id, {
                                onSuccess: () => toast.success('Dashboard deleted'),
                              });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{d.panels.length} panel{d.panels.length !== 1 ? 's' : ''}</span>
                      {d.is_template && (
                        <span className="rounded bg-purple-500/10 text-purple-400 px-1.5 py-0.5 font-medium">Template</span>
                      )}
                      {d.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {d.tags.slice(0, 3).map((t) => (
                            <span key={t} className="rounded bg-muted px-1.5 py-0.5">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {d.panels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {d.panels.slice(0, 5).map((p) => (
                          <span key={p.id} className="rounded bg-primary/5 text-primary/70 px-1.5 py-0.5 text-[9px] font-medium">
                            {PANEL_TYPE_LABELS[p.type] || p.type}
                          </span>
                        ))}
                        {d.panels.length > 5 && (
                          <span className="text-[9px] text-muted-foreground">+{d.panels.length - 5} more</span>
                        )}
                      </div>
                    )}

                    <p className="text-[9px] text-muted-foreground mt-3">
                      Updated {new Date(d.updated_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Dashboard</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 px-6 pb-6">
            <div>
              <label className="text-sm font-medium text-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                placeholder="e.g. API Overview"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                placeholder="Optional description..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createDashboard.isPending || !name}>
                {createDashboard.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
