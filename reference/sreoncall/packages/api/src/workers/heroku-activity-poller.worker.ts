import { ObservabilityConnection } from '../models/observability-connection.model';
import { logger } from '../utils/logger';
import { getDefaultLabels, mergeLabels } from '../services/observability-labels.service';

/**
 * Heroku Activity Poller  (v2 — complete activity coverage)
 *
 * Polls the Heroku Platform API every 60s and forwards ALL activity events to
 * Loki so they appear in the SREonCall Logs dashboard.
 *
 * Events captured:
 *   RELEASES (/apps/{app}/releases)
 *     - Deploy abc1234 (v55)          → event_type=release
 *     - Rollback to v52               → event_type=release
 *     - Set DATABASE_URL config vars  → event_type=release
 *     - Attach REDIS add-on           → event_type=release
 *     - Scale web=2:Standard-1X       → event_type=release
 *
 *   BUILDS (/apps/{app}/builds)
 *     - Build succeeded               → event_type=build, level=info
 *     - Build failed                  → event_type=build, level=error
 *
 * Fix for PENDING releases:
 *   Releases go through pending → succeeded/failed. The poller now tracks
 *   pending IDs and re-checks them on the next tick so the final status
 *   is always recorded in Loki.
 *
 * State (per app, stored as JSON in config.heroku_activity_state_json):
 *   lastReleaseVersion  — highest release version seen, so new ones are detected
 *   pendingReleaseIds   — IDs fetched while pending, re-checked next tick
 *   lastBuildCreatedAt  — ISO timestamp of most recent build seen
 *   pendingBuildIds     — build IDs fetched while pending, re-checked next tick
 *
 * Loki labels:
 *   source=heroku  app=<app>  event_type=release|build  level=info|warn|error
 *   job=heroku  source_type=api_poller  tenant_id=<id>
 */

const POLL_INTERVAL_MS = 60_000;
const HEROKU_API       = 'https://api.heroku.com';
const MANAGED_LOKI_URL = process.env.MANAGED_LOKI_URL || 'http://10.10.1.21:3100';

let timer: NodeJS.Timeout | null = null;
let running = false;

// ── Types ────────────────────────────────────────────────────────────────────

interface HerokuApp {
  id: string;
  name: string;
}

interface HerokuRelease {
  id: string;
  version: number;
  description: string;
  status: 'succeeded' | 'failed' | 'pending';
  created_at: string;
  user?: { email?: string };
}

interface HerokuBuild {
  id: string;
  status: 'succeeded' | 'failed' | 'pending';
  created_at: string;
  updated_at: string;
  user?: { email?: string };
  source_blob?: { checksum?: string };
}

// Per-app persisted state
interface AppActivityState {
  lastReleaseVersion: number;
  pendingReleaseIds: string[];
  lastBuildCreatedAt: string;
  pendingBuildIds: string[];
}

type ActivityState = Record<string, AppActivityState>; // keyed by app.id

// ── Heroku fetch helper ──────────────────────────────────────────────────────

async function herokuFetch<T>(path: string, apiKey: string, rangeHeader?: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.heroku+json; version=3',
    };
    if (rangeHeader) headers['Range'] = rangeHeader;

    const res = await fetch(`${HEROKU_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.debug('Heroku API non-2xx', { path, status: res.status });
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    logger.debug('Heroku API fetch failed', { path, error: err.message });
    return null;
  }
}

// ── Severity helpers ─────────────────────────────────────────────────────────

function releaseLevel(status: string): string {
  if (status === 'failed')  return 'error';
  if (status === 'pending') return 'warn';
  return 'info';
}

function buildLevel(status: string): string {
  if (status === 'failed')  return 'error';
  if (status === 'pending') return 'warn';
  return 'info';
}

// ── Log line formatters ──────────────────────────────────────────────────────

function formatReleaseLine(r: HerokuRelease): string {
  const who  = r.user?.email ? ` by ${r.user.email}` : '';
  const st   = r.status !== 'succeeded' ? ` [${r.status.toUpperCase()}]` : '';
  return `${r.description || 'Release'} (v${r.version})${who}${st}`;
}

function formatBuildLine(b: HerokuBuild): string {
  const who  = b.user?.email ? ` by ${b.user.email}` : '';
  const hash = b.source_blob?.checksum?.slice(-8) || '';
  const st   = b.status === 'succeeded' ? 'Build succeeded' : b.status === 'failed' ? 'Build failed' : 'Build pending';
  return `${st}${who}${hash ? ` [${hash}]` : ''}`;
}

// ── Push to Loki ─────────────────────────────────────────────────────────────

async function pushToLoki(
  tenantId: string,
  appName: string,
  eventType: 'release' | 'build',
  entries: Array<{ tsMs: number; line: string; level: string }>,
): Promise<void> {
  if (entries.length === 0) return;

  const customLabels = await getDefaultLabels(tenantId, 'heroku');

  // Group by level to minimise stream count
  const byLevel = new Map<string, [string, string][]>();
  for (const e of entries) {
    const tsNano = `${e.tsMs * 1_000_000}`;
    if (!byLevel.has(e.level)) byLevel.set(e.level, []);
    byLevel.get(e.level)!.push([tsNano, e.line]);
  }

  const streams = Array.from(byLevel.entries()).map(([level, values]) => ({
    stream: mergeLabels(
      {
        source:      'heroku',
        service_name: appName,
        app:         appName,
        event_type:  eventType,
        level,
        job:         'heroku',
        source_type: 'api_poller',
        tenant_id:   tenantId,
      },
      customLabels,
    ),
    values,
  }));

  await fetch(`${MANAGED_LOKI_URL}/loki/api/v1/push`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Scope-OrgID': tenantId },
    body:    JSON.stringify({ streams }),
    signal:  AbortSignal.timeout(5_000),
  }).catch((err: any) => {
    logger.warn('Failed to push Heroku activity to Loki', { error: err.message, tenantId, app: appName, eventType });
  });
}

// ── Process releases for one app ─────────────────────────────────────────────

async function processReleases(
  tenantId: string,
  app: HerokuApp,
  apiKey: string,
  state: AppActivityState,
): Promise<{ newPendingIds: string[]; totalPushed: number }> {
  const releases = await herokuFetch<HerokuRelease[]>(
    `/apps/${app.name}/releases`,
    apiKey,
    'version ..; order=desc,max=50',
  );
  if (!releases || !Array.isArray(releases)) return { newPendingIds: state.pendingReleaseIds, totalPushed: 0 };

  const toPush: Array<{ tsMs: number; line: string; level: string }> = [];
  const newPendingIds: string[] = [];

  // 1. Re-check previously-pending releases
  if (state.pendingReleaseIds.length > 0) {
    const byId = new Map(releases.map(r => [r.id, r]));
    for (const id of state.pendingReleaseIds) {
      const r = byId.get(id);
      if (!r) continue; // fell off the last-50 window — skip
      if (r.status === 'pending') {
        newPendingIds.push(id); // still pending, keep tracking
      } else {
        // Status resolved — push the final state
        toPush.push({ tsMs: new Date(r.created_at).getTime(), line: formatReleaseLine(r), level: releaseLevel(r.status) });
      }
    }
  }

  // 2. New releases (version > last seen)
  const newReleases = releases.filter(r => r.version > state.lastReleaseVersion);
  for (const r of newReleases) {
    toPush.push({ tsMs: new Date(r.created_at).getTime(), line: formatReleaseLine(r), level: releaseLevel(r.status) });
    if (r.status === 'pending') newPendingIds.push(r.id);
  }

  // Update last seen version
  const maxVersion = releases.reduce((m, r) => Math.max(m, r.version), state.lastReleaseVersion);
  state.lastReleaseVersion = maxVersion;

  await pushToLoki(tenantId, app.name, 'release', toPush);
  return { newPendingIds, totalPushed: toPush.length };
}

// ── Process builds for one app ───────────────────────────────────────────────

async function processBuilds(
  tenantId: string,
  app: HerokuApp,
  apiKey: string,
  state: AppActivityState,
): Promise<{ newPendingIds: string[]; totalPushed: number }> {
  const builds = await herokuFetch<HerokuBuild[]>(
    `/apps/${app.name}/builds`,
    apiKey,
    'created_at ..; order=desc,max=20',
  );
  if (!builds || !Array.isArray(builds)) return { newPendingIds: state.pendingBuildIds, totalPushed: 0 };

  const toPost: Array<{ tsMs: number; line: string; level: string }> = [];
  const newPendingIds: string[] = [];

  // 1. Re-check previously-pending builds
  if (state.pendingBuildIds.length > 0) {
    const byId = new Map(builds.map(b => [b.id, b]));
    for (const id of state.pendingBuildIds) {
      const b = byId.get(id);
      if (!b) continue;
      if (b.status === 'pending') {
        newPendingIds.push(id);
      } else {
        toPost.push({ tsMs: new Date(b.updated_at).getTime(), line: formatBuildLine(b), level: buildLevel(b.status) });
      }
    }
  }

  // 2. New builds (created_at > last seen)
  const sinceMs = state.lastBuildCreatedAt ? new Date(state.lastBuildCreatedAt).getTime() : 0;
  const newBuilds = builds.filter(b => new Date(b.created_at).getTime() > sinceMs);
  for (const b of newBuilds) {
    toPost.push({ tsMs: new Date(b.created_at).getTime(), line: formatBuildLine(b), level: buildLevel(b.status) });
    if (b.status === 'pending') newPendingIds.push(b.id);
  }

  // Advance build cursor
  if (builds.length > 0) {
    const latest = builds.reduce((a, b) =>
      new Date(a.created_at) > new Date(b.created_at) ? a : b
    );
    state.lastBuildCreatedAt = latest.created_at;
  }

  await pushToLoki(tenantId, app.name, 'build', toPost);
  return { newPendingIds, totalPushed: toPost.length };
}

// ── Poll one connection ──────────────────────────────────────────────────────

async function pollConnection(conn: any): Promise<void> {
  const tenantId     = String(conn.tenant_id);
  const connectionId = String(conn._id);
  const apiKey       = conn.config?.credentials?.api_key as string | undefined;
  if (!apiKey) return;

  // Load persisted per-app state
  const rawState = conn.config?.heroku_activity_state_json as string | undefined;
  const activityState: ActivityState = rawState ? JSON.parse(rawState) : {};

  const apps = await herokuFetch<HerokuApp[]>('/apps', apiKey);
  if (!apps || !Array.isArray(apps)) return;

  let totalEvents = 0;

  for (const app of apps) {
    if (!app?.name || !app?.id) continue;

    // Init state for new apps
    if (!activityState[app.id]) {
      activityState[app.id] = {
        lastReleaseVersion: 0,
        pendingReleaseIds: [],
        lastBuildCreatedAt: '',
        pendingBuildIds: [],
      };
    }
    const appState = activityState[app.id];

    // Process releases
    const relResult = await processReleases(tenantId, app, apiKey, appState);
    appState.pendingReleaseIds = relResult.newPendingIds;
    totalEvents += relResult.totalPushed;

    // Process builds
    const buildResult = await processBuilds(tenantId, app, apiKey, appState);
    appState.pendingBuildIds = buildResult.newPendingIds;
    totalEvents += buildResult.totalPushed;
  }

  // Persist updated state + health check
  await ObservabilityConnection.updateOne(
    { _id: connectionId },
    {
      $set: {
        'config.heroku_activity_state_json': JSON.stringify(activityState),
        last_health_check_at:  new Date(),
        health_check_message:  `Activity poller: ${apps.length} apps, ${totalEvents} new events`,
      },
    },
  ).catch(() => {});

  if (totalEvents > 0) {
    logger.debug('Heroku activity poller pushed events', { tenantId, apps: apps.length, events: totalEvents });
  }
}

// ── Tick ─────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const connections = await ObservabilityConnection.find({ vendor: 'heroku', status: 'connected' }).lean();
    for (const conn of connections) {
      try {
        await pollConnection(conn);
      } catch (err: any) {
        logger.warn('Heroku activity poller failed for connection', { connectionId: String(conn._id), error: err.message });
      }
    }
  } catch (err: any) {
    logger.error('Heroku activity poller tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function startHerokuActivityPollerWorker(): void {
  logger.info('Starting Heroku activity poller v2 (releases + builds, pending re-check, interval: 60s)');
  setTimeout(() => {
    tick().catch(() => {});
    timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
  }, 30_000);
}

export function stopHerokuActivityPollerWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
  logger.info('Heroku activity poller stopped');
}

