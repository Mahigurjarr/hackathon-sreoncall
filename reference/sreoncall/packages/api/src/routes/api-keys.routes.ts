import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as apiKeyService from '../services/api-key.service';

const router = Router();

// API key lifetime bounds (F-06 in security assessment 2026-04-21).
// Keys must have an expiration; honour `expires_in` (seconds) when supplied,
// and cap the maximum lifetime at one year so compromised keys age out
// without requiring manual rotation.
const DEFAULT_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60;  // 90 days default
const MAX_EXPIRES_IN_SECONDS     = 365 * 24 * 60 * 60; // 365 day cap
const MIN_EXPIRES_IN_SECONDS     = 60;                 // 1 minute floor

const createKeySchema = z
  .object({
    name: z.string().min(1).max(200),
    permissions: z.array(z.string()).optional(),
    // Either expires_in (seconds) OR expires_at (ISO datetime). If both
    // provided, expires_at wins. If neither, DEFAULT_EXPIRES_IN_SECONDS.
    expires_in: z
      .number()
      .int()
      .min(MIN_EXPIRES_IN_SECONDS)
      .max(MAX_EXPIRES_IN_SECONDS)
      .optional(),
    expires_at: z.string().datetime().optional(),
  })
  .refine(
    (body) => {
      if (!body.expires_at) return true;
      const diffMs = new Date(body.expires_at).getTime() - Date.now();
      return diffMs > 0 && diffMs <= MAX_EXPIRES_IN_SECONDS * 1000;
    },
    { message: `expires_at must be in the future and within ${MAX_EXPIRES_IN_SECONDS / 86400} days`, path: ['expires_at'] },
  );

function resolveExpiresAt(body: { expires_in?: number; expires_at?: string }): Date {
  if (body.expires_at) return new Date(body.expires_at);
  const seconds = body.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS;
  return new Date(Date.now() + seconds * 1000);
}

// GET /api/v1/api-keys
router.get('/', rbac('api_keys:read'), async (req: Request, res: Response) => {
  const keys = await apiKeyService.listApiKeys(req.tenantId);
  res.json({
    data: keys.map((k) => ({
      id: k._id.toString(),
      name: k.name,
      key_prefix: k.key_prefix,
      permissions: k.permissions,
      last_used_at: k.last_used_at || null,
      expires_at: k.expires_at || null,
      created_at: k.created_at,
    })),
  });
});

// POST /api/v1/api-keys
router.post('/', rbac('api_keys:create'), async (req: Request, res: Response) => {
  const body = createKeySchema.parse(req.body);
  const { doc, rawKey } = await apiKeyService.createApiKey(req.tenantId, req.userId, {
    name: body.name,
    permissions: body.permissions,
    expires_at: resolveExpiresAt(body),
  });
  res.status(201).json({
    id: doc._id.toString(),
    name: doc.name,
    key: rawKey,
    key_prefix: doc.key_prefix,
    permissions: doc.permissions,
    expires_at: doc.expires_at || null,
    created_at: doc.created_at,
  });
});

// DELETE /api/v1/api-keys/:id
router.delete('/:id', rbac('api_keys:revoke'), async (req: Request, res: Response) => {
  await apiKeyService.revokeApiKey(req.tenantId, req.params.id as string);
  res.status(204).send();
});

export default router;
