/**
 * One-shot migration: set `verify_tls = false` on every existing
 * `synthetic_checks` document that does not yet have the field. This
 * preserves pre-feature behavior — those checks tolerated bad/expired
 * TLS certs by design.
 *
 * New checks created after this PR ships default to `verify_tls = true`
 * (secure-by-default). Admins can opt out per check by setting the field
 * to false via the API or UI toggle.
 *
 * Idempotent — re-running is a no-op once every existing row has the
 * field populated.
 *
 *   ts-node packages/api/src/scripts/migrate-synthetic-check-verify-tls.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';

const COLLECTION = 'syntheticchecks';

async function run() {
  await connectDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No active mongoose connection');
  const coll = db.collection(COLLECTION);

  const filter = { verify_tls: { $exists: false } };
  const matched = await coll.countDocuments(filter);
  logger.info('Synthetic-check verify_tls migration: candidates', { matched });

  if (matched === 0) {
    logger.info('No documents need migration — exiting.');
    await mongoose.disconnect();
    return;
  }

  const result = await coll.updateMany(filter, { $set: { verify_tls: false } });
  logger.info('Synthetic-check verify_tls migration: complete', {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });

  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Migration failed', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
