/**
 * Migration: Backfill AI Notetaker plan limits onto existing tenants.
 *
 * The AI Notetaker feature added two PlanLimits fields:
 *   - ai_notetaker_enabled
 *   - max_notetaker_minutes_per_month
 *
 * Existing tenants' `plan_limits` are a stored snapshot taken before these
 * fields existed, so gating reads `undefined` (treated as disabled) even on
 * paid plans. New plan assignments pick the values up automatically via
 * getPlanLimitsFromDB; this backfills everyone already provisioned.
 *
 * Idempotent: only sets the two fields, leaving all other limits (and any
 * per-tenant overrides) untouched. Safe to run repeatedly.
 *
 * Usage: npx tsx src/scripts/migrate-notetaker-plan-limits.ts
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sreoncall?replicaSet=rs0';

// Mirrors the presets in services/billing.service.ts (PLAN_LIMITS), incl. aliases.
function notetakerLimitsForPlan(plan: string): { enabled: boolean; minutes: number } {
  switch (plan) {
    case 'growth':
      return { enabled: true, minutes: 600 };
    case 'business':
    case 'enterprise':
      return { enabled: true, minutes: 3000 };
    // free, starter, startup, pro → disabled
    default:
      return { enabled: false, minutes: 0 };
  }
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const tenants = db.collection('tenants');
  const docs = await tenants.find({}).toArray();

  let updated = 0;
  let skipped = 0;

  for (const t of docs) {
    const plan: string = t.plan || 'free';
    const want = notetakerLimitsForPlan(plan);
    const limits = t.plan_limits || {};
    const curEnabled = limits.ai_notetaker_enabled;
    const curMinutes = limits.max_notetaker_minutes_per_month;

    if (curEnabled === want.enabled && curMinutes === want.minutes) {
      skipped++;
      continue;
    }

    await tenants.updateOne(
      { _id: t._id },
      {
        $set: {
          'plan_limits.ai_notetaker_enabled': want.enabled,
          'plan_limits.max_notetaker_minutes_per_month': want.minutes,
        },
      }
    );
    updated++;
    console.log(`  ${t.slug} (${plan}) → enabled=${want.enabled}, minutes=${want.minutes}`);
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped} (already correct).`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
