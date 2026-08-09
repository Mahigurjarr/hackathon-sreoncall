import { Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { Incident } from '../models/incident.model';

export interface IncidentAnalyticsParams {
  from: Date;
  to: Date;
}

interface MetricSummary {
  mean: number | null;
  median: number | null;
  p95: number | null;
}

export interface IncidentAnalyticsReport {
  range: { from: string; to: string };
  summary: {
    total_incidents: number;
    resolved_incidents: number;
    open_incidents: number;
    mtta_seconds: MetricSummary;
    mttr_seconds: MetricSummary;
  };
  by_classification: Array<{
    classification: string;
    count: number;
    resolved: number;
    mtta_mean_seconds: number | null;
    mttr_mean_seconds: number | null;
  }>;
  by_severity: Array<{
    severity: number;
    count: number;
    mtta_mean_seconds: number | null;
    mttr_mean_seconds: number | null;
  }>;
  by_service: Array<{
    service_id: string | null;
    service_name: string;
    classification: string;
    count: number;
    mtta_mean_seconds: number | null;
    mttr_mean_seconds: number | null;
  }>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

function summarize(values: Array<number | null | undefined>): MetricSummary {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return { mean: null, median: null, p95: null };
  const sorted = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { mean, median: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

const CLOSED_STATUSES = ['resolved', 'closed'];
const UNCLASSIFIED = 'unclassified';

export async function generateIncidentAnalytics(
  tenantId: string,
  params: IncidentAnalyticsParams,
): Promise<IncidentAnalyticsReport> {
  const tenantOid = new Types.ObjectId(tenantId);

  const incidents = await Incident.aggregate<{
    _id: Types.ObjectId;
    severity: number;
    status: string;
    mtta_seconds: number | null;
    mttr_seconds: number | null;
    first_service: { _id: Types.ObjectId; name: string; classification: string | null } | null;
  }>([
    {
      $match: {
        tenant_id: tenantOid,
        createdAt: { $gte: params.from, $lte: params.to },
      },
    },
    {
      $project: {
        severity: 1,
        status: 1,
        mtta_seconds: '$metrics.mtta_seconds',
        mttr_seconds: '$metrics.mttr_seconds',
        // Guard $arrayElemAt: some legacy incidents stored affected_service_ids
        // as a scalar (or null) rather than an array. $arrayElemAt throws
        // (Location28689) on a non-array first arg, which 500s the whole report.
        // Coerce anything that isn't an array to [] → first_service_id null.
        first_service_id: {
          $arrayElemAt: [
            { $cond: [{ $isArray: '$affected_service_ids' }, '$affected_service_ids', []] },
            0,
          ],
        },
      },
    },
    {
      $lookup: {
        from: 'services',
        localField: 'first_service_id',
        foreignField: '_id',
        as: 'svc',
        pipeline: [{ $project: { name: 1, classification: 1 } }],
      },
    },
    {
      $project: {
        severity: 1,
        status: 1,
        mtta_seconds: 1,
        mttr_seconds: 1,
        first_service: { $arrayElemAt: ['$svc', 0] },
      },
    },
  ]);

  const total = incidents.length;
  const resolved = incidents.filter((i) => CLOSED_STATUSES.includes(i.status)).length;

  const summary: IncidentAnalyticsReport['summary'] = {
    total_incidents: total,
    resolved_incidents: resolved,
    open_incidents: total - resolved,
    mtta_seconds: summarize(incidents.map((i) => i.mtta_seconds)),
    mttr_seconds: summarize(incidents.map((i) => i.mttr_seconds)),
  };

  // by_classification
  const byClassMap = new Map<string, { count: number; resolved: number; mtta: number[]; mttr: number[] }>();
  for (const inc of incidents) {
    const cls = inc.first_service?.classification ?? UNCLASSIFIED;
    let bucket = byClassMap.get(cls);
    if (!bucket) {
      bucket = { count: 0, resolved: 0, mtta: [], mttr: [] };
      byClassMap.set(cls, bucket);
    }
    bucket.count++;
    if (CLOSED_STATUSES.includes(inc.status)) bucket.resolved++;
    if (typeof inc.mtta_seconds === 'number') bucket.mtta.push(inc.mtta_seconds);
    if (typeof inc.mttr_seconds === 'number') bucket.mttr.push(inc.mttr_seconds);
  }
  const by_classification = Array.from(byClassMap.entries())
    .map(([classification, b]) => ({
      classification,
      count: b.count,
      resolved: b.resolved,
      mtta_mean_seconds: b.mtta.length ? b.mtta.reduce((a, x) => a + x, 0) / b.mtta.length : null,
      mttr_mean_seconds: b.mttr.length ? b.mttr.reduce((a, x) => a + x, 0) / b.mttr.length : null,
    }))
    .sort((a, b) => b.count - a.count);

  // by_severity
  const bySevMap = new Map<number, { count: number; mtta: number[]; mttr: number[] }>();
  for (const inc of incidents) {
    let bucket = bySevMap.get(inc.severity);
    if (!bucket) {
      bucket = { count: 0, mtta: [], mttr: [] };
      bySevMap.set(inc.severity, bucket);
    }
    bucket.count++;
    if (typeof inc.mtta_seconds === 'number') bucket.mtta.push(inc.mtta_seconds);
    if (typeof inc.mttr_seconds === 'number') bucket.mttr.push(inc.mttr_seconds);
  }
  const by_severity = Array.from(bySevMap.entries())
    .map(([severity, b]) => ({
      severity,
      count: b.count,
      mtta_mean_seconds: b.mtta.length ? b.mtta.reduce((a, x) => a + x, 0) / b.mtta.length : null,
      mttr_mean_seconds: b.mttr.length ? b.mttr.reduce((a, x) => a + x, 0) / b.mttr.length : null,
    }))
    .sort((a, b) => a.severity - b.severity);

  // by_service (top 50)
  const bySvcMap = new Map<
    string,
    { service_id: string | null; service_name: string; classification: string; count: number; mtta: number[]; mttr: number[] }
  >();
  for (const inc of incidents) {
    const sid = inc.first_service?._id?.toString() ?? null;
    const name = inc.first_service?.name ?? 'No service assigned';
    const cls = inc.first_service?.classification ?? UNCLASSIFIED;
    const key = sid ?? '__none__';
    let bucket = bySvcMap.get(key);
    if (!bucket) {
      bucket = { service_id: sid, service_name: name, classification: cls, count: 0, mtta: [], mttr: [] };
      bySvcMap.set(key, bucket);
    }
    bucket.count++;
    if (typeof inc.mtta_seconds === 'number') bucket.mtta.push(inc.mtta_seconds);
    if (typeof inc.mttr_seconds === 'number') bucket.mttr.push(inc.mttr_seconds);
  }
  const by_service = Array.from(bySvcMap.values())
    .map((b) => ({
      service_id: b.service_id,
      service_name: b.service_name,
      classification: b.classification,
      count: b.count,
      mtta_mean_seconds: b.mtta.length ? b.mtta.reduce((a, x) => a + x, 0) / b.mtta.length : null,
      mttr_mean_seconds: b.mttr.length ? b.mttr.reduce((a, x) => a + x, 0) / b.mttr.length : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  return {
    range: { from: params.from.toISOString(), to: params.to.toISOString() },
    summary,
    by_classification,
    by_severity,
    by_service,
  };
}

function fmtSec(s: number | null): string {
  if (s == null) return '-';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}

function csvEscape(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export function exportIncidentAnalyticsCSV(report: IncidentAnalyticsReport): string {
  const lines: string[] = [];
  const { range, summary } = report;

  lines.push(`Incident Analytics Report,${range.from} to ${range.to}`);
  lines.push('');
  lines.push('Summary');
  lines.push('Metric,Value');
  lines.push(`Total Incidents,${summary.total_incidents}`);
  lines.push(`Resolved,${summary.resolved_incidents}`);
  lines.push(`Open,${summary.open_incidents}`);
  lines.push(`MTTA mean,${fmtSec(summary.mtta_seconds.mean)}`);
  lines.push(`MTTA median,${fmtSec(summary.mtta_seconds.median)}`);
  lines.push(`MTTA p95,${fmtSec(summary.mtta_seconds.p95)}`);
  lines.push(`MTTR mean,${fmtSec(summary.mttr_seconds.mean)}`);
  lines.push(`MTTR median,${fmtSec(summary.mttr_seconds.median)}`);
  lines.push(`MTTR p95,${fmtSec(summary.mttr_seconds.p95)}`);
  lines.push('');
  lines.push('By Classification (app / platform / infrastructure / monitoring / system / unclassified)');
  lines.push('Classification,Incidents,Resolved,MTTA mean,MTTR mean');
  for (const c of report.by_classification) {
    lines.push([csvEscape(c.classification), c.count, c.resolved, fmtSec(c.mtta_mean_seconds), fmtSec(c.mttr_mean_seconds)].join(','));
  }
  lines.push('');
  lines.push('By Severity');
  lines.push('Severity,Incidents,MTTA mean,MTTR mean');
  for (const s of report.by_severity) {
    lines.push([`SEV${s.severity}`, s.count, fmtSec(s.mtta_mean_seconds), fmtSec(s.mttr_mean_seconds)].join(','));
  }
  lines.push('');
  lines.push('By Service (top 50)');
  lines.push('Service,Classification,Incidents,MTTA mean,MTTR mean');
  for (const s of report.by_service) {
    lines.push([csvEscape(s.service_name), csvEscape(s.classification), s.count, fmtSec(s.mtta_mean_seconds), fmtSec(s.mttr_mean_seconds)].join(','));
  }
  return lines.join('\n');
}

export function exportIncidentAnalyticsPDF(
  tenantName: string,
  report: IncidentAnalyticsReport,
): PassThrough {
  const stream = new PassThrough();
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(stream);

  const NAVY = '#0D1117';
  const ORANGE = '#FF6B2B';
  const fromStr = report.range.from.slice(0, 10);
  const toStr = report.range.to.slice(0, 10);

  doc.fontSize(20).fillColor(NAVY).text('Incident Analytics', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor(ORANGE).text(tenantName, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(NAVY).text(`${fromStr} to ${toStr}`, { align: 'center' });
  doc.moveDown(1);

  // Summary
  doc.fontSize(13).fillColor(NAVY).text('Summary', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10);
  const s = report.summary;
  doc.text(`Total Incidents: ${s.total_incidents}    Resolved: ${s.resolved_incidents}    Open: ${s.open_incidents}`);
  doc.moveDown(0.2);
  doc.text(`MTTA — mean ${fmtSec(s.mtta_seconds.mean)} · median ${fmtSec(s.mtta_seconds.median)} · p95 ${fmtSec(s.mtta_seconds.p95)}`);
  doc.text(`MTTR — mean ${fmtSec(s.mttr_seconds.mean)} · median ${fmtSec(s.mttr_seconds.median)} · p95 ${fmtSec(s.mttr_seconds.p95)}`);
  doc.moveDown(0.8);

  // Classification
  doc.fontSize(13).fillColor(NAVY).text('By Classification (where time is spent)', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(ORANGE).text('Classification          Incidents  Resolved   MTTA mean   MTTR mean');
  doc.fontSize(9).fillColor(NAVY);
  for (const c of report.by_classification) {
    doc.text(`${String(c.classification).padEnd(22).slice(0, 22)}  ${String(c.count).padStart(8)}  ${String(c.resolved).padStart(8)}   ${fmtSec(c.mtta_mean_seconds).padStart(9)}   ${fmtSec(c.mttr_mean_seconds).padStart(9)}`);
  }
  doc.moveDown(0.8);

  // Severity
  doc.fontSize(13).fillColor(NAVY).text('By Severity', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(ORANGE).text('Severity   Incidents   MTTA mean   MTTR mean');
  doc.fontSize(9).fillColor(NAVY);
  for (const sev of report.by_severity) {
    doc.text(`SEV${sev.severity}       ${String(sev.count).padStart(8)}   ${fmtSec(sev.mtta_mean_seconds).padStart(9)}   ${fmtSec(sev.mttr_mean_seconds).padStart(9)}`);
  }
  doc.moveDown(0.8);

  // Top services
  doc.fontSize(13).fillColor(NAVY).text('Top Services (by incident count)', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(ORANGE).text('Service                            Class            Incidents   MTTA mean   MTTR mean');
  doc.fontSize(9).fillColor(NAVY);
  for (const svc of report.by_service.slice(0, 30)) {
    const line = `${String(svc.service_name).padEnd(33).slice(0, 33)}  ${String(svc.classification).padEnd(14).slice(0, 14)}  ${String(svc.count).padStart(8)}   ${fmtSec(svc.mtta_mean_seconds).padStart(9)}   ${fmtSec(svc.mttr_mean_seconds).padStart(9)}`;
    doc.text(line);
    if (doc.y > 760) {
      doc.addPage();
      doc.fontSize(9).fillColor(NAVY);
    }
  }

  doc.end();
  return stream;
}
