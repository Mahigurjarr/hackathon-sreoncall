/**
 * Migration script: Transform ticket types and priorities to the new work ticket system.
 *
 * Type mapping:
 *   incident → bug, service_request → task, change → task, problem → bug, task → task
 *
 * Priority mapping:
 *   1 → high, 2 → high, 3 → medium, 4 → low, 5 → low
 *
 * Also:
 *   - Backfills time_estimate_raw from time_estimate_minutes
 *   - Initializes linked_incident_ids and linked_change_request_ids to []
 *   - Sets all existing work logs to status: 'approved'
 *
 * Idempotent: skips documents already in new format.
 *
 * Usage:
 *   npx tsx packages/api/src/scripts/migrate-ticket-types.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/sreoncall';

const TYPE_MAP: Record<string, string> = {
  incident: 'bug',
  service_request: 'task',
  change: 'task',
  problem: 'bug',
  task: 'task',
};

const PRIORITY_MAP: Record<number, string> = {
  1: 'high',
  2: 'high',
  3: 'medium',
  4: 'low',
  5: 'low',
};

const NEW_TYPES = new Set(['epic', 'user_story', 'task', 'bug']);
const NEW_PRIORITIES = new Set(['high', 'medium', 'low']);

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 480;
const MINUTES_PER_WEEK = 2400;

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  if (minutes >= MINUTES_PER_WEEK && minutes % MINUTES_PER_WEEK === 0) return `${minutes / MINUTES_PER_WEEK}w`;
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}d`;
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR}h`;
  if (minutes >= MINUTES_PER_HOUR) {
    const h = Math.floor(minutes / MINUTES_PER_HOUR);
    const m = minutes % MINUTES_PER_HOUR;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

async function migrate() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  const db = mongoose.connection.db!;
  const ticketsCol = db.collection('tickets');
  const workLogsCol = db.collection('work_logs');

  // --- Migrate tickets ---
  console.log('\n--- Migrating tickets ---');

  const tickets = await ticketsCol.find({}).toArray();
  let ticketUpdated = 0;
  let ticketSkipped = 0;

  for (const ticket of tickets) {
    const updates: Record<string, any> = {};
    const setOnInsert: Record<string, any> = {};

    // Type migration
    const currentType = ticket.type as string;
    if (!NEW_TYPES.has(currentType) && TYPE_MAP[currentType]) {
      updates.type = TYPE_MAP[currentType];
    } else if (NEW_TYPES.has(currentType)) {
      // Already migrated
    } else {
      updates.type = 'task'; // fallback
    }

    // Priority migration
    const currentPriority = ticket.priority;
    if (typeof currentPriority === 'number' && PRIORITY_MAP[currentPriority]) {
      updates.priority = PRIORITY_MAP[currentPriority];
    } else if (typeof currentPriority === 'string' && NEW_PRIORITIES.has(currentPriority)) {
      // Already migrated
    } else {
      updates.priority = 'medium'; // fallback
    }

    // Backfill time_estimate_raw
    if (!ticket.time_estimate_raw && ticket.time_estimate_minutes && ticket.time_estimate_minutes > 0) {
      updates.time_estimate_raw = formatMinutes(ticket.time_estimate_minutes);
    }

    // Initialize cross-entity link arrays
    if (!ticket.linked_incident_ids) {
      updates.linked_incident_ids = [];
    }
    if (!ticket.linked_change_request_ids) {
      updates.linked_change_request_ids = [];
    }

    if (Object.keys(updates).length > 0) {
      await ticketsCol.updateOne({ _id: ticket._id }, { $set: updates });
      ticketUpdated++;
    } else {
      ticketSkipped++;
    }
  }

  console.log(`Tickets: ${ticketUpdated} updated, ${ticketSkipped} skipped (already migrated)`);

  // --- Migrate work logs ---
  console.log('\n--- Migrating work logs ---');

  const result = await workLogsCol.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'approved' } },
  );
  console.log(`Work logs: ${result.modifiedCount} set to approved, ${result.matchedCount - result.modifiedCount} already had status`);

  // --- Also migrate the AI suggestion priority_suggestion field ---
  console.log('\n--- Migrating AI priority suggestions ---');
  const aiResult = await ticketsCol.updateMany(
    { 'ai.priority_suggestion': { $type: 'number' } },
    [
      {
        $set: {
          'ai.priority_suggestion': {
            $switch: {
              branches: [
                { case: { $lte: ['$ai.priority_suggestion', 2] }, then: 'high' },
                { case: { $eq: ['$ai.priority_suggestion', 3] }, then: 'medium' },
              ],
              default: 'low',
            },
          },
        },
      },
    ],
  );
  console.log(`AI suggestions: ${aiResult.modifiedCount} migrated`);

  console.log('\nMigration complete.');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
