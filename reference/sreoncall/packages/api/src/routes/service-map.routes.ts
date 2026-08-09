import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { ServiceDependency } from '../models/service-dependency.model';
import { Service } from '../models/service.model';
import { ServiceMapVersion } from '../models/service-map-version.model';
import { Types } from 'mongoose';

const router = Router();

const snapshotSchema = z.object({
  change_summary: z.string().max(500).optional(),
  incident_id: z.string().optional(),
});

// GET /api/v1/service-map — full approved topology as nodes + edges
router.get('/', rbac('services:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  const [dependencies, services] = await Promise.all([
    ServiceDependency.find({ tenant_id: tenantId, status: 'approved' }).lean(),
    Service.find({ tenant_id: tenantId }).select('name type current_status owner_id').lean(),
  ]);

  const serviceMap = new Map(services.map((s) => [s._id.toString(), s]));

  const nodes = services.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    type: s.type,
    status: s.current_status,
  }));

  const edges = dependencies.map((d) => ({
    source_service_id: d.source_service_id.toString(),
    target_service_id: d.target_service_id.toString(),
    source_service_name: serviceMap.get(d.source_service_id.toString())?.name ?? 'Unknown',
    target_service_name: serviceMap.get(d.target_service_id.toString())?.name ?? 'Unknown',
    dependency_type: d.dependency_type,
    criticality: d.criticality,
    traffic: d.traffic_metadata ?? null,
  }));

  res.json({ nodes, edges, total_edges: edges.length, total_nodes: nodes.length });
});

// GET /api/v1/service-map/versions — list snapshots (newest first)
router.get('/versions', rbac('services:read'), async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const skip = Number(req.query.skip) || 0;

  const [versions, total] = await Promise.all([
    ServiceMapVersion.find({ tenant_id: req.tenantId })
      .sort({ version: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ServiceMapVersion.countDocuments({ tenant_id: req.tenantId }),
  ]);

  res.json({ data: versions, total, limit, skip });
});

// GET /api/v1/service-map/versions/:version — get a specific snapshot
router.get('/versions/:version', rbac('services:read'), async (req: Request, res: Response) => {
  const versionNum = parseInt(req.params['version'] as string, 10);
  if (isNaN(versionNum)) return res.status(400).json({ detail: 'version must be a number' });

  const snapshot = await ServiceMapVersion.findOne({
    tenant_id: req.tenantId,
    version: versionNum,
  }).lean();

  if (!snapshot) return res.status(404).json({ detail: 'Snapshot not found' });
  res.json(snapshot);
});

// POST /api/v1/service-map/snapshot — create a manual snapshot of the current approved topology
router.post(
  '/snapshot',
  rbac('services:create'),
  auditMiddleware({ action: 'service_map.snapshot_created', resourceType: 'service_map_version' }),
  async (req: Request, res: Response) => {
    const body = snapshotSchema.parse(req.body);
    const tenantId = req.tenantId;

    const [dependencies, services] = await Promise.all([
      ServiceDependency.find({ tenant_id: tenantId, status: 'approved' }).lean(),
      Service.find({ tenant_id: tenantId }).select('name').lean(),
    ]);

    const serviceMap = new Map(services.map((s) => [s._id.toString(), s.name as string]));

    // Determine next version number
    const latest = await ServiceMapVersion.findOne({ tenant_id: tenantId }).sort({ version: -1 }).lean();
    const nextVersion = (latest?.version ?? 0) + 1;

    const snapshot = await ServiceMapVersion.create({
      tenant_id: tenantId,
      version: nextVersion,
      snapshot: dependencies.map((d) => ({
        source_service_id: d.source_service_id,
        source_service_name: serviceMap.get(d.source_service_id.toString()) ?? 'Unknown',
        target_service_id: d.target_service_id,
        target_service_name: serviceMap.get(d.target_service_id.toString()) ?? 'Unknown',
        dependency_type: d.dependency_type,
        criticality: d.criticality,
      })),
      created_by: req.userId,
      change_summary: body.change_summary ?? null,
      incident_id: body.incident_id ? new Types.ObjectId(body.incident_id) : null,
    });

    res.status(201).json(snapshot);
  },
);

export default router;
