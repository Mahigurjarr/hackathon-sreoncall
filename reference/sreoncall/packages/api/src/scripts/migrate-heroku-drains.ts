/**
 * Migrate Heroku log drains to the per-app URL format.
 *
 * Thin CLI over the heroku-drain-migrator service — the UI calls the
 * same service via POST /observability-connections/:id/migrate-heroku-drains.
 * Prefer the UI button unless you need to automate outside the platform.
 *
 * Usage:
 *   npx tsx src/scripts/migrate-heroku-drains.ts --tenant <slug>
 *   npx tsx src/scripts/migrate-heroku-drains.ts --tenant <slug> --dry-run
 *   npx tsx src/scripts/migrate-heroku-drains.ts --tenant <slug> --ingest-host https://ingest.sreoncall.com
 */
import mongoose from 'mongoose';
import { Tenant } from '../models/tenant.model';
import { migrateAllHerokuDrainsForTenant } from '../services/heroku-drain-migrator.service';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sreoncall?replicaSet=rs0';

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const tenant = get('--tenant');
  if (!tenant) {
    console.error('Missing --tenant <slug>');
    process.exit(2);
  }
  return {
    tenant: tenant as string,
    dryRun: argv.includes('--dry-run'),
    ingestHost: get('--ingest-host'),
  };
}

async function main() {
  const args = parseArgs();
  await mongoose.connect(MONGODB_URI);

  const tenant = await Tenant.findOne({ slug: args.tenant }).lean();
  if (!tenant) throw new Error(`Tenant slug "${args.tenant}" not found`);
  const tenantId = String((tenant as any)._id);
  console.log(`Tenant: ${(tenant as any).name} (${tenantId})${args.dryRun ? '  [DRY RUN]' : ''}`);

  const reports = await migrateAllHerokuDrainsForTenant(tenantId, {
    dryRun: args.dryRun,
    ingestHost: args.ingestHost,
  });

  for (const r of reports) {
    console.log(`\n=== Connection: ${r.connectionName} (${r.appsSeen} apps) ===`);
    for (const a of r.apps) {
      const prefix =
        a.action === 'migrated' ? '+' :
        a.action === 'already_current' ? '·' :
        a.action === 'error' ? '!' : ' ';
      const detail = a.action === 'migrated' ? ` (${a.legacyDrainsFound} legacy removed)` :
        a.action === 'error' ? ` — ${a.error}` : '';
      console.log(`  ${prefix} ${a.app}: ${a.action}${detail}`);
    }
    console.log('  totals:', JSON.stringify(r.totals));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
