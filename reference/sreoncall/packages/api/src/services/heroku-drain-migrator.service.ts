import mongoose from 'mongoose';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { logger } from '../utils/logger';

/**
 * Heroku log-drain URL migrator.
 *
 * The drain route used to take only {tenantId, drainToken}, so every
 * Heroku app on a customer's account shipped logs to the same URL and
 * we could never recover the real app name at label-time (Heroku's
 * syslog APP-NAME is always literally "app" or "heroku"). The new
 * route takes a 3rd path segment — the Heroku app slug — so
 * `service_name=<app>` is correct.
 *
 * This service walks every Heroku app reachable with the API key
 * stored on the tenant's Heroku ObservabilityConnection and rewrites
 * legacy 2-segment drains to the 3-segment shape. Idempotent:
 *
 *   - Already-current drains are left alone
 *   - Foreign drains (Papertrail, Datadog, etc.) are never touched
 *   - New drain is added BEFORE the legacy one is removed, so there's
 *     no window where logs fall on the floor
 *
 * Consumed by both the CLI (src/scripts/migrate-heroku-drains.ts) and
 * the HTTP endpoint (POST /observability-connections/:id/migrate-heroku-drains).
 */

export interface MigrateOptions {
  dryRun?: boolean;
  /** Override ingest host — defaults to https://ingest.sreoncall.com. */
  ingestHost?: string;
}

export interface AppMigrationAction {
  app: string;
  action: 'migrated' | 'already_current' | 'no_sreoncall_drain' | 'skipped' | 'error';
  /** Count of legacy drains found (for "migrated" / "already_current") */
  legacyDrainsFound?: number;
  /** Error message when action === "error" */
  error?: string;
  /** URL planned to be added (useful in dry-run) */
  plannedUrl?: string;
}

export interface MigrationReport {
  tenantId: string;
  connectionId: string;
  connectionName: string;
  dryRun: boolean;
  appsSeen: number;
  apps: AppMigrationAction[];
  totals: {
    migrated: number;
    already_current: number;
    no_sreoncall_drain: number;
    error: number;
  };
}

interface HerokuApp {
  id: string;
  name: string;
}

interface HerokuDrain {
  id: string;
  url: string;
  token: string;
}

interface HerokuTeam {
  id: string;
  name: string;
}

/**
 * Heroku's /apps endpoint only returns apps the authenticating user
 * is a direct collaborator of. Team-owned apps where the user has
 * only indirect access are invisible there — so we also walk every
 * team the token can see and merge team apps. Same pattern the cloud
 * discovery service uses.
 */
async function listAllReachableApps(apiKey: string): Promise<HerokuApp[]> {
  const byId = new Map<string, HerokuApp>();
  try {
    const personal = await heroku<HerokuApp[]>(apiKey, '/apps');
    for (const a of personal) byId.set(a.id, a);
  } catch {
    /* ignore — fall through to team enumeration */
  }

  try {
    const teams = await heroku<HerokuTeam[]>(apiKey, '/teams');
    for (const team of teams) {
      try {
        const teamApps = await heroku<HerokuApp[]>(apiKey, `/teams/${team.name}/apps`);
        for (const a of teamApps) byId.set(a.id, a);
      } catch {
        /* per-team failure is non-fatal */
      }
    }
  } catch {
    /* no teams or no access — fine */
  }

  return Array.from(byId.values());
}

async function heroku<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.heroku.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.heroku+json; version=3',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Heroku ${init?.method || 'GET'} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Match any URL whose PATH is the SREonCall Heroku drain path for this
 * tenant, regardless of the host. White-label tenants route drains
 * through custom domains (e.g., monitoring.thepackengers.com) and
 * earlier rollouts used app.sreoncall.com instead of the dedicated
 * ingest.sreoncall.com subdomain. Pattern:
 *   https?://<any-host>/api/v1/webhooks/heroku/logs/<tenantId>/<token>[/<appSlug>]
 */
function parseOurDrainUrl(
  url: string,
  tenantId: string,
): { host: string; token: string; app?: string } | null {
  try {
    // tenantId may arrive as a mongoose ObjectId from the request
    // middleware — coerce to the hex string so `!==` against parts[5]
    // (which is always a string from URL.pathname) works.
    const tid = String(tenantId);
    const u = new URL(url.split('?')[0]);
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    // ['api', 'v1', 'webhooks', 'heroku', 'logs', '<tenantId>', '<token>', '<app>?']
    if (parts.length < 7) return null;
    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'webhooks') return null;
    if (parts[3] !== 'heroku' || parts[4] !== 'logs') return null;
    if (parts[5] !== tid) return null;
    const token = decodeURIComponent(parts[6]);
    const app = parts[7] ? decodeURIComponent(parts[7]) : undefined;
    return { host: `${u.protocol}//${u.host}`, token, app };
  } catch {
    return null;
  }
}

function classifyDrain(
  url: string,
  tenantId: string,
  expectedToken: string,
): 'legacy' | 'current' | 'foreign' {
  const parsed = parseOurDrainUrl(url, tenantId);
  if (!parsed || parsed.token !== expectedToken) return 'foreign';
  return parsed.app ? 'current' : 'legacy';
}

function newDrainUrl(
  ingestHost: string,
  tenantId: string,
  drainToken: string,
  appSlug: string,
): string {
  return `${ingestHost.replace(/\/+$/, '')}/api/v1/webhooks/heroku/logs/${tenantId}/${drainToken}/${encodeURIComponent(appSlug)}`;
}

/**
 * Walk every app's log drains and return the first (host, token) we
 * recognise as ours. Legacy connections don't persist the token on the
 * connection doc, and customers may be using a white-label host that
 * doesn't match the platform-default ingest.sreoncall.com — so host is
 * discovered alongside the token to preserve whatever the customer
 * chose.
 */
async function discoverDrainSettingsFromHeroku(
  apiKey: string,
  tenantId: string,
): Promise<{ token: string; host: string } | undefined> {
  const apps = await listAllReachableApps(apiKey);
  for (const app of apps) {
    let drains: HerokuDrain[];
    try {
      drains = await heroku<HerokuDrain[]>(apiKey, `/apps/${app.name}/log-drains`);
    } catch {
      continue;
    }
    for (const d of drains) {
      const parsed = parseOurDrainUrl(d.url, tenantId);
      if (parsed) return { token: parsed.token, host: parsed.host };
    }
  }
  return undefined;
}

/**
 * Return every distinct drain URL across the customer's Heroku apps
 * with a short classification. Used to build an informative error when
 * token discovery can't find anything — the human can then see what
 * URLs are actually in play and figure out what's off (wrong tenantId
 * in the URL, wrong path, foreign third-party drain, etc.).
 */
async function sampleDrainUrlsFromHeroku(
  apiKey: string,
  tenantId: string,
  max = 15,
): Promise<{ url: string; recognised: boolean; app: string }[]> {
  const out: { url: string; recognised: boolean; app: string }[] = [];
  try {
    const apps = await listAllReachableApps(apiKey);
    for (const app of apps) {
      if (out.length >= max) break;
      let drains: HerokuDrain[] = [];
      try {
        drains = await heroku<HerokuDrain[]>(apiKey, `/apps/${app.name}/log-drains`);
      } catch {
        continue;
      }
      for (const d of drains) {
        if (out.length >= max) break;
        out.push({ url: d.url, app: app.name, recognised: !!parseOurDrainUrl(d.url, tenantId) });
      }
    }
  } catch {
    /* swallow — this is a best-effort diagnostic path */
  }
  return out;
}

/**
 * Run the migration for a single ObservabilityConnection. Resolves to
 * a full report regardless of per-app failures — per-app errors are
 * captured in `apps[].action === "error"` so the caller can render a
 * partial success.
 */
export async function migrateHerokuDrainsForConnection(
  tenantIdInput: string,
  connectionId: string,
  opts: MigrateOptions = {},
): Promise<MigrationReport> {
  const dryRun = !!opts.dryRun;
  // Normalise once — tenantId arrives as a mongoose ObjectId from the
  // request middleware. Strict-equality comparisons against URL path
  // segments need a plain hex string. Query filters auto-cast so the
  // Mongo lookup below still works.
  const tenantId = String(tenantIdInput);

  const conn = await ObservabilityConnection.findOne({
    _id: connectionId,
    tenant_id: tenantId,
    'config.cloud_provider': 'heroku',
  }).lean();
  if (!conn) throw new Error('Heroku connection not found for this tenant');

  const apiKey = (conn as any).config?.credentials?.api_key as string | undefined;
  let drainToken = (conn as any).config?.drain_token as string | undefined;
  if (!apiKey) throw new Error('Heroku connection is missing an api_key in config.credentials');

  // Determine both the drain_token and the ingest host to use for the
  // /new/ URLs. Priority:
  //   1. explicit opts.ingestHost + stored drain_token — fresh flows
  //   2. discover token+host from the customer's existing drains — legacy
  //   3. fall back to ingest.sreoncall.com if token was stored but host
  //      couldn't be inferred (customer deleted all their drains)
  let ingestHost = opts.ingestHost ? opts.ingestHost.replace(/\/+$/, '') : '';

  if (!drainToken || !ingestHost) {
    const discovered = await discoverDrainSettingsFromHeroku(apiKey, tenantId);
    if (discovered) {
      if (!drainToken) drainToken = discovered.token;
      if (!ingestHost) ingestHost = discovered.host;
    }
  }

  if (!drainToken) {
    // Build a diagnostic sample of actual drain URLs so the operator
    // sees exactly what's configured and can spot the mismatch (wrong
    // tenantId in the URL, a different path, a Papertrail-style drain,
    // etc.). Everything here is best-effort; we still throw if token
    // discovery failed.
    const samples = await sampleDrainUrlsFromHeroku(apiKey, tenantId);
    if (samples.length === 0) {
      throw new Error(
        'Could not determine the drain token. The Heroku API key works but none ' +
          'of the apps on the account have any log drains configured at all. ' +
          'Add a drain from the Connect wizard, then re-run this migration.',
      );
    }
    const lines = samples
      .slice(0, 8)
      .map(
        (s) =>
          `  • ${s.recognised ? '[MATCH]  ' : '[unmatched]'} ${s.app}: ${s.url}`,
      )
      .join('\n');
    throw new Error(
      `Could not determine the drain token from the ${samples.length} drain${samples.length === 1 ? '' : 's'} we found. ` +
        `Either none are pointing at this tenant's endpoint, or they use a URL shape we don't recognise. ` +
        `Tenant id we matched against: ${tenantId}.\n` +
        'Sample drain URLs:\n' +
        lines +
        '\n\nIf you see [MATCH] above, retry — cache may have been stale. ' +
        'Otherwise: the URLs don\'t contain this tenant id, or the path isn\'t ' +
        '/api/v1/webhooks/heroku/logs/<tenantId>/<token>[/<app>]. ' +
        'Re-create one drain from the Connect wizard to seed a known token.',
    );
  }
  if (!ingestHost) ingestHost = 'https://ingest.sreoncall.com';

  const report: MigrationReport = {
    tenantId,
    connectionId,
    connectionName: (conn as any).name,
    dryRun,
    appsSeen: 0,
    apps: [],
    totals: { migrated: 0, already_current: 0, no_sreoncall_drain: 0, error: 0 },
  };

  const apps = await listAllReachableApps(apiKey);
  report.appsSeen = apps.length;

  for (const app of apps) {
    let drains: HerokuDrain[];
    try {
      drains = await heroku<HerokuDrain[]>(apiKey, `/apps/${app.name}/log-drains`);
    } catch (err: any) {
      report.apps.push({ app: app.name, action: 'error', error: err.message });
      report.totals.error++;
      continue;
    }

    const ours = drains.filter(
      (d) => classifyDrain(d.url, tenantId, drainToken!) !== 'foreign',
    );
    if (ours.length === 0) {
      report.apps.push({ app: app.name, action: 'no_sreoncall_drain' });
      report.totals.no_sreoncall_drain++;
      continue;
    }

    const want = newDrainUrl(ingestHost, tenantId, drainToken!, app.name);
    const wantPath = new URL(want).pathname;
    const hasCurrent = ours.some((d) => {
      try {
        return new URL(d.url.split('?')[0]).pathname === wantPath;
      } catch {
        return false;
      }
    });
    const legacyDrains = ours.filter(
      (d) => classifyDrain(d.url, tenantId, drainToken!) === 'legacy',
    );

    if (hasCurrent && legacyDrains.length === 0) {
      report.apps.push({ app: app.name, action: 'already_current' });
      report.totals.already_current++;
      continue;
    }

    if (dryRun) {
      report.apps.push({
        app: app.name,
        action: 'migrated',
        legacyDrainsFound: legacyDrains.length,
        plannedUrl: want,
      });
      report.totals.migrated++;
      continue;
    }

    // Real run — add the new drain first, then remove legacy ones.
    try {
      if (!hasCurrent) {
        await heroku(apiKey, `/apps/${app.name}/log-drains`, {
          method: 'POST',
          body: JSON.stringify({ url: want }),
        });
      }
      for (const legacy of legacyDrains) {
        await heroku(apiKey, `/apps/${app.name}/log-drains/${legacy.id}`, { method: 'DELETE' });
      }
      report.apps.push({
        app: app.name,
        action: 'migrated',
        legacyDrainsFound: legacyDrains.length,
        plannedUrl: want,
      });
      report.totals.migrated++;
    } catch (err: any) {
      logger.warn('migrate-heroku-drains: per-app failure', {
        tenantId,
        connectionId,
        app: app.name,
        error: err.message,
      });
      report.apps.push({ app: app.name, action: 'error', error: err.message });
      report.totals.error++;
    }
  }

  return report;
}

// Convenience wrapper used by the CLI: walk every Heroku connection
// on a tenant (usually just one) and aggregate reports.
export async function migrateAllHerokuDrainsForTenant(
  tenantId: string,
  opts: MigrateOptions = {},
): Promise<MigrationReport[]> {
  const conns = await ObservabilityConnection.find({
    tenant_id: tenantId,
    'config.cloud_provider': 'heroku',
  }).select('_id').lean();
  const reports: MigrationReport[] = [];
  for (const c of conns as any[]) {
    reports.push(await migrateHerokuDrainsForConnection(tenantId, String(c._id), opts));
  }
  return reports;
}
