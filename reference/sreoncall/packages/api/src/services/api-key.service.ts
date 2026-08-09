import crypto from 'crypto';
import { Types } from 'mongoose';
import { ApiKey, ApiKeyDocument } from '../models/api-key.model';
import { AppError } from '../middleware/errorHandler.middleware';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function listApiKeys(tenantId: Types.ObjectId): Promise<ApiKeyDocument[]> {
  return ApiKey.find({ tenant_id: tenantId, revoked_at: { $exists: false } }).sort({ created_at: -1 });
}

export interface CreateApiKeyInput {
  name: string;
  permissions?: string[];
  expires_at?: Date;
}

export async function createApiKey(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  input: CreateApiKeyInput
): Promise<{ doc: ApiKeyDocument; rawKey: string }> {
  const rawKey = 'srk_' + crypto.randomBytes(32).toString('hex');
  const key_hash = hashKey(rawKey);
  const key_prefix = rawKey.slice(0, 12);

  const doc = await ApiKey.create({
    tenant_id: tenantId,
    name: input.name,
    key_hash,
    key_prefix,
    permissions: input.permissions || [],
    expires_at: input.expires_at,
    created_by: userId,
  });

  return { doc, rawKey };
}

export async function revokeApiKey(tenantId: Types.ObjectId, id: string): Promise<void> {
  const key = await ApiKey.findOne({ _id: id, tenant_id: tenantId, revoked_at: { $exists: false } });
  if (!key) throw AppError.notFound('API key');
  key.revoked_at = new Date();
  await key.save();
}

/**
 * Verifies a raw API key (as presented in an Authorization: Bearer header) and
 * resolves it to its owning ApiKey document. Returns null on any invalid/
 * revoked/expired key — callers should treat that as 401, not distinguish why.
 */
export async function verifyApiKey(rawKey: string): Promise<ApiKeyDocument | null> {
  const key_hash = hashKey(rawKey);
  const key = await ApiKey.findOne({ key_hash, revoked_at: { $exists: false } });
  if (!key) return null;
  if (key.expires_at && key.expires_at < new Date()) return null;

  // Fire-and-forget — auth should not slow down on this write.
  ApiKey.updateOne({ _id: key._id }, { last_used_at: new Date() }).catch(() => {});

  return key;
}
