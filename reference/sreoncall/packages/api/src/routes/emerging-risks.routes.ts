import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as emergingRiskService from '../services/emerging-risk.service';

const router = Router();

function serialize(doc: any) {
  const service = doc.service_id && typeof doc.service_id === 'object' ? doc.service_id : null;
  return {
    id: doc._id?.toString() ?? doc.id,
    service_id: service ? service._id?.toString() : (doc.service_id?.toString() ?? null),
    service: service ? { id: service._id?.toString(), name: service.name } : null,
    risk_type: doc.risk_type,
    severity: doc.severity,
    description: doc.description,
    current_value: doc.current_value,
    projected_value: doc.projected_value,
    projected_breach_at: doc.projected_breach_at,
    recommendation: doc.recommendation,
    cleared_at: doc.cleared_at,
    dismissed_reason: doc.dismissed_reason,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

// GET /api/v1/emerging-risks — list active emerging risks
router.get('/', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const result = await emergingRiskService.list(req.tenantId.toString(), {
    service_id: req.query.service_id as string | undefined,
    risk_type: req.query.risk_type as string | undefined,
    severity: req.query.severity as string | undefined,
    active_only: req.query.active_only !== 'false',
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor: req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/emerging-risks/:id — get risk details
router.get('/:id', rbac('monitoring-integrations:read'), async (req: Request, res: Response) => {
  const doc = await emergingRiskService.getById(req.tenantId.toString(), req.params.id as string);
  res.json({ data: serialize(doc) });
});

const dismissSchema = z.object({
  reason: z.string().min(1).max(2000),
});

// POST /api/v1/emerging-risks/:id/dismiss — dismiss risk
router.post('/:id/dismiss', rbac('monitoring-integrations:update'), async (req: Request, res: Response) => {
  const body = dismissSchema.parse(req.body);
  const doc = await emergingRiskService.dismiss(req.tenantId.toString(), req.params.id as string, body.reason);
  res.json({ data: serialize(doc) });
});

export default router;
