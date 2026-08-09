import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { IngestionToken } from '../models/ingestion-token.model';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.enum(['metrics:write', 'logs:write', 'traces:write'])).min(1),
  expires_at: z.string().nullable().optional(),
});

/** Hash a raw token using SHA-256 (fast, one-way — sufficient for machine tokens) */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function serialize(t: any) {
  return {
    id: t._id?.toString() ?? t.id,
    name: t.name,
    scopes: t.scopes,
    last_used_at: t.last_used_at,
    expires_at: t.expires_at,
    revoked_at: t.revoked_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

// List tokens (active, not revoked)
router.get('/', rbac('ingestion-tokens:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const docs = await IngestionToken.find({ tenant_id: tenantId }).sort({ created_at: -1 });
  res.json({ data: docs.map(serialize) });
});

// Create token — returns the raw token exactly once
router.post(
  '/',
  rbac('ingestion-tokens:create'),
  auditMiddleware({ action: 'ingestion_token.create', resourceType: 'ingestion_token' }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const body = createSchema.parse(req.body);

    // Generate a 32-byte random token with sre_ingest_ prefix
    const raw = `sre_ingest_${randomBytes(32).toString('hex')}`;
    const doc = await IngestionToken.create({
      tenant_id: tenantId,
      name: body.name,
      token_hash: hashToken(raw),
      scopes: body.scopes,
      expires_at: body.expires_at ? new Date(body.expires_at) : null,
      created_by: userId,
    });

    res.status(201).json({
      data: {
        ...serialize(doc),
        token: raw, // Only returned on creation
      },
    });
  },
);

// Revoke token
router.post(
  '/:id/revoke',
  rbac('ingestion-tokens:revoke'),
  auditMiddleware({
    action: 'ingestion_token.revoke',
    resourceType: 'ingestion_token',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const doc = await IngestionToken.findOneAndUpdate(
      { _id: req.params.id, tenant_id: tenantId, revoked_at: null },
      { $set: { revoked_at: new Date() } },
      { new: true },
    );
    if (!doc) return res.status(404).json({ error: 'Token not found or already revoked' });
    res.json({ data: serialize(doc) });
  },
);

// Delete token permanently
router.delete(
  '/:id',
  rbac('ingestion-tokens:delete'),
  auditMiddleware({
    action: 'ingestion_token.delete',
    resourceType: 'ingestion_token',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const doc = await IngestionToken.findOneAndDelete({
      _id: req.params.id,
      tenant_id: tenantId,
    });
    if (!doc) return res.status(404).json({ error: 'Token not found' });
    res.json({ message: 'Token deleted' });
  },
);

export default router;
