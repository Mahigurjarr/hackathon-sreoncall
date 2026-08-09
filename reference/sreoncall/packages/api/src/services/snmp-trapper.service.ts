import { SnmpTrapper, ISnmpTrapper } from '../models/snmp-trapper.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';

export interface RegisterTrapperInput {
  name: string;
  hostname: string;
  version?: string;
  ip_address?: string;
}

export interface UpdateTrapperInput {
  name?: string;
  hostname?: string;
  version?: string;
  ip_address?: string;
}

export interface HeartbeatData {
  hostname: string;
  version: string;
  uptime_seconds: number;
  trap_rate: number;
  active_correlations: number;
  ip_address: string;
  config_hash: string;
}

export async function listTrappers(tenantId: string) {
  return SnmpTrapper.find({ tenant_id: tenantId }).sort({ hostname: 1 }).lean();
}

export async function getTrapper(tenantId: string, id: string) {
  const doc = await SnmpTrapper.findOne({ _id: id, tenant_id: tenantId }).lean();
  if (!doc) throw AppError.notFound('SNMP trapper not found');
  return doc;
}

export async function registerTrapper(tenantId: string, userId: string, input: RegisterTrapperInput) {
  const doc = await SnmpTrapper.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    hostname: input.hostname,
    version: input.version ?? '',
    ip_address: input.ip_address ?? '',
  });
  return doc.toObject();
}

export async function updateTrapper(tenantId: string, id: string, input: UpdateTrapperInput) {
  const doc = await SnmpTrapper.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: input },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('SNMP trapper not found');
  return doc;
}

export async function deleteTrapper(tenantId: string, id: string) {
  const doc = await SnmpTrapper.findOneAndDelete({ _id: id, tenant_id: tenantId });
  if (!doc) throw AppError.notFound('SNMP trapper not found');
}

export async function processHeartbeat(tenantId: string, tokenId: string, data: HeartbeatData) {
  const doc = await SnmpTrapper.findOneAndUpdate(
    { tenant_id: tenantId, hostname: data.hostname },
    {
      $set: {
        status: 'online',
        version: data.version,
        uptime_seconds: data.uptime_seconds,
        trap_rate: data.trap_rate,
        active_correlations: data.active_correlations,
        ip_address: data.ip_address,
        config_hash: data.config_hash,
        last_heartbeat_at: new Date(),
        ingestion_token_id: tokenId,
      },
      $setOnInsert: {
        tenant_id: tenantId,
        name: data.hostname,
        created_by: null,
      },
    },
    { new: true, upsert: true, lean: true },
  );
  logger.debug('SNMP trapper heartbeat processed', { hostname: data.hostname, tenantId });
  return doc;
}

export async function markStale() {
  const cutoff = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes ago
  const result = await SnmpTrapper.updateMany(
    { status: { $ne: 'offline' }, last_heartbeat_at: { $lt: cutoff } },
    { $set: { status: 'offline' } },
  );
  if (result.modifiedCount > 0) {
    logger.info('Marked stale SNMP trappers as offline', { count: result.modifiedCount });
  }
  return result.modifiedCount;
}
