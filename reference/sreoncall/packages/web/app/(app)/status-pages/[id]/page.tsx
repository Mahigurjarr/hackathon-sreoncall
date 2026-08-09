'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  AlertTriangle,
  Info,
  AlertOctagon,
  X,
  ChevronRight,

  Bell,
  Lock,
  LayoutList,
  GripVertical,
  Zap,
  Hexagon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useStatusPage,
  useStatusUpdates,
  useStatusPageSubscribers,
  useUpdateStatusPage,
} from '@/lib/hooks/useStatusPages';

// ---- Health Ring SVG Donut ---------------------------------------------------

function HealthRing({ percent }: { percent: number | null }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const pct = percent ?? 0;
  const offset = circ * (1 - pct / 100);
  const color =
    pct >= 99 ? '#10B981' : pct >= 95 ? '#F59E0B' : '#F43F5E';

  return (
    <div className="relative w-[84px] h-[84px] flex-shrink-0">
      <svg viewBox="0 0 84 84" className="w-[84px] h-[84px] -rotate-90">
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          className="text-border"
        />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-extrabold tracking-tight" style={{ color }}>
          {percent != null ? `${percent.toFixed(1)}%` : '\u2014'}
        </span>
        <span className="text-[9px] font-bold text-muted-foreground tracking-wider mt-0.5">
          UPTIME
        </span>
      </div>
    </div>
  );
}

// ---- Helpers -----------------------------------------------------------------

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatTimestamp(dateStr: string) {
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' \u00B7 ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) +
    ' UTC'
  );
}

// Status maps
const statusPillStyles: Record<string, string> = {
  operational: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  degraded: 'bg-amber-500/10 text-amber-500 border-amber-500/25',
  partial_outage: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  major_outage: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  maintenance: 'bg-blue-500/10 text-blue-400 border-blue-500/25',
};

const statusLabels: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Maintenance',
};

const statusDotBg: Record<string, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  partial_outage: 'bg-rose-500',
  major_outage: 'bg-rose-500',
  maintenance: 'bg-blue-500',
};

const updateStatusPill: Record<string, string> = {
  investigating: 'bg-rose-500/10 text-rose-300 border-rose-300/20',
  identified: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  monitoring: 'bg-blue-500/10 text-blue-300 border-blue-300/20',
  resolved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  informational: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
};

const updateStatusDotBg: Record<string, string> = {
  investigating: 'bg-rose-500',
  identified: 'bg-amber-500',
  monitoring: 'bg-blue-500',
  resolved: 'bg-emerald-500',
  informational: 'bg-cyan-500',
};

const updateStatusLabel: Record<string, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  informational: 'Informational',
};

// ---- Component Group ---------------------------------------------------------

interface ComponentGroupProps {
  title: string;
  components: any[];
  defaultOpen?: boolean;
}

function ComponentGroup({ title, components, defaultOpen = true }: ComponentGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allOperational = components.every((c) => c.status === 'operational');
  const groupPillLabel = allOperational ? 'All Up' : 'Issues';
  const groupPillStyle = allOperational
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
    : 'bg-amber-500/10 text-amber-500 border-amber-500/25';

  return (
    <div>
      {/* Group header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center w-full px-4 py-3 bg-muted/50 hover:bg-muted transition-colors"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 mr-2 flex-shrink-0 ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span className="text-[12.5px] font-bold text-muted-foreground tracking-wide uppercase">
          {title}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground/60 mr-3">
          {components.length} component{components.length !== 1 ? 's' : ''}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${groupPillStyle}`}
        >
          {groupPillLabel}
        </span>
      </button>

      {/* Group items */}
      {open && (
        <div>
          {components.map((comp, i) => {
            const compKey = comp.id ?? `${i}`;
            const isExpanded = expandedId === compKey;
            return (
              <div key={compKey}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : compKey)}
                  className="flex items-center gap-3 px-4 py-3 border-t border-border hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  {/* Drag handle */}
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab flex-shrink-0" />

                  {/* Status dot with pulse */}
                  <div className="relative flex-shrink-0 w-3 h-3 flex items-center justify-center">
                    {comp.status === 'operational' && (
                      <span className="absolute inset-0 rounded-full bg-emerald-500/30 animate-pulse" />
                    )}
                    <span
                      className={`relative h-2 w-2 rounded-full ${
                        statusDotBg[comp.status] ?? 'bg-muted-foreground'
                      }`}
                    />
                  </div>

                  {/* Name + service tag */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-foreground truncate">
                        {comp.name}
                      </span>
                      {(comp.source === 'service' || comp.source === 'synthetic_check') && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-bold text-purple-400 flex-shrink-0">
                          <Zap className="h-2.5 w-2.5" /> auto
                        </span>
                      )}
                    </div>
                    {comp.description ? (
                      <div className="text-[11px] font-mono text-muted-foreground/60 truncate mt-0.5">
                        {comp.description}
                      </div>
                    ) : comp.source === 'service' ? (
                      <div className="text-[11px] font-mono text-muted-foreground/60 truncate mt-0.5">
                        linked service
                      </div>
                    ) : comp.source === 'synthetic_check' ? (
                      <div className="text-[11px] font-mono text-muted-foreground/60 truncate mt-0.5">
                        synthetic check
                      </div>
                    ) : null}
                  </div>

                  {/* Status pill */}
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold flex-shrink-0 ${
                      statusPillStyles[comp.status] ?? 'bg-muted/50 text-muted-foreground border-border'
                    }`}
                  >
                    {statusLabels[comp.status] ?? comp.status}
                  </span>

                  {/* Expand chevron */}
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200 flex-shrink-0 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="bg-muted/30 border-t border-border px-4 py-3 space-y-2">
                    {comp.description && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider w-20 flex-shrink-0">
                          Description
                        </span>
                        <span className="text-[12.5px] text-foreground">{comp.description}</span>
                      </div>
                    )}
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider w-20 flex-shrink-0">
                        Source
                      </span>
                      <span className="text-[12.5px] text-foreground capitalize">
                        {comp.source === 'synthetic_check' ? 'Synthetic Check' : comp.source || 'Manual'}
                      </span>
                    </div>
                    {comp.uptime_24h != null && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider w-20 flex-shrink-0">
                          Uptime 24h
                        </span>
                        <span className="text-[12.5px] text-foreground font-mono">
                          {comp.uptime_24h.toFixed(2)}%
                        </span>
                      </div>
                    )}
                    {comp.service_id && (
                      <Link
                        href="/services"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Service <ChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                    {comp.synthetic_check_id && (
                      <Link
                        href="/synthetic-checks"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Check <ChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Settings Accordion Section ----------------------------------------------

function AccordionSection({
  icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden mb-2">
      <button
        onClick={onToggle}
        className="flex items-center w-full px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <span className="mr-2 text-muted-foreground">{icon}</span>
        <span className="text-[12.5px] font-bold text-foreground">{title}</span>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-border">{children}</div>}
    </div>
  );
}

// ---- Main Component ----------------------------------------------------------

export default function StatusPageOverview() {
  const { id } = useParams();
  const pageId = id as string;
  const { data: page, isLoading } = useStatusPage(pageId);
  const { data: updatesData } = useStatusUpdates(pageId);
  const { data: subsData } = useStatusPageSubscribers(pageId);
  const updatePage = useUpdateStatusPage();

  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(false);

  // Settings accordion state
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  // Settings form state
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementType, setAnnouncementType] = useState<'info' | 'warning' | 'critical'>('info');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [accessVisibility, setAccessVisibility] = useState<'public' | 'private'>('public');
  const [showIncidents, setShowIncidents] = useState(true);
  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [showRca, setShowRca] = useState(false);

  // Sync settings from server data
  useEffect(() => {
    if (!page) return;
    const ann = page.custom_announcement;
    if (ann) {
      setAnnouncementEnabled(ann.enabled);
      setAnnouncementType(ann.type);
      setAnnouncementTitle(ann.title ?? '');
      setAnnouncementBody(ann.body ?? '');
    }
    if (page.settings?.access_control) {
      setAccessVisibility(page.settings.access_control.visibility);
    }
    if (page.settings?.display_options) {
      setShowIncidents(page.settings.display_options.show_incidents);
      setShowWeeklySummary(page.settings.display_options.show_weekly_summary);
      setShowRca(page.settings.display_options.show_rca_followups);
    }
  }, [page]);

  const updates = updatesData?.data ?? [];
  const subscribers = subsData?.data ?? [];

  const components = page?.components ?? [];
  const announcement = page?.custom_announcement;

  // Calculate stats
  const uptimeComponents = components.filter((c) => c.uptime_24h != null);
  const avgUptime =
    uptimeComponents.length > 0
      ? uptimeComponents.reduce((sum, c) => sum + (c.uptime_24h ?? 0), 0) / uptimeComponents.length
      : null;

  const operationalCount = components.filter((c) => c.status === 'operational').length;
  const degradedCount = components.filter(
    (c) => c.status === 'degraded' || c.status === 'partial_outage' || c.status === 'major_outage',
  ).length;

  const confirmedSubs = subscribers.filter((s) => s.confirmed).length;
  const pendingSubs = subscribers.length - confirmedSubs;

  const lastUpdateDate = updates.length > 0 ? formatShortDate(updates[0].created_at) : 'Never';

  // MTTR calculation (average time between investigating and resolved for resolved updates)
  const mttrLabel = useMemo(() => {
    // Simplified: just show a placeholder based on update count
    if (updates.length === 0) return '--';
    const resolvedUpdates = updates.filter((u) => u.status === 'resolved');
    if (resolvedUpdates.length === 0) return '--';
    // Average hours between creation and last update as rough proxy
    const totalMins = resolvedUpdates.reduce((sum, u) => {
      const created = new Date(u.created_at).getTime();
      const updated = new Date(u.updated_at).getTime();
      return sum + Math.max(0, updated - created) / 60000;
    }, 0);
    const avgMins = totalMins / resolvedUpdates.length;
    if (avgMins < 60) return `${Math.round(avgMins)}m`;
    const h = Math.floor(avgMins / 60);
    const m = Math.round(avgMins % 60);
    return `${h}h ${m}m`;
  }, [updates]);

  // Group components by source
  const serviceComps = components.filter((c) => c.source === 'service');
  const checkComps = components.filter((c) => c.source === 'synthetic_check');
  const manualComps = components.filter((c) => !c.source || c.source === 'manual');

  // By-channel subscriber counts (all are email for now)
  const emailSubs = subscribers.length;

  // Save settings handler
  const handleSaveSettings = () => {
    updatePage.mutate({
      id: pageId,
      input: {
        custom_announcement: {
          enabled: announcementEnabled,
          type: announcementType,
          title: announcementTitle,
          body: announcementBody,
        },
        settings: {
          access_control: {
            visibility: accessVisibility,
            allowed_viewer_emails: page?.settings?.access_control?.allowed_viewer_emails ?? [],
          },
          display_options: {
            show_incidents: showIncidents,
            show_weekly_summary: showWeeklySummary,
            show_rca_followups: showRca,
            selected_service_ids: page?.settings?.display_options?.selected_service_ids ?? [],
            selected_synthetic_check_ids:
              page?.settings?.display_options?.selected_synthetic_check_ids ?? [],
          },
          localization: page?.settings?.localization ?? {
            additional_locales_enabled: false,
            default_language: 'en',
          },
        },
      },
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!page) return null;

  return (
    <div className="space-y-6">
      {/* ================================================================== */}
      {/* 1. HEALTH ZONE                                                      */}
      {/* ================================================================== */}
      <div className="flex items-start gap-6">
        <HealthRing percent={avgUptime} />

        <div className="grid grid-cols-3 sm:grid-cols-3 gap-3 flex-1 min-w-0">
          {/* Stat card: Operational */}
          <div className="bg-card border border-border rounded-[10px] px-4 py-3">
            <div className="text-[22px] font-extrabold text-emerald-500 leading-tight">
              {operationalCount}/{components.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Operational</div>
          </div>

          {/* Stat card: Degraded */}
          <div className="bg-card border border-border rounded-[10px] px-4 py-3">
            <div className="text-[22px] font-extrabold text-amber-500 leading-tight">
              {degradedCount}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Degraded</div>
          </div>

          {/* Stat card: Subscribers */}
          <div className="bg-card border border-border rounded-[10px] px-4 py-3">
            <div className="text-[22px] font-extrabold text-cyan-500 leading-tight">
              {subscribers.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Subscribers</div>
          </div>

          {/* Stat card: Updates (30d) */}
          <div className="bg-card border border-border rounded-[10px] px-4 py-3">
            <div className="text-[22px] font-extrabold text-orange-500 leading-tight">
              {updates.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Updates (30d)</div>
          </div>

          {/* Stat card: Avg MTTR */}
          <div className="bg-card border border-border rounded-[10px] px-4 py-3">
            <div className="text-[22px] font-extrabold text-foreground leading-tight">
              {mttrLabel}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Avg MTTR</div>
          </div>

          {/* Stat card: Last Update */}
          <div className="bg-card border border-border rounded-[10px] px-4 py-3">
            <div className="text-[22px] font-extrabold text-foreground leading-tight">
              {lastUpdateDate}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Last Update</div>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 2. ANNOUNCEMENT BANNER                                              */}
      {/* ================================================================== */}
      {announcement?.enabled && !dismissedAnnouncement && (
        <div
          className={`relative flex items-start gap-3 rounded-lg border p-4 ${
            announcement.type === 'critical'
              ? 'bg-red-500/10 border-red-500/25'
              : announcement.type === 'warning'
              ? 'bg-yellow-500/10 border-yellow-500/25'
              : 'bg-blue-500/10 border-blue-500/25'
          }`}
        >
          <div className="mt-0.5 flex-shrink-0">
            {announcement.type === 'critical' ? (
              <AlertOctagon className="h-4 w-4 text-red-400" />
            ) : announcement.type === 'warning' ? (
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
            ) : (
              <Info className="h-4 w-4 text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-bold text-foreground">{announcement.title}</p>
            {announcement.body && (
              <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
                {announcement.body}
              </p>
            )}
          </div>
          <button
            onClick={() => setDismissedAnnouncement(true)}
            className="flex-shrink-0 p-1 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* 3. COMPONENTS SECTION (collapsible groups)                          */}
      {/* ================================================================== */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-foreground">Components</h3>
            <span className="inline-flex items-center rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
              {components.length}
            </span>
          </div>
          <Link href={`/status-pages/${pageId}/settings`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs">
              + Add
            </Button>
          </Link>
        </div>

        {components.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            {serviceComps.length > 0 && (
              <ComponentGroup title="Linked Services" components={serviceComps} />
            )}
            {checkComps.length > 0 && (
              <ComponentGroup title="Synthetic Checks" components={checkComps} />
            )}
            {manualComps.length > 0 && (
              <ComponentGroup title="Manual Components" components={manualComps} />
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <Hexagon className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No components added yet.</p>
            <Link href={`/status-pages/${pageId}/settings`}>
              <Button variant="ghost" size="sm" className="mt-2">
                + Add Components
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* 4. TWO-COLUMN BOTTOM: Activity Feed + Subscribers/Settings          */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* ---- Left Column: Update History ---- */}
        <div>
          <div className="text-[12.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
            Update History
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            {updates.length > 0 ? (
              <div className="relative">
                {updates.slice(0, 10).map((update, i, arr) => (
                  <div key={update.id} className="flex gap-3 pb-5 last:pb-0">
                    {/* Timeline dot + stem */}
                    <div className="flex flex-col items-center flex-shrink-0 w-3">
                      <div
                        className={`h-3 w-3 rounded-full mt-0.5 flex-shrink-0 ${
                          updateStatusDotBg[update.status] ?? 'bg-muted-foreground'
                        }`}
                      />
                      {i < arr.length - 1 && (
                        <div className="w-px flex-1 bg-muted mt-1" />
                      )}
                    </div>

                    {/* Content body */}
                    <div className="flex-1 min-w-0">
                      {/* Meta row: status pill + visibility pill + timestamp */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${
                            updateStatusPill[update.status] ??
                            'bg-muted/50 text-muted-foreground border-border'
                          }`}
                        >
                          {updateStatusLabel[update.status] ?? update.status}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${
                            update.visibility === 'public'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                              : 'bg-muted text-muted-foreground/60 border-border'
                          }`}
                        >
                          {update.visibility === 'public' ? 'Public' : 'Internal'}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground/60">
                          {formatTimestamp(update.created_at)}
                        </span>
                      </div>

                      {/* Title */}
                      <div className="text-[13.5px] font-semibold text-foreground mb-1">
                        {update.title}
                      </div>

                      {/* Body */}
                      {update.body && (
                        <div className="text-[12.5px] text-muted-foreground leading-relaxed mb-1.5">
                          {update.body}
                        </div>
                      )}

                      {/* Affected component chips */}
                      {update.affected_components && update.affected_components.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {update.affected_components.map((ac, j) => (
                            <span
                              key={j}
                              className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              {ac.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic py-4 text-center">
                No updates posted yet.
              </p>
            )}

            {updates.length > 10 && (
              <div className="mt-4 pt-3 border-t border-border text-center">
                <Link
                  href={`/status-pages/${pageId}/updates`}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  View all {updates.length} updates &rarr;
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ---- Right Column: Subscribers + Settings ---- */}
        <div className="space-y-4">
          {/* Subscribers Card */}
          <div>
            <div className="text-[12.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Subscribers
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              {/* Mini stat boxes: total / confirmed / pending */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1 text-center bg-muted border border-border rounded-lg py-2">
                  <div className="text-[20px] font-extrabold text-cyan-500">{subscribers.length}</div>
                  <div className="text-[10px] text-muted-foreground/60">total</div>
                </div>
                <div className="flex-1 text-center bg-muted border border-border rounded-lg py-2">
                  <div className="text-[20px] font-extrabold text-emerald-500">{confirmedSubs}</div>
                  <div className="text-[10px] text-muted-foreground/60">confirmed</div>
                </div>
                <div className="flex-1 text-center bg-muted border border-border rounded-lg py-2">
                  <div className="text-[20px] font-extrabold text-amber-500">{pendingSubs}</div>
                  <div className="text-[10px] text-muted-foreground/60">pending</div>
                </div>
              </div>

              {/* By Channel */}
              <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-2">
                By Channel
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="inline-flex items-center gap-1.5 rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                  Email
                </span>
                <span className="text-[12px] font-mono text-foreground">{emailSubs}</span>
              </div>

              <Link href={`/status-pages/${pageId}/subscribers`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 w-full justify-center text-xs"
                >
                  Manage Subscribers
                </Button>
              </Link>
            </div>
          </div>

          {/* Settings Accordion */}
          <div>
            <div className="text-[12.5px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Page Settings
            </div>
            <div>
              {/* Section 1: Announcement Banner */}
              <AccordionSection
                icon={<Bell className="h-4 w-4" />}
                title="Announcement Banner"
                open={openAccordion === 'announcement'}
                onToggle={() =>
                  setOpenAccordion(openAccordion === 'announcement' ? null : 'announcement')
                }
              >
                <div className="space-y-3 pt-1">
                  {/* Enable toggle */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[12px] text-foreground">Enable Banner</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={announcementEnabled}
                      onClick={() => setAnnouncementEnabled(!announcementEnabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        announcementEnabled ? 'bg-emerald-500' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          announcementEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </label>

                  {/* Type select */}
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Type</label>
                    <select
                      value={announcementType}
                      onChange={(e) => setAnnouncementType(e.target.value as any)}
                      className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Title</label>
                    <input
                      type="text"
                      value={announcementTitle}
                      onChange={(e) => setAnnouncementTitle(e.target.value)}
                      className="w-full bg-muted border border-border rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Announcement title..."
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">Message</label>
                    <textarea
                      value={announcementBody}
                      onChange={(e) => setAnnouncementBody(e.target.value)}
                      rows={3}
                      className="w-full bg-muted border border-border rounded-md px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                      placeholder="Announcement body..."
                    />
                  </div>
                </div>
              </AccordionSection>

              {/* Section 2: Access Control */}
              <AccordionSection
                icon={<Lock className="h-4 w-4" />}
                title="Access Control"
                open={openAccordion === 'access'}
                onToggle={() => setOpenAccordion(openAccordion === 'access' ? null : 'access')}
              >
                <div className="space-y-3 pt-1">
                  <label className="flex items-center gap-3 cursor-pointer p-2 rounded-md hover:bg-muted transition-colors">
                    <input
                      type="radio"
                      name="visibility"
                      checked={accessVisibility === 'public'}
                      onChange={() => setAccessVisibility('public')}
                      className="accent-emerald-500"
                    />
                    <div>
                      <div className="text-[12px] font-semibold text-foreground">Public</div>
                      <div className="text-[11px] text-muted-foreground/60">
                        Anyone with the link can view
                      </div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer p-2 rounded-md hover:bg-muted transition-colors">
                    <input
                      type="radio"
                      name="visibility"
                      checked={accessVisibility === 'private'}
                      onChange={() => setAccessVisibility('private')}
                      className="accent-emerald-500"
                    />
                    <div>
                      <div className="text-[12px] font-semibold text-foreground">Private</div>
                      <div className="text-[11px] text-muted-foreground/60">
                        Only allowed viewers can access
                      </div>
                    </div>
                  </label>
                </div>
              </AccordionSection>

              {/* Section 3: Display Options */}
              <AccordionSection
                icon={<LayoutList className="h-4 w-4" />}
                title="Display Options"
                open={openAccordion === 'display'}
                onToggle={() => setOpenAccordion(openAccordion === 'display' ? null : 'display')}
              >
                <div className="space-y-3 pt-1">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[12px] text-foreground">Show Incidents</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showIncidents}
                      onClick={() => setShowIncidents(!showIncidents)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        showIncidents ? 'bg-emerald-500' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          showIncidents ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[12px] text-foreground">Show Weekly Summary</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showWeeklySummary}
                      onClick={() => setShowWeeklySummary(!showWeeklySummary)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        showWeeklySummary ? 'bg-emerald-500' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          showWeeklySummary ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[12px] text-foreground">Show RCA Follow-ups</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showRca}
                      onClick={() => setShowRca(!showRca)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        showRca ? 'bg-emerald-500' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          showRca ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </AccordionSection>

              {/* Save button */}
              <button
                onClick={handleSaveSettings}
                disabled={updatePage.isPending}
                className="w-full mt-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updatePage.isPending ? 'Saving...' : 'Save Settings'}
              </button>

              {updatePage.isSuccess && (
                <p className="text-[11px] text-emerald-400 text-center mt-1.5">
                  Settings saved successfully.
                </p>
              )}
              {updatePage.isError && (
                <p className="text-[11px] text-rose-400 text-center mt-1.5">
                  Failed to save settings.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
