/**
 * One-shot migration: convert support contract tier `schedule_id`
 * (single ObjectId) to `schedule_ids` (array of ObjectIds), and drop
 * the legacy field. Idempotent — re-running is a no-op once every
 * tier has been converted.
 *
 * Implementation note: this runs against the raw MongoDB collection
 * to bypass the model's `pre('init')` hook, which would otherwise
 * hydrate `schedule_ids` from `schedule_id` in memory and make the
 * migration appear unnecessary. We need the new shape persisted on
 * disk so future readers see it without depending on the hook.
 *
 *   ts-node packages/api/src/scripts/migrate-support-contract-schedules.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';

const COLLECTION = 'support_contracts';

async function run() {
  await connectDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No active mongoose connection');
  const coll = db.collection(COLLECTION);

  // Match docs where any tier still has the legacy `schedule_id` field,
  // even if a `schedule_ids` array also already exists (we want to drop
  // the dead key in that case too).
  const filter = { 'tiers.schedule_id': { $exists: true } };
  const matched = await coll.countDocuments(filter);

  // Aggregation pipeline rewrite: rebuild each tier with schedule_ids
  // populated from whichever source is available, omitting schedule_id.
  // Aggregation `$set` only writes the fields listed in `in:`, so the
  // legacy schedule_id is naturally stripped — no separate $unset needed.
  const result = await coll.updateMany(filter, [
    {
      $set: {
        tiers: {
          $map: {
            input: '$tiers',
            as: 't',
            in: {
              level: '$$t.level',
              name: '$$t.name',
              escalation_timeout_minutes: '$$t.escalation_timeout_minutes',
              schedule_ids: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ['$$t.schedule_ids', []] } }, 0] },
                  '$$t.schedule_ids',
                  {
                    $cond: [
                      { $ifNull: ['$$t.schedule_id', false] },
                      ['$$t.schedule_id'],
                      [],
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
  ]);

  logger.info('migrate-support-contract-schedules finished', {
    matched,
    modified: result.modifiedCount,
  });
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('migrate-support-contract-schedules failed', { error: err?.message });
  process.exit(1);
});
