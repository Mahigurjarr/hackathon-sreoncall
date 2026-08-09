import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import { IngestionToken } from '../models/ingestion-token.model';

const router = Router();

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// GET /api/v1/ingest/auth
// Called by nginx auth_request for ingest.sreoncall.com.
// Validates Bearer token + X-Scope-OrgID, returns 200 or 401.
router.get('/auth', async (req: Request, res: Response) => {
  const auth = (req.headers.authorization as string) || '';
  const orgId = (req.headers['x-scope-orgid'] as string) || '';

  if (!auth.startsWith('Bearer sre_ingest_') || !orgId) {
    res.status(401).end();
    return;
  }

  const raw = auth.slice('Bearer '.length);
  const hash = hashToken(raw);

  let tenantObjectId: mongoose.Types.ObjectId;
  try {
    tenantObjectId = new mongoose.Types.ObjectId(orgId);
  } catch {
    res.status(401).end();
    return;
  }

  const token = await IngestionToken.findOne({
    token_hash: hash,
    tenant_id: tenantObjectId,
    revoked_at: null,
  }).lean();

  if (!token) {
    res.status(401).end();
    return;
  }

  if (token.expires_at && token.expires_at < new Date()) {
    res.status(401).end();
    return;
  }

  // Fire-and-forget last_used_at update — don't block the response
  IngestionToken.updateOne({ _id: token._id }, { $set: { last_used_at: new Date() } }).catch(() => {});

  res.status(200).end();
});

export default router;
