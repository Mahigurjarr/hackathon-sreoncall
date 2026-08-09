/**
 * Migration: Rename plan tiers to v2 canonical names and backfill new PlanLimits fields
 *
 * Run once after deploying the code with expanded PlanLimits schema.
 *
 * What it does:
 *  1. Renames legacy plan names to v2 canonical names on all Tenant and
 *     Subscription documents: starter→startup, pro→startup, business→enterprise.
 *  2. Backfills all new PlanLimits fields onto every tenant by calling
 *     getPlanLimitsFromDB() — which merges DB PlanDefinition over hardcoded
 *     fallbacks, so every field gets a correct plan-appropriate default.
 *  3. Seeds (or upserts) the four canonical PlanDefinition documents:
 *     free, startup, growth, enterprise — with all limits from the pricing table.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-plan-tiers.ts
 *   (or run via: npm run ts-node -- src/scripts/migrate-plan-tiers.ts)
 */

import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { Tenant } from '../models/tenant.model';
import { Subscription } from '../models/billing.model';
import { PlanDefinition } from '../models/plan-definition.model';
import { getPlanLimitsFromDB } from '../services/billing.service';
import { logger } from '../utils/logger';

// v2 canonical plan definitions — aligned with PLAN_LIMITS in billing.service.ts
const PLAN_DEFINITIONS = [
  {
    name: 'free',
    display_name: 'Free',
    description: 'For solo SREs and evaluation.',
    sort_order: 0,
    is_popular: false,
    price_monthly_cents: 0,
    price_yearly_cents: 0,
    features: ['∞ services', '3 users', 'Email notifications', 'Basic observability (3-day retention)'],
  },
  {
    name: 'startup',
    display_name: 'Startup',
    description: 'For small teams up to 10 people.',
    sort_order: 1,
    is_popular: false,
    price_monthly_cents: 114900,
    price_yearly_cents: 99900,
    features: ['∞ services', '10 users', 'SMS & voice notifications', 'eBPF auto-instrumentation', '7-day observability retention'],
  },
  {
    name: 'growth',
    display_name: 'Growth',
    description: 'For growing teams up to 50 people.',
    sort_order: 2,
    is_popular: true,
    price_monthly_cents: 229900,
    price_yearly_cents: 199900,
    features: ['∞ services', '50 users', 'AI-powered RCA', 'AI agent (1)', 'WhatsApp notifications', 'BYOS integrations', '15-day observability retention'],
  },
  {
    name: 'enterprise',
    display_name: 'Enterprise',
    description: 'For large organisations up to 200+ people.',
    sort_order: 3,
    is_popular: false,
    price_monthly_cents: 689900,
    price_yearly_cents: 599900,
    features: ['∞ services', '200 users', 'SSO & SCIM', '5 AI agents', 'MSP multi-tenant', '30-day observability retention'],
  },
];

async function run() {
  await connectDatabase();
  logger.info('migrate-plan-tiers: connected to database');

  // ── Step 1: Rename legacy plan names to v2 canonical names ────────────────
  // starter → startup, pro → startup, business → enterprise
  const aliasMap: Array<[string, string]> = [
    ['starter', 'startup'],
    ['pro', 'startup'],
    ['business', 'enterprise'],
  ];

  for (const [oldPlan, newPlan] of aliasMap) {
    const [tenantResult, subResult] = await Promise.all([
      Tenant.updateMany({ plan: oldPlan }, { $set: { plan: newPlan } }),
      Subscription.updateMany({ plan: oldPlan }, { $set: { plan: newPlan } }),
    ]);
    logger.info(`Renamed ${oldPlan} → ${newPlan}`, {
      tenants: tenantResult.modifiedCount,
      subscriptions: subResult.modifiedCount,
    });
  }

  // ── Step 2: Seed PlanDefinition documents ──────────────────────────────────
  for (const def of PLAN_DEFINITIONS) {
    await PlanDefinition.findOneAndUpdate(
      { name: def.name },
      { $set: { ...def, is_active: true } },
      { upsert: true, new: true }
    );
    logger.info(`Upserted PlanDefinition: ${def.name}`);
  }

  // Deactivate legacy plan definitions (starter, pro, business) if they exist
  const deactivated = await PlanDefinition.updateMany(
    { name: { $in: ['starter', 'pro', 'business'] } },
    { $set: { is_active: false } }
  );
  logger.info(`Deactivated legacy plan definitions: ${deactivated.modifiedCount}`);

  // ── Step 3: Backfill new PlanLimits fields on all tenants ─────────────────
  const tenants = await Tenant.find({}, '_id plan').lean();
  logger.info(`Backfilling plan_limits on ${tenants.length} tenants...`);

  let backfilled = 0;
  for (const t of tenants) {
    try {
      const limits = await getPlanLimitsFromDB(t.plan);
      await Tenant.findByIdAndUpdate(t._id, { $set: { plan_limits: limits } });
      backfilled++;
    } catch (err: any) {
      logger.error(`Failed to backfill tenant ${t._id}`, { error: err.message });
    }
  }

  logger.info(`Backfilled plan_limits on ${backfilled}/${tenants.length} tenants`);

  // ── Verify ─────────────────────────────────────────────────────────────────
  const legacyCount = await Tenant.countDocuments({ plan: { $in: ['starter', 'pro', 'business'] } });
  if (legacyCount > 0) {
    logger.warn(`WARNING: ${legacyCount} tenants still have legacy plan names!`);
  } else {
    logger.info('✓ No legacy plan names remain in tenants collection');
  }

  logger.info('migrate-plan-tiers: complete');
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Migration failed', { error: err.message });
  process.exit(1);
});
