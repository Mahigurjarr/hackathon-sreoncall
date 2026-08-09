import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import { ServiceDependency } from '../models/service-dependency.model';
import * as serviceDependencyService from '../services/service-dependency.service';
import * as dependencyDiscoverySettingsService from '../services/dependency-discovery-settings.service';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { logger } from '../utils/logger';

const router = Router();
const sc = StringCodec();
const discoveryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const DISCOVERY_TYPES = ['otel_trace_scan', 'document_upload', 'network_scan'] as const;

const triggerDiscoverySchema = z.object({
  type: z.enum(DISCOVERY_TYPES),
});

function serializeDiscoveryJob(j: any) {
  return {
    id: j._id?.toString() ?? j.id,
    type: j.type,
    status: j.status,
    source: j.source ?? {},
    results: j.results ?? null,
    ai_parse_output: j.ai_parse_output ?? null,
    error_message: j.error_message ?? null,
    triggered_by: j.triggered_by?.toString() ?? null,
    started_at: j.started_at ?? null,
    completed_at: j.completed_at ?? null,
    created_at: j.createdAt,
    updated_at: j.updatedAt,
  };
}

const DEPENDENCY_TYPES = ['http', 'grpc', 'tcp', 'database', 'queue', 'cache', 'dns', 'file', 'custom'] as const;
const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;

const protocolDetailsSchema = z.object({
  port: z.number().nullable().optional(),
  path: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  queue_name: z.string().nullable().optional(),
  topic: z.string().nullable().optional(),
  database_name: z.string().nullable().optional(),
  collection_name: z.string().nullable().optional(),
}).optional();

const createSchema = z.object({
  source_service_id: z.string().min(1),
  target_service_id: z.string().min(1),
  dependency_type: z.enum(DEPENDENCY_TYPES),
  criticality: z.enum(CRITICALITIES).optional(),
  protocol_details: protocolDetailsSchema,
  notes: z.string().max(2000).optional(),
  labels: z.record(z.string()).optional(),
});

const updateSchema = z.object({
  notes: z.string().max(2000).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  protocol_details: protocolDetailsSchema,
  labels: z.record(z.string()).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

const bulkRejectSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().min(1).max(1000),
});

const snapshotSchema = z.object({
  change_summary: z.string().max(500).nullable().optional(),
  incident_id: z.string().optional(),
});

function serialize(d: any) {
  // source/target may be populated objects or plain ObjectIds
  const sourceIsPopulated = d.source_service_id && typeof d.source_service_id === 'object' && d.source_service_id.name;
  const targetIsPopulated = d.target_service_id && typeof d.target_service_id === 'object' && d.target_service_id.name;

  return {
    id: d._id?.toString() ?? d.id,
    source_service_id: sourceIsPopulated ? d.source_service_id._id.toString() : (d.source_service_id?.toString() ?? null),
    source_service_name: sourceIsPopulated ? d.source_service_id.name : null,
    target_service_id: targetIsPopulated ? d.target_service_id._id.toString() : (d.target_service_id?.toString() ?? null),
    target_service_name: targetIsPopulated ? d.target_service_id.name : null,
    dependency_type: d.dependency_type,
    protocol_details: d.protocol_details ?? {},
    criticality: d.criticality ?? 'medium',
    discovery_method: d.discovery_method,
    status: d.status,
    approved_by: d.approved_by?.toString() ?? null,
    approved_at: d.approved_at ?? null,
    rejected_reason: d.rejected_reason ?? null,
    last_seen_at: d.last_seen_at ?? null,
    first_seen_at: d.first_seen_at ?? null,
    traffic_metadata: d.traffic_metadata ?? {},
    labels: d.labels ?? {},
    notes: d.notes ?? null,
    created_by: d.created_by?.toString() ?? null,
    version: d.version ?? 1,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

function serializeVersion(v: any) {
  return {
    id: v._id?.toString() ?? v.id,
    version: v.version,
    snapshot: v.snapshot,
    created_by: v.created_by?.toString() ?? null,
    change_summary: v.change_summary ?? null,
    incident_id: v.incident_id?.toString() ?? null,
    created_at: v.createdAt,
  };
}

// GET /api/v1/service-dependencies/map — full approved topology
// NOTE: Defined before /:id to avoid route conflict
router.get('/map', rbac('services:read'), async (req: Request, res: Response) => {
  const topology = await serviceDependencyService.getFullTopology(req.tenantId.toString());
  res.json(topology);
});

// GET /api/v1/service-dependencies/map/versions — list snapshots
router.get('/map/versions', rbac('services:read'), async (req: Request, res: Response) => {
  const docs = await serviceDependencyService.getTopologyVersions(req.tenantId.toString());
  res.json({ data: docs.map(serializeVersion) });
});

// POST /api/v1/service-dependencies/map/snapshot — create snapshot
router.post('/map/snapshot', rbac('services:update'), auditMiddleware({ action: 'service_map.snapshot_created', resourceType: 'service_map_version' }), async (req: Request, res: Response) => {
  const body = snapshotSchema.parse(req.body);
  const doc = await serviceDependencyService.createSnapshot(
    req.tenantId.toString(),
    req.userId.toString(),
    body.change_summary ?? null,
    body.incident_id,
  );
  res.status(201).json(serializeVersion(doc));
});

// POST /api/v1/service-dependencies/bulk-approve
router.post('/bulk-approve', rbac('services:update'), auditMiddleware({ action: 'service_dependency.bulk_approved', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  const { ids } = bulkIdsSchema.parse(req.body);
  const result = await serviceDependencyService.bulkApprove(req.tenantId.toString(), ids, req.userId.toString());
  res.json(result);
});

// POST /api/v1/service-dependencies/bulk-reject
router.post('/bulk-reject', rbac('services:update'), auditMiddleware({ action: 'service_dependency.bulk_rejected', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  const { ids, reason } = bulkRejectSchema.parse(req.body);
  const result = await serviceDependencyService.bulkReject(req.tenantId.toString(), ids, reason, req.userId.toString());
  res.json(result);
});

// ─── Discovery settings (before /:id to avoid conflicts) ────────────────────

const discoverySettingsSchema = z.object({
  otel_trace_scanning_enabled: z.boolean().optional(),
  schedule_interval: z.enum(['1h', '6h', '12h', '24h']).optional(),
  observability_connection_id: z.string().nullable().optional(),
});

function serializeDiscoverySettings(s: any) {
  return {
    otel_trace_scanning_enabled: s.otel_trace_scanning_enabled,
    schedule_interval: s.schedule_interval,
    observability_connection_id: s.observability_connection_id?.toString() ?? null,
    next_run_at: s.next_run_at ?? null,
  };
}

// GET /api/v1/service-dependencies/discovery/settings
router.get('/discovery/settings', rbac('services:read'), async (req: Request, res: Response) => {
  const settings = await dependencyDiscoverySettingsService.getSettings(req.tenantId);
  res.json(serializeDiscoverySettings(settings));
});

// PATCH /api/v1/service-dependencies/discovery/settings
router.patch('/discovery/settings', rbac('services:update'), auditMiddleware({ action: 'discovery.settings_updated', resourceType: 'dependency_discovery_settings' }), async (req: Request, res: Response) => {
  const body = discoverySettingsSchema.parse(req.body);
  const settings = await dependencyDiscoverySettingsService.updateSettings(req.tenantId, body);
  res.json(serializeDiscoverySettings(settings));
});

// ─── Discovery routes (before /:id to avoid conflicts) ──────────────────────

// POST /api/v1/service-dependencies/discovery/trigger
router.post('/discovery/trigger', rbac('services:create'), auditMiddleware({ action: 'discovery.triggered', resourceType: 'dependency_discovery_job' }), async (req: Request, res: Response) => {
  const body = triggerDiscoverySchema.parse(req.body);
  const job = await serviceDependencyService.triggerDiscovery(req.tenantId.toString(), body.type, req.userId.toString());
  await serviceDependencyService.publishDiscoveryTriggerEvent(req.tenantId.toString(), job._id.toString(), body.type, req.userId.toString());

  // A manual run resets the tenant's auto-discovery schedule, so the
  // background scheduler doesn't immediately re-fire right behind it.
  if (body.type === 'otel_trace_scan') {
    await dependencyDiscoverySettingsService.bumpNextRunAfterManualTrigger(req.tenantId);
  }

  res.status(201).json(serializeDiscoveryJob(job));
});

// POST /api/v1/service-dependencies/discovery/upload
router.post('/discovery/upload', rbac('services:create'), discoveryUpload.single('file'), auditMiddleware({ action: 'discovery.document_uploaded', resourceType: 'dependency_discovery_job' }), async (req: Request, res: Response) => {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ detail: 'No file provided' });
    return;
  }

  const isImage = /^image\//.test(file.mimetype);
  const fileContent = isImage
    ? file.buffer.toString('base64')
    : file.buffer.toString('utf-8').slice(0, 100_000);

  const job = await serviceDependencyService.uploadDocument(
    req.tenantId.toString(),
    null,
    file.originalname,
    req.userId.toString(),
  );

  // Process inline instead of via NATS — avoids NATS 1MB payload limit for images
  try {
    const js = getJetStream();
    await js.publish('icc.discovery.document', sc.encode(JSON.stringify({
      job_id: job._id.toString(),
      tenant_id: req.tenantId.toString(),
      filename: file.originalname,
      triggered_by: req.userId.toString(),
      file_size: file.size,
      mime_type: file.mimetype,
      file_content: fileContent,
    })));
  } catch (err: any) {
    logger.error('Failed to publish discovery document event, will be retried', { error: err.message });
  }

  res.status(201).json(serializeDiscoveryJob(job));
});

// GET /api/v1/service-dependencies/discovery/jobs
router.get('/discovery/jobs', rbac('services:read'), async (req: Request, res: Response) => {
  const result = await serviceDependencyService.listDiscoveryJobs(req.tenantId.toString(), {
    status: req.query.status as string | undefined,
    type: req.query.type as string | undefined,
  });
  res.json({ data: result.map(serializeDiscoveryJob), pagination: { total: result.length } });
});

// GET /api/v1/service-dependencies/discovery/jobs/:jobId
router.get('/discovery/jobs/:jobId', rbac('services:read'), async (req: Request, res: Response) => {
  const job = await serviceDependencyService.getDiscoveryJob(req.tenantId.toString(), req.params['jobId'] as string);
  res.json(serializeDiscoveryJob(job));
});

// GET /api/v1/service-dependencies
router.get('/', rbac('services:read'), async (req: Request, res: Response) => {
  const result = await serviceDependencyService.list(req.tenantId.toString(), {
    status: req.query.status as string | undefined,
    source_service_id: req.query.source_service_id as string | undefined,
    target_service_id: req.query.target_service_id as string | undefined,
    discovery_method: req.query.discovery_method as string | undefined,
    criticality: req.query.criticality as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// POST /api/v1/service-dependencies
router.post('/', rbac('services:create'), requirePlanLimit('service_dependencies_max', async (req) => {
  return ServiceDependency.countDocuments({ tenant_id: req.tenantId });
}), auditMiddleware({ action: 'service_dependency.created', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const doc = await serviceDependencyService.create(req.tenantId.toString(), body, req.userId.toString());
  res.status(201).json(serialize(doc));
});

// GET /api/v1/service-dependencies/:id
router.get('/:id', rbac('services:read'), async (req: Request, res: Response) => {
  const doc = await serviceDependencyService.getById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// PATCH /api/v1/service-dependencies/:id
router.patch('/:id', rbac('services:update'), auditMiddleware({ action: 'service_dependency.updated', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const doc = await serviceDependencyService.update(req.tenantId.toString(), req.params['id'] as string, body);
  res.json(serialize(doc));
});

// DELETE /api/v1/service-dependencies/:id
router.delete('/:id', rbac('services:delete'), auditMiddleware({ action: 'service_dependency.deleted', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  await serviceDependencyService.remove(req.tenantId.toString(), req.params['id'] as string);
  res.status(204).send();
});

// POST /api/v1/service-dependencies/:id/approve
router.post('/:id/approve', rbac('services:update'), auditMiddleware({ action: 'service_dependency.approved', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  const doc = await serviceDependencyService.approve(req.tenantId.toString(), req.params['id'] as string, req.userId.toString());
  res.json(serialize(doc));
});

// POST /api/v1/service-dependencies/:id/reject
router.post('/:id/reject', rbac('services:update'), auditMiddleware({ action: 'service_dependency.rejected', resourceType: 'service_dependency' }), async (req: Request, res: Response) => {
  const { reason } = rejectSchema.parse(req.body);
  const doc = await serviceDependencyService.reject(req.tenantId.toString(), req.params['id'] as string, reason, req.userId.toString());
  res.json(serialize(doc));
});

export default router;
