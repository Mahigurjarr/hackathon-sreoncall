/**
 * Migration: backfill role='owner' on existing PartnerUsers that have no role.
 *
 * Prior to the team feature, every partner org had exactly one PartnerUser.
 * This script marks all such legacy users as 'owner' so they retain full
 * access to invite teammates and manage the org.
 *
 * Idempotent: only touches documents where role is missing.
 *
 * Usage:
 *   npx tsx packages/api/src/scripts/migrate-partner-user-roles.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI =
  process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/sreoncall';

async function main() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db!;
  const coll = db.collection('partnerusers');

  const missing = await coll.countDocuments({ role: { $exists: false } });
  console.log(`PartnerUsers missing role: ${missing}`);

  const result = await coll.updateMany(
    { role: { $exists: false } },
    { $set: { role: 'owner' } }
  );
  console.log(`Set role=owner on ${result.modifiedCount} documents.`);

  // Sanity: warn if any partner org has >1 owner after backfill (shouldn't
  // happen since legacy orgs were 1:1, but catch data drift).
  const multiOwner = await coll
    .aggregate([
      { $match: { role: 'owner' } },
      { $group: { _id: '$partnerId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (multiOwner.length > 0) {
    console.warn(`WARNING: ${multiOwner.length} partner orgs now have multiple owners:`);
    for (const row of multiOwner) console.warn(`  partnerId=${row._id} owners=${row.count}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
