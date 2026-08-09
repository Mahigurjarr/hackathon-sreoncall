import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as registryService from '../../services/credential-registry.service';
import * as rotationService from '../../services/credential-rotation.service';
import { logger } from '../../utils/logger';

const router = Router();

function serialize(c: any) {
  return {
    ...c,
    _id: c._id?.toString?.() ?? c._id,
  };
}

const updateSettingsSchema = z.object({
  rotation_interval_days: z.number().int().min(1).max(730).optional(),
  notify_before_days: z.number().int().min(1).max(90).optional(),
  rotation_mode: z.enum(['auto', 'manual']).optional(),
});

// GET /platform/credentials
router.get('/', async (req: Request, res: Response) => {
  await registryService.refreshStatuses();
  const credentials = await registryService.listCredentials();
  res.json({ data: credentials.map(serialize) });
});

// GET /platform/credentials/:key
router.get('/:key', async (req: Request, res: Response) => {
  const credential = await registryService.getCredential(req.params['key'] as string);
  if (!credential) {
    res.status(404).json({ error: 'Credential not found' });
    return;
  }
  res.json({ data: serialize(credential) });
});

// POST /platform/credentials/seed
router.post('/seed', async (req: Request, res: Response) => {
  const result = await registryService.seedCredentials();
  res.json({ data: result });
});

// POST /platform/credentials/:key/rotate
router.post('/:key/rotate', async (req: Request, res: Response) => {
  const key = req.params['key'] as string;
  const userEmail = (req as any).user?.email || 'admin';

  const credential = await registryService.getCredential(key);
  if (!credential) {
    res.status(404).json({ error: 'Credential not found' });
    return;
  }

  // External/manual credentials: just mark complete (no automated rotation)
  if (credential.category === 'external' || credential.rotation_mode === 'manual') {
    await registryService.markRotationComplete(key, userEmail, null);
    const updated = await registryService.getCredential(key);
    res.json({ data: serialize(updated) });
    return;
  }

  // Internal/auto credentials: execute rotation via rotation service
  await registryService.markRotationStarted(key);

  try {
    logger.info('Credential rotation dispatched', { key });

    const result = await rotationService.rotateCredential(key);

    if (result.success) {
      await registryService.markRotationComplete(key, userEmail, result.newValueHint || null);
      const updated = await registryService.getCredential(key);
      res.json({ data: serialize(updated) });
    } else {
      await registryService.markRotationFailed(key, userEmail, result.error || 'Rotation failed');
      const updated = await registryService.getCredential(key);
      res.status(500).json({ error: result.error || 'Rotation failed', data: serialize(updated) });
    }
  } catch (err: any) {
    logger.error('Credential rotation unexpected error', { key, error: err.message });
    await registryService.markRotationFailed(key, userEmail, err.message);
    const updated = await registryService.getCredential(key);
    res.status(500).json({ error: err.message, data: serialize(updated) });
  }
});

// PATCH /platform/credentials/:key
router.patch('/:key', async (req: Request, res: Response) => {
  const key = req.params['key'] as string;
  const body = updateSettingsSchema.parse(req.body);

  const updated = await registryService.updateCredentialSettings(key, body);
  if (!updated) {
    res.status(404).json({ error: 'Credential not found' });
    return;
  }
  res.json({ data: serialize(updated) });
});

export default router;
