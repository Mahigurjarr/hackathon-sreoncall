/**
 * Migration: Convert channel members from ObjectId[] to structured format
 *
 * Usage: npx tsx src/scripts/migrate-channel-members.ts
 *
 * Before: members: [ObjectId("abc"), ObjectId("def")]
 * After:  members: [{ user_id: ObjectId("abc"), role: "member", joined_at: Date }, ...]
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sreoncall?replicaSet=rs0';

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const collection = db.collection('channels');

  const channels = await collection.find({}).toArray();
  let migrated = 0;
  let skipped = 0;

  for (const channel of channels) {
    const members = channel.members || [];

    // Skip if already migrated (first element has user_id)
    if (members.length > 0 && members[0]?.user_id) {
      skipped++;
      continue;
    }

    // Convert ObjectId[] → { user_id, role, joined_at }[]
    const newMembers = members.map((m: any) => ({
      user_id: m,
      role: 'member',
      joined_at: channel.created_at || new Date(),
    }));

    // Set creator as owner if present
    if (channel.created_by) {
      const ownerIdx = newMembers.findIndex((m: any) => m.user_id?.equals?.(channel.created_by));
      if (ownerIdx >= 0) {
        newMembers[ownerIdx].role = 'owner';
      }
    }

    await collection.updateOne(
      { _id: channel._id },
      { $set: { members: newMembers } }
    );
    migrated++;
  }

  console.log(`Migration complete: ${migrated} channels migrated, ${skipped} already migrated`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
