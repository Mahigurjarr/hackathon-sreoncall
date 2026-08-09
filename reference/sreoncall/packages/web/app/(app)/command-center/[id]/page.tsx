'use client';

import { useState, useMemo, useEffect, useCallback, Component, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Shield,
  Activity,
  Eye,
  Zap,
  BarChart3,
  GitBranch,
  FileText,
  MessageSquare,
  BookOpen,
  Network,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { SeverityBadge } from '@/components/shared/SeverityBadge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn } from '@/lib/utils';
import {
  useIncident,
  useIncidentTimeline,
  useAddTimelineEntry,
  useAcknowledgeIncident,
  useResolveIncident,
  useEscalateIncident,
} from '@/lib/hooks/useIncidents';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import {
  useAlertQuality,
  useEmergingRisks,
  useMergeCorrelation,
  useOpenActionItemsCount,
  useRejectCorrelation,
  useStakeholderUpdates,
  useCreateStakeholderUpdate,
  useSendStakeholderUpdate,
  type StakeholderUpdate,
} from '@/lib/hooks/useICCExtras';
import { useCommandCenter, useCommandCenterTopology, useConsumerImpacts, useMarkComplianceAction } from '@/lib/hooks/useCommandCenter';
import {
  getAvailablePersonas,
  getDefaultPersona,
  type PersonaDef,
  type PersonaKey,
} from '@/components/dashboard/PersonaSwitcher';
import {
  useResolutionPlan,
  useValidationResults,
  useCreateResolution,
  useUpdateStep,
  useAddStep,
  useDeleteStep,
  useTriggerValidation,
  useRediagnose,
  useConfirmResolution,
} from '@/lib/hooks/useResolution';

import { ComplianceBanner } from '@/components/command-center/ComplianceBanner';
import { OrgAdminView } from '@/components/command-center/OrgAdminView';
import { MSPConsumerImpactTable } from '@/components/command-center/MSPConsumerImpactTable';
import { ContextBrief } from '@/components/command-center/ContextBrief';
import { ChangeCorrelation } from '@/components/command-center/ChangeCorrelation';
import { BusinessImpact } from '@/components/command-center/BusinessImpact';
import { CorrelatedIncidents } from '@/components/command-center/CorrelatedIncidents';
import { EmergingRisks } from '@/components/command-center/EmergingRisks';
import { IncidentTimeline } from '@/components/command-center/IncidentTimeline';
import { TelemetryPanel } from '@/components/command-center/TelemetryPanel';
import { ResolvePanel } from '@/components/command-center/ResolvePanel';
import { StakeholderComms } from '@/components/command-center/StakeholderComms';
import { LearnPanel } from '@/components/command-center/LearnPanel';

// TopologyMap uses @xyflow/react + dagre — must avoid SSR
const TopologyMap = dynamic(
  () => import('@/components/command-center/TopologyMap').then((mod) => mod.TopologyMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center min-h-[300px] border border-border bg-card rounded-lg">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

// ─── Types ─────────────────────────────────────────────────────────────────────

type ICCTab = 'metrics' | 'traces' | 'logs' | 'resolve' | 'comms' | 'learn';

const ALL_TABS: { id: ICCTab; label: string; icon: React.ElementType }[] = [
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
  { id: 'traces', label: 'Traces', icon: GitBranch },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'resolve', label: 'Resolve', icon: CheckCircle2 },
  { id: 'comms', label: 'Comms', icon: MessageSquare },
  { id: 'learn', label: 'Learn', icon: BookOpen },
];

// Tabs visible per persona — FRD §17.3
const PERSONA_TABS: Record<string, ICCTab[]> = {
  sre_engineer:      ['metrics', 'traces', 'logs', 'resolve', 'learn'],
  sre_manager:       ['metrics', 'resolve', 'comms', 'learn'],
  platform_engineer: ['metrics', 'traces', 'logs', 'resolve', 'learn'],
  tenant_admin:      ['comms'],
  msp_provider:      ['metrics', 'resolve', 'comms', 'learn'],
  consumer:          ['metrics'],
  platform_admin:    ['metrics', 'traces', 'logs', 'resolve', 'comms', 'learn'],
};

// Default tab per persona — FRD §17.3
const PERSONA_DEFAULT_TAB: Record<string, ICCTab> = {
  sre_engineer:      'metrics',
  sre_manager:       'comms',
  platform_engineer: 'metrics',
  tenant_admin:      'comms',
  msp_provider:      'comms',
  consumer:          'metrics',
  platform_admin:    'metrics',
};

// Topology interactivity/hover depth per persona — FRD §17.7
const TOPOLOGY_INTERACTIVE_PERSONAS = new Set(['sre_engineer', 'platform_engineer', 'platform_admin', 'msp_provider']);

const PERSONA_HOVER_DEPTH: Record<string, 'full' | 'summary' | 'none'> = {
  sre_engineer:      'full',
  platform_engineer: 'full',
  platform_admin:    'full',
  sre_manager:       'summary',
  msp_provider:      'summary',
  consumer:          'summary',
  tenant_admin:      'none',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(s: number | null | undefined): string {
  if (s == null) return '\u2014';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${sec}s`;
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ElementType }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center min-w-[90px]">
      <div className="flex items-center justify-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-sm font-bold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

// ─── Data mappers (all wrapped in try/catch) ───────────────────────────────────

function buildTopoNodes(commandData: any) {
  try {
    const ccNodes = commandData?.topology?.nodes;
    if (Array.isArray(ccNodes) && ccNodes.length > 0) {
      return ccNodes.map((n: any) => ({
        service_id: n.service_id ?? n.id ?? '',
        name: n.name ?? 'Unknown',
        type: n.type ?? 'backend',
        status: (['healthy', 'degraded', 'down'].includes(n.status) ? n.status : n.current_status === 'operational' ? 'healthy' : 'unknown') as any,
        is_root_cause: !!n.is_root_cause,
        is_affected: !!n.is_affected,
        health: {
          error_rate_percent: n.health?.error_rate_percent ?? n.metrics?.error_rate_percent ?? null,
          latency_p99_ms: n.health?.latency_p99_ms ?? n.metrics?.latency_p99_ms ?? null,
          cpu_percent: n.health?.cpu_percent ?? n.metrics?.cpu_percent ?? null,
          memory_percent: n.health?.memory_percent ?? n.metrics?.memory_percent ?? null,
        },
        owner_team: n.owner_team ?? null,
        oncall_user: n.oncall_user ?? null,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

function buildTopoEdges(commandData: any) {
  try {
    const ccEdges = commandData?.topology?.edges;
    if (Array.isArray(ccEdges) && ccEdges.length > 0) {
      return ccEdges.map((e: any) => ({
        source_service_id: e.source_service_id ?? e.source ?? '',
        target_service_id: e.target_service_id ?? e.target ?? '',
        dependency_type: e.dependency_type ?? e.type ?? 'http',
        criticality: e.criticality ?? 'medium',
        traffic: {
          requests_per_minute: e.traffic?.requests_per_minute ?? e.traffic_metadata?.avg_requests_per_minute ?? null,
          error_rate_percent: e.traffic?.error_rate_percent ?? e.traffic_metadata?.error_rate_percent ?? null,
          latency_ms: e.traffic?.latency_ms ?? e.traffic_metadata?.avg_latency_ms ?? null,
        },
      }));
    }
    return [];
  } catch {
    return [];
  }
}

function buildBusinessImpact(commandData: any) {
  try {
    const bi = commandData?.business_impact;
    if (!bi) return null;
    return {
      revenue_impact_per_hour_cents: bi.revenue_impact_per_hour_cents ?? bi.estimated_cost ?? 0,
      users_affected: bi.users_affected ?? bi.affected_customers ?? 0,
      // Backend returns {tier, count} objects; component expects string[].
      customer_tiers: (bi.customer_tiers ?? []).map((t: any) =>
        typeof t === 'object' && t !== null
          ? `${t.tier ?? t.name ?? ''}${t.count != null ? ` (${t.count})` : ''}`.trim()
          : String(t ?? ''),
      ).filter(Boolean),
      sla_at_risk: Array.isArray(bi.sla_at_risk)
        ? bi.sla_at_risk.filter(Boolean).map((s: any) => ({
            name: s.customer ?? s.sla_name ?? s.name ?? 'SLA',
            breach_in_minutes: s.remaining_minutes ?? 0,
          }))
        : [],
      support_ticket_surge_percent: bi.support_ticket_surge_percent ?? 0,
    };
  } catch {
    return null;
  }
}

// Maps backend correlation status → component status
function mapCorrStatus(s: string): 'pending' | 'merged' | 'separated' {
  if (s === 'confirmed') return 'merged';
  if (s === 'rejected') return 'separated';
  return 'pending'; // 'proposed' and anything else
}

function buildCorrelations(commandData: any) {
  try {
    const corr = commandData?.correlated_incidents ?? (commandData as any)?.correlations?.events;
    if (!Array.isArray(corr) || corr.length === 0) return [];
    if (corr[0]?.correlation_id || corr[0]?.incidents) {
      return corr.filter(Boolean).map((c: any) => ({ ...c, status: mapCorrStatus(c.status) }));
    }
    const incidentEvents = corr.filter((e: any) => e.type === 'incident');
    if (incidentEvents.length === 0) return [];
    return [
      {
        correlation_id: 'auto',
        incidents: incidentEvents.map((e: any) => ({
          id: e.id,
          number: String(e.id).slice(-4),
          title: e.title ?? '',
          severity: 'SEV3' as const,
          service_name: e.metadata?.service_name ?? 'Unknown',
        })),
        correlation_type: 'temporal',
        confidence_percent: Math.round((incidentEvents[0]?.correlation_score ?? 0.5) * 100),
        evidence: [incidentEvents[0]?.relationship ?? 'Correlated events detected'],
        status: 'pending' as const,
      },
    ];
  } catch {
    return [];
  }
}

function buildTimeline(timelineEntries: any) {
  try {
    if (!Array.isArray(timelineEntries) || timelineEntries.length === 0) return [];
    const typeMap: Record<string, string> = {
      declaration: 'status',
      acknowledgment: 'status',
      status_change: 'status',
      severity_change: 'status',
      role_assigned: 'status',
      alert: 'alert',
      ai_insight: 'ai',
      runbook_started: 'step',
      runbook_step: 'step',
      note: 'note',
      escalation: 'escalation',
      resolution: 'resolve',
      comms_sent: 'note',
    };
    return timelineEntries.filter(Boolean).map((e: any) => ({
      timestamp: e.timestamp,
      type: (typeMap[e.type] ?? 'note') as any,
      actor_name: e.actor_name ?? e.metadata?.actor_name ?? 'System',
      message: e.message ?? '',
    }));
  } catch {
    return [];
  }
}

function buildResolvePlan(resolutionPlan: any) {
  try {
    if (!resolutionPlan) return null;
    const plan = resolutionPlan as any;
    const confidence = plan.confidence_percent ?? plan.confidence ?? 0;
    return {
      root_cause: plan.diagnosis?.root_cause ?? plan.root_cause ?? plan.diagnosis ?? '',
      confidence: (confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      evidence: plan.diagnosis?.evidence?.map((e: any) => e.description ?? e) ?? [],
      steps: Array.isArray(plan.steps)
        ? plan.steps.filter(Boolean).map((s: any) => ({
            id: s._id ?? s.id ?? '',
            title: s.title ?? '',
            description: s.description ?? null,
            source: ({
              runbook:          'runbook',
              ai_suggested:     'ai',
              ai:               'ai',
              similar_incident: 'similar_incident',
              engineer_added:   'engineer_added',
              // Compliance-injected steps (FRD §9) are manual actions, not AI-generated.
              compliance:       'engineer_added',
            } as Record<string, 'runbook' | 'ai' | 'similar_incident' | 'engineer_added'>)[
              s.source ?? s.metadata?.source ?? 'ai'
            ] ?? 'ai',
            suggested_command: s.suggested_command ?? s.metadata?.command ?? undefined,
            status: (s.status ?? 'pending') as 'pending' | 'completed' | 'skipped',
            completed_by: s.completed_by ?? s.assignee_name ?? undefined,
            skip_reason: s.skipped_reason ?? s.metadata?.skip_reason ?? undefined,
            notes: s.notes ?? null,
          }))
        : [],
    };
  } catch {
    return null;
  }
}

function buildContextBrief(commandData: any, serviceName: string) {
  try {
    const cb = commandData?.context_brief;
    if (!cb) return null;

    const cs = cb.current_state;
    const currentState = cs
      ? [
          cs.error_rate !== 'N/A' ? `Error: ${cs.error_rate}` : null,
          cs.latency_p99 !== 'N/A' ? `p99: ${cs.latency_p99}` : null,
          cs.active_alerts > 0 ? `${cs.active_alerts} active alert${cs.active_alerts !== 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(' · ') || 'No telemetry data'
      : 'No telemetry data';

    return {
      service_name: cb.service_name ?? serviceName,
      service_description: cb.service_description ?? '',
      owner_team: cb.owner_team ?? '',
      oncall_engineer: cb.oncall_engineer ?? '',
      last_deploy: cb.last_deploy && (cb.last_deploy.version || cb.last_deploy.deployed_at)
        ? {
            version: cb.last_deploy.version ?? 'Unknown',
            deployed_at: cb.last_deploy.deployed_at ?? '',
            deployed_by: cb.last_deploy.deployed_by ?? 'Unknown',
          }
        : null,
      known_quirks: Array.isArray(cb.known_quirks) ? cb.known_quirks : [],
      recent_incidents: (cb.recent_incidents ?? []).filter(Boolean).map((inc: any) => ({
        number: String(inc.number),
        title: inc.title,
        resolved_at: inc.resolved_at ?? '',
      })),
      current_state: currentState,
    };
  } catch {
    return null;
  }
}

function buildChanges(commandData: any) {
  try {
    const cc = commandData?.change_correlation;
    if (!cc) return null;
    return {
      recent_deploys: (cc.recent_deploys ?? []).filter(Boolean).map((d: any) => ({
        version: d.version ?? 'Unknown',
        service: d.service_name ?? 'Unknown',
        deployed_by: d.deployed_by ?? 'Unknown',
        deployed_at: d.deployed_at,
        minutes_before: d.time_before_incident_minutes ?? 0,
      })),
      recent_config_changes: (cc.recent_config_changes ?? []).filter(Boolean).map((c: any) => ({
        key: c.description ?? c.type ?? 'Unknown',
        service: c.type ?? '',
        changed_by: c.changed_by ?? 'Unknown',
        changed_at: c.changed_at,
        minutes_before: c.time_before_incident_minutes ?? 0,
      })),
      recent_alerts: (cc.recent_alerts ?? []).filter(Boolean).map((a: any) => ({
        name: a.alert_name ?? 'Unknown',
        service: a.service_name ?? 'Unknown',
        fired_at: a.fired_at,
        minutes_before: Math.floor((Date.now() - new Date(a.fired_at).getTime()) / 60000),
      })),
    };
  } catch {
    return null;
  }
}

// ─── Comms audience filter by persona ─────────────────────────────────────────

type CommsAudience = StakeholderUpdate['audience'];

function getCommsAudiences(persona: PersonaKey): CommsAudience[] {
  switch (persona) {
    case 'sre_engineer':      return ['internal_engineering'];
    case 'tenant_admin':      return ['external_customer', 'status_page'];
    case 'sre_manager':
    case 'msp_provider':
    case 'platform_admin':    return ['internal_engineering', 'internal_leadership', 'external_customer', 'status_page'];
    case 'platform_engineer': return [];  // stakeholder_comms: 'hidden' per visibility matrix
    case 'consumer':          return [];  // stakeholder_comms: 'hidden' per visibility matrix
    default:                  return ['internal_engineering'];
  }
}

// ─── Error Boundary ────────────────────────────────────────────────────────────

class ICCErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      const isDev = process.env.NODE_ENV === 'development';
      return (
        <div className="flex h-[calc(100vh-50px)] items-center justify-center overflow-auto">
          <div className="max-w-2xl w-full rounded-lg border border-border bg-card p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-error mx-auto mb-3" />
            <h2 className="text-lg font-bold text-foreground mb-1">Something went wrong</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred in the Command Center.'}
            </p>
            {isDev && this.state.error?.stack && (
              <pre className="text-left text-[11px] bg-muted/60 rounded p-3 mb-4 overflow-auto max-h-64 text-muted-foreground whitespace-pre-wrap break-all">
                {this.state.error.stack}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Page Wrapper ──────────────────────────────────────────────────────────────

export default function CommandCenterPageWrapper() {
  return (
    <ICCErrorBoundary>
      <CommandCenterPage />
    </ICCErrorBoundary>
  );
}

// ─── Collapsible Sidebar Section ────────────────────────────────────────────────

function SidebarSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-1 py-2 text-left hover:bg-muted/50 rounded transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 text-brand shrink-0" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

function CommandCenterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // Persona resolution — mirrors dashboard logic
  const { data: session } = useSession();
  const { data: currentUser } = useCurrentUser();
  const roles = currentUser?.roles || [(session?.user as any)?.role || 'agent'];
  const tenantType = (session?.user as any)?.tenantType || 'standalone';
  const availablePersonas = useMemo(() => getAvailablePersonas(roles, tenantType), [roles, tenantType]);
  const defaultPersona = useMemo(() => getDefaultPersona(roles, tenantType), [roles, tenantType]);
  const [activePersona, setActivePersona] = useState<PersonaKey | null>(null);
  const persona: PersonaKey = availablePersonas.some((p) => p.key === (activePersona ?? defaultPersona))
    ? (activePersona ?? defaultPersona)
    : (availablePersonas[0]?.key ?? 'sre_engineer');

  // Live updates — invalidate ICC-specific queries whenever the backend pushes
  // an incident event for this incident over the WebSocket connection.
  // The useWebSocket hook already handles ['incident', id] and ['incident-timeline', id]
  // automatically; the onMessage callback adds the ICC-specific keys on top.
  // useCallback is required: useWebSocket includes onMessage in connect()'s dep array,
  // so an inline function would trigger a reconnect on every render.
  const queryClient = useQueryClient();
  const wsMessageHandler = useCallback(
    (event: { type: string; payload: Record<string, unknown> }) => {
      if (
        event.type === 'incident' &&
        (event.payload?.incident_id as string | undefined) === id
      ) {
        queryClient.invalidateQueries({ queryKey: ['command-center', id] });
        queryClient.invalidateQueries({ queryKey: ['command-center-topology', id] });
        queryClient.invalidateQueries({ queryKey: ['resolution', id] });
        queryClient.invalidateQueries({ queryKey: ['resolution-validations', id] });
        queryClient.invalidateQueries({ queryKey: ['stakeholder-updates', id] });
      }
    },
    [id, queryClient],
  );
  useWebSocket({ onMessage: wsMessageHandler });

  // MSP consumer tenant selector — only fetched when persona is msp_provider
  const [selectedConsumerId, setSelectedConsumerId] = useState<string | null>(null);
  // Clear consumer scope whenever the user switches away from the MSP persona so
  // the cache key doesn't carry a stale consumer ID into unrelated persona views.
  useEffect(() => {
    if (persona !== 'msp_provider') setSelectedConsumerId(null);
  }, [persona]);
  const { data: providerConsumers = [] } = useQuery<Array<{ _id: string; name: string; slug: string }>>({
    queryKey: ['provider-consumers'],
    queryFn: async () => {
      const res = await api.get<{ data: Array<{ consumer: { _id: string; name: string; slug: string } }> }>(
        '/api/v1/provider/consumers',
      );
      return res.data
        .map((l) => l.consumer)
        .filter((c): c is { _id: string; name: string; slug: string } => !!c && !!c.name);
    },
    enabled: persona === 'msp_provider',
  });

  // Data fetching
  const { data: incident, isLoading, error } = useIncident(id);
  const { data: commandData } = useCommandCenter(id, persona, selectedConsumerId ?? undefined);
  // Dedicated topology query refreshes every 10s (matches the topology cache TTL).
  // The full ICC payload above refreshes every 15s — without this, topology health
  // metrics were always 5s stale relative to their cache window.
  const { data: topologyQueryData } = useCommandCenterTopology(id);
  const { data: timelineEntries } = useIncidentTimeline(id);
  const { data: resolutionPlan } = useResolutionPlan(id);
  const { data: validationEntries = [] } = useValidationResults(id);

  // Mutations
  const addTimelineEntry = useAddTimelineEntry();
  const createResolution = useCreateResolution();
  const updateStep = useUpdateStep();
  const addStep = useAddStep();
  const deleteStep = useDeleteStep();
  const triggerValidation = useTriggerValidation();
  const rediagnose = useRediagnose();
  const confirmResolution = useConfirmResolution();
  const acknowledge = useAcknowledgeIncident();
  const resolve = useResolveIncident();
  const escalate = useEscalateIncident();
  const markComplianceAction = useMarkComplianceAction();
  // Per-consumer aggregate view — only fetched for MSP persona with no specific consumer selected
  const { data: consumerImpacts = [] } = useConsumerImpacts(
    id,
    persona === 'msp_provider' && !selectedConsumerId,
  );
  const mergeCorrelation = useMergeCorrelation();
  const rejectCorrelation = useRejectCorrelation();

  // Emerging risks (sidebar) — filtered to services involved in this incident
  const { data: emergingRisksData = [] } = useEmergingRisks();
  const mappedEmergingRisks = useMemo(() => {
    // platform_engineer sees ALL tenant emerging risks (FRD §17.3 "all services, not just on-call").
    // All other personas are scoped to the incident's directly affected services.
    const isPlatformEngineer = persona === 'platform_engineer';

    const affectedNames = isPlatformEngineer
      ? null  // null → skip filter
      : new Set(
          (incident?.affected_services ?? []).map((s: any) =>
            typeof s === 'object' && s !== null ? (s.name ?? '') : String(s),
          ).filter(Boolean),
        );

    return emergingRisksData
      .filter((r) =>
        !affectedNames ||                   // platform_engineer: no filter
        affectedNames.size === 0 ||         // incident not yet loaded — show all
        r.affected_services.length === 0 || // tenant-wide risk, not service-specific
        r.affected_services.some((svc) => affectedNames.has(svc)),
      )
      .map((r) => ({
        service_name: r.affected_services[0] ?? r.source,
        risk_type: (r.risk_level === 'critical' ? 'critical' : r.risk_level === 'high' ? 'warning' : 'watch') as 'critical' | 'warning' | 'watch',
        severity: r.risk_level,
        description: r.description,
        projected_breach_at: null as string | null,
      }));
  }, [emergingRisksData, incident?.affected_services, persona]);

  // Alert quality: platform_engineer sees all tenant rules; other personas see
  // only the incident's primary service (FRD §17.3 "all alert rules, not just their own").
  const primaryServiceId = incident?.affected_services?.[0]?.id;
  const { data: alertQualityData = [] } = useAlertQuality(
    persona === 'platform_engineer'
      ? {}
      : primaryServiceId ? { service_id: primaryServiceId } : {},
  );
  const alertQualityItems = useMemo(
    () => alertQualityData.map((entry) => ({
      name: entry.alert_rule?.name ?? entry.alert_rule_id ?? 'Unknown alert',
      signal_score: Math.round(entry.signal_score ?? 0),
      recommendation: entry.recommendation_details ?? entry.recommendation ?? 'No recommendation available',
    })),
    [alertQualityData],
  );

  // Stakeholder comms
  const { data: rawStakeholderUpdates = [] } = useStakeholderUpdates(id);
  const createStakeholderUpdate = useCreateStakeholderUpdate();
  const sendStakeholderUpdate = useSendStakeholderUpdate();
  const commsAudiences = useMemo(() => getCommsAudiences(persona), [persona]);
  const mappedStakeholderUpdates = useMemo(
    () => rawStakeholderUpdates.map((u) => ({
      id: u.id,
      audience: u.audience,
      content: u.body,
      status: u.status as 'draft' | 'sent' | 'pending',
    })),
    [rawStakeholderUpdates],
  );

  // UI state
  const [activeTab, setActiveTab] = useState<ICCTab>('metrics');
  const [detailsOpen, setDetailsOpen] = useState(true);

  // Persona-gated tab list — re-evaluated when persona changes
  const visibleTabs = useMemo(
    () => ALL_TABS.filter((t) => (PERSONA_TABS[persona] ?? PERSONA_TABS.sre_engineer).includes(t.id)),
    [persona],
  );

  // Snap to persona default when the active tab is not available for this persona.
  // Uses derived value rather than setState so persona switches are instant.
  const effectiveTab: ICCTab = visibleTabs.some((t) => t.id === activeTab)
    ? activeTab
    : (PERSONA_DEFAULT_TAB[persona] ?? 'metrics');

  // FRD §17.3: sre_engineer default tab switches to 'resolve' once a resolution
  // plan exists. Only fires if the user is still on 'metrics' (hasn't moved away).
  useEffect(() => {
    if (
      persona === 'sre_engineer' &&
      resolutionPlan &&
      activeTab === 'metrics' &&
      visibleTabs.some((t) => t.id === 'resolve')
    ) {
      setActiveTab('resolve');
    }
  }, [resolutionPlan, persona]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recurrence: extract similar incident IDs from the ai_insight timeline entry
  // written by recurrence detection in incident.service.ts.
  // These hooks must stay BEFORE the early returns to satisfy Rules of Hooks.
  const recurrenceEntry = useMemo(() => {
    if (!Array.isArray(timelineEntries) || timelineEntries.length === 0) return null;
    return [...timelineEntries]
      .reverse()
      .find((e: any) =>
        e.type === 'ai_insight' &&
        typeof (e.metadata as any)?.similar_count === 'number' &&
        (e.metadata as any).similar_count > 0,
      ) ?? null;
  }, [timelineEntries]);

  const similarIncidentIds = useMemo(
    () => ((recurrenceEntry as any)?.metadata?.similar_incident_ids as string[] | undefined) ?? [],
    [recurrenceEntry],
  );

  const { data: openActionItemsCount = 0 } = useOpenActionItemsCount(similarIncidentIds);

  const recurrenceData = useMemo(() => {
    if (!recurrenceEntry) return null;
    return {
      is_recurring: true,
      pattern_description: (recurrenceEntry as any).message ?? '',
      open_action_items: openActionItemsCount,
    };
  }, [recurrenceEntry, openActionItemsCount]);


  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-50px)] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
          <p className="text-sm text-muted-foreground font-medium">Loading Command Center...</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !incident) {
    return (
      <div className="flex h-[calc(100vh-50px)] items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-error mx-auto mb-3" />
            <h2 className="text-lg font-bold text-foreground mb-1">Failed to load incident</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {(error as any)?.message || 'The incident could not be found or you do not have access.'}
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => router.back()}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Go Back
              </Button>
              <Button size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const sevKey = `SEV${incident.severity}` as 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4' | 'SEV5';
  const responderCount = incident.responders?.length ?? 0;
  const isActive = ['open', 'acknowledged', 'investigating', 'monitoring'].includes(incident.status);
  // Prefer the dedicated topology query (10s TTL) over the full ICC payload (15s TTL).
  // Wrapping in { topology: ... } satisfies the shape buildTopoNodes/buildTopoEdges expect.
  const topoSource = topologyQueryData ? { topology: topologyQueryData } : commandData;
  const topoEdges = buildTopoEdges(topoSource);
  const topoNodes = buildTopoNodes(topoSource);
  const businessImpactData = buildBusinessImpact(commandData);
  const correlatedIncidentsData = buildCorrelations(commandData);
  const mappedTimeline = buildTimeline(timelineEntries);
  const resolvePlanData = buildResolvePlan(resolutionPlan);

  // Extract service name for telemetry queries
  // Prefer incident's affected services, fall back to first topology node
  const firstService = incident.affected_services?.[0];
  let primaryServiceName =
    (typeof firstService === 'object' && firstService !== null
      ? firstService.name ?? (firstService as any).slug ?? ''
      : typeof firstService === 'string'
        ? firstService
        : '');
  // If service name doesn't look like an OTel service name, try topology nodes
  if (!primaryServiceName || !primaryServiceName.includes('-')) {
    const firstTopoNode = topoNodes?.[0]?.name;
    if (firstTopoNode) primaryServiceName = firstTopoNode;
  }

  const contextBriefData = buildContextBrief(commandData, primaryServiceName);
  const changesData = buildChanges(commandData);

  // ── Tab content renderer ─────────────────────────────────────────────────────

  function renderTabContent(tab: ICCTab) {
    switch (tab) {
      case 'metrics':
        return <TelemetryPanel type="metrics" serviceName={primaryServiceName} incidentId={id} />;
      case 'traces':
        return <TelemetryPanel type="traces" serviceName={primaryServiceName} incidentId={id} />;
      case 'logs':
        return <TelemetryPanel type="logs" serviceName={primaryServiceName} incidentId={id} />;
      case 'resolve':
        return (
          <ResolvePanel
            plan={resolvePlanData}
            readOnly={!commandData?._permissions?.can_resolve_steps}
            onCreatePlan={() => createResolution.mutate({ incidentId: id })}
            onCompleteStep={(stepId) => updateStep.mutate({ incidentId: id, stepId, input: { status: 'completed' } })}
            onSkipStep={(stepId, reason) => updateStep.mutate({ incidentId: id, stepId, input: { status: 'skipped', output: reason } })}
            onTriggerValidation={() => triggerValidation.mutate(id)}
            onRediagnose={() => rediagnose.mutate({ incidentId: id })}
            onConfirmResolution={() => confirmResolution.mutate({ incidentId: id })}
            onAddStep={(title) =>
              addStep.mutate(
                { incidentId: id, input: { title, type: 'manual' } },
                { onError: () => toast.error('Failed to add step') },
              )
            }
            onDeleteStep={(stepId) =>
              deleteStep.mutate(
                { incidentId: id, stepId },
                {
                  onSuccess: () => toast.success('Step removed'),
                  onError: () => toast.error('Failed to delete step'),
                },
              )
            }
            onSaveNote={(stepId, notes, onSuccess) =>
              updateStep.mutate(
                { incidentId: id, stepId, input: { notes } },
                {
                  onSuccess,
                  onError: () => toast.error('Failed to save note'),
                },
              )
            }
            pending={{
              creating: createResolution.isPending,
              updatingStepId: updateStep.isPending ? (updateStep.variables?.stepId ?? null) : null,
              savingNoteStepId: updateStep.isPending ? (updateStep.variables?.stepId ?? null) : null,
              deletingStepId: deleteStep.isPending ? (deleteStep.variables?.stepId ?? null) : null,
              validating: triggerValidation.isPending,
              rediagnosing: rediagnose.isPending,
              confirming: confirmResolution.isPending,
              addingStep: addStep.isPending,
            }}
            validationEntries={validationEntries}
          />
        );
      case 'comms':
        return (
          <StakeholderComms
            updates={mappedStakeholderUpdates}
            visibleAudiences={commsAudiences}
            onGenerate={(audience) => {
              createStakeholderUpdate.mutate(
                { incidentId: id, input: { audience: audience as CommsAudience } },
                {
                  onSuccess: () => toast.success('Draft generated'),
                  onError: () => toast.error('Failed to generate draft'),
                },
              );
            }}
            onSend={(updateId) => {
              sendStakeholderUpdate.mutate(
                { incidentId: id, updateId },
                {
                  onSuccess: () => toast.success('Update sent'),
                  onError: () => toast.error('Failed to send update'),
                },
              );
            }}
          />
        );
      case 'learn':
        return (
          <LearnPanel
            recurrence={recurrenceData}
            toil={[]}
            showToil={false}
            alertQuality={alertQualityItems}
            showAlertQuality={true}
            incidentId={id}
          />
        );
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="bg-background overflow-hidden"
      style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: 'calc(100vh - 50px)' }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card px-4 pt-2 pb-0">
        <div className="flex items-center gap-3 pb-2">
          {/* Back + incident ID */}
          <button
            onClick={() => router.push(`/incidents/${id}`)}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs font-medium">Back</span>
          </button>

          <div className="h-5 w-px bg-border shrink-0" />

          <span className="text-sm font-mono font-bold text-muted-foreground shrink-0">
            INC-{String(incident.number).padStart(4, '0')}
          </span>
          <SeverityBadge severity={sevKey} />
          <StatusBadge status={incident.status} />

          {isActive && (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-error" />
            </span>
          )}

          <h1 className="text-sm font-semibold text-foreground truncate min-w-0 flex-1">
            {incident.title}
          </h1>

          {/* Metrics strip */}
          <div className="flex items-center gap-2 shrink-0">
            <MetricCard label="MTTA" value={formatSeconds(incident.metrics?.mtta_seconds)} icon={Clock} />
            <MetricCard label="MTTR" value={formatSeconds(incident.metrics?.mttr_seconds)} icon={Activity} />
            <MetricCard label="Commander" value={incident.commander?.name?.split(' ')[0] || '\u2014'} icon={Shield} />
            <MetricCard label="Responders" value={String(responderCount)} icon={Users} />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {incident.status === 'open' && (
              <Button
                size="sm"
                variant="info"
                disabled={acknowledge.isPending}
                onClick={() => {
                  acknowledge.mutate(id, {
                    onSuccess: () => toast.success('Incident acknowledged'),
                    onError: () => toast.error('Failed to acknowledge'),
                  });
                }}
              >
                {acknowledge.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
                Acknowledge
              </Button>
            )}
            {isActive && (
              <Button
                size="sm"
                variant="outline"
                disabled={escalate.isPending}
                onClick={() => {
                  escalate.mutate({ id, reason: 'Escalated from Command Center' }, {
                    onSuccess: () => toast.success('Incident escalated'),
                    onError: () => toast.error('Failed to escalate'),
                  });
                }}
              >
                {escalate.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                Escalate
              </Button>
            )}
            {isActive && (
              <Button
                size="sm"
                disabled={resolve.isPending}
                onClick={() => {
                  resolve.mutate({ id, message: 'Resolved from Command Center' }, {
                    onSuccess: () => toast.success('Incident resolved'),
                    onError: () => toast.error('Failed to resolve'),
                  });
                }}
              >
                {resolve.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                Resolve
              </Button>
            )}
          </div>
        </div>

        {/* MSP consumer tenant selector — shown only for msp_provider with linked consumers */}
        {persona === 'msp_provider' && providerConsumers.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border pt-1.5 pb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Consumer</span>
            <select
              value={selectedConsumerId ?? ''}
              onChange={(e) => setSelectedConsumerId(e.target.value || null)}
              className="text-[11px] font-medium rounded border border-border bg-background px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">All consumers</option>
              {providerConsumers.filter(Boolean).map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Persona switcher — compact strip, only shown when user has more than one persona */}
        {availablePersonas.length > 1 && (
          <div className="flex items-center gap-2 border-t border-border pt-1.5 pb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">View as</span>
            <div className="flex flex-wrap gap-1.5">
              {availablePersonas.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setActivePersona(p.key)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                    persona === p.key
                      ? 'border-brand bg-brand text-white'
                      : 'border-border text-muted-foreground hover:border-brand/50 hover:text-brand',
                  )}
                >
                  <p.icon className="h-3 w-3" />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ── MAIN ────────────────────────────────────────────────────────────── */}
      <div className="flex overflow-hidden">

        {/* ── CENTER COLUMN ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* TOP: Topology Map (full width of center) */}
          <div className="relative bg-card" style={{ flex: '1 1 0%', minHeight: '250px' }}>
            {topoNodes.length > 0 ? (
              <TopologyMap
                nodes={topoNodes}
                edges={topoEdges}
                hoverDepth={PERSONA_HOVER_DEPTH[persona] ?? 'summary'}
                interactive={TOPOLOGY_INTERACTIVE_PERSONAS.has(persona)}
                showMascot
                mascotMode="tips"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
                <Network className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-semibold text-muted-foreground">No service dependencies configured</p>
                <p className="text-xs text-muted-foreground/60 mt-1 mb-3">
                  Set up service topology to see the dependency map here.
                </p>
                <Link
                  href="/services/topology"
                  className="text-xs font-medium text-brand hover:text-brand/80 transition-colors"
                >
                  Go to Service Topology &rarr;
                </Link>
              </div>
            )}
          </div>

          {/* BOTTOM: Tabbed panel — tenant_admin gets a bespoke, no-tabs
              business-impact-first view instead (FRD §17.3/17.8) */}
          {persona === 'tenant_admin' ? (
            <div className="flex-1 overflow-y-auto bg-card p-4 border-t border-border">
              <OrgAdminView
                impact={businessImpactData}
                stakeholderUpdates={mappedStakeholderUpdates}
                resolutionProgress={{
                  stepsCompleted: resolvePlanData?.steps.filter((s: any) => s.status === 'completed').length ?? 0,
                  stepsTotal: resolvePlanData?.steps.length ?? 0,
                  confidence: resolvePlanData?.confidence ?? 'low',
                }}
              />
            </div>
          ) : (
            <div className="shrink-0 flex flex-col overflow-hidden border-t border-border" style={{ height: '40%', minHeight: '200px' }}>
              <div className="shrink-0 flex items-center border-b border-border bg-card px-2 gap-0.5">
                {visibleTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isSelected = effectiveTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors relative',
                        isSelected ? 'text-brand' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                      {isSelected && (
                        <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-t-full" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1 overflow-y-auto bg-card p-4">{renderTabContent(effectiveTab)}</div>
            </div>
          )}
        </div>

        {/* ── RIGHT SIDEBAR ──────────────────────────────────────────────── */}
        {detailsOpen ? (
          <aside className="w-[320px] shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
            {/* Collapse button — small icon at top right */}
            <div className="shrink-0 flex items-center justify-end px-2 py-1.5 border-b border-border">
              <button
                onClick={() => setDetailsOpen(false)}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Hide panel"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Original components — no wrapper changes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* MSP aggregate consumer impact table — visible when no specific consumer selected */}
              {persona === 'msp_provider' && !selectedConsumerId && consumerImpacts.length > 0 && (
                <MSPConsumerImpactTable
                  entries={consumerImpacts}
                  onSelectConsumer={(consumerId) => setSelectedConsumerId(consumerId)}
                />
              )}
              {(() => {
                const c = commandData?.compliance;
                if (!c || !c.regulatory_clock_active) return null;
                return (
                  <ComplianceBanner
                    regulation={c.regulation ?? 'Regulatory Compliance'}
                    deadline={new Date(c.deadline ?? '')}
                    timeRemaining={c.time_remaining ?? ''}
                    actions={c.required_actions ?? []}
                    canAct={!!commandData?._permissions?.can_manage_compliance}
                    onMarkAction={(actionKey) =>
                      markComplianceAction.mutate(
                        { incidentId: id, actionKey },
                        {
                          onSuccess: () => toast.success('Action marked as complete'),
                          onError: () => toast.error('Failed to update compliance action'),
                        },
                      )
                    }
                  />
                );
              })()}
              <ContextBrief brief={contextBriefData} level="full" />
              <ChangeCorrelation changes={changesData} />
              <BusinessImpact impact={businessImpactData} />
              <CorrelatedIncidents
                correlations={correlatedIncidentsData}
                canMerge={!!commandData?._permissions?.can_merge_correlations}
                onMerge={(correlationId) =>
                  mergeCorrelation.mutate(correlationId, {
                    onSuccess: () => toast.success('Incidents merged'),
                    onError: () => toast.error('Failed to merge incidents'),
                  })
                }
                onSeparate={(correlationId) =>
                  rejectCorrelation.mutate(correlationId, {
                    onSuccess: () => toast.success('Incidents kept separate'),
                    onError: () => toast.error('Failed to update correlation'),
                  })
                }
              />
              <EmergingRisks risks={mappedEmergingRisks} />
              <IncidentTimeline
                entries={mappedTimeline}
                canAddNotes
                onAddNote={(note) => addTimelineEntry.mutate({ id, message: note })}
              />
            </div>
          </aside>
        ) : (
          /* Collapsed — thin vertical tab */
          <button
            onClick={() => setDetailsOpen(true)}
            className="w-7 shrink-0 border-l border-border bg-card hover:bg-muted/50 flex items-center justify-center transition-colors"
            title="Show details panel"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}
