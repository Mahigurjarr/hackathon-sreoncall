'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Globe,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useStatusPages,
  useCreateStatusPage,
  useDeleteStatusPage,
  type StatusPageItem,
  type StatusPageComponent,
} from '@/lib/hooks/useStatusPages';

/* ─── StatusPageDialog (unchanged) ──────────────────────────────────────────── */

function StatusPageDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createPage = useCreateStatusPage();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!slug.trim()) {
      toast.error('Slug is required');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      toast.error('Slug can only contain lowercase letters, numbers, and hyphens');
      return;
    }
    try {
      await createPage.mutateAsync({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        is_public: isPublic,
        components: [],
      });
      toast.success('Status page created');
      setName('');
      setSlug('');
      setDescription('');
      setIsPublic(true);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create status page');
    }
  }

  const isPending = createPage.isPending;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="max-w-lg">
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            New Status Page
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Create a new public or private status page</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Page Name</label>
            <Input
              placeholder="e.g., ACME Platform Status"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, ''),
                );
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Slug</label>
            <div className="flex items-stretch">
              <div className="flex items-center rounded-l-lg border border-r-0 border-border bg-muted/50 px-3 text-sm text-muted-foreground">
                status/
              </div>
              <Input
                placeholder="acme-platform"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="rounded-l-none flex-1"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              URL-friendly identifier — lowercase letters, numbers, hyphens only
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
            <Input
              placeholder="Brief description of what this status page covers..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Initial Visibility</label>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  isPublic
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border hover:border-border/80'
                }`}
              >
                <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  isPublic ? 'border-primary' : 'border-muted-foreground/30'
                }`}>
                  {isPublic && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <span className="text-sm">Public — Anyone with the link can view</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  !isPublic
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border hover:border-border/80'
                }`}
              >
                <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  !isPublic ? 'border-primary' : 'border-muted-foreground/30'
                }`}>
                  {!isPublic && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <span className="text-sm">Private — Restricted access</span>
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Status Page
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function overallHealth(components: StatusPageComponent[]) {
  if (!components?.length) return 'unknown';
  if (components.some((c) => c.status === 'major_outage')) return 'major_outage';
  if (components.some((c) => c.status === 'partial_outage' || c.status === 'degraded')) return 'degraded';
  if (components.some((c) => c.status === 'maintenance')) return 'maintenance';
  return 'operational';
}

function healthLabel(h: string) {
  const map: Record<string, string> = {
    operational: 'All Operational',
    degraded: 'Degraded Performance',
    major_outage: 'Major Outage',
    maintenance: 'Under Maintenance',
    unknown: 'No Data',
  };
  return map[h] || 'Unknown';
}

function uptimePercent(components: StatusPageComponent[]) {
  if (!components?.length) return null;
  const uptimes = components.filter((c) => c.uptime_24h != null).map((c) => c.uptime_24h!);
  if (!uptimes.length) return null;
  return uptimes.reduce((a, b) => a + b, 0) / uptimes.length;
}

const healthBorderColor: Record<string, string> = {
  operational: 'from-emerald-500 to-emerald-400',
  degraded: 'from-amber-500 to-yellow-500',
  major_outage: 'from-rose-500 to-red-500',
  maintenance: 'from-blue-500 to-blue-400',
  unknown: 'from-border to-border',
};

const healthDotColor: Record<string, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  major_outage: 'bg-rose-500',
  maintenance: 'bg-blue-500',
  unknown: 'bg-muted-foreground/40',
};

const healthTextColor: Record<string, string> = {
  operational: 'text-emerald-500',
  degraded: 'text-amber-500',
  major_outage: 'text-rose-500',
  maintenance: 'text-blue-500',
  unknown: 'text-muted-foreground',
};

/* ─── Pulse Bars ────────────────────────────────────────────────────────────── */

function PulseBars({ components }: { components: StatusPageComponent[] }) {
  const bars = Array.from({ length: 30 }, (_, i) => {
    const hasIssue = components?.some(
      (c) => c.status !== 'operational' && c.status !== 'maintenance',
    );
    const isRecent = i > 25;
    const cls = hasIssue && isRecent ? 'bg-yellow-500' : 'bg-emerald-500';
    const h = 60 + Math.random() * 40;
    return (
      <div
        key={i}
        className={`flex-1 rounded-[1px] ${cls}`}
        style={{ height: `${h}%`, opacity: 0.7 }}
      />
    );
  });
  return <div className="flex items-end gap-[1.5px] h-7">{bars}</div>;
}

/* ─── Main Page ─────────────────────────────────────────────────────────────── */

export default function StatusPagesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data: currentUser } = useCurrentUser();
  const { data, isLoading } = useStatusPages();
  const deletePage = useDeleteStatusPage();

  const pages = data?.data ?? [];
  const filtered = search
    ? pages.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.slug.toLowerCase().includes(search.toLowerCase()),
      )
    : pages;

  const totalComponents = pages.reduce((sum, p) => sum + (p.components?.length ?? 0), 0);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deletePage.mutateAsync(deleteId);
      toast.success('Status page deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete status page');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Status Pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pages.length} pages &middot; {totalComponents} components
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => document.getElementById('sp-search')?.focus()}>
            <Search className="mr-2 h-3.5 w-3.5" />
            Search
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Status Page
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No status pages"
          description="Create a status page to share your service health with customers."
          actionLabel="Create Status Page"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <>
          {/* Search bar */}
          <SearchInput
            id="sp-search"
            containerClassName="max-w-sm"
            placeholder="Search by name or slug..."
            value={search}
            onChange={setSearch}
          />

          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((page) => {
              const health = overallHealth(page.components);
              const uptime = uptimePercent(page.components);
              const compCount = page.components?.length ?? 0;
              const operationalCount = page.components?.filter((c) => c.status === 'operational').length ?? 0;

              return (
                <div
                  key={page.id}
                  className="group relative rounded-[14px] border border-border bg-card overflow-hidden transition-shadow hover:shadow-lg hover:shadow-black/5"
                >
                  {/* Colored top border */}
                  <div className={`h-[2px] bg-gradient-to-r ${healthBorderColor[health] || healthBorderColor.unknown}`} />

                  <div className="p-4 space-y-4">
                    {/* Row 1: Name + Visibility */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/status-pages/${page.id}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors line-clamp-1"
                        >
                          {page.name}
                        </Link>
                        <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                          /{page.slug}
                        </p>
                      </div>
                      {page.is_public ? (
                        <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500 border border-emerald-500/20">
                          Public
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center rounded-full bg-purple-500/8 px-2 py-0.5 text-[10px] font-bold text-purple-400 border border-purple-500/20">
                          Private
                        </span>
                      )}
                    </div>

                    {/* Health section */}
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className={`text-3xl font-bold tracking-tight leading-none ${healthTextColor[health] || healthTextColor.unknown}`}>
                          {uptime != null ? `${uptime.toFixed(1)}%` : '\u2014'}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className={`inline-block h-2 w-2 rounded-full ${healthDotColor[health] || healthDotColor.unknown}`} />
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {healthLabel(health)}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {compCount} service{compCount !== 1 ? 's' : ''} &middot; last check {page.updated_at ? timeAgo(page.updated_at) : 'n/a'}
                        </p>
                      </div>
                    </div>

                    {/* Pulse bars */}
                    <div>
                      <PulseBars components={page.components ?? []} />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10.5px] text-muted-foreground/50">90 days ago</span>
                        <span className="text-[10.5px] text-muted-foreground/50">Today</span>
                      </div>
                    </div>

                    {/* Component chips + stats */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 flex-wrap min-w-0">
                        {page.components?.slice(0, 3).map((c, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground truncate max-w-[90px]"
                          >
                            {c.name}
                          </span>
                        ))}
                        {compCount > 3 && (
                          <span className="text-[10px] font-medium text-muted-foreground/70">
                            +{compCount - 3}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-center">
                          <div className="text-[11px] font-bold text-muted-foreground">0</div>
                          <div className="text-[9px] text-muted-foreground/60">subs</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[11px] font-bold text-emerald-500">{operationalCount}/{compCount}</div>
                          <div className="text-[9px] text-muted-foreground/60">up</div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom actions row */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground/60">
                        {page.updated_at ? timeAgo(page.updated_at) : 'Never updated'}
                      </span>
                      <div className="flex items-center gap-1">
                        <Link href={`/status-pages/${page.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                            Manage
                          </Button>
                        </Link>
                        <a
                          href={page.is_public ? `/status/${page.slug}` : `/status/${page.slug}?viewer_email=${encodeURIComponent(currentUser?.email || '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                            View
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </a>
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          onClick={() => setDeleteId(page.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Dashed "Create Status Page" card */}
            <div
              onClick={() => setShowCreate(true)}
              className="flex flex-col items-center justify-center gap-3 min-h-[220px] rounded-[14px] border border-dashed border-border/60 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            >
              <div className="w-10 h-10 rounded-full border-2 border-dashed border-border/50 flex items-center justify-center text-muted-foreground text-xl">
                +
              </div>
              <span className="text-sm font-semibold text-muted-foreground">Create Status Page</span>
            </div>
          </div>
        </>
      )}

      <StatusPageDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Status Page"
        description="Are you sure you want to delete this status page? The public URL will stop working."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
