import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as iccVisibilityService from '../services/icc-visibility.service';

const router = Router();

const updateOverridesSchema = z.object({
  overrides: z.record(z.enum(['full', 'view', 'summary', 'own', 'hidden'])),
});

// GET /api/v1/icc-visibility
router.get('/', rbac('settings:read'), async (req: Request, res: Response) => {
  const configs = await iccVisibilityService.list(req.tenantId.toString());
  res.json({ data: configs });
});

// GET /api/v1/icc-visibility/:persona
router.get('/:persona', rbac('settings:read'), async (req: Request, res: Response) => {
  const config = await iccVisibilityService.getByPersona(
    req.tenantId.toString(),
    req.params['persona'] as string,
  );
  res.json(config);
});

// PATCH /api/v1/icc-visibility/:persona
router.patch(
  '/:persona',
  rbac('settings:update'),
  auditMiddleware({ action: 'icc_visibility.updated', resourceType: 'icc_visibility_config', getResourceId: (req) => req.params['persona'] as string }),
  async (req: Request, res: Response) => {
    const body = updateOverridesSchema.parse(req.body);
    const config = await iccVisibilityService.updateOverrides(
      req.tenantId.toString(),
      req.params['persona'] as string,
      body.overrides,
      req.userId.toString(),
    );
    res.json(config);
  },
);

// DELETE /api/v1/icc-visibility/:persona
router.delete(
  '/:persona',
  rbac('settings:update'),
  auditMiddleware({ action: 'icc_visibility.reset', resourceType: 'icc_visibility_config', getResourceId: (req) => req.params['persona'] as string }),
  async (req: Request, res: Response) => {
    const result = await iccVisibilityService.resetToDefaults(
      req.tenantId.toString(),
      req.params['persona'] as string,
    );
    res.json(result);
  },
);

export default router;
