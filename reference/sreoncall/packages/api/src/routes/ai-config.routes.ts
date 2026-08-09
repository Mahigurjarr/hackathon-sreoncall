import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { encryptToken } from '../utils/encryption';
import { AI_PROVIDERS, isValidProviderModel } from '../services/ai-providers';
import { Tenant } from '../models/tenant.model';
import { logger } from '../utils/logger';

const router = Router();

const putSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model:    z.string().min(1),
  api_key:  z.string().min(1),
});

// GET /api/v1/settings/ai-config
router.get('/', rbac('settings:read'), async (req: Request, res: Response) => {
  const tenant = await Tenant.findById(req.tenantId).select('ai_config').lean();
  const cfg = (tenant as any)?.ai_config;
  res.json({
    provider:      cfg?.provider      ?? null,
    model:         cfg?.model         ?? null,
    api_key_hint:  cfg?.api_key_hint  ?? null,
    configured_by: cfg?.configured_by ?? null,
    configured_at: cfg?.configured_at ?? null,
  });
});

// PUT /api/v1/settings/ai-config
router.put('/', rbac('settings:update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider, model, api_key } = putSchema.parse(req.body);

    if (!isValidProviderModel(provider, model)) {
      throw AppError.badRequest(`Model "${model}" is not valid for provider "${provider}"`);
    }

    const api_key_encrypted = encryptToken(api_key);
    const api_key_hint = '...' + api_key.slice(-4);

    const updated = await Tenant.findByIdAndUpdate(
      req.tenantId,
      {
        $set: {
          'ai_config.provider':          provider,
          'ai_config.model':             model,
          'ai_config.api_key_encrypted': api_key_encrypted,
          'ai_config.api_key_hint':      api_key_hint,
          'ai_config.configured_by':     (req as any).userId ?? null,
          'ai_config.configured_at':     new Date(),
        },
      },
      { new: true },
    ).select('ai_config').lean();

    const cfg = (updated as any)?.ai_config;
    logger.info('AI config updated', { tenantId: req.tenantId, provider, model });

    res.json({
      provider:      cfg?.provider,
      model:         cfg?.model,
      api_key_hint:  cfg?.api_key_hint,
      configured_by: cfg?.configured_by,
      configured_at: cfg?.configured_at,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/settings/ai-config
router.delete('/', rbac('settings:update'), async (req: Request, res: Response) => {
  await Tenant.findByIdAndUpdate(req.tenantId, {
    $set: {
      'ai_config.provider':          null,
      'ai_config.model':             null,
      'ai_config.api_key_encrypted': null,
      'ai_config.api_key_hint':      null,
      'ai_config.configured_by':     null,
      'ai_config.configured_at':     null,
    },
  });
  logger.info('AI config cleared', { tenantId: req.tenantId });
  res.json({ success: true });
});

export default router;
