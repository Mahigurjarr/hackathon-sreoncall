/**
 * One-shot migration: backfill `status_source`/`status_updated_at` on every
 * existing `services` document that does not yet have `status_source` set.
 *
 * The status-cascading engine distinguishes statuses a human set manually from
 * ones it derived itself, so it never clobbers a human override. Services that
 * predate this feature have no such field — they're treated as `manual` (the
 * safe default: assume any existing status was set the old way, not by a
 * cascade engine that didn't exist yet).
 *
 * Idempotent — services that already have `status_source` are skipped.
 *
 *   ts-node packages/api/src/scripts/migrate-service-status-source.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { Service } from '../models/service.model';

async function run() {
  await connectDatabase();

  const result = await Service.updateMany(
    { status_source: { $exists: false } },
    { $set: { status_source: 'manual', status_updated_at: new Date() } },
  );

  logger.info('Service status_source migration: complete', {
    matched: result.matchedCount,
    updated: result.modifiedCount,
  });
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Migration failed', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
