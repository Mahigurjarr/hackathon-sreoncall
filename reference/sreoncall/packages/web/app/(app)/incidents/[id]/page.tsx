'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MarkdownRenderer } from '@/components/ai/MarkdownRenderer';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Activity,
  ChevronDown,
  ChevronUp,
  Bot,
  Plus,
  UserPlus,
  Minus,
  TrendingUp,
  Clock,
  FileText,
  Siren,
  GitBranch,
  Sparkles,
  Search,
  BookOpen,
  Timer,
  Trash2,
  Radar,
  ExternalLink,
  MessageCircle,
  type LucideProps,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { AIAnalysisCard } from '@/components/ai/AIAnalysisCard';
import { CopilotPanel } from '@/components/ai/CopilotPanel';
import {
  useIncident,
  useIncidentTimeline,
  useAcknowledgeIncident,
  useResolveIncident,
  useCloseIncident,
  useChangeSeverity,
  useEscalateIncident,
  useAddResponder,
  useRemoveResponder,
  useAddTimelineEntry,
  useCreateIncidentPostmortem,
  useUpdateIncident,
  type TimelineEntryType,
  type Incident,
} from '@/lib/hooks/useIncidents';
import { useEscalationPolicies } from '@/lib/hooks/useEscalationPolicies';
import { useUsers } from '@/lib/hooks/useUsers';
import { useWebSocket } from '@/lib/hooks/useWebSocket';

// ─── Constants ────────────────────────────────────────────────────────────────

/* Severity badge colors — exact hex from design-system-final.svg */
const SEV_COLORS: Record<number, string> = {
  1: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  2: 'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]',
  3: 'bg-[#FEFCE8] text-[#A16207] border-[#FDE68A]',
  4: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
  5: 'bg-[#F1F5F9] text-[#94A3B8] border-[#E2E8F0]',
};

/* Incident status colors — exact hex from design spec */
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  acknowledged: 'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]',
  investigating: 'bg-[#FEFCE8] text-[#A16207] border-[#FDE68A]',
  monitoring: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
  resolved: 'bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]',
  closed: 'bg-[#F1F5F9] text-[#94A3B8] border-[#E2E8F0]',
};

const ROLE_BADGE: Record<string, string> = {
  commander:  'bg-red-50    text-red-700    border border-red-200    dark:bg-red-950/40    dark:text-red-400',
  comms_lead: 'bg-sky-50    text-sky-700    border border-sky-200    dark:bg-sky-950/40    dark:text-sky-400',
  ops_lead:   'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400',
  observer:   'bg-slate-50  text-slate-600  border border-slate-200  dark:bg-slate-950/40  dark:text-slate-400',
  responder:  'bg-muted text-muted-foreground border border-border',
};

function AbsTime({ ts }: { ts: string }) {
  return (
    <time title={new Date(ts).toLocaleString()} dateTime={ts} className="cursor-default">
      {formatDistanceToNow(new Date(ts), { addSuffix: true })}
    </time>
  );
}

function TimelineIcon({ type }: { type: string }) {
  const base = 'h-3.5 w-3.5 shrink-0 mt-0.5';
  const icons: Record<string, [React.FC<LucideProps>, string]> = {
    declaration:         [AlertTriangle,  cn(base, 'text-destructive')],
    acknowledgment:      [Eye,            cn(base, 'text-orange-500')],
    status_change:       [ArrowRight,     cn(base, 'text-blue-500')],
    severity_change:     [TrendingUp,     cn(base, 'text-amber-500')],
    role_assigned:       [UserPlus,       cn(base, 'text-purple-500')],
    alert:               [Activity,       cn(base, 'text-destructive')],
    ai_insight:          [Sparkles,       cn(base, 'text-violet-500')],
    runbook_started:     [BookOpen,       cn(base, 'text-blue-500')],
    runbook_step:        [CheckCircle2,   cn(base, 'text-green-500')],
    note:                [FileText,       cn(base, 'text-muted-foreground')],
    escalation:          [Siren,          cn(base, 'text-destructive')],
    provider_escalation: [Radar,          cn(base, 'text-destructive')],
    resolution:          [CheckCircle2,   cn(base, 'text-green-500')],
    comms_sent:          [MessageCircle,  cn(base, 'text-sky-500')],
    bridge_sync:         [GitBranch,      cn(base, 'text-muted-foreground')],
    system:              [Bot,            cn(base, 'text-muted-foreground')],
  };
  const [Icon, cls] = icons[type] ?? [Clock, cn(base, 'text-muted-foreground')];
  return <Icon className={cls} />;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/* AIResultCard removed — using imported AIAnalysisCard component */

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatSeconds(s: number | null) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${sec}s`;
}

/** Keys (case-insensitive) from alert labels that identify the firing resource. */
const RESOURCE_LABEL_KEYS = [
  'instance', 'host', 'hostname', 'node', 'nodename',
  'pod', 'pod_name', 'container', 'container_name',
  'device', 'mountpoint', 'filesystem', 'fstype',
  'namespace', 'cluster',
];

/** Parse `key:value` label strings into a resource dict (preserves label order). */
function parseResourceLabels(labels: string[]): Array<{ key: string; value: string }> {
  const resourceKeys = new Set(RESOURCE_LABEL_KEYS);
  const out: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const idx = raw.indexOf(':');
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    const keyLower = key.toLowerCase();
    if (!value || seen.has(keyLower) || !resourceKeys.has(keyLower)) continue;
    seen.add(keyLower);
    out.push({ key, value });
  }
  return out;
}

/** Labels that aren't resource identifiers — shown as the generic chip row. */
function filterNonResourceLabels(labels: string[]): string[] {
  const resourceKeys = new Set(RESOURCE_LABEL_KEYS);
  return labels.filter((raw) => {
    const idx = raw.indexOf(':');
    if (idx < 0) return true;
    return !resourceKeys.has(raw.slice(0, idx).trim().toLowerCase());
  });
}

// ─── Observability Tab ───────────────────────────────────────────────────────

function IncidentObservabilityTab({ incident }: { incident: Incident }) {
  const [logQuery, setLogQuery] = useState('');
  const [logResults, setLogResults] = useState<string[]>([]);
  const [metricsData, setMetricsData] = useState<Record<string, string>>({});
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const hasNoServices = !incident.affected_services?.length;
  const serviceNames = incident.affected_services?.map((s) => s.name) || [];
  const resources = parseResourceLabels(incident.labels);
  const resourceMap = Object.fromEntries(resources.map((r) => [r.key.toLowerCase(), r.value]));
  const instance = resourceMap.instance || resourceMap.host || resourceMap.hostname || resourceMap.node || resourceMap.nodename || '';
  const pod = resourceMap.pod || resourceMap.pod_name || '';

  async function fetchObservability() {
    if (loading) return;
    setLoading(true);
    setLogError(null);
    setMetricsError(null);
    try {
      // Build LogQL filter: prefer service_name, then instance/host, then pod — fall back to any error logs.
      // Loki stream selectors can't be OR'd, so we try one preferred label per case.
      const escapeRe = (s: string) => s.replace(/[.+*?^$()|[\]\\]/g, '\\$&');
      let logQ: string;
      if (serviceNames.length > 0) {
        logQ = `{service_name=~"${serviceNames.join('|')}"} |~ "(?i)error|exception|fail"`;
      } else if (instance) {
        logQ = `{instance=~"${escapeRe(instance)}"}`;
      } else if (pod) {
        logQ = `{pod="${pod}"}`;
      } else {
        logQ = '{level=~"error|ERROR"}';
      }
      setLogQuery(logQ);

      // Loki query_range expects start/end in nanoseconds since epoch.
      const createdMs = new Date(incident.created_at).getTime();
      const startNs = String((createdMs - 5 * 60_000) * 1e6);
      const endNs = String((createdMs + 30 * 60_000) * 1e6);

      try {
        const logResp = await api.get<any>('/api/v1/observability/logs/query_range', {
          query: logQ,
          limit: 30,
          start: startNs,
          end: endNs,
        });
        const lines: string[] = [];
        for (const stream of logResp?.data?.result || []) {
          for (const [ts, line] of stream.values || []) {
            lines.push(`[${new Date(parseInt(ts) / 1e6).toLocaleTimeString()}] ${String(line).slice(0, 300)}`);
          }
        }
        setLogResults(lines);
      } catch (err: any) {
        setLogError(err?.message || 'Failed to fetch logs');
        setLogResults([]);
      }

      // Fetch key metrics — narrow to the firing instance when known.
      const metrics: Record<string, string> = {};
      let metricsFailed = 0;
      const instanceSelector = instance
        ? `{instance=~"${instance.replace(/[.+*?^$()|[\]\\]/g, '\\$&')}"}`
        : '';
      const queries = [
        { label: 'Error Rate (5xx)', q: 'sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))' },
        { label: 'Request Rate', q: 'sum(rate(http_server_request_duration_seconds_count[5m]))' },
        { label: 'P99 Latency', q: 'histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le))' },
        { label: 'CPU %', q: `avg(rate(node_cpu_seconds_total${instanceSelector ? instanceSelector.replace('{', '{mode!="idle",').replace('}', '}') : '{mode!="idle"}'}[5m])) * 100` },
        { label: 'Memory %', q: `(1 - avg(node_memory_MemAvailable_bytes${instanceSelector}) / avg(node_memory_MemTotal_bytes${instanceSelector})) * 100` },
        { label: 'Disk Used %', q: `(1 - avg(node_filesystem_avail_bytes${instanceSelector}) / avg(node_filesystem_size_bytes${instanceSelector})) * 100` },
      ];
      for (const mq of queries) {
        try {
          const r = await api.get<any>('/api/v1/observability/metrics/query', { query: mq.q });
          const val = r?.data?.result?.[0]?.value?.[1];
          if (val != null && isFinite(parseFloat(val))) metrics[mq.label] = parseFloat(val).toFixed(2);
        } catch { metricsFailed++; }
      }
      if (metricsFailed === queries.length) {
        setMetricsError('Prometheus is unreachable or not configured');
      }
      setMetricsData(metrics);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch when the tab mounts for the first time
  useEffect(() => {
    fetchObservability();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* No-services notice — shown alongside results so the user knows why queries are broad */}
      {loaded && hasNoServices && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            No affected services are linked to this incident — queries use a generic fallback filter.
            <a href="#" onClick={(e) => { e.preventDefault(); }} className="ml-1 underline underline-offset-2">Add a service</a> to get targeted logs and metrics.
          </span>
        </div>
      )}

      {!loaded && loading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Loading observability data…</span>
          </CardContent>
        </Card>
      )}

      {loaded && (
        <>
          {/* Metrics */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">System Metrics</CardTitle>
                <button onClick={fetchObservability} disabled={loading} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {metricsError ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  {metricsError}
                </div>
              ) : Object.keys(metricsData).length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {Object.entries(metricsData).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{k}</p>
                      <p className="text-lg font-bold font-mono text-foreground">{v}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No metrics returned — Prometheus may have no data for this time window.</p>
              )}
            </CardContent>
          </Card>

          {/* Logs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Related Logs</CardTitle>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{logQuery}</p>
            </CardHeader>
            <CardContent>
              {logResults.length > 0 ? (
                <pre className="max-h-[400px] overflow-y-auto rounded-lg bg-muted p-4 font-mono text-xs text-foreground leading-relaxed">
                  {logResults.join('\n')}
                </pre>
              ) : logError ? (
                <div className="flex items-center gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-destructive">Loki unreachable: {logError}</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No matching logs in the ±30-minute window around this incident.
                  {hasNoServices && ' Link an affected service to narrow the search.'}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardHeader><CardTitle className="text-base">Explore Further</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <a href="/observability/logs" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                  Log Explorer
                </a>
                <a href="/observability/metrics" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                  Metrics Explorer
                </a>
                <a href="/observability/traces" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                  Trace Explorer
                </a>
                {incident.affected_services?.map((svc) => (
                  <a key={svc.id} href={`/services/${svc.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
                    {svc.name}
                  </a>
                ))}
                {incident.affected_services
                  ?.filter((svc) => svc.cloud_metadata?.provider === 'supabase' && svc.cloud_metadata?.cloud_id)
                  .map((svc) => {
                    const startMs = new Date(incident.created_at).getTime() - 5 * 60_000;
                    const endMs = (incident.resolved_at ? new Date(incident.resolved_at).getTime() : Date.now()) + 5 * 60_000;
                    const href = `https://supabase.com/dashboard/project/${svc.cloud_metadata!.cloud_id}/logs/explorer?its=${startMs}&ite=${endMs}`;
                    return (
                      <a
                        key={`supabase-${svc.id}`}
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open {svc.name} in Supabase
                      </a>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: incident, isLoading, error } = useIncident(id);
  const { data: timeline = [] } = useIncidentTimeline(id);

  const acknowledge = useAcknowledgeIncident();
  const resolve = useResolveIncident();
  const close = useCloseIncident();
  const changeSeverity = useChangeSeverity();
  const escalate = useEscalateIncident();
  const addResponder = useAddResponder();
  const removeResponder = useRemoveResponder();
  const addTimelineEntry = useAddTimelineEntry();
  const createPostmortem = useCreateIncidentPostmortem();
  const updateIncident = useUpdateIncident();
  const { data: orgUsers = [] } = useUsers();

  // UI state
  const [activeTab, setActiveTab] = useState<'overview' | 'observability' | 'timeline' | 'responders' | 'time_log'>('overview');
  const [showSeverityDialog, setShowSeverityDialog] = useState(false);
  const [newSeverity, setNewSeverity] = useState('');
  const [severityReason, setSeverityReason] = useState('');
  const [showEscalateDialog, setShowEscalateDialog] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');
  const [escalatePolicyId, setEscalatePolicyId] = useState('');
  const { data: epData } = useEscalationPolicies({ status: 'active' });
  const escalationPolicies = epData ?? [];
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [resolveMessage, setResolveMessage] = useState('');
  const [showResponderDialog, setShowResponderDialog] = useState(false);
  const [responderUserId, setResponderUserId] = useState('');
  const [responderRole, setResponderRole] = useState('responder');
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [roleField, setRoleField] = useState<'commander_id' | 'comms_lead_id' | 'operations_lead_id'>('commander_id');
  const [roleUserId, setRoleUserId] = useState('');
  const [noteText, setNoteText] = useState('');

  // Compute most recent escalation event from timeline
  const escalationEvents = (timeline as any[]).filter((e) => e.type === 'escalation' || e.type === 'provider_escalation');
  const lastEscalation = escalationEvents.length > 0 ? escalationEvents[escalationEvents.length - 1] : null;
  const escalationCount = escalationEvents.length;
  // Disable re-escalation for 5 minutes after the last one to prevent duplicates
  const ESCALATION_COOLDOWN_MS = 5 * 60 * 1000;
  const escalationCooldownActive = lastEscalation
    ? (Date.now() - new Date(lastEscalation.timestamp).getTime()) < ESCALATION_COOLDOWN_MS
    : false;

  // AI state
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageResult, setTriageResult] = useState<string | null>(null);
  const [triageGeneratedAt, setTriageGeneratedAt] = useState<string | null>(null);
  const [rcaLoading, setRcaLoading] = useState(false);
  const [rcaResult, setRcaResult] = useState<string | null>(null);
  const [rcaGeneratedAt, setRcaGeneratedAt] = useState<string | null>(null);
  const [postmortemLoading, setPostmortemLoading] = useState(false);
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  // Live duration clock (updates every minute while incident is open)
  const [liveDuration, setLiveDuration] = useState('');
  useEffect(() => {
    if (!incident) return;
    const isActive = !['resolved', 'closed'].includes(incident.status);
    if (!isActive) { setLiveDuration(''); return; }
    function tick() {
      const ms = Date.now() - new Date(incident!.created_at).getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLiveDuration(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [incident?.created_at, incident?.status]);

  // Pre-populate AI results from stored analysis on mount
  useEffect(() => {
    if (!id) return;
    api.get<{ root_cause: string | null; last_analyzed_at: string | null }>(
      `/api/v1/incidents/${id}/ai/analysis`
    ).then((res) => {
      if (res.root_cause && !rcaResult) {
        setRcaResult(res.root_cause);
        setRcaGeneratedAt(res.last_analyzed_at ?? null);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // WebSocket: invalidate queries on real-time incident events
  useWebSocket();

  // Time Log state
  const [workLogs, setWorkLogs] = useState<any[]>([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showAddTime, setShowAddTime] = useState(false);
  const [timeHours, setTimeHours] = useState('');
  const [timeMinutes, setTimeMinutes] = useState('');
  const [timeDescription, setTimeDescription] = useState('');
  const [submittingTime, setSubmittingTime] = useState(false);

  // ── Work Log Handlers ──────────────────────────────────────────────────

  async function fetchWorkLogs() {
    setLoadingLogs(true);
    try {
      const res = await api.get<{ data: any[]; total_minutes: number }>(`/api/v1/incidents/${id}/work-logs`);
      setWorkLogs(res.data);
      setTotalMinutes(res.total_minutes);
    } catch {} finally { setLoadingLogs(false); }
  }

  async function handleAddTime() {
    const mins = (parseInt(timeHours || '0') * 60) + parseInt(timeMinutes || '0');
    if (mins < 1) { toast.error('Duration must be at least 1 minute'); return; }
    setSubmittingTime(true);
    try {
      await api.post(`/api/v1/incidents/${id}/work-logs`, {
        duration_minutes: mins,
        description: timeDescription.trim(),
      });
      toast.success('Time logged');
      setTimeHours(''); setTimeMinutes(''); setTimeDescription(''); setShowAddTime(false);
      fetchWorkLogs();
    } catch { toast.error('Failed to log time'); } finally { setSubmittingTime(false); }
  }

  async function handleDeleteLog(logId: string) {
    try {
      await api.delete(`/api/v1/incidents/${id}/work-logs/${logId}`);
      toast.success('Work log removed');
      fetchWorkLogs();
    } catch { toast.error('Failed to remove work log'); }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleAcknowledge() {
    try {
      await acknowledge.mutateAsync(id);
      toast.success('Incident acknowledged');
    } catch {
      toast.error('Failed to acknowledge incident');
    }
  }

  async function handleSeverityChange(e: React.FormEvent) {
    e.preventDefault();
    try {
      await changeSeverity.mutateAsync({ id, severity: Number(newSeverity), reason: severityReason });
      toast.success('Severity updated');
      setShowSeverityDialog(false);
      setSeverityReason('');
    } catch {
      toast.error('Failed to change severity');
    }
  }

  async function handleEscalate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await escalate.mutateAsync({
        id,
        reason: escalateReason,
        escalation_policy_id: escalatePolicyId || undefined,
      });
      toast.success('Incident escalated');
      setShowEscalateDialog(false);
      setEscalateReason('');
      setEscalatePolicyId('');
    } catch {
      toast.error('Failed to escalate incident');
    }
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    try {
      await resolve.mutateAsync({ id, message: resolveMessage });
      toast.success('Incident resolved');
      setShowResolveDialog(false);
      setResolveMessage('');
    } catch {
      toast.error('Failed to resolve incident');
    }
  }

  async function handleClose() {
    try {
      await close.mutateAsync(id);
      toast.success('Incident closed');
    } catch {
      toast.error('Failed to close incident');
    }
  }

  async function handleAddResponder(e: React.FormEvent) {
    e.preventDefault();
    if (!responderUserId.trim()) return;
    try {
      await addResponder.mutateAsync({ id, user_id: responderUserId.trim(), role: responderRole });
      toast.success('Responder added');
      setShowResponderDialog(false);
      setResponderUserId('');
      setResponderRole('responder');
    } catch {
      toast.error('Failed to add responder');
    }
  }

  async function handleRemoveResponder(userId: string) {
    try {
      await removeResponder.mutateAsync({ id, userId });
      toast.success('Responder removed');
    } catch {
      toast.error('Failed to remove responder');
    }
  }

  async function handleAssignRole(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateIncident.mutateAsync({ id, input: { [roleField]: roleUserId.trim() || null } });
      toast.success('Role assigned');
      setShowRoleDialog(false);
      setRoleUserId('');
    } catch {
      toast.error('Failed to assign role');
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    try {
      await addTimelineEntry.mutateAsync({ id, message: noteText.trim(), type: 'note' as TimelineEntryType });
      toast.success('Note added');
      setNoteText('');
    } catch {
      toast.error('Failed to add note');
    }
  }

  async function handleCreatePostmortem() {
    try {
      const { postmortem_id } = await createPostmortem.mutateAsync(id);
      toast.success('Post-mortem created');
      router.push(`/postmortems/${postmortem_id}`);
    } catch {
      toast.error('Failed to create post-mortem');
    }
  }

  async function handleTriage() {
    setTriageLoading(true);
    try {
      const res = await api.post<{ result?: string; summary?: string; analysis?: string; triage?: string; generated_at?: string }>(`/api/v1/ai/triage/incident/${id}`);
      setTriageResult(res.result ?? res.summary ?? res.analysis ?? res.triage ?? JSON.stringify(res, null, 2));
      setTriageGeneratedAt(res.generated_at ?? new Date().toISOString());
    } catch {
      toast.error('Auto-triage failed');
    } finally {
      setTriageLoading(false);
    }
  }

  async function handleRCA() {
    setRcaLoading(true);
    try {
      const res = await api.post<{ result?: string; rca?: string; analysis?: string; generated_at?: string }>(`/api/v1/ai/rca/incident/${id}`);
      setRcaResult(res.result ?? res.rca ?? res.analysis ?? JSON.stringify(res, null, 2));
      setRcaGeneratedAt(res.generated_at ?? new Date().toISOString());
    } catch {
      toast.error('Generate RCA failed');
    } finally {
      setRcaLoading(false);
    }
  }

  async function handleDraftPostmortem() {
    setPostmortemLoading(true);
    try {
      await api.post(`/api/v1/ai/postmortem/draft/${id}`);
      toast.success('Post-mortem draft created');
      router.push('/postmortems');
    } catch {
      toast.error('Failed to draft post-mortem');
    } finally {
      setPostmortemLoading(false);
    }
  }

  async function handleGenerateRunbook() {
    setRunbookLoading(true);
    try {
      const result = await api.post<{ runbook_id: string; step_count?: number; ai_generated?: boolean }>(
        `/api/v1/ai/runbooks/generate-from-incident/${id}`,
      );
      toast.success(
        `Runbook generated (${result.step_count ?? 0} steps) — opening…`,
        {
          action: {
            label: 'Open',
            onClick: () => router.push(`/runbooks/${result.runbook_id}`),
          },
        },
      );
      // Auto-navigate so the user sees the detailed report immediately
      router.push(`/runbooks/${result.runbook_id}`);
    } catch {
      toast.error('Failed to generate runbook');
    } finally {
      setRunbookLoading(false);
    }
  }

  // ── Loading / Error states ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Incident not found.</p>
        <Button variant="outline" onClick={() => router.push('/incidents')}>
          Back to Incidents
        </Button>
      </div>
    );
  }

  const isOpen = incident.status === 'open';
  const canResolve = ['open', 'acknowledged', 'investigating', 'monitoring'].includes(incident.status);
  const canClose = incident.status === 'resolved';
  const isClosed = incident.status === 'closed';

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => router.push('/incidents')}>
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Incidents
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              INC-{String(incident.number).padStart(4, '0')}
            </span>
            <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', SEV_COLORS[incident.severity])}>
              {incident.severity_label}
            </span>
            <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize', STATUS_COLORS[incident.status])}>
              {incident.status.replace(/_/g, ' ')}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{incident.title}</h1>
          {incident.affected_services?.length > 0 && (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>Resource:</span>
              {incident.affected_services.map((svc) => (
                <span key={svc.id} className="font-medium text-foreground">{svc.name}</span>
              ))}
            </div>
          )}
          {incident.source === 'alert' && incident.source_alert && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 text-[#DC2626]" />
              <span>Alert: <span className="font-medium text-foreground/80">{incident.source_alert.name}</span></span>
            </div>
          )}
          {(() => {
            const resources = parseResourceLabels(incident.labels);
            if (resources.length === 0) return null;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {resources.map(({ key, value }) => (
                  <span key={`${key}:${value}`} className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                    <span className="font-mono font-semibold text-foreground">{value}</span>
                  </span>
                ))}
              </div>
            );
          })()}
          {(() => {
            const otherLabels = filterNonResourceLabels(incident.labels);
            if (otherLabels.length === 0) return null;
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                {otherLabels.map((l) => (
                  <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{l}</span>
                ))}
              </div>
            );
          })()}

          {/* Live duration clock */}
          {liveDuration && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
              <Clock className="h-3 w-3 animate-pulse" />
              Open for {liveDuration}
            </div>
          )}

          {/* Escalation policy */}
          {incident.escalation_policy_id && (() => {
            const policy = escalationPolicies.find(p => p._id === incident.escalation_policy_id);
            if (!policy) return null;
            return (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Siren className="h-3 w-3" />
                <span>Policy: <span className="font-medium text-foreground/80">{policy.name}</span>
                  <span className="ml-1 text-muted-foreground">· {policy.steps.length} step{policy.steps.length !== 1 ? 's' : ''}</span>
                </span>
              </div>
            );
          })()}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" className="bg-[#FF6B2B] hover:bg-[#e55e24] text-white" onClick={() => router.push(`/command-center/${incident.id}`)}>
            <Radar className="mr-1.5 h-4 w-4" />
            Command Center
          </Button>
          {isOpen && (
            <Button variant="outline" size="sm" onClick={handleAcknowledge} disabled={acknowledge.isPending}>
              {acknowledge.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
              Acknowledge
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setNewSeverity(String(incident.severity)); setShowSeverityDialog(true); }} disabled={isClosed}>
            <TrendingUp className="mr-1.5 h-4 w-4" />
            Severity
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEscalateDialog(true)}
            disabled={isClosed || escalationCooldownActive}
            title={escalationCooldownActive ? `Escalation cooldown active. Wait before escalating again.` : undefined}
          >
            <GitBranch className="mr-1.5 h-4 w-4" />
            {escalationCount > 0 ? `Escalated (${escalationCount})` : 'Escalate'}
          </Button>
          {canResolve && (
            <Button size="sm" onClick={() => setShowResolveDialog(true)} disabled={resolve.isPending}>
              {resolve.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Resolve
            </Button>
          )}
          {canClose && (
            <Button variant="outline" size="sm" onClick={handleClose} disabled={close.isPending}>
              {close.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Last escalation banner */}
      {lastEscalation && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 flex items-center gap-3">
          <GitBranch className="h-4 w-4 text-warning shrink-0" />
          <div className="flex-1 min-w-0 text-xs">
            <span className="font-semibold text-foreground">Escalated</span>
            <span className="text-muted-foreground ml-1.5">
              {lastEscalation.message}
              {' \u00B7 '}
              {new Date(lastEscalation.timestamp).toLocaleString()}
            </span>
          </div>
          {escalationCooldownActive && (
            <span className="text-[10px] font-medium text-warning shrink-0">
              Cooldown {Math.ceil((ESCALATION_COOLDOWN_MS - (Date.now() - new Date(lastEscalation.timestamp).getTime())) / 60000)}m left
            </span>
          )}
        </div>
      )}

      {/* Metrics strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="MTTA" value={formatSeconds(incident.metrics.mtta_seconds)} />
        <MetricCard label="MTTR" value={formatSeconds(incident.metrics.mttr_seconds)} />
        <MetricCard label="Commander" value={incident.commander?.name ?? 'Unassigned'} />
        <MetricCard label="Responders" value={String(incident.responders.filter(r => !r.left_at).length)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['overview', 'observability', 'timeline', 'responders', 'time_log'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); if (tab === 'time_log') fetchWorkLogs(); }}
            className={cn(
              'px-4 py-2 text-sm font-medium capitalize transition-colors',
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab === 'time_log' ? 'Time Log' : tab}
            {tab === 'timeline' && ` (${timeline.length})`}
            {tab === 'responders' && ` (${incident.responders.filter(r => !r.left_at).length})`}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: description */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Description</CardTitle>
              </CardHeader>
              <CardContent>
                {incident.description ? (
                  <MarkdownRenderer content={incident.description} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">No description provided.</p>
                )}
              </CardContent>
            </Card>

            {/* Affected Resources & Source Alert */}
            {(incident.affected_services?.length > 0 || incident.source_alert || incident.source_synthetic_check || incident.resource_labels?.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Affected Resources</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {incident.affected_services?.length > 0 && (
                    <div className="space-y-2">
                      {incident.affected_services.map((svc) => (
                        <div key={svc.id} className="flex items-center gap-2">
                          <span className={cn(
                            'h-2 w-2 rounded-full',
                            svc.current_status === 'operational' ? 'bg-[#16A34A]' :
                            svc.current_status === 'degraded' ? 'bg-[#A16207]' : 'bg-[#DC2626]',
                          )} />
                          <span className="text-sm font-medium text-foreground">{svc.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{svc.type}</span>
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                            svc.current_status === 'operational' ? 'bg-[#16A34A]/10 text-[#16A34A]' :
                            svc.current_status === 'degraded' ? 'bg-[#A16207]/10 text-[#A16207]' :
                            'bg-[#DC2626]/10 text-[#DC2626]',
                          )}>
                            {svc.current_status?.replace(/_/g, ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {incident.source_alert && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-[#DC2626]" />
                        <span className="text-xs font-medium text-foreground">Triggered by alert:</span>
                        <span className="text-xs font-semibold text-foreground">{incident.source_alert.name}</span>
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
                          incident.source_alert.alert_state === 'firing' ? 'bg-[#DC2626]/10 text-[#DC2626]' : 'bg-[#16A34A]/10 text-[#16A34A]',
                        )}>
                          {incident.source_alert.alert_state}
                        </span>
                      </div>
                      {incident.source_alert.last_firing_labels && Object.keys(incident.source_alert.last_firing_labels).length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-5">
                          {Object.entries(incident.source_alert.last_firing_labels).map(([k, v]) => (
                            <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                              <span className="text-muted-foreground">{k}=</span>{v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {incident.source_synthetic_check && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-[#DC2626]" />
                        <span className="text-xs font-medium text-foreground">Triggered by synthetic check:</span>
                        <span className="text-xs font-semibold text-foreground">{incident.source_synthetic_check.name}</span>
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
                          incident.source_synthetic_check.last_status === 'up' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-[#DC2626]/10 text-[#DC2626]',
                        )}>
                          {incident.source_synthetic_check.last_status ?? 'down'}
                        </span>
                      </div>
                      {(incident.source_synthetic_check.url || incident.source_synthetic_check.host) && (
                        <div className="flex items-center gap-1.5 pl-5">
                          <span className="text-[10px] text-muted-foreground">Target:</span>
                          <span className="text-[10px] font-semibold text-foreground/80 font-mono">
                            {incident.source_synthetic_check.url || incident.source_synthetic_check.host}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {incident.resource_labels?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {incident.resource_labels.map(({ key, value }) => (
                        <span key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                          <span className="text-muted-foreground">{key}=</span>{value}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Post-mortem */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4" />
                    Post-Mortem
                  </CardTitle>
                  {!incident.postmortem_id && (
                    <Button size="sm" variant="outline" onClick={handleCreatePostmortem} disabled={createPostmortem.isPending}>
                      {createPostmortem.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                      Create
                    </Button>
                  )}
                  {incident.postmortem_id && (
                    <Button size="sm" variant="outline" onClick={() => router.push(`/postmortems/${incident.postmortem_id}`)}>
                      View Post-Mortem
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {incident.postmortem_id ? (
                  <p className="text-sm text-muted-foreground">Post-mortem linked. Click "View Post-Mortem" to open.</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No post-mortem yet. Create one to document the incident.</p>
                )}
              </CardContent>
            </Card>

            {/* Linked Tickets */}
            {(incident.linked_tickets?.length ?? 0) > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitBranch className="h-4 w-4" />
                    Linked Tickets
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {incident.linked_tickets!.map((t) => (
                    <a
                      key={t.id}
                      href={`/tickets/${t.id}`}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          #{t.number}
                        </span>
                        <span className="truncate text-sm text-foreground">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2 shrink-0">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                          {t.status.replace(/_/g, ' ')}
                        </span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                          t.priority === 'high'   ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' :
                          t.priority === 'medium' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' :
                                                    'bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-400'
                        )}>
                          {t.priority}
                        </span>
                      </div>
                    </a>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* AI Copilot */}
            <Card className="border-[#7C3AED]/20">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-[#7C3AED]" />
                    AI Copilot
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setCopilotOpen(true)}
                    className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Open Copilot
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start border-[#7C3AED]/20 hover:border-[#7C3AED] hover:bg-[#F5F3FF]"
                    onClick={handleTriage}
                    disabled={triageLoading}
                  >
                    {triageLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#7C3AED]" /> : <Search className="mr-2 h-4 w-4 text-[#7C3AED]" />}
                    Auto-Triage
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start border-[#7C3AED]/20 hover:border-[#7C3AED] hover:bg-[#F5F3FF]"
                    onClick={handleRCA}
                    disabled={rcaLoading}
                  >
                    {rcaLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#7C3AED]" /> : <Activity className="mr-2 h-4 w-4 text-[#7C3AED]" />}
                    Generate RCA
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start border-[#7C3AED]/20 hover:border-[#7C3AED] hover:bg-[#F5F3FF]"
                    onClick={handleDraftPostmortem}
                    disabled={postmortemLoading}
                  >
                    {postmortemLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#7C3AED]" /> : <FileText className="mr-2 h-4 w-4 text-[#7C3AED]" />}
                    Draft Post-mortem
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start border-[#7C3AED]/20 hover:border-[#7C3AED] hover:bg-[#F5F3FF]"
                    onClick={handleGenerateRunbook}
                    disabled={runbookLoading}
                  >
                    {runbookLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#7C3AED]" /> : <BookOpen className="mr-2 h-4 w-4 text-[#7C3AED]" />}
                    Generate Runbook
                  </Button>
                </div>

                {/* AI Analysis Results */}
                {(triageLoading || triageResult) && (
                  <AIAnalysisCard
                    title="Auto-Triage Analysis"
                    content={triageResult || ''}
                    loading={triageLoading}
                    generatedAt={triageGeneratedAt ?? undefined}
                  />
                )}
                {(rcaLoading || rcaResult) && (
                  <AIAnalysisCard
                    title="Root Cause Analysis"
                    content={rcaResult || ''}
                    loading={rcaLoading}
                    generatedAt={rcaGeneratedAt ?? undefined}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: details */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {/* Roles */}
                {[
                  { label: 'Commander', field: 'commander_id' as const, user: incident.commander },
                  { label: 'Comms Lead', field: 'comms_lead_id' as const, user: incident.comms_lead },
                  { label: 'Ops Lead', field: 'operations_lead_id' as const, user: incident.operations_lead },
                ].map(({ label, field, user }) => (
                  <div key={field}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-muted-foreground">{label}</span>
                      {!isClosed && (
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => { setRoleField(field); setRoleUserId(user?.id ?? ''); setShowRoleDialog(true); }}
                        >
                          {user ? 'Change' : 'Assign'}
                        </button>
                      )}
                    </div>
                    {user ? (
                      <div className="mt-1 flex items-center gap-2">
                        <UserAvatar name={user.name ?? '?'} size="sm" />
                        <span className="text-foreground">{user.name}</span>
                      </div>
                    ) : (
                      <p className="mt-1 text-muted-foreground">Unassigned</p>
                    )}
                  </div>
                ))}

                <div>
                  <span className="font-medium text-muted-foreground">Created by</span>
                  <div className="mt-1 flex items-center gap-2">
                    {incident.created_by ? (
                      <>
                        <UserAvatar name={incident.created_by.name ?? '?'} size="sm" />
                        <span className="text-foreground">{incident.created_by.name}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Unknown</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="font-medium text-muted-foreground">Created</span>
                  <p className="mt-1 text-foreground"><AbsTime ts={incident.created_at} /></p>
                </div>

                {incident.metrics.ack_at && (
                  <div>
                    <span className="font-medium text-muted-foreground">Acknowledged</span>
                    <p className="mt-1 text-foreground"><AbsTime ts={incident.metrics.ack_at} /></p>
                  </div>
                )}

                {incident.metrics.resolved_at && (
                  <div>
                    <span className="font-medium text-muted-foreground">Resolved</span>
                    <p className="mt-1 text-foreground"><AbsTime ts={incident.metrics.resolved_at} /></p>
                  </div>
                )}

                <div>
                  <span className="font-medium text-muted-foreground">Source</span>
                  <p className="mt-1 capitalize text-foreground">{incident.source}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Observability Tab ────────────────────────────────────────────── */}
      {activeTab === 'observability' && (
        <IncidentObservabilityTab incident={incident} />
      )}

      {/* ── Timeline Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="space-y-6">
          {/* Add note */}
          <Card>
            <CardContent className="pt-4">
              <form onSubmit={handleAddNote} className="flex gap-2 items-start">
                <textarea
                  placeholder="Add a timeline note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={2}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (noteText.trim()) handleAddNote(e as any);
                    }
                  }}
                />
                <Button type="submit" size="sm" disabled={addTimelineEntry.isPending || !noteText.trim()}>
                  {addTimelineEntry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Timeline list */}
          {timeline.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Clock className="mr-2 h-4 w-4" />
              No timeline entries yet.
            </div>
          ) : (
            <div className="space-y-1">
              {[...timeline].reverse().map((entry) => (
                <div key={entry.id} className="flex gap-3 rounded-lg border border-border bg-card p-3">
                  <TimelineIcon type={entry.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{entry.message}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{entry.type.replace(/_/g, ' ')}</span>
                      {entry.actor?.name && (
                        <>
                          <span>·</span>
                          <span>{entry.actor.name}</span>
                        </>
                      )}
                      <span>·</span>
                      <AbsTime ts={entry.timestamp} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Responders Tab ────────────────────────────────────────────────── */}
      {activeTab === 'responders' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            {!isClosed && (
              <Button size="sm" onClick={() => setShowResponderDialog(true)}>
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add Responder
              </Button>
            )}
          </div>

          {incident.responders.filter(r => !r.left_at).length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Siren className="mr-2 h-4 w-4" />
              No active responders.
            </div>
          ) : (
            <div className="space-y-2">
              {incident.responders
                .filter(r => !r.left_at)
                .map((r) => (
                  <div key={r.user.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={r.user.name ?? '?'} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.user.name ?? r.user.email}</p>
                        <span className={cn(
                          'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                          ROLE_BADGE[r.role] ?? ROLE_BADGE.responder
                        )}>
                          {r.role.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        Joined <AbsTime ts={r.joined_at} />
                      </span>
                      {!isClosed && (
                        <button
                          onClick={() => handleRemoveResponder(r.user.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Past responders */}
          {incident.responders.filter(r => r.left_at).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Past Responders</p>
              <div className="space-y-2">
                {incident.responders
                  .filter(r => r.left_at)
                  .map((r) => (
                    <div key={`${r.user.id}-left`} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-4 py-3 opacity-60">
                      <UserAvatar name={r.user.name ?? '?'} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.user.name ?? r.user.email}</p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                            ROLE_BADGE[r.role] ?? ROLE_BADGE.responder
                          )}>
                            {r.role.replace(/_/g, ' ')}
                          </span>
                          {r.left_at && (
                            <span className="text-[10px] text-muted-foreground">Left <AbsTime ts={r.left_at} /></span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Time Log Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'time_log' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Timer className="h-4 w-4" />
                Time Log
              </CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Total: <span className="font-semibold text-foreground">{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</span>
                </span>
                <Button size="sm" onClick={() => setShowAddTime(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add Time
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showAddTime && (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Hours</label>
                    <input type="number" min="0" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={timeHours} onChange={(e) => setTimeHours(e.target.value)} placeholder="0" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Minutes</label>
                    <input type="number" min="0" max="59" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={timeMinutes} onChange={(e) => setTimeMinutes(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Description</label>
                  <input className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={timeDescription} onChange={(e) => setTimeDescription(e.target.value)} placeholder="What did you work on?" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setShowAddTime(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleAddTime} disabled={submittingTime}>
                    {submittingTime ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Log Time
                  </Button>
                </div>
              </div>
            )}

            {loadingLogs ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : workLogs.length > 0 ? (
              <div className="space-y-2">
                {workLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {Math.floor(log.duration_minutes / 60)}h {log.duration_minutes % 60}m
                          <span className="ml-2 text-xs text-muted-foreground">{log.user?.name || 'Unknown'}</span>
                        </p>
                        {log.description && (
                          <p className="text-xs text-muted-foreground truncate" title={log.description}>
                            {log.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">{log.logged_at ? new Date(log.logged_at).toLocaleDateString() : ''}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteLog(log.id)} className="text-muted-foreground hover:text-destructive ml-2">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No time logged yet</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}

      {/* Severity */}
      <Dialog open={showSeverityDialog} onClose={() => setShowSeverityDialog(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowSeverityDialog(false)} />
          <DialogHeader>
            <DialogTitle>Change Severity</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSeverityChange} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">New Severity</label>
              <Select value={newSeverity} onChange={(e) => setNewSeverity(e.target.value)} required>
                <option value="">Select severity</option>
                <option value="1">SEV1 — Critical</option>
                <option value="2">SEV2 — High</option>
                <option value="3">SEV3 — Medium</option>
                <option value="4">SEV4 — Low</option>
                <option value="5">SEV5 — Informational</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Reason (optional)</label>
              <Input placeholder="Why is the severity changing?" value={severityReason} onChange={(e) => setSeverityReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowSeverityDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={changeSeverity.isPending || !newSeverity}>
                {changeSeverity.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Update Severity
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Escalate */}
      <Dialog open={showEscalateDialog} onClose={() => setShowEscalateDialog(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowEscalateDialog(false)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Escalate Incident
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEscalate} className="space-y-4 px-6 pb-6">
            {incident?.escalation_policy_id ? (
              <p className="text-sm text-muted-foreground">
                This incident has an escalation policy attached. Escalating will trigger the next step in the policy.
              </p>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">Escalation Policy</label>
                <Select value={escalatePolicyId} onChange={(e) => setEscalatePolicyId(e.target.value)}>
                  <option value="">Auto-detect from service</option>
                  {escalationPolicies.map((p) => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">No policy is attached. Select one or let it auto-detect from the affected service.</p>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Reason (optional)</label>
              <Input placeholder="Why is this being escalated?" value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowEscalateDialog(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={escalate.isPending}>
                {escalate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Escalate
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Resolve */}
      <Dialog open={showResolveDialog} onClose={() => setShowResolveDialog(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowResolveDialog(false)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-[#16A34A]" />
              Resolve Incident
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleResolve} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Resolution summary (optional)</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What fixed the issue?"
                value={resolveMessage}
                onChange={(e) => setResolveMessage(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowResolveDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={resolve.isPending}>
                {resolve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Mark Resolved
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Responder */}
      <Dialog open={showResponderDialog} onClose={() => setShowResponderDialog(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowResponderDialog(false)} />
          <DialogHeader>
            <DialogTitle>Add Responder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddResponder} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">User *</label>
              <Select value={responderUserId} onChange={(e) => setResponderUserId(e.target.value)} required>
                <option value="">Select a user...</option>
                {orgUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Role</label>
              <Select value={responderRole} onChange={(e) => setResponderRole(e.target.value)}>
                <option value="responder">Responder</option>
                <option value="commander">Commander</option>
                <option value="comms_lead">Comms Lead</option>
                <option value="ops_lead">Ops Lead</option>
                <option value="observer">Observer</option>
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowResponderDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={addResponder.isPending || !responderUserId.trim()}>
                {addResponder.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Add Responder
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Role */}
      <Dialog open={showRoleDialog} onClose={() => setShowRoleDialog(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowRoleDialog(false)} />
          <DialogHeader>
            <DialogTitle>
              Assign {roleField === 'commander_id' ? 'Commander' : roleField === 'comms_lead_id' ? 'Comms Lead' : 'Ops Lead'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssignRole} className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Select User (leave blank to unassign)</label>
              <Select value={roleUserId} onChange={(e) => setRoleUserId(e.target.value)}>
                <option value="">Unassigned</option>
                {orgUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowRoleDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={updateIncident.isPending}>
                {updateIncident.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* AI Copilot Panel */}
      <CopilotPanel
        incidentId={id}
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
      />
    </div>
  );
}
