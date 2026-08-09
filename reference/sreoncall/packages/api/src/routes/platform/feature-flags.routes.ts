import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as ffService from '../../services/platform/feature-flag.service';

const router = Router();

function serializeFlag(f: any) {
  return {
    _id: f._id.toString(),
    key: f.key,
    description: f.description,
    default_value: f.default_value,
    tenant_overrides: (f.tenant_overrides || []).map((o: any) => ({
      tenant_id: o.tenant_id.toString(),
      value: o.value,
    })),
    createdAt: f.createdAt?.toISOString?.() || f.createdAt,
    updatedAt: f.updatedAt?.toISOString?.() || f.updatedAt,
  };
}

const tenantOverrideSchema = z.object({
  tenant_id: z.string(),
  value: z.boolean(),
});

const createFlagSchema = z.object({
  key: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  default_value: z.boolean().optional(),
  tenant_overrides: z.array(tenantOverrideSchema).optional(),
});

const updateFlagSchema = z.object({
  description: z.string().max(500).optional(),
  default_value: z.boolean().optional(),
  tenant_overrides: z.array(tenantOverrideSchema).optional(),
});

// GET /platform/feature-flags
router.get('/', async (_req: Request, res: Response) => {
  const flags = await ffService.listFeatureFlags();
  res.json({ data: flags.map(serializeFlag) });
});

// POST /platform/feature-flags
router.post('/', async (req: Request, res: Response) => {
  const body = createFlagSchema.parse(req.body);
  const flag = await ffService.createFeatureFlag(body);
  res.status(201).json(serializeFlag(flag));
});

// PATCH /platform/feature-flags/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const body = updateFlagSchema.parse(req.body);
  const flag = await ffService.updateFeatureFlag(req.params['id'] as string, body);
  res.json(serializeFlag(flag));
});

// DELETE /platform/feature-flags/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await ffService.deleteFeatureFlag(req.params['id'] as string);
  res.status(204).send();
});

export default router;
