import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { rbac } from '../middleware/rbac.middleware';
import { requirePlanFeature } from '../middleware/planLimit.middleware';
import * as reportService from '../services/report.service';
import * as aiSummaryService from '../services/ai-summary.service';
import * as incidentAnalytics from '../services/incident-analytics.service';
import { Postmortem } from '../models/postmortem.model';
import { ToilRecord } from '../models/toil-record.model';
import { Incident } from '../models/incident.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { AlertRule } from '../models/alert-rule.model';
import { Service } from '../models/service.model';
import { Tenant } from '../models/tenant.model';

const router = Router();

const reportQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  entity_type: z.enum(['ticket', 'incident', 'all']).optional().default('all'),
  project_id: z.string().optional(),
  milestone_id: z.string().optional(),
  team_id: z.string().optional(),
  user_id: z.string().optional(),
  source: z.enum(['internal', 'provider', 'all']).optional().default('all'),
  group_by: z.enum(['project', 'ticket', 'user', 'team', 'source', 'entity_type']).optional().default('user'),
  billable_only: z.enum(['true', 'false']).optional(),
  approved_only: z.enum(['true', 'false']).optional(),
  consumer_name: z.string().optional(),
});

function parseParams(query: any): reportService.WorkLogReportParams {
  const parsed = reportQuerySchema.parse(query);
  const from = new Date(parsed.from);
  // Set 'to' to end-of-day so the selected date is fully inclusive
  const to = new Date(parsed.to);
  to.setUTCHours(23, 59, 59, 999);

  // Max date range: 365 days
  const diffMs = to.getTime() - from.getTime();
  if (diffMs < 0) throw new Error('to must be after from');
  if (diffMs > 365 * 24 * 60 * 60 * 1000 + 86399999) throw new Error('Date range cannot exceed 365 days');

  return {
    from,
    to,
    entity_type: parsed.entity_type as any,
    project_id: parsed.project_id,
    milestone_id: parsed.milestone_id,
    team_id: parsed.team_id,
    user_id: parsed.user_id,
    source: parsed.source as any,
    group_by: parsed.group_by as any,
    billable_only: parsed.billable_only === 'true',
    approved_only: parsed.approved_only === 'true',
    consumer_name: parsed.consumer_name,
  };
}

// GET /api/v1/reports/work-logs
router.get('/work-logs', rbac('reports:read'), async (req: Request, res: Response) => {
  const params = parseParams(req.query);
  const report = await reportService.generateWorkLogReport(req.tenantId.toString(), params);
  res.json(report);
});

// GET /api/v1/reports/ai-summary — SRE executive summary PDF
router.get('/ai-summary', rbac('reports:export'), async (req: Request, res: Response) => {
  const params    = parseParams(req.query);
  const tenantOid = new mongoose.Types.ObjectId(req.tenantId.toString());

  // When filtering by consumer, resolve their name to a tenant ObjectId so we can
  // filter incidents by source_consumer_tenant_id — without this, all consumers' incidents
  // appear in every consumer-filtered report.
  let consumerTenantOid: mongoose.Types.ObjectId | null = null;
  if (params.consumer_name) {
    const ct = await Tenant.findOne({ name: params.consumer_name }).select('_id').lean().catch(() => null);
    consumerTenantOid = ct ? (ct._id as mongoose.Types.ObjectId) : null;
  }

  // Build incident query — add consumer filter when active
  const incidentDateFilter: Record<string, any> = {
    tenant_id: tenantOid,
    createdAt: { $gte: params.from, $lte: params.to },
  };
  const activeIncidentFilter: Record<string, any> = {
    tenant_id: tenantOid,
    status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
  };
  if (params.consumer_name) {
    // If the consumer name matched a known tenant, scope to their incidents only.
    // If it didn't match (e.g. legacy name), use an impossible condition so we don't
    // leak other consumers' incidents into this report.
    const consumerFilter = consumerTenantOid
      ? { source_consumer_tenant_id: consumerTenantOid }
      : { _id: new mongoose.Types.ObjectId('000000000000000000000000') };
    Object.assign(incidentDateFilter, consumerFilter);
    Object.assign(activeIncidentFilter, consumerFilter);
  }

  // Fetch all data sources in parallel; individual source failures degrade gracefully
  const [report, tenantName, incidents, activeIncidents, syntheticChecks, alertRules, services] =
    await Promise.all([
      reportService.generateWorkLogReport(req.tenantId.toString(), params),
      reportService.getTenantName(req.tenantId.toString()),
      // FIX: Mongoose timestamps creates `createdAt` (camelCase), not `created_at`
      Incident.find(incidentDateFilter)
        .select('title severity status metrics createdAt resolvedAt')
        .sort({ severity: 1, createdAt: -1 })
        .limit(200)
        .lean()
        .catch(() => []),
      Incident.find(activeIncidentFilter)
        .select('title severity status metrics createdAt')
        .sort({ severity: 1, createdAt: 1 })
        .limit(50)
        .lean()
        .catch(() => []),
      SyntheticCheck.find({ tenant_id: tenantOid })
        .select('name type status last_status uptime_24h last_response_time_ms url')
        .lean()
        .catch(() => []),
      AlertRule.find({ tenant_id: tenantOid })
        .select('name severity status alert_state trigger_count')
        .lean()
        .catch(() => []),
      Service.find({ tenant_id: tenantOid, deleted_at: null })
        .select('name type current_status cloud_metadata')
        .lean()
        .catch(() => []),
    ]);

  // Build active filters label for the PDF cover
  const filterParts: string[] = [];
  if (params.group_by && params.group_by !== 'user') filterParts.push(`Grouped by ${params.group_by}`);
  if (params.entity_type && params.entity_type !== 'all') filterParts.push(`Entity: ${params.entity_type}`);
  if (params.source && params.source !== 'all') filterParts.push(`Source: ${params.source}`);
  if (params.project_id) filterParts.push('Project filtered');
  if (params.milestone_id) filterParts.push('Milestone filtered');
  if (params.billable_only) filterParts.push('Billable only');
  if (params.consumer_name) filterParts.push(`Consumer: ${params.consumer_name}`);
  const filterLabel = filterParts.length > 0 ? filterParts.join('  ·  ') : 'All data';

  const metrics = aiSummaryService.buildMetrics(
    report as any,
    incidents as any,
    activeIncidents as any,
    syntheticChecks as any,
    alertRules as any,
    services as any,
    params.from,
    params.to,
  );
  const content   = await aiSummaryService.generateAISummaryContent(tenantName, params, metrics, req.tenantId.toString());
  const pdfStream = aiSummaryService.renderAISummaryPDF(tenantName, params, content, metrics, filterLabel);
  const fromStr   = params.from.toISOString().split('T')[0];
  const toStr     = params.to.toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sre-summary-${fromStr}-to-${toStr}.pdf"`);
  pdfStream.pipe(res);
});

// GET /api/v1/reports/work-logs/export
router.get('/work-logs/export', rbac('reports:export'), async (req: Request, res: Response) => {
  const params = parseParams(req.query);
  const format = (req.query.format as string) || 'csv';
  const report = await reportService.generateWorkLogReport(req.tenantId.toString(), params);

  if (format === 'pdf') {
    const tenantName = await reportService.getTenantName(req.tenantId.toString());
    const pdfStream = reportService.exportWorkLogPDF(tenantName, params, report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="work-log-report.pdf"');
    pdfStream.pipe(res);
  } else {
    const csv = reportService.exportWorkLogCSV(report);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="work-log-report.csv"');
    res.send(csv);
  }
});

// ---------- Incident analytics (MTTA/MTTR by classification/severity/service) ----------

const incidentAnalyticsQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

function parseIncidentAnalyticsParams(query: any): incidentAnalytics.IncidentAnalyticsParams {
  const parsed = incidentAnalyticsQuerySchema.parse(query);
  const from = new Date(parsed.from);
  const to = new Date(parsed.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('Invalid from/to date');
  }
  const diffMs = to.getTime() - from.getTime();
  if (diffMs < 0) throw new Error('to must be after from');
  if (diffMs > 365 * 24 * 60 * 60 * 1000) throw new Error('Date range cannot exceed 365 days');
  return { from, to };
}

router.get('/incidents', rbac('reports:read'), async (req: Request, res: Response) => {
  const params = parseIncidentAnalyticsParams(req.query);
  const report = await incidentAnalytics.generateIncidentAnalytics(req.tenantId.toString(), params);
  res.json(report);
});

router.get('/incidents/export', rbac('reports:export'), async (req: Request, res: Response) => {
  const params = parseIncidentAnalyticsParams(req.query);
  const format = (req.query.format as string) || 'csv';
  const report = await incidentAnalytics.generateIncidentAnalytics(req.tenantId.toString(), params);

  if (format === 'pdf') {
    const tenantName = await reportService.getTenantName(req.tenantId.toString());
    const pdfStream = incidentAnalytics.exportIncidentAnalyticsPDF(tenantName, report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="incident-analytics.pdf"');
    pdfStream.pipe(res);
  } else {
    const csv = incidentAnalytics.exportIncidentAnalyticsCSV(report);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="incident-analytics.csv"');
    res.send(csv);
  }
});

// ---------- GAP 4: Learning report routes ----------

// GET /api/v1/reports/action-items — cross-incident action item dashboard
router.get('/action-items', rbac('reports:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();
  const status = req.query.status as string | undefined;
  const owner_id = req.query.owner_id as string | undefined;

  const matchStage: any = { tenant_id: new (require('mongoose').Types.ObjectId)(tenantId) };

  const pipeline: any[] = [
    { $match: matchStage },
    { $unwind: '$action_items' },
  ];

  if (status) {
    pipeline.push({ $match: { 'action_items.status': status } });
  }
  if (owner_id) {
    pipeline.push({ $match: { 'action_items.owner_id': new (require('mongoose').Types.ObjectId)(owner_id) } });
  }

  pipeline.push({
    $group: {
      _id: null,
      total: { $sum: 1 },
      open: { $sum: { $cond: [{ $eq: ['$action_items.status', 'open'] }, 1, 0] } },
      in_progress: { $sum: { $cond: [{ $eq: ['$action_items.status', 'in_progress'] }, 1, 0] } },
      done: { $sum: { $cond: [{ $eq: ['$action_items.status', 'done'] }, 1, 0] } },
      overdue: {
        $sum: {
          $cond: [
            {
              $and: [
                { $ne: ['$action_items.status', 'done'] },
                { $ne: ['$action_items.due_date', null] },
                { $lt: ['$action_items.due_date', new Date()] },
              ],
            },
            1,
            0,
          ],
        },
      },
    },
  });

  const [stats] = await Postmortem.aggregate(pipeline);

  // Fetch individual action items with postmortem context
  const itemsPipeline: any[] = [
    { $match: matchStage },
    { $unwind: '$action_items' },
  ];
  if (status) {
    itemsPipeline.push({ $match: { 'action_items.status': status } });
  }
  if (owner_id) {
    itemsPipeline.push({ $match: { 'action_items.owner_id': new (require('mongoose').Types.ObjectId)(owner_id) } });
  }
  itemsPipeline.push(
    { $sort: { 'action_items.due_date': 1 } },
    { $limit: 100 },
    {
      $project: {
        postmortem_id: '$_id',
        postmortem_title: '$title',
        incident_id: '$incident_id',
        action_item: '$action_items',
      },
    },
  );

  const items = await Postmortem.aggregate(itemsPipeline);

  res.json({
    stats: stats ?? { total: 0, open: 0, in_progress: 0, done: 0, overdue: 0 },
    items,
  });
});

// GET /api/v1/reports/recurrence — recurrence pattern report
router.get('/recurrence', rbac('reports:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();

  const pipeline: any[] = [
    {
      $match: {
        tenant_id: new (require('mongoose').Types.ObjectId)(tenantId),
        'recurrence_pattern.is_recurring': true,
      },
    },
    { $sort: { created_at: -1 } },
    { $limit: 100 },
    {
      $project: {
        _id: 1,
        title: 1,
        incident_id: 1,
        severity: 1,
        recurrence_pattern: 1,
        root_cause: 1,
        created_at: 1,
      },
    },
  ];

  const recurring = await Postmortem.aggregate(pipeline);

  // Summary stats
  const [summary] = await Postmortem.aggregate([
    {
      $match: {
        tenant_id: new (require('mongoose').Types.ObjectId)(tenantId),
        'recurrence_pattern.is_recurring': true,
      },
    },
    {
      $group: {
        _id: null,
        total_recurring: { $sum: 1 },
        total_open_action_items_from_previous: {
          $sum: { $ifNull: ['$recurrence_pattern.open_action_items_from_previous', 0] },
        },
      },
    },
  ]);

  res.json({
    summary: summary ?? { total_recurring: 0, total_open_action_items_from_previous: 0 },
    incidents: recurring,
  });
});

// ---------- GAP 5: Toil report routes ----------

const toilQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  user_id: z.string().optional(),
  service_id: z.string().optional(),
  type: z.enum(['manual_action', 'runbook_repeat', 'alert_dismiss', 'incident_repeat']).optional(),
  limit: z.string().optional(),
});

// GET /api/v1/reports/toil — toil summary
router.get('/toil', rbac('reports:read'), requirePlanFeature('toil_tracking'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();
  const params = toilQuerySchema.parse(req.query);
  const ObjectId = require('mongoose').Types.ObjectId;

  const query: any = { tenant_id: new ObjectId(tenantId) };
  if (params.user_id) query.user_id = new ObjectId(params.user_id);
  if (params.service_id) query.service_id = new ObjectId(params.service_id);
  if (params.type) query.type = params.type;
  if (params.from || params.to) {
    query.created_at = {};
    if (params.from) query.created_at.$gte = new Date(params.from);
    if (params.to) query.created_at.$lte = new Date(params.to);
  }

  const limit = Math.min(parseInt(params.limit ?? '100', 10), 500);

  const [stats] = await ToilRecord.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        total_records: { $sum: 1 },
        total_duration_seconds: { $sum: { $ifNull: ['$duration_seconds', 0] } },
        automatable_count: { $sum: { $cond: ['$automatable', 1, 0] } },
        by_type: {
          $push: '$type',
        },
      },
    },
  ]);

  const byType = await ToilRecord.aggregate([
    { $match: query },
    { $group: { _id: '$type', count: { $sum: 1 }, total_seconds: { $sum: { $ifNull: ['$duration_seconds', 0] } } } },
    { $sort: { count: -1 } },
  ]);

  const records = await ToilRecord.find(query)
    .sort({ created_at: -1 })
    .limit(limit)
    .populate('user_id', 'name email')
    .populate('service_id', 'name')
    .lean();

  res.json({
    stats: stats
      ? { total_records: stats.total_records, total_duration_seconds: stats.total_duration_seconds, automatable_count: stats.automatable_count }
      : { total_records: 0, total_duration_seconds: 0, automatable_count: 0 },
    by_type: byType,
    records,
  });
});

// GET /api/v1/reports/toil/top-automatable — highest-impact automation opportunities
router.get('/toil/top-automatable', rbac('reports:read'), requirePlanFeature('toil_tracking'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();
  const ObjectId = require('mongoose').Types.ObjectId;

  const results = await ToilRecord.aggregate([
    { $match: { tenant_id: new ObjectId(tenantId), automatable: true } },
    {
      $group: {
        _id: { description: '$description', type: '$type', service_id: '$service_id' },
        count: { $sum: 1 },
        total_duration_seconds: { $sum: { $ifNull: ['$duration_seconds', 0] } },
        automation_suggestion: { $first: '$automation_suggestion' },
      },
    },
    { $sort: { total_duration_seconds: -1 } },
    { $limit: 20 },
  ]);

  res.json({ data: results });
});

// GET /api/v1/reports/toil/by-engineer — toil hours per engineer
router.get('/toil/by-engineer', rbac('reports:read'), requirePlanFeature('toil_tracking'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();
  const ObjectId = require('mongoose').Types.ObjectId;

  const results = await ToilRecord.aggregate([
    { $match: { tenant_id: new ObjectId(tenantId) } },
    {
      $group: {
        _id: '$user_id',
        total_records: { $sum: 1 },
        total_duration_seconds: { $sum: { $ifNull: ['$duration_seconds', 0] } },
        automatable_count: { $sum: { $cond: ['$automatable', 1, 0] } },
      },
    },
    { $sort: { total_duration_seconds: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  ]);

  res.json({ data: results });
});

// GET /api/v1/reports/toil/by-service — toil hours per service
router.get('/toil/by-service', rbac('reports:read'), requirePlanFeature('toil_tracking'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();
  const ObjectId = require('mongoose').Types.ObjectId;

  const results = await ToilRecord.aggregate([
    { $match: { tenant_id: new ObjectId(tenantId), service_id: { $ne: null } } },
    {
      $group: {
        _id: '$service_id',
        total_records: { $sum: 1 },
        total_duration_seconds: { $sum: { $ifNull: ['$duration_seconds', 0] } },
        automatable_count: { $sum: { $cond: ['$automatable', 1, 0] } },
      },
    },
    { $sort: { total_duration_seconds: -1 } },
    {
      $lookup: {
        from: 'services',
        localField: '_id',
        foreignField: '_id',
        as: 'service',
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
  ]);

  res.json({ data: results });
});

export default router;
