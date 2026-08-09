import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as resolutionService from '../services/guided-resolution.service';

const router = Router({ mergeParams: true });

// POST /api/v1/incidents/:id/resolution — create resolution plan
router.post('/', rbac('incidents:update'), async (req: Request, res: Response) => {
  const plan = await resolutionService.createPlan(
    req.tenantId.toString(),
    req.params['id'] as string,
    req.userId.toString(),
  );
  res.status(201).json({ data: plan.toObject() });
});

// GET /api/v1/incidents/:id/resolution — get current plan
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const plan = await resolutionService.getPlan(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json({ data: plan.toObject() });
});

// PATCH /api/v1/incidents/:id/resolution — update plan (e.g. abandon)
router.patch('/', rbac('incidents:update'), async (req: Request, res: Response) => {
  const body = z.object({
    status:           z.enum(['abandoned']).optional(),
    abandoned_reason: z.string().max(2000).optional(),
  }).parse(req.body);

  const plan = await resolutionService.updatePlan(
    req.tenantId.toString(),
    req.params['id'] as string,
    body,
  );
  res.json({ data: plan.toObject() });
});

// POST /api/v1/incidents/:id/resolution/steps — add engineer-defined step
router.post('/steps', rbac('incidents:update'), async (req: Request, res: Response) => {
  const body = z.object({
    title:             z.string().min(1).max(500),
    description:       z.string().max(5000).optional(),
    type:              z.enum(['manual', 'command', 'rollback', 'restart', 'scale', 'config_change', 'verification', 'custom']),
    suggested_command: z.string().max(5000).optional(),
    source_reference:  z.object({
      runbook_id:      z.string().optional(),
      runbook_title:   z.string().optional(),
      incident_id:     z.string().optional(),
      incident_number: z.number().optional(),
    }).optional(),
  }).parse(req.body);

  const plan = await resolutionService.addStep(
    req.tenantId.toString(),
    req.params['id'] as string,
    body,
  );
  res.status(201).json({ data: plan.toObject() });
});

// PATCH /api/v1/incidents/:id/resolution/steps/:stepId — update step
router.patch(
  '/steps/:stepId',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const body = z.object({
      status:         z.enum(['in_progress', 'completed', 'skipped', 'failed']).optional(),
      skipped_reason: z.string().max(2000).optional(),
      notes:          z.string().max(5000).optional(),
    }).parse(req.body);

    const plan = await resolutionService.updateStep(
      req.tenantId.toString(),
      req.params['id'] as string,
      req.params['stepId'] as string,
      {
        ...body,
        completed_by: body.status === 'completed' ? req.userId.toString() : undefined,
      },
    );
    res.json({ data: plan.toObject() });
  },
);

// DELETE /api/v1/incidents/:id/resolution/steps/:stepId — delete engineer-added step
router.delete(
  '/steps/:stepId',
  rbac('incidents:update'),
  async (req: Request, res: Response) => {
    const plan = await resolutionService.deleteStep(
      req.tenantId.toString(),
      req.params['id'] as string,
      req.params['stepId'] as string,
    );
    res.json({ data: plan.toObject() });
  },
);

// POST /api/v1/incidents/:id/resolution/validate — trigger validation
router.post('/validate', rbac('incidents:update'), async (req: Request, res: Response) => {
  const plan = await resolutionService.triggerValidation(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json({ data: plan.toObject() });
});

// GET /api/v1/incidents/:id/resolution/validations — list validation results
router.get('/validations', rbac('incidents:read'), async (req: Request, res: Response) => {
  const validations = await resolutionService.getValidations(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json({ data: validations });
});

// POST /api/v1/incidents/:id/resolution/rediagnose — trigger re-diagnosis
router.post('/rediagnose', rbac('incidents:update'), async (req: Request, res: Response) => {
  const plan = await resolutionService.rediagnose(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json({ data: plan.toObject() });
});

// POST /api/v1/incidents/:id/resolution/confirm — confirm resolution
router.post('/confirm', rbac('incidents:update'), async (req: Request, res: Response) => {
  const plan = await resolutionService.confirmResolution(
    req.tenantId.toString(),
    req.params['id'] as string,
    req.userId.toString(),
  );
  res.json({ data: plan.toObject() });
});

export default router;
