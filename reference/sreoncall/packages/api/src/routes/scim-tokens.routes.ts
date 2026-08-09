import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { ScimToken } from '../models/scim-token.model';

const router = Router();

// GET /api/v1/scim-tokens — List SCIM tokens for the current tenant
router.get('/', async (req: Request, res: Response) => {
  const isAdmin = req.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r));
  if (!isAdmin) {
    res.status(403).json({ detail: 'Only admins can manage SCIM tokens.' });
    return;
  }

  const tokens = await ScimToken.find({ tenant_id: req.tenantId })
    .select('-token_hash')
    .sort({ createdAt: -1 });

  res.json({
    tokens: tokens.map((t) => ({
      id: t._id,
      name: t.name,
      token_prefix: t.token_prefix,
      last_used_at: t.last_used_at,
      expires_at: t.expires_at,
      created_by: t.created_by,
      revoked_at: t.revoked_at,
      created_at: t.createdAt,
    })),
  });
});

// POST /api/v1/scim-tokens — Create a new SCIM token
router.post('/', async (req: Request, res: Response) => {
  const isAdmin = req.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r));
  if (!isAdmin) {
    res.status(403).json({ detail: 'Only admins can manage SCIM tokens.' });
    return;
  }

  const body = z.object({
    name: z.string().min(1).max(200),
    expires_in_days: z.number().min(1).max(365).optional(),
  }).parse(req.body);

  // Generate a secure random token
  const rawToken = `scim_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenPrefix = rawToken.slice(0, 12);

  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000)
    : undefined;

  const scimToken = await ScimToken.create({
    tenant_id: req.tenantId,
    name: body.name,
    token_hash: tokenHash,
    token_prefix: tokenPrefix,
    expires_at: expiresAt,
    created_by: req.userId,
  });

  // Return the raw token only once — it cannot be retrieved again
  res.status(201).json({
    id: scimToken._id,
    name: scimToken.name,
    token: rawToken,
    token_prefix: tokenPrefix,
    expires_at: expiresAt,
    created_at: scimToken.createdAt,
  });
});

// DELETE /api/v1/scim-tokens/:id — Revoke a SCIM token
router.delete('/:id', async (req: Request, res: Response) => {
  const isAdmin = req.roles.some((r) => ['platform_admin', 'tenant_admin'].includes(r));
  if (!isAdmin) {
    res.status(403).json({ detail: 'Only admins can manage SCIM tokens.' });
    return;
  }

  const token = await ScimToken.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!token) {
    res.status(404).json({ detail: 'SCIM token not found.' });
    return;
  }

  token.revoked_at = new Date();
  await token.save();

  res.json({ message: 'SCIM token revoked.' });
});

export default router;
