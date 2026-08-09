import { Types } from 'mongoose';
import { DsarRequest, DsarRequestDocument, DsarType } from '../models/dsar-request.model';
import { User } from '../models/user.model';
import { Ticket } from '../models/ticket.model';
import { Incident } from '../models/incident.model';
import { AuditLog } from '../models/audit-log.model';
import { Consent } from '../models/consent.model';
import { StatusPageSubscriber } from '../models/status-page-subscriber.model';
import { getRedis } from '../config/redis';
import { removeDocument } from './search.service';
import { logger } from '../utils/logger';
import { anonymizeIp } from '../utils/ip-anonymize';

export async function createDsarRequest(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  type: DsarType,
  notes?: string
): Promise<DsarRequestDocument> {
  return DsarRequest.create({
    tenant_id: tenantId,
    user_id: userId,
    type,
    status: 'pending',
    requested_at: new Date(),
    notes,
  });
}

export async function getDsarRequests(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<DsarRequestDocument[]> {
  return DsarRequest.find({ tenant_id: tenantId, user_id: userId }).sort({ requested_at: -1 });
}

export async function getDsarRequestById(
  requestId: string,
  tenantId: Types.ObjectId,
  userId?: Types.ObjectId
): Promise<DsarRequestDocument | null> {
  const filter: Record<string, any> = { _id: requestId, tenant_id: tenantId };
  if (userId) filter.user_id = userId;
  return DsarRequest.findOne(filter);
}

export async function listAllDsarRequests(
  filters?: { status?: string; tenant_id?: string }
): Promise<DsarRequestDocument[]> {
  const filter: Record<string, any> = {};
  if (filters?.status) filter.status = filters.status;
  if (filters?.tenant_id) filter.tenant_id = new Types.ObjectId(filters.tenant_id);
  return DsarRequest.find(filter).sort({ requested_at: -1 }).limit(200);
}

export async function updateDsarStatus(
  requestId: string,
  status: string,
  updates?: { download_url?: string; download_expires_at?: Date; notes?: string }
): Promise<DsarRequestDocument | null> {
  const req = await DsarRequest.findById(requestId);
  if (!req) return null;

  req.status = status as any;
  if (status === 'completed') req.completed_at = new Date();
  if (updates?.download_url) req.download_url = updates.download_url;
  if (updates?.download_expires_at) req.download_expires_at = updates.download_expires_at;
  if (updates?.notes) req.notes = updates.notes;

  return req.save();
}

export async function processExport(
  userId: Types.ObjectId,
  tenantId: Types.ObjectId
): Promise<Record<string, any>> {
  const tenantFilter = { tenant_id: tenantId };

  const [user, tickets, incidents, auditLogs, consents] = await Promise.all([
    User.findOne({ _id: userId, ...tenantFilter })
      .select('-password_hash -password_history -mfa.totp_secret -mfa.backup_codes')
      .lean(),
    Ticket.find({
      ...tenantFilter,
      $or: [{ assignee_id: userId }, { reporter_id: userId }],
    })
      .select('number title status priority type created_at updated_at')
      .lean(),
    Incident.find({
      ...tenantFilter,
      $or: [{ 'responders.user_id': userId }, { commander_id: userId }],
    })
      .select('number title status severity created_at updated_at')
      .lean(),
    AuditLog.find({ ...tenantFilter, 'actor.id': userId })
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean(),
    Consent.find({ ...tenantFilter, user_id: userId }).lean(),
  ]);

  // Get Redis sessions
  const redis = getRedis();
  const sessionKeys = await redis.keys(`session:${userId}:*`);
  const sessions = [];
  for (const key of sessionKeys) {
    const data = await redis.get(key);
    if (data) sessions.push(JSON.parse(data));
  }

  return {
    exported_at: new Date().toISOString(),
    user,
    tickets,
    incidents,
    audit_logs: auditLogs,
    consents,
    sessions,
  };
}

export async function processErasure(
  userId: Types.ObjectId,
  tenantId: Types.ObjectId
): Promise<void> {
  const tenantFilter = { tenant_id: tenantId };

  // 1. Anonymize user document
  const user = await User.findOne({ _id: userId, ...tenantFilter }).select(
    '+password_hash +password_history +mfa.totp_secret +mfa.backup_codes'
  );
  if (!user) {
    logger.warn('DSAR erasure: user not found', { userId: userId.toString() });
    return;
  }

  user.name = 'Deleted User';
  user.email = `deleted-${userId}@anonymized.local`;
  user.phone_number = undefined;
  user.avatar_url = undefined;
  user.password_hash = undefined;
  user.password_history = [];
  user.mfa = {
    totp_secret: undefined,
    totp_enabled: false,
    webauthn_credentials: [],
    backup_codes: [],
    mfa_enabled: false,
  };
  user.status = 'deleted';
  user.deleted_at = new Date();
  user.slack_user_id = undefined;
  user.invite_token = undefined;
  user.markModified('mfa');
  await user.save();

  // 2. Anonymize audit logs
  await AuditLog.updateMany(
    { ...tenantFilter, 'actor.id': userId },
    {
      $set: {
        'actor.email': 'deleted-user@anonymized.local',
      },
    }
  );
  // Anonymize IPs in audit logs for this user
  const userLogs = await AuditLog.find({ ...tenantFilter, 'actor.id': userId });
  for (const log of userLogs) {
    if (log.actor?.ip) {
      log.actor.ip = anonymizeIp(log.actor.ip);
      log.markModified('actor');
      await log.save();
    }
  }

  // 3. Delete from Meilisearch
  try {
    await removeDocument('users', userId.toString());
  } catch (err: any) {
    logger.warn('DSAR erasure: failed to remove user from search index', { error: err.message });
  }

  // 4. Delete Redis sessions
  const redis = getRedis();
  const sessionKeys = await redis.keys(`session:${userId}:*`);
  if (sessionKeys.length > 0) {
    await redis.del(...sessionKeys);
  }

  // 5. Delete status page subscriptions for this user's email
  const originalEmail = user.email; // already anonymized, but we stored before
  await StatusPageSubscriber.deleteMany({
    ...tenantFilter,
    email: { $regex: `^deleted-${userId}@` },
  });

  // 6. Keep consent records (needed for proving past lawful basis)

  logger.info('DSAR erasure completed', {
    userId: userId.toString(),
    tenantId: tenantId.toString(),
  });
}
