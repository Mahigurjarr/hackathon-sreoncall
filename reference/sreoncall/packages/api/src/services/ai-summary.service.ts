import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { generateCompletion } from './ai.service';
import type { WorkLogReportParams } from './report.service';

// ─── SREonCall Orange Theme ───────────────────────────────────────────────────

const C = {
  PRIMARY:      '#E85D04',
  SECONDARY:    '#F48C06',
  ACCENT:       '#FAA307',
  DARK:         '#7C2D12',
  LIGHT_BG:     '#FFF7ED',
  LIGHT_BORDER: '#FED7AA',
  WHITE:        '#FFFFFF',
  GRAY_900:     '#111827',
  GRAY_700:     '#374151',
  GRAY_600:     '#4B5563',
  GRAY_400:     '#9CA3AF',
  GRAY_200:     '#E5E7EB',
  GRAY_100:     '#F3F4F6',
  GRAY_50:      '#F9FAFB',
  GREEN:        '#059669',
  GREEN_LIGHT:  '#ECFDF5',
  RED:          '#DC2626',
  RED_LIGHT:    '#FEE2E2',
  AMBER:        '#D97706',
  AMBER_LIGHT:  '#FFFBEB',
  BLUE:         '#2563EB',
  BLUE_LIGHT:   '#EFF6FF',
};

const PW = 595.28;
const PH = 841.89;
const M  = 48;
const CW = PW - M * 2;
const FOOT = 44;

// ─── Raw data shapes (passed from route) ─────────────────────────────────────

export interface IncidentRaw {
  title: string;
  severity: number;
  status: string;
  metrics?: { mtta_seconds?: number | null; mttr_seconds?: number | null } | null;
  // Mongoose `timestamps: true` uses camelCase — createdAt, not created_at
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
  incident_minutes?: number;
}

export interface SyntheticCheckRaw {
  name: string;
  type: string;
  status: string;
  last_status: string | null;
  uptime_24h: number | null;        // null when check has never run
  last_response_time_ms: number | null;
  url?: string;
}

export interface AlertRuleRaw {
  name: string;
  severity: string;
  status: string;
  alert_state: string;
  trigger_count: number;
}

export interface ServiceRaw {
  name: string;
  type: string;
  current_status: string;
  cloud_metadata?: { provider?: string | null };
}

interface WorkLogData {
  grand_total_minutes: number;
  internal_minutes: number;
  provider_minutes: number;
  billable_minutes: number;
  ticket_minutes: number;
  incident_minutes: number;
  grouped: Array<{ key: string; total_minutes: number; count: number; billable_minutes: number }>;
  rows: any[];
}

// ─── Metrics & Content types ──────────────────────────────────────────────────

export interface SRESummaryMetrics {
  from: string;
  to: string;
  // Work logs
  work_hours: string;
  billable_hours: string;
  work_entries: number;
  billable_pct: string;
  incident_minutes: number;
  top_work_areas: Array<{ name: string; hours: string; entries: number }>;
  // Incidents
  total_incidents: number;
  open_incidents: number;
  critical_incidents: number;
  resolved_incidents: number;
  avg_mttr_minutes: string;
  avg_mtta_minutes: string;
  by_severity: { sev1: number; sev2: number; sev3: number; sev4: number; sev5: number };
  top_incidents: Array<{ title: string; severity: number; status: string; mttr_h: string }>;
  active_incidents: Array<{ title: string; severity: number; status: string; age_hours: string }>;
  // Synthetic
  total_checks: number;
  checks_up: number;
  checks_down: number;
  avg_uptime_24h: string;
  check_details: Array<{ name: string; type: string; status: string; uptime_24h: number; response_ms: number | null }>;
  // Alerts
  total_rules: number;
  active_rules: number;
  firing_rules: number;
  high_trigger_rules: Array<{ name: string; severity: string; state: string; count: number }>;
  // Services
  total_services: number;
  operational_services: number;
  degraded_services: number;
  outage_services: number;
  service_inventory: Array<{ name: string; type: string; status: string; provider: string }>;
}

export interface SRESummaryContent {
  exec_paragraph: string;
  kpi_commentary: string;
  incident_trend: string;
  recurring_insight: string;
  infra_commentary: string;
  monitoring_insight: string;
  alert_quality_insight: string;
  active_incident_note: string;
  optimization_insight: string;
  conclusion: string;
}

// ─── Metrics Builder ──────────────────────────────────────────────────────────

export function buildMetrics(
  workLog: WorkLogData,
  incidents: IncidentRaw[],
  activeIncidents: IncidentRaw[],
  syntheticChecks: SyntheticCheckRaw[],
  alertRules: AlertRuleRaw[],
  services: ServiceRaw[],
  from: Date,
  to: Date,
): SRESummaryMetrics {
  const fromStr = from.toISOString().split('T')[0];
  const toStr   = to.toISOString().split('T')[0];

  // BUG-FIX #3: guard against undefined workLog fields (DB can return partial objects)
  const grandTotal   = workLog.grand_total_minutes ?? 0;
  const billableMin  = workLog.billable_minutes     ?? 0;
  const incidentMin  = workLog.incident_minutes     ?? 0;
  const workRows     = workLog.rows     ?? [];
  const workGrouped  = workLog.grouped  ?? [];

  const totalH    = (grandTotal / 60).toFixed(1);
  const billableH = (billableMin / 60).toFixed(1);
  const billPct   = grandTotal > 0
    ? ((billableMin / grandTotal) * 100).toFixed(0) : '0';

  // Helper: safely parse a number — rejects null, undefined, NaN, Infinity, empty string
  const safeNum = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return !isNaN(n) && isFinite(n) ? n : null;
  };

  const resolved   = incidents.filter((i) => i.status === 'resolved' || i.status === 'closed');
  const mttrVals   = resolved.map((i) => safeNum(i.metrics?.mttr_seconds)).filter((v): v is number => v !== null);
  const mttaVals   = incidents.map((i) => safeNum(i.metrics?.mtta_seconds)).filter((v): v is number => v !== null);
  const avgMttr    = mttrVals.length ? Math.round(mttrVals.reduce((a, b) => a + b, 0) / mttrVals.length / 60).toString() : '—';
  const avgMtta    = mttaVals.length ? (mttaVals.reduce((a, b) => a + b, 0) / mttaVals.length / 60).toFixed(0) : '—';

  const bySev = { sev1: 0, sev2: 0, sev3: 0, sev4: 0, sev5: 0 };
  for (const inc of incidents) {
    const k = `sev${inc.severity}` as keyof typeof bySev;
    if (k in bySev) bySev[k]++;
  }

  const topIncidents = [...incidents]
    .sort((a, b) => a.severity - b.severity)
    .slice(0, 10)
    .map((i) => {
      const mttrSec = safeNum(i.metrics?.mttr_seconds);
      return {
        title:    i.title.slice(0, 55),
        severity: i.severity,
        status:   i.status,
        mttr_h:   mttrSec != null ? (mttrSec / 3600).toFixed(1) + 'h' : '—',
      };
    });

  const now = Date.now();
  const activeList = activeIncidents.slice(0, 10).map((i) => {
    // createdAt (Mongoose timestamp camelCase) — guard against undefined/invalid
    const ts = new Date(i.createdAt).getTime();
    const ageH = isNaN(ts) ? '?' : ((now - ts) / 3_600_000).toFixed(0);
    return {
      title:     i.title.slice(0, 55),
      severity:  i.severity,
      status:    i.status,
      age_hours: ageH + 'h',
    };
  });

  const checksUp   = syntheticChecks.filter((c) => c.last_status === 'up').length;
  // BUG-FIX #2: include 'degraded' in not-up count — degraded checks are also failing
  const checksDown = syntheticChecks.filter((c) => c.last_status === 'down' || c.last_status === 'degraded').length;
  // Filter out null/NaN uptime values before averaging
  const uptimeVals = syntheticChecks.map((c) => safeNum(c.uptime_24h)).filter((v): v is number => v !== null);
  const avgUptime  = uptimeVals.length
    ? (uptimeVals.reduce((a, b) => a + b, 0) / uptimeVals.length).toFixed(2) : '—';

  // BUG-FIX #1: store uptime_24h as safeNum (null-safe) — PDF renderer calls .toFixed() on it
  const checkDetails = syntheticChecks.slice(0, 15).map((c) => ({
    name:        c.name.slice(0, 42),
    type:        c.type,
    status:      c.last_status ?? 'unknown',
    uptime_24h:  safeNum(c.uptime_24h) ?? 100,   // default 100% if never run
    response_ms: c.last_response_time_ms,
  }));

  const activeRules  = alertRules.filter((r) => r.status === 'active').length;
  const firingRules  = alertRules.filter((r) => r.alert_state === 'firing').length;
  // BUG-FIX #4: use safeNum for sort — trigger_count null/undefined breaks sort comparison
  const highTriggers = [...alertRules]
    .sort((a, b) => (safeNum(b.trigger_count) ?? 0) - (safeNum(a.trigger_count) ?? 0))
    .slice(0, 10)
    .map((r) => ({
      name:     r.name.slice(0, 46),
      severity: r.severity,
      state:    r.alert_state,
      count:    safeNum(r.trigger_count) ?? 0,
    }));

  const operational = services.filter((s) => s.current_status === 'operational').length;
  const degraded    = services.filter((s) => ['degraded', 'partial_outage'].includes(s.current_status)).length;
  const outage      = services.filter((s) => s.current_status === 'major_outage').length;
  const inventory   = services.slice(0, 25).map((s) => ({
    name: s.name.slice(0, 36), type: s.type,
    status: s.current_status,
    provider: s.cloud_metadata?.provider ?? 'on-prem',
  }));

  return {
    from: fromStr, to: toStr,
    work_hours: totalH, billable_hours: billableH,
    work_entries: workRows.length,
    // BUG-FIX #6: incident_minutes uses safe local variable
    billable_pct: billPct, incident_minutes: incidentMin,
    top_work_areas: workGrouped.slice(0, 10).map((g) => ({
      name: g.key, hours: (g.total_minutes / 60).toFixed(1), entries: g.count,
    })),
    total_incidents: incidents.length, open_incidents: activeIncidents.length,
    critical_incidents: bySev.sev1 + bySev.sev2, resolved_incidents: resolved.length,
    avg_mttr_minutes: avgMttr, avg_mtta_minutes: avgMtta, by_severity: bySev,
    top_incidents: topIncidents, active_incidents: activeList,
    total_checks: syntheticChecks.length, checks_up: checksUp, checks_down: checksDown,
    avg_uptime_24h: avgUptime, check_details: checkDetails,
    total_rules: alertRules.length, active_rules: activeRules, firing_rules: firingRules,
    high_trigger_rules: highTriggers,
    total_services: services.length, operational_services: operational,
    degraded_services: degraded, outage_services: outage, service_inventory: inventory,
  };
}

// ─── AI Content Generation ────────────────────────────────────────────────────

export async function generateAISummaryContent(
  tenantName: string,
  _params: WorkLogReportParams,
  m: SRESummaryMetrics,
  tenantId: string,
): Promise<SRESummaryContent> {
  const system = `You are a senior SRE technical writer producing factual executive reports for ${tenantName}. Use only the provided data. Return ONLY valid JSON with no markdown fences.`;

  const prompt = `Write SRE report narrative for ${tenantName}, period ${m.from} to ${m.to}.

DATA:
- Work: ${m.work_hours}h total, ${m.billable_hours}h billable (${m.billable_pct}%), ${m.work_entries} entries
- Incidents: ${m.total_incidents} total, ${m.critical_incidents} critical (SEV1/SEV2), ${m.resolved_incidents} resolved
- MTTR: ${m.avg_mttr_minutes}m avg | MTTA: ${m.avg_mtta_minutes}m avg
- Severity: SEV1=${m.by_severity.sev1}, SEV2=${m.by_severity.sev2}, SEV3=${m.by_severity.sev3}, SEV4=${m.by_severity.sev4}
- Active/unresolved: ${m.open_incidents}
- Synthetic: ${m.total_checks} checks, ${m.checks_up} up, ${m.checks_down} down, avg 24h uptime ${m.avg_uptime_24h}%
- Alert rules: ${m.total_rules} total, ${m.active_rules} active, ${m.firing_rules} firing
- Services: ${m.total_services} total, ${m.operational_services} operational, ${m.degraded_services} degraded, ${m.outage_services} outage
- Top work areas: ${m.top_work_areas.slice(0, 5).map((g) => `${g.name}(${g.hours}h)`).join(', ')}

Return exactly this JSON with real sentences based on the numbers above. Write prose — do not use variable letters like X, Y, Z, W:
{
  "exec_paragraph": "During ${m.from} to ${m.to}, ${tenantName} logged ${m.work_hours}h across ${m.work_entries} entries, resolving ${m.resolved_incidents} of ${m.total_incidents} incidents at ${m.avg_mttr_minutes}m average MTTR.",
  "kpi_commentary": "The ${m.avg_mttr_minutes}m average MTTR and ${m.avg_mtta_minutes}m MTTA reflect current on-call responsiveness. ${m.critical_incidents} critical incidents warrant deeper root-cause review.",
  "incident_trend": "${m.total_incidents} incidents were recorded. ${m.by_severity.sev1 + m.by_severity.sev2} were high-severity (SEV1/SEV2), ${m.resolved_incidents} were resolved, and ${m.open_incidents} remain active.",
  "recurring_insight": "${m.open_incidents} incidents remain unresolved. Reviewing postmortems for the ${m.by_severity.sev1 + m.by_severity.sev2} SEV1/SEV2 events is recommended.",
  "infra_commentary": "${m.operational_services} of ${m.total_services} services are fully operational. ${m.degraded_services} show degraded status and ${m.outage_services} are in major outage.",
  "monitoring_insight": "${m.checks_up} of ${m.total_checks} synthetic checks are passing with ${m.avg_uptime_24h}% average 24-hour uptime. ${m.checks_down} failing checks require investigation.",
  "alert_quality_insight": "${m.firing_rules} of ${m.active_rules} active alert rules are currently firing. High-trigger rules should be reviewed for threshold tuning to reduce noise.",
  "active_incident_note": "There are currently ${m.open_incidents} active, unresolved incidents requiring ongoing response team attention.",
  "optimization_insight": "Engineering effort was distributed across ${m.top_work_areas.length} work areas. The top area was ${m.top_work_areas[0]?.name ?? 'operations'} with ${m.top_work_areas[0]?.hours ?? '0'}h logged.",
  "conclusion": "The ${m.from}–${m.to} period recorded ${m.total_incidents} incidents at ${m.avg_mttr_minutes}m average MTTR with ${m.avg_uptime_24h}% synthetic uptime. Priorities: resolve active incidents, fix failing checks, tune firing rules."
}`;

  try {
    const result = await generateCompletion({ system, userMessage: prompt, maxTokens: 4000, tenantId });
    if (result.model === 'disabled') {
      const fb = buildFallback(tenantName, m);
      fb.conclusion += '\n\nAI summary unavailable — configure your AI provider in Settings → AI.';
      return fb;
    }
    const match  = result.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const p = JSON.parse(match[0]) as Partial<SRESummaryContent>;
    return mergeContent(p, tenantName, m);
  } catch {
    return buildFallback(tenantName, m);
  }
}

// Returns true only if the string looks like real generated content, not an echoed instruction
function isRealContent(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (t.length < 35) return false;
  // Reject echoed instruction text
  if (/^\d[\s-]+\d\s*sentence/i.test(t)) return false;
  if (/sentence[s]?\s+summar/i.test(t)) return false;
  if (/summarise the period and state/i.test(t)) return false;
  if (/state top \d/i.test(t)) return false;
  // Reject unfilled placeholder variables — catches "X of Y services", "Yh", "Z%", "W failing"
  // Matches standalone letters AND letter+unit combos (Xh, Y%, Zm) used as variable placeholders
  const varCount = (t.match(/\b[XYZWN](?:h|%|m)?\b/g) ?? []).length;
  if (varCount >= 2) return false;
  return true;
}

function mergeContent(p: Partial<SRESummaryContent>, tn: string, m: SRESummaryMetrics): SRESummaryContent {
  const fb = buildFallback(tn, m);
  const s  = (v: unknown, d: string) => (isRealContent(v) ? (v as string) : d);
  return {
    exec_paragraph:        s(p.exec_paragraph,        fb.exec_paragraph),
    kpi_commentary:        s(p.kpi_commentary,        fb.kpi_commentary),
    incident_trend:        s(p.incident_trend,        fb.incident_trend),
    recurring_insight:     s(p.recurring_insight,     fb.recurring_insight),
    infra_commentary:      s(p.infra_commentary,      fb.infra_commentary),
    monitoring_insight:    s(p.monitoring_insight,    fb.monitoring_insight),
    alert_quality_insight: s(p.alert_quality_insight, fb.alert_quality_insight),
    active_incident_note:  s(p.active_incident_note,  fb.active_incident_note),
    optimization_insight:  s(p.optimization_insight,  fb.optimization_insight),
    conclusion:            s(p.conclusion,            fb.conclusion),
  };
}

function buildFallback(tn: string, m: SRESummaryMetrics): SRESummaryContent {
  const incStr = `${m.total_incidents} incident${m.total_incidents !== 1 ? 's' : ''}`;

  // BUG-FIX #5: '—' is a sentinel meaning "no data" — render gracefully in prose
  const mttrText   = m.avg_mttr_minutes === '—' ? 'no resolution time data yet'       : `a ${m.avg_mttr_minutes}m average MTTR`;
  const mttaText   = m.avg_mtta_minutes === '—' ? 'no acknowledgement time data yet'   : `${m.avg_mtta_minutes} minutes average MTTA`;
  const uptimeText = m.avg_uptime_24h   === '—' ? 'no uptime data available'            : `${m.avg_uptime_24h}% average 24-hour uptime`;
  const incidentH  = (m.incident_minutes / 60).toFixed(1);

  return {
    exec_paragraph: `During ${m.from} to ${m.to}, ${tn} operations recorded ${incStr} with ${mttrText} and ${mttaText}. ${m.work_hours} hours of engineering effort were logged across ${m.work_entries} entries, with ${m.billable_pct}% billable. Synthetic monitoring tracked ${m.total_checks} checks achieving ${uptimeText}.`,
    kpi_commentary: m.critical_incidents > 0
      ? `${m.critical_incidents} critical incidents (SEV1/SEV2) require post-incident review. ${m.avg_mtta_minutes !== '—' ? `Average MTTA of ${m.avg_mtta_minutes} minutes reflects current on-call responsiveness.` : 'On-call acknowledgement data is not yet available for this period.'}`
      : `No critical incidents recorded this period — a strong signal. ${m.avg_mtta_minutes !== '—' ? `Average MTTA of ${m.avg_mtta_minutes} minutes confirms solid on-call coverage.` : ''}`,
    incident_trend: `${m.total_incidents} incidents were recorded in the period, with ${m.by_severity.sev1 + m.by_severity.sev2} high-severity (SEV1/SEV2). ${m.resolved_incidents} were resolved${m.avg_mttr_minutes !== '—' ? ` with ${mttrText}` : ''}. The ${m.by_severity.sev3} SEV3 incidents represent the bulk of the operational load.`,
    recurring_insight: `${m.open_incidents} incident${m.open_incidents !== 1 ? 's' : ''} remain${m.open_incidents === 1 ? 's' : ''} unresolved at the time of this report. Reviewing SEV1/SEV2 postmortems for common root causes is recommended to reduce future recurrence.`,
    infra_commentary: `Of ${m.total_services} tracked services, ${m.operational_services} are fully operational, ${m.degraded_services} show degraded status, and ${m.outage_services} are in major outage. ${m.outage_services > 0 ? 'Immediate remediation is required for outage-state services.' : 'No major outages recorded this period.'}`,
    monitoring_insight: `${m.checks_up} of ${m.total_checks} synthetic checks are passing with ${uptimeText}. ${m.checks_down > 0 ? `${m.checks_down} check${m.checks_down !== 1 ? 's' : ''} (down or degraded) require immediate investigation.` : 'All checks are currently in a passing state.'}`,
    alert_quality_insight: `${m.firing_rules} of ${m.active_rules} active alert rules are in firing state. Rules with high trigger counts should be reviewed for noise reduction and proper threshold tuning.`,
    active_incident_note: `There are currently ${m.open_incidents} active, unresolved incident${m.open_incidents !== 1 ? 's' : ''} requiring ongoing response team attention.`,
    optimization_insight: `Engineering effort was distributed across ${m.top_work_areas.length} work area${m.top_work_areas.length !== 1 ? 's' : ''}. ${m.top_work_areas[0] ? `The highest-volume area was ${m.top_work_areas[0].name} (${m.top_work_areas[0].hours}h).` : ''} Incident response accounted for ${incidentH}h of the total ${m.work_hours}h logged.`,
    conclusion: `The ${m.from}–${m.to} period recorded ${incStr}${m.avg_mttr_minutes !== '—' ? ` with ${mttrText}` : ''}${m.avg_uptime_24h !== '—' ? ` and ${uptimeText}` : ''}. For the next period, the top priorities are: resolving the ${m.open_incidents} active incident${m.open_incidents !== 1 ? 's' : ''}, addressing ${m.checks_down} failing check${m.checks_down !== 1 ? 's' : ''}, and tuning the ${m.firing_rules} currently firing alert rule${m.firing_rules !== 1 ? 's' : ''}.`,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PDF RENDERER  — all Y cursor updates are explicit; no text overlap
// ═════════════════════════════════════════════════════════════════════════════

export function renderAISummaryPDF(
  tenantName: string,
  _params: WorkLogReportParams,
  content: SRESummaryContent,
  metrics: SRESummaryMetrics,
  filterLabel = 'All data',
): PassThrough {
  const stream = new PassThrough();
  const doc    = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
  doc.pipe(stream);

  const reportDate = new Date().toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  let y = M;

  // ── Page helpers ──────────────────────────────────────────────────────────

  function drawFooter() {
    const fy = PH - 28;
    doc.moveTo(M, fy - 8).lineTo(PW - M, fy - 8)
      .strokeColor(C.GRAY_200).lineWidth(0.5).stroke();
    doc.fontSize(7.5).fillColor(C.GRAY_400).font('Helvetica')
      .text(`${tenantName}  |  SRE Operations Report  |  Confidential`, M, fy, {
        width: CW / 2, lineBreak: false,
      })
      .text('Powered by SREonCall', M, fy, {
        width: CW, align: 'right', lineBreak: false,
      });
  }

  function addPage() {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.rect(0, 0, PW, PH).fill(C.WHITE);
    drawFooter();
    y = M;
  }

  // guard() caps at max usable page height to prevent infinite-loop for over-sized elements
  const PAGE_USABLE = PH - M - FOOT - 16;
  function guard(need: number) {
    if (y + Math.min(need, PAGE_USABLE) > PH - FOOT - 16) addPage();
  }

  // ── Section header ────────────────────────────────────────────────────────

  function sectionHeader(num: string, title: string, accent = C.PRIMARY) {
    // Pre-gap + large guard: 260pt ensures header (78) + pills (92) always land together.
    // If the remaining space can't hold header + a meaningful first element, start fresh page.
    if (y > M + 10) y += 22;
    guard(260);
    doc.roundedRect(M, y, 30, 30, 5).fill(accent);
    doc.fontSize(11).fillColor(C.WHITE).font('Helvetica-Bold')
      .text(num, M, y + 8, { width: 30, align: 'center', lineBreak: false });
    doc.fontSize(15).fillColor(C.GRAY_900).font('Helvetica-Bold')
      .text(title, M + 38, y + 6, { width: CW - 38, lineBreak: false });
    y += 36;
    doc.moveTo(M, y).lineTo(PW - M, y)
      .strokeColor(C.LIGHT_BORDER).lineWidth(2).stroke();
    y += 14;
  }

  // ── Paragraph (flow text — always updates y via doc.y) ───────────────────

  function para(text: string) {
    if (!text) return;
    doc.fontSize(10.5).font('Helvetica');
    const h = doc.heightOfString(text, { width: CW, lineGap: 3 });
    guard(h + 16);
    doc.fillColor(C.GRAY_600).text(text, M, y, { width: CW, lineGap: 3 });
    y = doc.y + 16;
  }

  function subheader(text: string) {
    // 120pt = subheader (26) + table header (30) + at least 2 data rows (64) — keeps sub-title
    // attached to its following table/chart; never orphaned at page bottom
    guard(120);
    y += 4;
    doc.fontSize(11).fillColor(C.GRAY_700).font('Helvetica-Bold')
      .text(text, M, y, { width: CW, lineBreak: false });
    y += 22;
  }

  // ── Callout box ───────────────────────────────────────────────────────────

  function calloutBox(symbol: string, title: string, body: string, accent = C.PRIMARY, bg = C.LIGHT_BG) {
    if (!body) return;
    doc.fontSize(10.5).font('Helvetica');
    const bodyW  = CW - 50;
    const bodyH  = doc.heightOfString(body, { width: bodyW, lineGap: 3.5 });
    const titleH = title ? 20 : 0;
    const boxH   = titleH + bodyH + 28;
    guard(boxH + 18);
    const bY = y;

    doc.roundedRect(M, bY, CW, boxH, 6).fill(bg);
    doc.rect(M, bY, 3, boxH).fill(accent);

    // Symbol: use GRAY_700 when on light background to avoid orange-on-light contrast issue
    const symColor = (bg === C.LIGHT_BG || bg === C.GREEN_LIGHT || bg === C.AMBER_LIGHT)
      ? C.GRAY_700 : accent;
    doc.fontSize(13).fillColor(symColor)
      .text(symbol, M + 10, bY + 9, { lineBreak: false });

    let ty = bY + 9;
    if (title) {
      doc.fontSize(11).fillColor(C.GRAY_900).font('Helvetica-Bold')
        .text(title, M + 32, ty, { width: bodyW, lineBreak: false });
      ty += titleH;
    }
    doc.fontSize(10.5).fillColor(C.GRAY_600).font('Helvetica')
      .text(body, M + 32, ty, { width: bodyW, lineGap: 3.5 });

    y = bY + boxH + 18;
  }

  // ── KPI Cards (4-up) ──────────────────────────────────────────────────────

  function kpiCards(cards: Array<{ label: string; value: string; sub: string; color: string }>) {
    const gap = 10;
    const cw  = (CW - gap * (cards.length - 1)) / cards.length;
    const ch  = 84;
    guard(ch + 20);
    const rowY = y;

    cards.forEach((card, i) => {
      const cx = M + i * (cw + gap);
      doc.save().opacity(0.04).roundedRect(cx + 2, rowY + 2, cw, ch, 7).fill('#000').restore();
      doc.roundedRect(cx, rowY, cw, ch, 7).fill(C.WHITE);
      doc.roundedRect(cx, rowY, cw, ch, 7).strokeColor(C.GRAY_200).lineWidth(1).stroke();
      doc.roundedRect(cx, rowY, cw, 4, 2).fill(card.color);
      // Value text: use darker shade of color for readability on white
      doc.fontSize(22).fillColor(card.color).font('Helvetica-Bold')
        .text(card.value, cx + 12, rowY + 14, { width: cw - 24, lineBreak: false });
      doc.fontSize(9).fillColor(C.GRAY_700).font('Helvetica-Bold')
        .text(card.label, cx + 12, rowY + 44, { width: cw - 24, lineBreak: false });
      doc.fontSize(8.5).fillColor(C.GRAY_600).font('Helvetica')
        .text(card.sub, cx + 12, rowY + 59, { width: cw - 24, lineBreak: false });
    });

    y = rowY + ch + 18;
  }

  // ── Metric pills (3-up summary row) ──────────────────────────────────────

  function metricPills(pills: Array<{ label: string; value: string | number; color: string; bg: string }>) {
    const gap = 12;
    const pw  = (CW - gap * (pills.length - 1)) / pills.length;
    const ph  = 56;
    guard(ph + 20);
    const rowY = y;

    pills.forEach((pill, i) => {
      const px = M + i * (pw + gap);
      doc.roundedRect(px, rowY, pw, ph, 6).fill(pill.bg);
      // Border uses a darker shade of the color for contrast (no orange-on-orange)
      doc.roundedRect(px, rowY, pw, ph, 6).strokeColor(pill.color).lineWidth(1).stroke();
      // Value: pill.color on pill.bg — guaranteed readable since we pick dark on light pairs
      doc.fontSize(21).fillColor(pill.color).font('Helvetica-Bold')
        .text(String(pill.value), px + 14, rowY + 9, { width: pw - 28, lineBreak: false });
      doc.fontSize(9).fillColor(C.GRAY_600).font('Helvetica-Bold')
        .text(pill.label, px + 14, rowY + 38, { width: pw - 28, lineBreak: false });
    });

    y = rowY + ph + 18;
  }

  // ── Status badge (returns badge width) ───────────────────────────────────

  function drawBadge(label: string, bx: number, by: number): number {
    const lc = label.toLowerCase().replace(/[_\s]/g, '_');
    let bg: string;
    let fg: string;
    if (['up', 'ok', 'operational', 'resolved', 'closed', 'done', 'active'].includes(lc))
      { bg = C.GREEN_LIGHT; fg = C.GREEN; }
    else if (['firing', 'down', 'major_outage', 'open', 'critical', 'sev1'].includes(lc))
      { bg = C.RED_LIGHT; fg = C.RED; }
    else if (['degraded', 'partial_outage', 'pending', 'acknowledged', 'high', 'sev2'].includes(lc))
      { bg = C.AMBER_LIGHT; fg = C.AMBER; }
    else if (['no_data', 'paused', 'inactive', 'unknown'].includes(lc))
      { bg = C.GRAY_100; fg = C.GRAY_400; }
    else if (['investigating', 'monitoring', 'medium', 'sev3'].includes(lc))
      { bg = C.BLUE_LIGHT; fg = C.BLUE; }
    else { bg = C.LIGHT_BG; fg = C.PRIMARY; }

    doc.fontSize(8.5).font('Helvetica-Bold');
    const bw = Math.min(doc.widthOfString(label) + 16, 90);
    doc.roundedRect(bx, by, bw, 17, 3).fill(bg);
    doc.fillColor(fg).text(label, bx + 8, by + 3, { width: bw - 16, lineBreak: false });
    return bw;
  }

  // ── Data table — splits across pages; column headers repeat on each continuation ──

  function dataTable(
    headers: string[],
    rows: string[][],
    colWidths: number[],
    badgeCol = -1,
  ) {
    if (rows.length === 0) return;
    const rowH = 28;
    const hdrH = 30;

    // Ensure at least the header row + 1 data row fit before we start
    guard(hdrH + rowH + 20);

    let remaining = rows.slice();

    while (remaining.length > 0) {
      // Calculate how many rows fit in the remaining vertical space on this page
      const availH = PH - FOOT - 16 - y;
      const rowsFit = Math.max(1, Math.floor((availH - hdrH - 20) / rowH));
      const chunk   = remaining.slice(0, rowsFit);
      remaining     = remaining.slice(rowsFit);

      const chunkTotal = hdrH + chunk.length * rowH;
      const tY         = y;

      // ── Draw table border + header bg ──────────────────────────────────
      doc.roundedRect(M, tY, CW, chunkTotal, 6)
        .strokeColor(C.GRAY_200).lineWidth(1).stroke();
      doc.roundedRect(M, tY, CW, hdrH, 6).fill(C.GRAY_50);
      doc.rect(M, tY + 14, CW, 16).fill(C.GRAY_50);
      doc.moveTo(M + 1, tY + hdrH).lineTo(M + CW - 1, tY + hdrH)
        .strokeColor(C.GRAY_200).lineWidth(1).stroke();

      // ── Column headers ──────────────────────────────────────────────────
      doc.fontSize(7.5).fillColor(C.GRAY_400).font('Helvetica-Bold');
      let hx = M + 12;
      headers.forEach((h, i) => {
        doc.text(h, hx, tY + 10, { width: colWidths[i] - 10, lineBreak: false });
        hx += colWidths[i];
      });

      // ── Data rows ───────────────────────────────────────────────────────
      chunk.forEach((row, ri) => {
        const ry = tY + hdrH + ri * rowH;
        if (ri % 2 === 1) doc.rect(M + 1, ry, CW - 2, rowH).fill(C.GRAY_50);
        if (ri < chunk.length - 1) {
          doc.moveTo(M + 1, ry + rowH).lineTo(M + CW - 1, ry + rowH)
            .strokeColor(C.GRAY_100).lineWidth(0.5).stroke();
        }
        let rx = M + 12;
        row.forEach((cell, ci) => {
          const cw2 = colWidths[ci];
          if (ci === badgeCol) {
            drawBadge(cell, rx, ry + 5);
          } else {
            doc.fontSize(ci === 0 ? 10 : 9.5)
              .fillColor(ci === 0 ? C.GRAY_900 : C.GRAY_600)
              .font(ci === 0 ? 'Helvetica-Bold' : 'Helvetica')
              .text(cell, rx, ry + 8, { width: cw2 - 12, lineBreak: false });
          }
          rx += cw2;
        });
      });

      y = tY + chunkTotal + 20;

      // Continuation: new page, loop draws the same header again
      if (remaining.length > 0) addPage();
    }
  }

  // ── Severity distribution bar ─────────────────────────────────────────────

  function severityBar(bySev: SRESummaryMetrics['by_severity'], total: number) {
    if (total === 0) return;
    guard(54);
    const barY = y;
    const barH = 16;
    const sevs = [
      { k: 'sev1' as const, label: 'SEV1', color: '#DC2626' },
      { k: 'sev2' as const, label: 'SEV2', color: '#EA580C' },
      { k: 'sev3' as const, label: 'SEV3', color: '#D97706' },
      { k: 'sev4' as const, label: 'SEV4', color: '#2563EB' },
      { k: 'sev5' as const, label: 'SEV5', color: '#9CA3AF' },
    ];

    let bx = M;
    for (const s of sevs) {
      const n = bySev[s.k];
      if (!n) continue;
      const segW = Math.max(Math.round((n / total) * CW), 1);
      doc.rect(bx, barY, segW, barH).fill(s.color);
      bx += segW;
    }
    doc.roundedRect(M, barY, CW, barH, 0).strokeColor(C.GRAY_200).lineWidth(0.5).stroke();

    let lx = M;
    const legendY = barY + barH + 8;
    doc.fontSize(8.5).font('Helvetica');
    for (const s of sevs) {
      const n = bySev[s.k];
      doc.circle(lx + 5, legendY + 5, 4).fill(s.color);
      doc.fillColor(C.GRAY_600).text(`${s.label}: ${n}`, lx + 13, legendY, { lineBreak: false });
      lx += 72;
    }
    y = legendY + 22;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  doc.addPage({ size: 'A4', margin: 0 });

  const covG = doc.linearGradient(0, 0, PW * 0.65, PH);
  covG.stop(0, C.DARK).stop(0.45, C.PRIMARY).stop(1, C.SECONDARY);
  doc.rect(0, 0, PW, PH).fill(covG as any);

  // Decorative circles
  doc.save().opacity(0.07).circle(PW + 80, -80, 320).fill(C.WHITE).restore();
  doc.save().opacity(0.04).circle(-70, PH + 70, 250).fill(C.WHITE).restore();
  doc.save().opacity(0.05).circle(PW * 0.72, PH * 0.42, 170).fill(C.WHITE).restore();

  // Accent top bar
  doc.rect(0, 0, PW, 5).fill(C.ACCENT);

  // Badge
  doc.save().opacity(0.2).roundedRect(M, 62, 210, 22, 4).fill(C.WHITE).restore();
  doc.fontSize(7.5).fillColor(C.WHITE).font('Helvetica-Bold')
    .text('CONFIDENTIAL  |  SRE OPERATIONS REPORT', M, 69, {
      width: 210, align: 'center', characterSpacing: 0.8, lineBreak: false,
    });

  // Title
  doc.fontSize(40).fillColor(C.WHITE).font('Helvetica-Bold')
    .text('SRE Operations', M, 108, { width: CW });
  doc.fontSize(40).fillColor(C.WHITE).font('Helvetica-Bold')
    .text('Report', M, 154, { width: CW });

  doc.fontSize(17).fillColor('rgba(255,255,255,0.92)').font('Helvetica')
    .text(`${metrics.from}  –  ${metrics.to}`, M, 206, { width: CW });
  doc.fontSize(11.5).fillColor('rgba(255,255,255,0.58)').font('Helvetica')
    .text('Incident Analysis  ·  Infrastructure Health  ·  Monitoring  ·  Optimization', M, 228, { width: CW });
  // Show active filters on cover
  doc.fontSize(10).fillColor('rgba(255,255,255,0.42)').font('Helvetica')
    .text(`Filters: ${filterLabel}`, M, 248, { width: CW });

  // Meta strip
  const metaY = PH - 156;
  doc.save().opacity(0.2)
    .moveTo(M, metaY).lineTo(PW - M, metaY)
    .strokeColor(C.WHITE).lineWidth(1).stroke().restore();

  const metaCols = [
    { label: 'REPORT PERIOD',  value: `${metrics.from} – ${metrics.to}` },
    { label: 'REPORT DATE',    value: reportDate },
    { label: 'FILTERS APPLIED', value: filterLabel },
    { label: 'CLASSIFICATION', value: 'Confidential' },
  ];
  metaCols.forEach((mc, i) => {
    const mx = M + i * (CW / 4);
    doc.fontSize(7).fillColor('rgba(255,255,255,0.45)').font('Helvetica-Bold')
      .text(mc.label, mx, metaY + 18, { width: CW / 4 - 6, characterSpacing: 0.5, lineBreak: false });
    doc.fontSize(10).fillColor('rgba(255,255,255,0.85)').font('Helvetica')
      .text(mc.value, mx, metaY + 34, { width: CW / 4 - 6, lineBreak: false });
  });

  doc.fontSize(30).fillColor(C.WHITE).font('Helvetica-Bold')
    .text(tenantName, M, PH - 64, { width: CW });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION PAGES
  // ═══════════════════════════════════════════════════════════════════════════

  addPage();

  // ── 01  Executive Summary ─────────────────────────────────────────────────
  sectionHeader('01', 'Executive Summary');
  para(content.exec_paragraph);
  calloutBox('>', 'Period Highlight', content.kpi_commentary, C.PRIMARY, C.LIGHT_BG);

  // ── 02  Key Performance Indicators ───────────────────────────────────────
  sectionHeader('02', 'Key Performance Indicators');
  kpiCards([
    {
      label: 'Avg MTTR',
      value: metrics.avg_mttr_minutes === '—' ? 'N/A' : `${metrics.avg_mttr_minutes}m`,
      sub:   'Mean Time to Resolve',
      color: C.PRIMARY,
    },
    {
      label: 'Avg MTTA',
      value: metrics.avg_mtta_minutes === '—' ? 'N/A' : `${metrics.avg_mtta_minutes}m`,
      sub:   'Mean Time to Acknowledge',
      color: C.SECONDARY,
    },
    {
      label: 'Total Incidents',
      value: String(metrics.total_incidents),
      sub:   `${metrics.critical_incidents} critical (SEV1/SEV2)`,
      color: metrics.critical_incidents > 0 ? C.RED : C.GREEN,
    },
    {
      label: 'Avg Uptime 24h',
      value: metrics.avg_uptime_24h === '—' ? 'N/A' : `${metrics.avg_uptime_24h}%`,
      sub:   `${metrics.checks_up}/${metrics.total_checks} checks passing`,
      color: (() => {
        const v = parseFloat(metrics.avg_uptime_24h);
        return isNaN(v) ? C.GRAY_400 : v >= 99.9 ? C.GREEN : v >= 99 ? C.AMBER : C.RED;
      })(),
    },
  ]);

  // ── 03  Incident Volume & Trend Analysis ──────────────────────────────────
  sectionHeader('03', 'Incident Volume & Trend Analysis');
  metricPills([
    { label: 'Total',            value: metrics.total_incidents,    color: C.PRIMARY, bg: C.LIGHT_BG },
    { label: 'Critical (S1+S2)', value: metrics.critical_incidents, color: C.RED,     bg: C.RED_LIGHT },
    { label: 'Resolved',         value: metrics.resolved_incidents, color: C.GREEN,   bg: C.GREEN_LIGHT },
  ]);
  para(content.incident_trend);
  if (metrics.total_incidents > 0) {
    subheader('Severity Distribution');
    severityBar(metrics.by_severity, metrics.total_incidents);
  }

  // ── 04  Top Recurring Incidents ───────────────────────────────────────────
  // Pre-guard: keep header + para + table-header + ≥3 rows together; rest splits naturally
  guard(78 + 60 + 16 + 30 + 3 * 28);
  sectionHeader('04', 'Top Recurring Incidents');
  para(content.recurring_insight);
  if (metrics.top_incidents.length > 0) {
    const s4 = CW * 0.07, n4 = CW * 0.44, st4 = CW * 0.22, m4 = CW - s4 - n4 - st4;
    dataTable(
      ['SEV', 'INCIDENT TITLE', 'STATUS', 'MTTR'],
      metrics.top_incidents.map((i) => [`S${i.severity}`, i.title, i.status, i.mttr_h]),
      [s4, n4, st4, m4], 2,
    );
  } else {
    calloutBox('>', '', 'No incidents recorded in this period.', C.GREEN, C.GREEN_LIGHT);
  }

  // ── 05  Infrastructure Health & Analysis ──────────────────────────────────
  sectionHeader('05', 'Infrastructure Health & Analysis');
  metricPills([
    { label: 'Operational', value: metrics.operational_services, color: C.GREEN, bg: C.GREEN_LIGHT },
    { label: 'Degraded',    value: metrics.degraded_services,    color: C.AMBER, bg: C.AMBER_LIGHT },
    { label: 'Outage',      value: metrics.outage_services,      color: C.RED,   bg: C.RED_LIGHT },
  ]);
  para(content.infra_commentary);

  // ── 06  Synthetic Monitoring Status ──────────────────────────────────────
  // Pre-guard: header + pills + para + table-header + ≥2 rows together; rest splits
  guard(78 + 74 + 18 + 60 + 16 + 30 + 2 * 28);
  sectionHeader('06', 'Synthetic Monitoring Status');
  metricPills([
    { label: 'Total Checks', value: metrics.total_checks,  color: C.PRIMARY, bg: C.LIGHT_BG },
    { label: 'Up',           value: metrics.checks_up,     color: C.GREEN,   bg: C.GREEN_LIGHT },
    { label: 'Down',         value: metrics.checks_down,   color: C.RED,     bg: C.RED_LIGHT },
  ]);
  para(content.monitoring_insight);
  if (metrics.check_details.length > 0) {
    const n6 = CW * 0.36, t6 = CW * 0.11, u6 = CW * 0.14, r6 = CW * 0.13, s6 = CW - n6 - t6 - u6 - r6;
    dataTable(
      ['CHECK NAME', 'TYPE', 'UPTIME 24H', 'RESP ms', 'STATUS'],
      metrics.check_details.map((c) => [
        c.name, c.type.toUpperCase(),
        // uptime_24h is already null-safe (defaulted to 100 in buildMetrics)
        `${c.uptime_24h.toFixed(1)}%`,
        c.response_ms != null ? String(c.response_ms) : '—', c.status,
      ]),
      [n6, t6, u6, r6, s6], 4,
    );
  }

  // ── 07  Alert Rule Quality Assessment ────────────────────────────────────
  sectionHeader('07', 'Alert Rule Quality Assessment');
  metricPills([
    { label: 'Total Rules', value: metrics.total_rules,  color: C.GRAY_700, bg: C.GRAY_100 },
    { label: 'Active',      value: metrics.active_rules, color: C.PRIMARY,  bg: C.LIGHT_BG },
    { label: 'Firing',      value: metrics.firing_rules, color: C.RED,      bg: C.RED_LIGHT },
  ]);
  para(content.alert_quality_insight);
  if (metrics.high_trigger_rules.length > 0) {
    subheader('Rules by Trigger Count');
    const n7 = CW * 0.42, s7 = CW * 0.14, a7 = CW * 0.18, c7 = CW - n7 - s7 - a7;
    dataTable(
      ['RULE NAME', 'SEVERITY', 'STATE', 'TRIGGERS'],
      metrics.high_trigger_rules.map((r) => [r.name, r.severity, r.state, String(r.count)]),
      [n7, s7, a7, c7], 2,
    );
  }

  // ── 08  Active & Unresolved Incidents ────────────────────────────────────
  // Pre-guard: header + callout + table-header + ≥1 row together
  guard(78 + 80 + 30 + 28);
  sectionHeader('08', 'Active & Unresolved Incidents');
  calloutBox('!', '', content.active_incident_note, C.RED, C.RED_LIGHT);
  if (metrics.active_incidents.length > 0) {
    const s8 = CW * 0.07, n8 = CW * 0.43, st8 = CW * 0.22, a8 = CW - s8 - n8 - st8;
    dataTable(
      ['SEV', 'INCIDENT TITLE', 'STATUS', 'AGE'],
      metrics.active_incidents.map((i) => [`S${i.severity}`, i.title, i.status, i.age_hours]),
      [s8, n8, st8, a8], 2,
    );
  } else {
    calloutBox('>', '', 'No active incidents at time of report generation.', C.GREEN, C.GREEN_LIGHT);
  }

  // ── 09  Optimization Results ──────────────────────────────────────────────
  sectionHeader('09', 'Optimization Results');
  kpiCards([
    { label: 'Total Hours',    value: `${metrics.work_hours}h`,    sub: `${metrics.work_entries} log entries`,  color: C.PRIMARY },
    { label: 'Billable Hours', value: `${metrics.billable_hours}h`, sub: `${metrics.billable_pct}% of total`,   color: C.GREEN },
    { label: 'Work Areas',     value: String(metrics.top_work_areas.length), sub: 'distinct areas tracked',     color: C.SECONDARY },
    { label: 'Incident Hours', value: `${((metrics.incident_minutes ?? 0) / 60).toFixed(1)}h`, sub: 'incident response', color: C.AMBER },
  ]);
  para(content.optimization_insight);
  if (metrics.top_work_areas.length > 0) {
    subheader('Work Area Breakdown');
    const n9 = CW * 0.52, h9 = CW * 0.2, e9 = CW - n9 - h9;
    dataTable(
      ['WORK AREA', 'HOURS', 'ENTRIES'],
      metrics.top_work_areas.map((w) => [w.name, `${w.hours}h`, String(w.entries)]),
      [n9, h9, e9],
    );
  }

  // ── 10  Appendix: Environment Inventory ──────────────────────────────────
  // Pre-guard: header + pills + table-header + ≥3 rows; rest splits across pages
  guard(78 + 74 + 18 + 30 + 3 * 28);
  sectionHeader('10', 'Appendix: Environment Inventory');
  metricPills([
    { label: 'Total Services',    value: metrics.total_services,      color: C.GRAY_700, bg: C.GRAY_100 },
    { label: 'Operational',       value: metrics.operational_services, color: C.GREEN,    bg: C.GREEN_LIGHT },
    { label: 'Degraded / Outage', value: metrics.degraded_services + metrics.outage_services,
      color: metrics.outage_services > 0 ? C.RED : C.AMBER,
      bg:    metrics.outage_services > 0 ? C.RED_LIGHT : C.AMBER_LIGHT },
  ]);
  if (metrics.service_inventory.length > 0) {
    const n10 = CW * 0.32, t10 = CW * 0.16, p10 = CW * 0.18, s10 = CW - n10 - t10 - p10;
    dataTable(
      ['SERVICE NAME', 'TYPE', 'PROVIDER', 'STATUS'],
      metrics.service_inventory.map((s) => [s.name, s.type, s.provider ?? '—', s.status]),
      [n10, t10, p10, s10], 3,
    );
  }

  // ── Conclusion ────────────────────────────────────────────────────────────
  guard(90);
  y += 6;
  doc.moveTo(M, y).lineTo(PW - M, y)
    .strokeColor(C.LIGHT_BORDER).lineWidth(1.5).stroke();
  y += 18;
  calloutBox('=', 'Conclusion & Next Steps', content.conclusion, C.PRIMARY, C.LIGHT_BG);

  // ── Period summary grid — fills whitespace before closing banner ─────────
  const closingY = PH - FOOT - 72;
  if (y < closingY - 100) {
    y += 24;
    doc.moveTo(M, y).lineTo(PW - M, y)
      .strokeColor(C.GRAY_200).lineWidth(0.5).stroke();
    y += 20;
    doc.fontSize(10).fillColor(C.GRAY_400).font('Helvetica-Bold')
      .text('PERIOD AT A GLANCE', M, y, { characterSpacing: 1, lineBreak: false });
    y += 16;

    const stats = [
      { label: 'Total Incidents',   value: String(metrics.total_incidents),  color: C.PRIMARY },
      { label: 'Critical (S1+S2)',  value: String(metrics.critical_incidents), color: C.RED },
      { label: 'Avg MTTR',          value: `${metrics.avg_mttr_minutes}m`,   color: C.SECONDARY },
      { label: 'Avg MTTA',          value: `${metrics.avg_mtta_minutes}m`,   color: C.AMBER },
      { label: 'Avg Uptime 24h',    value: `${metrics.avg_uptime_24h}%`,     color: C.GREEN },
      { label: 'Total Work Hours',  value: `${metrics.work_hours}h`,         color: C.PRIMARY },
      { label: 'Billable Hours',    value: `${metrics.billable_hours}h`,     color: C.GREEN },
      { label: 'Services Online',   value: `${metrics.operational_services}/${metrics.total_services}`, color: C.GREEN },
    ];
    const cols = 4;
    const gap  = 10;
    const sw   = (CW - gap * (cols - 1)) / cols;
    const sh   = 58;

    for (let row = 0; row < Math.ceil(stats.length / cols); row++) {
      const rowStats = stats.slice(row * cols, row * cols + cols);
      const rowY = y;
      rowStats.forEach((st, ci) => {
        const sx = M + ci * (sw + gap);
        doc.roundedRect(sx, rowY, sw, sh, 5).fill(C.GRAY_50);
        doc.roundedRect(sx, rowY, sw, sh, 5).strokeColor(C.GRAY_200).lineWidth(0.5).stroke();
        doc.roundedRect(sx, rowY, sw, 3, 1).fill(st.color);
        doc.fontSize(18).fillColor(st.color).font('Helvetica-Bold')
          .text(st.value, sx + 10, rowY + 10, { width: sw - 20, lineBreak: false });
        doc.fontSize(8.5).fillColor(C.GRAY_600).font('Helvetica')
          .text(st.label, sx + 10, rowY + 36, { width: sw - 20, lineBreak: false });
      });
      y = rowY + sh + 10;
    }
    y += 8;
  }

  // ── Closing banner ────────────────────────────────────────────────────────
  if (y < closingY - 10) y = closingY;
  const banG = doc.linearGradient(0, y, PW, y);
  banG.stop(0, C.DARK).stop(0.5, C.PRIMARY).stop(1, C.SECONDARY);
  doc.rect(0, y, PW, 60).fill(banG as any);
  doc.fontSize(11).fillColor(C.WHITE).font('Helvetica-Bold')
    .text(tenantName, M, y + 12, { width: CW / 2, lineBreak: false });
  doc.fontSize(9).fillColor('rgba(255,255,255,0.65)').font('Helvetica')
    .text('SRE Operations Report  ·  Powered by SREonCall', M, y + 30, {
      width: CW / 2, lineBreak: false,
    });
  // White text for period — readable on any orange gradient shade
  doc.fontSize(9).fillColor('rgba(255,255,255,0.90)').font('Helvetica-Bold')
    .text(`${metrics.from}  –  ${metrics.to}`, M, y + 12, {
      width: CW, align: 'right', lineBreak: false,
    });
  doc.fontSize(8.5).fillColor('rgba(255,255,255,0.55)').font('Helvetica')
    .text('Confidential — For Internal Use Only', M, y + 30, {
      width: CW, align: 'right', lineBreak: false,
    });
  doc.save().opacity(0.25).rect(0, y + 57, PW, 3).fill(C.WHITE).restore();

  doc.end();
  return stream;
}
