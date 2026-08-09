/**
 * One-shot migration: backfill `key` and `color` on every existing `projects`
 * document that does not yet have them.
 *
 * Tickets are now identified by a project-scoped prefix (e.g. INFRA-0411) plus
 * a colored project chip on the card. Legacy projects predate the `key`/`color`
 * fields, so this assigns:
 *   - key:   a per-tenant-unique uppercase code derived from the project name
 *            (collisions get an incrementing suffix: INFRA, INFRA2, …)
 *   - color: round-robin through PROJECT_COLORS, per tenant, for visual variety
 *
 * Idempotent — projects that already have a key are skipped.
 *
 *   ts-node packages/api/src/scripts/migrate-project-key-color.ts
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { Project } from '../models/project.model';
import { deriveProjectKeyBase, PROJECT_COLORS } from '../services/project.service';

async function run() {
  await connectDatabase();

  // Process oldest-first so key/color assignment is stable across re-runs.
  const projects = await Project.find({ deleted_at: null }).sort({ tenant_id: 1, created_at: 1 }).lean();

  // Seed per-tenant used-key sets + color counters from already-keyed projects.
  const usedKeys = new Map<string, Set<string>>();
  const colorCount = new Map<string, number>();
  for (const p of projects) {
    const tid = p.tenant_id.toString();
    if (!usedKeys.has(tid)) usedKeys.set(tid, new Set());
    if (p.key) usedKeys.get(tid)!.add(p.key);
    if (p.color) colorCount.set(tid, (colorCount.get(tid) ?? 0) + 1);
  }

  let updated = 0;
  for (const p of projects) {
    if (p.key) continue; // already migrated

    const tid = p.tenant_id.toString();
    const used = usedKeys.get(tid)!;

    const base = deriveProjectKeyBase(p.name) || 'PRJ';
    let key = base;
    for (let i = 2; used.has(key); i++) key = `${base}${i}`.slice(0, 8);
    used.add(key);

    const idx = colorCount.get(tid) ?? 0;
    const color = PROJECT_COLORS[idx % PROJECT_COLORS.length];
    colorCount.set(tid, idx + 1);

    await Project.updateOne({ _id: p._id }, { $set: { key, color } });
    updated++;
  }

  logger.info('Project key/color migration: complete', { scanned: projects.length, updated });
  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error('Migration failed', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
