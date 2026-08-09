import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as serviceTopologySettingsService from '../services/service-topology-settings.service';

const router = Router();

const discoveryMethodThresholdSchema = z.object({
  enabled: z.boolean(),
  base_observation_threshold: z.number().min(1),
});

const updateSchema = z.object({
  cascade_enabled: z.boolean().optional(),
  auto_approval: z
    .object({
      enabled: z.boolean().optional(),
      thresholds: z
        .object({
          auto_otel: discoveryMethodThresholdSchema.optional(),
          auto_network: discoveryMethodThresholdSchema.optional(),
          ai_parsed: discoveryMethodThresholdSchema.optional(),
          document_upload: discoveryMethodThresholdSchema.optional(),
        })
        .optional(),
      criticality_multiplier: z
        .object({
          critical: z.number().min(0).optional(),
          high: z.number().min(0).optional(),
          medium: z.number().min(0).optional(),
          low: z.number().min(0).optional(),
        })
        .optional(),
    })
    .optional(),
});

// GET /api/v1/service-topology-settings
router.get('/', rbac('service-dependencies:configure'), async (req: Request, res: Response) => {
  const settings = await serviceTopologySettingsService.getSettings(req.tenantId);
  res.json({ data: settings });
});

// PATCH /api/v1/service-topology-settings
router.patch('/', rbac('service-dependencies:configure'), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const settings = await serviceTopologySettingsService.updateSettings(req.tenantId, body as any);
  res.json({ data: settings });
});

export default router;
