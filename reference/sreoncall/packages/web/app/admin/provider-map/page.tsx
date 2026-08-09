'use client';

import { useState, useMemo } from 'react';
import {
  useProviderLinks,
  useCreateProviderLink,
  useUpdateProviderLink,
  useDeleteProviderLink,
  useAdminTenants,
  type ProviderLink,
} from '@/lib/hooks/useAdmin';
import { Network, Plus, Trash2, ArrowRight, Pencil, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const SCOPE_OPTIONS = ['incidents', 'escalations', 'oncall', 'runbooks', 'communications', 'tickets', 'changes'];

const STATUS_COLORS: Record<string, { stroke: string; fill: string }> = {
  active: { stroke: '#16A34A', fill: 'rgba(22,163,74,0.15)' },
  pending: { stroke: '#EAB308', fill: 'rgba(234,179,8,0.15)' },
  suspended: { stroke: '#DC2626', fill: 'rgba(220,38,38,0.15)' },
};

// ─── Relationship Graph ───────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: 'provider' | 'consumer';
  x: number;
  y: number;
}

interface GraphEdge {
  from: string;
  to: string;
  status: string;
  scope: string[];
}

function RelationshipGraph({ links }: { links: ProviderLink[] }) {
  const { nodes, edges, width, height, offsetX, offsetY } = useMemo(() => {
    // Group links by provider
    const groups = new Map<string, ProviderLink[]>();
    for (const link of links) {
      const pid = link.provider_tenant_id;
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid)!.push(link);
    }

    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];
    const groupEntries = Array.from(groups.entries());
    const groupSpacing = 320;
    const centerY = 160;

    groupEntries.forEach(([providerId, groupLinks], gi) => {
      const cx = groupSpacing / 2 + gi * groupSpacing;
      const providerLabel = groupLinks[0]?.provider_tenant?.name || 'Provider';

      nodeMap.set(providerId, { id: providerId, label: providerLabel, type: 'provider', x: cx, y: centerY });

      // Deduplicate consumers within this group
      const seen = new Set<string>();
      const consumers: ProviderLink[] = [];
      for (const l of groupLinks) {
        if (!seen.has(l.consumer_tenant_id)) {
          seen.add(l.consumer_tenant_id);
          consumers.push(l);
        }
      }

      const radius = Math.max(100, 28 * consumers.length);
      consumers.forEach((link, ci) => {
        const angle = (2 * Math.PI * ci) / consumers.length - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        const consumerLabel = link.consumer_tenant?.name || 'Consumer';

        if (!nodeMap.has(link.consumer_tenant_id)) {
          nodeMap.set(link.consumer_tenant_id, { id: link.consumer_tenant_id, label: consumerLabel, type: 'consumer', x, y });
        }
      });

      for (const link of groupLinks) {
        edgeList.push({ from: providerId, to: link.consumer_tenant_id, status: link.status, scope: link.scope });
      }
    });

    const allNodes = Array.from(nodeMap.values());
    const minX = Math.min(...allNodes.map((n) => n.x)) - 80;
    const maxX = Math.max(...allNodes.map((n) => n.x)) + 80;
    const minY = Math.min(...allNodes.map((n) => n.y)) - 60;
    const maxY = Math.max(...allNodes.map((n) => n.y)) + 60;

    return {
      nodes: allNodes,
      edges: edgeList,
      width: maxX - minX,
      height: maxY - minY,
      offsetX: -minX,
      offsetY: -minY,
    };
  }, [links]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold">Relationship Graph</h3>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minHeight: 200, maxHeight: 380 }}>
          {/* Edges */}
          {edges.map((edge, i) => {
            const fromNode = nodes.find((n) => n.id === edge.from);
            const toNode = nodes.find((n) => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const x1 = fromNode.x + offsetX;
            const y1 = fromNode.y + offsetY;
            const x2 = toNode.x + offsetX;
            const y2 = toNode.y + offsetY;
            const color = STATUS_COLORS[edge.status]?.stroke || '#888';
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const scopeLabel = edge.scope.length <= 2 ? edge.scope.join(', ') : `${edge.scope.length} scopes`;
            return (
              <g key={`edge-${i}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeOpacity={0.6} />
                <text x={midX} y={midY - 6} textAnchor="middle" fontSize={9} fill="currentColor" className="text-muted-foreground" opacity={0.7}>
                  {scopeLabel}
                </text>
              </g>
            );
          })}
          {/* Nodes */}
          {nodes.map((node) => {
            const x = node.x + offsetX;
            const y = node.y + offsetY;
            const isProvider = node.type === 'provider';
            const fill = isProvider ? 'rgba(124,58,237,0.15)' : 'rgba(37,99,235,0.15)';
            const stroke = isProvider ? '#7C3AED' : '#2563EB';
            return (
              <g key={node.id}>
                <circle cx={x} cy={y} r={isProvider ? 28 : 22} fill={fill} stroke={stroke} strokeWidth={2} />
                <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={isProvider ? 10 : 9} fontWeight={isProvider ? 600 : 400} fill={stroke}>
                  {node.label.length > 10 ? node.label.slice(0, 9) + '…' : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#7C3AED' }} /> Provider
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#2563EB' }} /> Consumer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-4 rounded-full" style={{ background: '#16A34A' }} /> Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-4 rounded-full" style={{ background: '#EAB308' }} /> Pending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-4 rounded-full" style={{ background: '#DC2626' }} /> Suspended
        </span>
      </div>
    </div>
  );
}

// ─── Provider Map Page ────────────────────────────────────────────────────────

export default function ProviderMapPage() {
  const { data: links, isLoading } = useProviderLinks();
  const { data: tenants } = useAdminTenants();
  const createLink = useCreateProviderLink();
  const updateLink = useUpdateProviderLink();
  const deleteLink = useDeleteProviderLink();

  const [showCreate, setShowCreate] = useState(false);
  const [newLink, setNewLink] = useState({ provider_tenant_id: '', consumer_tenant_id: '', scope: ['incidents', 'escalations', 'tickets'] as string[] });

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ status: string; scope: string[] } | null>(null);

  const providers = tenants?.filter((t) => t.type === 'provider') ?? [];
  const consumers = tenants?.filter((t) => t.type === 'consumer') ?? [];

  async function handleCreate() {
    if (!newLink.provider_tenant_id || !newLink.consumer_tenant_id || !newLink.scope.length) return;
    try {
      await createLink.mutateAsync(newLink);
      setShowCreate(false);
      setNewLink({ provider_tenant_id: '', consumer_tenant_id: '', scope: ['incidents', 'escalations'] });
      toast.success('Link created');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create link');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this provider-consumer link?')) return;
    try {
      await deleteLink.mutateAsync(id);
      toast.success('Link removed');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove link');
    }
  }

  function toggleScope(scope: string) {
    setNewLink((prev) => ({
      ...prev,
      scope: prev.scope.includes(scope) ? prev.scope.filter((s) => s !== scope) : [...prev.scope, scope],
    }));
  }

  function startEditing(link: ProviderLink) {
    setEditingId(link._id);
    setEditForm({ status: link.status, scope: [...link.scope] });
  }

  function cancelEditing() {
    setEditingId(null);
    setEditForm(null);
  }

  function toggleEditScope(scope: string) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      scope: editForm.scope.includes(scope) ? editForm.scope.filter((s) => s !== scope) : [...editForm.scope, scope],
    });
  }

  async function handleSaveEdit(linkId: string) {
    if (!editForm) { toast.error('Edit form state is missing — please reopen the edit panel'); return; }
    if (!editForm.scope.length) { toast.error('Select at least one scope'); return; }
    try {
      await updateLink.mutateAsync({ id: linkId, input: { status: editForm.status, scope: editForm.scope } });
      toast.success('Link updated');
      cancelEditing();
    } catch (err: any) {
      console.error('Failed to update provider link:', err);
      toast.error(err.message || 'Failed to update link');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Provider Map</h1>
          <p className="text-sm text-muted-foreground">Manage provider-consumer relationships</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Link
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Create Provider-Consumer Link</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              value={newLink.provider_tenant_id}
              onChange={(e) => setNewLink({ ...newLink, provider_tenant_id: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select Provider...</option>
              {providers.map((t) => (
                <option key={t._id} value={t._id}>{t.name} ({t.slug})</option>
              ))}
            </select>
            <select
              value={newLink.consumer_tenant_id}
              onChange={(e) => setNewLink({ ...newLink, consumer_tenant_id: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select Consumer...</option>
              {consumers.map((t) => (
                <option key={t._id} value={t._id}>{t.name} ({t.slug})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {SCOPE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => toggleScope(s)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  newLink.scope.includes(s)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={createLink.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Create Link
            </button>
            <button onClick={() => setShowCreate(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Relationship Graph — shown when links exist */}
      {!isLoading && links && links.length > 0 && <RelationshipGraph links={links} />}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !links?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Network className="mb-3 h-10 w-10 opacity-50" />
          <p>No provider-consumer links configured</p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map((link: ProviderLink) =>
            editingId === link._id && editForm ? (
              /* ── Edit Mode ─────────────────────────────────── */
              <div key={link._id} className="rounded-xl border-2 border-primary/50 bg-card px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-[rgba(124,58,237,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[#7C3AED]">
                      {link.provider_tenant?.name || 'Provider'}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="rounded-full bg-[rgba(37,99,235,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[#2563EB]">
                      {link.consumer_tenant?.name || 'Consumer'}
                    </span>
                  </div>
                  <button onClick={cancelEditing} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Status selector */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Status</p>
                  <div className="flex gap-2">
                    {(['active', 'pending', 'suspended'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setEditForm({ ...editForm, status: s })}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                          editForm.status === s
                            ? {
                                'border-[#16A34A] bg-[rgba(22,163,74,0.15)] text-[#16A34A]': s === 'active',
                                'border-[#EAB308] bg-[rgba(234,179,8,0.15)] text-[#EAB308]': s === 'pending',
                                'border-[#DC2626] bg-[rgba(220,38,38,0.15)] text-[#DC2626]': s === 'suspended',
                              }
                            : 'border-border text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scope toggles */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Scope</p>
                  <div className="flex flex-wrap gap-2">
                    {SCOPE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => toggleEditScope(s)}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                          editForm.scope.includes(s)
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Save / Cancel */}
                <div className="flex gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => handleSaveEdit(link._id)}
                    disabled={updateLink.isPending || !editForm.scope.length}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Save
                  </button>
                  <button onClick={cancelEditing} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* ── View Mode ─────────────────────────────────── */
              <div key={link._id} className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-[rgba(124,58,237,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[#7C3AED]">
                      {link.provider_tenant?.name || 'Provider'}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="rounded-full bg-[rgba(37,99,235,0.15)] px-2.5 py-0.5 text-[10px] font-medium text-[#2563EB]">
                      {link.consumer_tenant?.name || 'Consumer'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {link.scope.map((s) => (
                    <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s}</span>
                  ))}
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', {
                  'bg-[rgba(22,163,74,0.15)] text-[#16A34A]': link.status === 'active',
                  'bg-[rgba(234,179,8,0.15)] text-[#EAB308]': link.status === 'pending',
                  'bg-[rgba(220,38,38,0.15)] text-[#DC2626]': link.status === 'suspended',
                })}>
                  {link.status}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEditing(link)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(link._id)} className="text-muted-foreground hover:text-[#DC2626] transition-colors p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
