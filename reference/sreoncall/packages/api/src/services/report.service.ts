import { Types } from 'mongoose';
import { WorkLog } from '../models/work-log.model';
import { Ticket } from '../models/ticket.model';
import { Team } from '../models/team.model';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export interface WorkLogReportParams {
  from: Date;
  to: Date;
  entity_type?: 'ticket' | 'incident' | 'all';
  project_id?: string;
  milestone_id?: string;
  team_id?: string;
  user_id?: string;
  source?: 'internal' | 'provider' | 'all';
  group_by: 'project' | 'ticket' | 'user' | 'team' | 'source' | 'entity_type';
  billable_only?: boolean;
  approved_only?: boolean;
  consumer_name?: string;
}

interface ReportRow {
  logged_at: Date;
  user_name: string;
  team_or_source: string;
  entity_type: string;
  project_name: string;
  entity_number: number | string;
  entity_title: string;
  duration_minutes: number;
  description: string;
  billable: boolean;
}

interface GroupedSummary {
  key: string;
  total_minutes: number;
  billable_minutes: number;
  count: number;
}

interface ReportResult {
  rows: ReportRow[];
  grouped: GroupedSummary[];
  groups: any[];
  grand_total_minutes: number;
  internal_minutes: number;
  provider_minutes: number;
  billable_minutes: number;
  ticket_minutes: number;
  incident_minutes: number;
  summary: {
    grand_total_minutes: number;
    internal_minutes: number;
    provider_minutes: number;
    billable_minutes: number;
    ticket_minutes: number;
    incident_minutes: number;
  };
}

export async function generateWorkLogReport(
  tenantId: string,
  params: WorkLogReportParams,
): Promise<ReportResult> {
  const tenantOid = new Types.ObjectId(tenantId);

  // Build base match
  const match: Record<string, any> = {
    tenant_id: tenantOid,
    logged_at: { $gte: params.from, $lte: params.to },
  };
  if (params.approved_only) {
    match.status = 'approved';
  }

  if (params.entity_type && params.entity_type !== 'all') {
    match.entity_type = params.entity_type;
  }
  if (params.source && params.source !== 'all') {
    match.source = params.source;
  }
  if (params.billable_only) {
    match.billable = true;
  }
  if (params.user_id) {
    match.user_id = new Types.ObjectId(params.user_id);
  }

  // Pre-fetch ticket IDs if project, milestone, or consumer filter
  if (params.project_id || params.milestone_id || params.consumer_name) {
    const ticketFilter: Record<string, any> = { tenant_id: tenantOid };
    if (params.project_id) ticketFilter.project_id = new Types.ObjectId(params.project_id);
    if (params.milestone_id) ticketFilter.milestone_id = new Types.ObjectId(params.milestone_id);
    if (params.consumer_name) ticketFilter['custom_fields.escalated_from'] = params.consumer_name;
    const ticketIds = await Ticket.find(ticketFilter, { _id: 1 }).lean();
    match.entity_id = { $in: ticketIds.map((t) => t._id) };
    if (params.consumer_name) match.entity_type = 'ticket';
  }

  // Pre-fetch team member IDs if team filter
  if (params.team_id) {
    const team = await Team.findOne({ _id: params.team_id, tenant_id: tenantOid }).lean();
    if (team) {
      match.user_id = { $in: team.members };
    } else {
      // No matching team, return empty
      return { rows: [], grouped: [], groups: [], grand_total_minutes: 0, internal_minutes: 0, provider_minutes: 0, billable_minutes: 0, ticket_minutes: 0, incident_minutes: 0, summary: { grand_total_minutes: 0, internal_minutes: 0, provider_minutes: 0, billable_minutes: 0, ticket_minutes: 0, incident_minutes: 0 } };
    }
  }

  // Fetch work logs
  const logs = await WorkLog.find(match).sort({ logged_at: 1 }).lean();

  // Fetch user map
  const userIds = [...new Set(logs.map((l) => l.user_id.toString()))];
  const users = await User.find({ _id: { $in: userIds } }, { name: 1, email: 1 }).lean();
  const userMap = new Map(users.map((u) => [u._id.toString(), u.name || u.email || 'Unknown']));

  // Fetch ticket/incident details for enrichment
  const ticketEntityIds = [...new Set(logs.filter((l) => l.entity_type === 'ticket').map((l) => l.entity_id))];
  const incidentEntityIds = [...new Set(logs.filter((l) => l.entity_type === 'incident').map((l) => l.entity_id))];

  const tickets = ticketEntityIds.length > 0
    ? await Ticket.find({ _id: { $in: ticketEntityIds } }, { number: 1, title: 1, project_id: 1 }).lean()
    : [];
  const ticketMap = new Map(tickets.map((t) => [t._id.toString(), t]));

  // Fetch project names for tickets
  const projectIds = [...new Set(tickets.filter((t) => t.project_id).map((t) => t.project_id!.toString()))];
  let projectMap = new Map<string, string>();
  if (projectIds.length > 0) {
    const { Project } = await import('../models/project.model');
    const projects = await Project.find({ _id: { $in: projectIds } }, { name: 1 }).lean();
    projectMap = new Map(projects.map((p: any) => [p._id.toString(), p.name]));
  }

  // Fetch incident details
  let incidentMap = new Map<string, any>();
  if (incidentEntityIds.length > 0) {
    const { Incident } = await import('../models/incident.model');
    const incidents = await Incident.find({ _id: { $in: incidentEntityIds } }, { number: 1, title: 1 }).lean();
    incidentMap = new Map(incidents.map((i: any) => [i._id.toString(), i]));
  }

  // Build rows
  const rows: ReportRow[] = logs.map((l) => {
    const userName = l.source === 'provider'
      ? (l.source_user_name || 'Provider User')
      : (userMap.get(l.user_id.toString()) || 'Unknown');

    let entityNumber: number | string = '';
    let entityTitle = '';
    let projectName = '';

    if (l.entity_type === 'ticket') {
      const ticket = ticketMap.get(l.entity_id.toString());
      if (ticket) {
        entityNumber = ticket.number;
        entityTitle = ticket.title;
        projectName = ticket.project_id ? (projectMap.get(ticket.project_id.toString()) || '') : '';
      }
    } else {
      const incident = incidentMap.get(l.entity_id.toString());
      if (incident) {
        entityNumber = incident.number;
        entityTitle = incident.title;
      }
    }

    return {
      logged_at: l.logged_at,
      user_name: userName,
      team_or_source: l.source === 'provider' ? 'Provider' : 'Internal',
      entity_type: l.entity_type,
      project_name: projectName,
      entity_number: entityNumber,
      entity_title: entityTitle,
      duration_minutes: l.duration_minutes,
      description: l.description || '',
      billable: l.billable ?? true,
    };
  });

  // Compute grouped summary
  const groupMap = new Map<string, GroupedSummary>();
  for (const row of rows) {
    let key: string;
    switch (params.group_by) {
      case 'project': key = row.project_name || 'No Project'; break;
      case 'ticket': key = `${row.entity_type.toUpperCase()}-${row.entity_number}`; break;
      case 'user': key = row.user_name; break;
      case 'team': key = row.team_or_source; break;
      case 'source': key = row.team_or_source; break;
      case 'entity_type': key = row.entity_type; break;
      default: key = 'all';
    }
    const existing = groupMap.get(key) || { key, total_minutes: 0, billable_minutes: 0, count: 0 };
    existing.total_minutes += row.duration_minutes;
    if (row.billable) existing.billable_minutes += row.duration_minutes;
    existing.count += 1;
    groupMap.set(key, existing);
  }
  const grouped = Array.from(groupMap.values());

  // Compute summary
  let grandTotal = 0;
  let internalMin = 0;
  let providerMin = 0;
  let billableMin = 0;
  let ticketMin = 0;
  let incidentMin = 0;
  for (const log of logs) {
    grandTotal += log.duration_minutes;
    if (log.source === 'provider') {
      providerMin += log.duration_minutes;
    } else {
      internalMin += log.duration_minutes;
    }
    if (log.billable !== false) {
      billableMin += log.duration_minutes;
    }
    if (log.entity_type === 'ticket') {
      ticketMin += log.duration_minutes;
    } else if (log.entity_type === 'incident') {
      incidentMin += log.duration_minutes;
    }
  }

  // Build groups with entries for expandable rows
  const groupsWithEntries = grouped.map((g) => ({
    _id: g.key,
    label: g.key,
    total_minutes: g.total_minutes,
    entry_count: g.count,
    entries: rows
      .filter((r) => {
        let key: string;
        switch (params.group_by) {
          case 'project': key = r.project_name || 'No Project'; break;
          case 'ticket': key = `${r.entity_type.toUpperCase()}-${r.entity_number}`; break;
          case 'user': key = r.user_name; break;
          case 'team': key = r.team_or_source; break;
          case 'source': key = r.team_or_source; break;
          case 'entity_type': key = r.entity_type; break;
          default: key = 'all';
        }
        return key === g.key;
      })
      .map((r) => ({
        id: `${r.entity_number}-${r.duration_minutes}-${r.logged_at}`,
        user_name: r.user_name,
        entity_type: r.entity_type,
        entity_number: r.entity_number,
        entity_title: r.entity_title,
        project_name: r.project_name,
        duration_minutes: r.duration_minutes,
        description: r.description,
        source: r.team_or_source.toLowerCase(),
        billable: r.billable,
        logged_at: r.logged_at instanceof Date ? r.logged_at.toISOString() : String(r.logged_at),
      })),
  }));

  return {
    rows,
    grouped,
    groups: groupsWithEntries,
    grand_total_minutes: grandTotal,
    internal_minutes: internalMin,
    provider_minutes: providerMin,
    billable_minutes: billableMin,
    ticket_minutes: ticketMin,
    incident_minutes: incidentMin,
    summary: {
      grand_total_minutes: grandTotal,
      internal_minutes: internalMin,
      provider_minutes: providerMin,
      billable_minutes: billableMin,
      ticket_minutes: ticketMin,
      incident_minutes: incidentMin,
    },
  };
}

export function exportWorkLogCSV(report: ReportResult): string {
  const header = 'Date,User,Team/Source,Entity Type,Project,Ticket/Incident#,Title,Minutes,Hours,Description,Billable';
  const lines = report.rows.map((r) => {
    const date = r.logged_at instanceof Date ? r.logged_at.toISOString().split('T')[0] : String(r.logged_at);
    const hours = (r.duration_minutes / 60).toFixed(2);
    const escapeCsv = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    return [
      date,
      escapeCsv(r.user_name),
      escapeCsv(r.team_or_source),
      r.entity_type,
      escapeCsv(r.project_name),
      r.entity_number,
      escapeCsv(r.entity_title),
      r.duration_minutes,
      hours,
      escapeCsv(r.description),
      r.billable ? 'Yes' : 'No',
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

export function exportWorkLogPDF(
  tenantName: string,
  params: WorkLogReportParams,
  report: ReportResult,
): PassThrough {
  const stream = new PassThrough();
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
  doc.pipe(stream);

  const NAVY = '#0D1117';
  const ORANGE = '#FF6B2B';

  // Header
  doc.fontSize(20).fillColor(NAVY).text('Work Log Report', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor(ORANGE).text(tenantName, { align: 'center' });
  doc.moveDown(0.2);
  const fromStr = params.from.toISOString().split('T')[0];
  const toStr = params.to.toISOString().split('T')[0];
  doc.fontSize(10).fillColor(NAVY).text(`${fromStr} to ${toStr}`, { align: 'center' });
  doc.moveDown(1);

  // Summary table
  doc.fontSize(12).fillColor(NAVY).text('Summary', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(NAVY);
  const totalHrs = (report.summary.grand_total_minutes / 60).toFixed(2);
  const internalHrs = (report.summary.internal_minutes / 60).toFixed(2);
  const providerHrs = (report.summary.provider_minutes / 60).toFixed(2);
  const billableHrs = (report.summary.billable_minutes / 60).toFixed(2);
  doc.text(`Total Hours: ${totalHrs}    Internal: ${internalHrs}    Provider: ${providerHrs}    Billable: ${billableHrs}`);
  doc.moveDown(0.8);

  // Grouped summary
  doc.fontSize(12).fillColor(NAVY).text(`Grouped by: ${params.group_by}`, { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(NAVY);
  for (const g of report.grouped) {
    const hrs = (g.total_minutes / 60).toFixed(2);
    const bHrs = (g.billable_minutes / 60).toFixed(2);
    doc.text(`  ${g.key}: ${hrs} hrs (${g.count} entries, ${bHrs} billable hrs)`);
  }
  doc.moveDown(0.8);

  // Detail table header
  doc.fontSize(12).fillColor(NAVY).text('Detail', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor(ORANGE);
  doc.text('Date          User                    Source      Type      Project           #      Mins  Billable  Description', { continued: false });
  doc.moveDown(0.2);

  doc.fontSize(7).fillColor(NAVY);
  for (const r of report.rows.slice(0, 200)) {
    const date = r.logged_at instanceof Date ? r.logged_at.toISOString().split('T')[0] : String(r.logged_at);
    const line = `${date}  ${String(r.user_name).padEnd(22).slice(0, 22)}  ${r.team_or_source.padEnd(10).slice(0, 10)}  ${r.entity_type.padEnd(8).slice(0, 8)}  ${r.project_name.padEnd(16).slice(0, 16)}  ${String(r.entity_number).padEnd(5).slice(0, 5)}  ${String(r.duration_minutes).padStart(4)}  ${r.billable ? 'Y' : 'N'}         ${r.description.slice(0, 40)}`;
    doc.text(line);

    // Check if we need a new page
    if (doc.y > 520) {
      doc.addPage();
      doc.fontSize(7).fillColor(NAVY);
    }
  }

  if (report.rows.length > 200) {
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor(ORANGE).text(`... and ${report.rows.length - 200} more rows (export CSV for full data)`);
  }

  doc.end();
  return stream;
}

export async function getTenantName(tenantId: string): Promise<string> {
  const tenant = await Tenant.findById(tenantId, { name: 1 }).lean();
  return (tenant as any)?.name || 'Unknown Tenant';
}
