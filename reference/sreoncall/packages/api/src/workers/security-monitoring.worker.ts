import { Types } from 'mongoose';
import { runSecurityChecks, SecurityThreat } from '../services/security-monitoring.service';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { User } from '../models/user.model';
import * as incidentService from '../services/incident.service';
import { logger } from '../utils/logger';

const CHECK_INTERVAL_MS = 5 * 60_000; // 5 minutes
const DEDUP_COOLDOWN_MS = 30 * 60_000; // 30 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

// In-memory dedup map: `${tenantId}:${threatType}` → timestamp of last incident creation
const dedupMap = new Map<string, number>();

function severityToNumber(severity: SecurityThreat['severity']): number {
  switch (severity) {
    case 'critical': return 1;
    case 'high':     return 2;
    case 'medium':   return 3;
    default:         return 3;
  }
}

async function getSystemUserId(tenantId: string): Promise<Types.ObjectId | null> {
  // Find the first active admin user for the tenant to use as the incident creator
  const adminUser = await User.findOne({
    tenant_id: new Types.ObjectId(tenantId),
    status: 'active',
    roles: 'Admin',
  }).select('_id').lean();

  if (adminUser) return (adminUser as any)._id as Types.ObjectId;

  // Fall back to any active user in the tenant
  const anyUser = await User.findOne({
    tenant_id: new Types.ObjectId(tenantId),
    status: 'active',
  }).select('_id').lean();

  return anyUser ? ((anyUser as any)._id as Types.ObjectId) : null;
}

async function processTenant(tenantId: string): Promise<void> {
  const threats = await runSecurityChecks(tenantId);
  if (threats.length === 0) return;

  const creatorId = await getSystemUserId(tenantId);
  if (!creatorId) {
    logger.warn('Security monitoring: no active user found for tenant, skipping incident creation', { tenantId });
    return;
  }

  const now = Date.now();

  for (const threat of threats) {
    const dedupKey = `${tenantId}:${threat.type}`;
    const lastFired = dedupMap.get(dedupKey);

    if (lastFired && now - lastFired < DEDUP_COOLDOWN_MS) {
      logger.debug('Security monitoring: suppressing duplicate threat (cooldown active)', {
        tenantId,
        type: threat.type,
        cooldownRemainingMs: DEDUP_COOLDOWN_MS - (now - lastFired),
      });
      continue;
    }

    try {
      const inc = await incidentService.createIncident({
        tenant_id: new Types.ObjectId(tenantId),
        created_by: creatorId,
        title: `[Security] ${threat.title}`,
        description: `${threat.description}\n\nMetric value: ${threat.metric_value} (threshold: ${threat.threshold})`,
        severity: severityToNumber(threat.severity),
        source: 'security_monitoring',
        labels: ['security', 'auto-detected', threat.type],
      });

      dedupMap.set(dedupKey, now);

      logger.info(`Security monitoring: auto-created incident INC-${inc.number}`, {
        tenantId,
        type: threat.type,
        severity: threat.severity,
        incidentId: inc._id,
      });
    } catch (err: any) {
      logger.error('Security monitoring: failed to create incident', {
        tenantId,
        type: threat.type,
        error: err.message,
      });
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Find all active observability connections to determine which tenants to check
    const connections = await ObservabilityConnection.find({
      status: { $in: ['connected', 'pending'] },
    }).select('tenant_id').lean();

    if (connections.length === 0) return;

    // Deduplicate tenant IDs
    const tenantIds = [...new Set(connections.map((c) => String(c.tenant_id)))];

    logger.debug(`Security monitoring worker: checking ${tenantIds.length} tenant(s)`);

    for (const tenantId of tenantIds) {
      try {
        await processTenant(tenantId);
      } catch (err: any) {
        logger.error('Security monitoring: tenant check failed', { tenantId, error: err.message });
      }
    }

    // Prune stale dedup entries to prevent unbounded memory growth
    const cutoff = Date.now() - DEDUP_COOLDOWN_MS;
    for (const [key, ts] of dedupMap.entries()) {
      if (ts < cutoff) dedupMap.delete(key);
    }
  } catch (err: any) {
    logger.error('Security monitoring worker tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

export function startSecurityMonitoringWorker(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
  // Run initial check after 60 seconds to let services initialize
  setTimeout(tick, 60_000);
  logger.info('Security monitoring worker started (interval: 5m)');
}

export function stopSecurityMonitoringWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Security monitoring worker stopped');
}
