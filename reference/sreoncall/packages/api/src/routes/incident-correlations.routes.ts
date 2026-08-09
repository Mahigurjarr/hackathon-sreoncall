import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as correlatorService from '../services/incident-correlator.service';

const router = Router();

function serializeUser(u: any) {
  if (!u || typeof u === 'string' || u._bsontype === 'ObjectId') return null;
  return { id: u._id?.toString(), name: u.name || null, email: u.email || null };
}

function serializeIncidentRef(inc: any) {
  if (!inc || typeof inc === 'string' || inc._bsontype === 'ObjectId') {
    return inc?.toString() ?? null;
  }
  return {
    id: inc._id?.toString(),
    number: inc.number,
    title: inc.title,
    severity: inc.severity,
    status: inc.status,
  };
}

function serialize(doc: any) {
  const parent = doc.parent_incident_id;
  return {
    id: doc._id?.toString() ?? doc.id,
    parent_incident_id: parent && typeof parent === 'object' && parent._id
      ? parent._id.toString()
      : (parent?.toString() ?? null),
    parent_incident: serializeIncidentRef(parent),
    correlated_incidents: (doc.correlated_incident_ids ?? []).map(serializeIncidentRef),
    status: doc.status,
    correlation_type: doc.correlation_type,
    confidence_percent: doc.confidence_percent,
    evidence: doc.evidence ?? [],
    confirmed_by: serializeUser(doc.confirmed_by),
    confirmed_at: doc.confirmed_at ?? null,
    rejected_by: serializeUser(doc.rejected_by),
    rejected_reason: doc.rejected_reason ?? null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

const confirmSchema = z.object({
  parent_incident_id: z.string().min(1),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(1000),
});

// GET /api/v1/incident-correlations
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const result = await correlatorService.list(req.tenantId.toString(), {
    status: req.query.status as string | undefined,
    incident_id: req.query.incident_id as string | undefined,
    correlation_type: req.query.correlation_type as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/incident-correlations/:id
router.get('/:id', rbac('incidents:read'), async (req: Request, res: Response) => {
  const doc = await correlatorService.getById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// POST /api/v1/incident-correlations/:id/confirm
router.post(
  '/:id/confirm',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident_correlation.confirmed', resourceType: 'incident_correlation', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = confirmSchema.parse(req.body);
    const doc = await correlatorService.confirm(
      req.tenantId.toString(),
      req.params['id'] as string,
      body.parent_incident_id,
      req.userId.toString(),
    );
    res.json(serialize(doc));
  },
);

// POST /api/v1/incident-correlations/:id/reject
router.post(
  '/:id/reject',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident_correlation.rejected', resourceType: 'incident_correlation', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = rejectSchema.parse(req.body);
    const doc = await correlatorService.reject(
      req.tenantId.toString(),
      req.params['id'] as string,
      body.reason,
      req.userId.toString(),
    );
    res.json(serialize(doc));
  },
);

// POST /api/v1/incident-correlations/:id/merge
router.post(
  '/:id/merge',
  rbac('incidents:update'),
  auditMiddleware({ action: 'incident_correlation.merged', resourceType: 'incident_correlation', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const result = await correlatorService.merge(
      req.tenantId.toString(),
      req.params['id'] as string,
    );
    res.json(result);
  },
);

export default router;
