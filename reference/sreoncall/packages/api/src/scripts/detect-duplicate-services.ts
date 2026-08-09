/**
 * Read-only report: finds existing Service documents that likely represent
 * the same real service but were created twice by the two independent
 * discovery pipelines (asset-discovery vs dependency-discovery) before their
 * normalized-name matching was wired up — e.g. 'checkout' and 'checkout-svc'.
 *
 * Does NOT merge anything automatically. Duplicates may already have
 * diverged configuration (different escalation policies, on-call schedules,
 * tags, or references from ServiceDependency / Incident.affected_service_ids /
 * BusinessImpactConfig) — merging blindly risks dropping one side's config or
 * breaking a reference. This only surfaces candidates for a human to review
 * and merge manually via the existing Service edit/delete UI.
 *
 *   ts-node packages/api/src/scripts/detect-duplicate-services.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { Service } from '../models/service.model';
import { normalizeServiceName } from '../services/service-identity.util';

async function run() {
  await connectDatabase();

  const services = await Service.find({ deleted_at: null })
    .select('_id tenant_id name source_asset_id')
    .lean();

  const byTenantAndNorm = new Map<string, Map<string, typeof services>>();
  for (const svc of services) {
    const tenantKey = svc.tenant_id.toString();
    if (!byTenantAndNorm.has(tenantKey)) byTenantAndNorm.set(tenantKey, new Map());
    const perTenant = byTenantAndNorm.get(tenantKey)!;
    const norm = normalizeServiceName(svc.name);
    if (!perTenant.has(norm)) perTenant.set(norm, []);
    perTenant.get(norm)!.push(svc);
  }

  let groupsFound = 0;
  for (const [tenantId, perTenant] of byTenantAndNorm) {
    for (const [norm, group] of perTenant) {
      const distinctNames = new Set(group.map((s) => s.name));
      if (distinctNames.size <= 1) continue;

      groupsFound++;
      logger.info('Possible duplicate services', {
        tenant_id: tenantId,
        normalized_name: norm,
        candidates: group.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          has_source_asset: Boolean(s.source_asset_id),
        })),
      });
    }
  }

  logger.info('Duplicate-service detection complete', { scanned: services.length, groupsFound });
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Detection script failed', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
