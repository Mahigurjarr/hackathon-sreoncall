/**
 * Read-only report: lists existing AlertRule documents with no `service_id`
 * linked, grouped by tenant. These predate the route-level requirement that
 * new alert rules must be mapped to a service (an unmapped alert can't
 * auto-populate affected_service_ids or route through the cascade-aware
 * status update path).
 *
 * Does not auto-assign a service to any rule — there's no reliable way to
 * guess which service an existing unmapped rule should point to. This only
 * surfaces candidates for a human to review and fix via the Alert Rules UI.
 *
 *   ts-node packages/api/src/scripts/detect-unmapped-alert-rules.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { AlertRule } from '../models/alert-rule.model';

async function run() {
  await connectDatabase();

  const rules = await AlertRule.find({ service_id: null })
    .select('_id tenant_id name status is_predefined')
    .lean();

  const byTenant = new Map<string, typeof rules>();
  for (const rule of rules) {
    const tenantKey = rule.tenant_id.toString();
    if (!byTenant.has(tenantKey)) byTenant.set(tenantKey, []);
    byTenant.get(tenantKey)!.push(rule);
  }

  for (const [tenantId, tenantRules] of byTenant) {
    logger.info('Unmapped alert rules', {
      tenant_id: tenantId,
      count: tenantRules.length,
      rules: tenantRules.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        status: r.status,
        is_predefined: r.is_predefined,
      })),
    });
  }

  logger.info('Unmapped alert rule detection complete', { scanned: rules.length, tenants: byTenant.size });
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Detection script failed', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
