import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as configService from '../../services/platform/global-config.service';

const router = Router();

function serializeConfig(c: any) {
  return {
    _id: c._id.toString(),
    key: c.key,
    value: c.value,
    description: c.description,
    category: c.category,
    createdAt: c.createdAt?.toISOString?.() || c.createdAt,
    updatedAt: c.updatedAt?.toISOString?.() || c.updatedAt,
  };
}

const upsertConfigSchema = z.object({
  items: z.array(z.object({
    key: z.string().min(1).max(100),
    value: z.any(),
    description: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
  })),
});

// GET /platform/config
router.get('/', async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const configs = await configService.listGlobalConfigs(category);
  res.json({ data: configs.map(serializeConfig) });
});

// PATCH /platform/config
router.patch('/', async (req: Request, res: Response) => {
  const body = upsertConfigSchema.parse(req.body);
  const results = [];
  for (const item of body.items) {
    const config = await configService.upsertGlobalConfig(
      item.key,
      item.value,
      item.description,
      item.category,
    );
    results.push(serializeConfig(config));
  }
  res.json({ data: results });
});

export default router;
