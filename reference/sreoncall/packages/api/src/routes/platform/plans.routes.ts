import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as planService from '../../services/platform/plan-definition.service';

const router = Router();

function serializePlan(p: any) {
  return {
    _id: p._id.toString(),
    name: p.name,
    display_name: p.display_name,
    description: p.description,
    limits: p.limits,
    features: p.features,
    price_monthly_cents: p.price_monthly_cents,
    price_yearly_cents: p.price_yearly_cents,
    stripe_price_id: p.stripe_price_id || null,
    is_active: p.is_active,
    sort_order: p.sort_order,
    createdAt: p.createdAt?.toISOString?.() || p.createdAt,
    updatedAt: p.updatedAt?.toISOString?.() || p.updatedAt,
  };
}

const createPlanSchema = z.object({
  name: z.string().min(1).max(50),
  display_name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  limits: z.record(z.any()).optional(),
  features: z.array(z.string()).optional(),
  price_monthly_cents: z.number().int().min(0).optional(),
  price_yearly_cents: z.number().int().min(0).optional(),
  stripe_price_id: z.string().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const updatePlanSchema = createPlanSchema.partial().omit({ name: true });

// GET /platform/plans
router.get('/', async (_req: Request, res: Response) => {
  const plans = await planService.listPlanDefinitions();
  res.json({ data: plans.map(serializePlan) });
});

// POST /platform/plans
router.post('/', async (req: Request, res: Response) => {
  const body = createPlanSchema.parse(req.body);
  const plan = await planService.createPlanDefinition(body);
  res.status(201).json(serializePlan(plan));
});

// PATCH /platform/plans/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const body = updatePlanSchema.parse(req.body);
  const plan = await planService.updatePlanDefinition(req.params['id'] as string, body);
  res.json(serializePlan(plan));
});

// DELETE /platform/plans/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await planService.deletePlanDefinition(req.params['id'] as string);
  res.status(204).send();
});

export default router;
