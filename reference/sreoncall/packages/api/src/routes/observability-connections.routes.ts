import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import {
  ObservabilityConnection,
  RESERVED_LABEL_KEYS,
  validateLabelKey,
  validateLabelValue,
} from '../models/observability-connection.model';
import { discoverCloudServices } from '../services/cloud-discovery.service';
import { discoverFromLgtm } from '../services/lgtm-discovery.service';
import { upsertDiscoveredAssets, removeStaleAssets } from '../services/asset.service';
import { assertUrlSafe } from '../utils/ssrf-guard';
import { invalidateLabelsCache } from '../services/observability-labels.service';
import { Team } from '../models/team.model';
import { migrateHerokuDrainsForConnection } from '../services/heroku-drain-migrator.service';

/** Enterprise label schema — suggestions the UI autocompletes. */
const SUGGESTED_ENVIRONMENTS = ['production', 'staging', 'development', 'preview', 'qa', 'test', 'sandbox'];
const SUGGESTED_TIERS = ['tier-0', 'tier-1', 'tier-2', 'tier-3', 'critical', 'high', 'medium', 'low'];
const RECOMMENDED_LABEL_KEYS = ['environment', 'team', 'tier', 'region', 'component', 'owner', 'cost_center'];

const labelEntriesSchema = z
  .record(z.string().min(1).max(256))
  .refine(
    (labels) => {
      for (const [k, v] of Object.entries(labels)) {
        if (validateLabelKey(k)) return false;
        if (validateLabelValue(v)) return false;
      }
      return true;
    },
    {
      message:
        'default_labels keys must match [a-z_][a-z0-9_]* and not be reserved (tenant_id, source, service_name, job, emitter)',
    },
  );

const router = Router();
const SUPPORTED_CLOUD_PROVIDERS = ['aws', 'gcp', 'azure', 'scaleway', 'digitalocean', 'heroku', 'supabase', 'vercel'] as const;
type SupportedCloudProvider = (typeof SUPPORTED_CLOUD_PROVIDERS)[number];

const createSchema = z.object({
  name: z.string().min(1).max(200),
  mode: z.enum(['managed', 'byos', 'third_party']),
  vendor: z.string().nullable().optional(),
  endpoints: z.object({
    metrics_url: z.string().optional().default(''),
    logs_url: z.string().optional().default(''),
    traces_url: z.string().optional().default(''),
  }).optional(),
  config: z.record(z.unknown()).optional(),
  default_labels: labelEntriesSchema.optional(),
});

const updateSchema = createSchema.partial();

function serializeLabels(v: any): Record<string, string> {
  if (!v) return {};
  if (v instanceof Map) return Object.fromEntries(v) as Record<string, string>;
  if (typeof v === 'object') return v as Record<string, string>;
  return {};
}

function serialize(c: any) {
  return {
    id: c._id?.toString() ?? c.id,
    name: c.name,
    mode: c.mode,
    vendor: c.vendor,
    endpoints: c.endpoints,
    status: c.status,
    last_health_check_at: c.last_health_check_at,
    health_check_message: c.health_check_message,
    config: c.config,
    default_labels: serializeLabels(c.default_labels),
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// List connections
router.get('/', rbac('observability-connections:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const docs = await ObservabilityConnection.find({ tenant_id: tenantId }).sort({ created_at: -1 });
  res.json({ data: docs.map(serialize) });
});

// Create connection
router.post(
  '/',
  rbac('observability-connections:create'),
  auditMiddleware({ action: 'observability_connection.create', resourceType: 'observability_connection' }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const body = createSchema.parse(req.body);
    const doc = await ObservabilityConnection.create({
      ...body,
      tenant_id: tenantId,
      created_by: userId,
    });

    // Auto-discover assets based on connection type
    let discoveryResult: any = null;
    const cloudProvider = doc.config?.cloud_provider as string | undefined;
    const typedCloudProvider = cloudProvider && SUPPORTED_CLOUD_PROVIDERS.includes(cloudProvider as SupportedCloudProvider)
      ? cloudProvider as SupportedCloudProvider
      : null;
    if (typedCloudProvider) {
      // Cloud provider discovery (AWS/GCP/Azure API)
      try {
        const credentials = (doc.config?.credentials as Record<string, string>) || {};
        const discovery = await discoverCloudServices(typedCloudProvider, credentials);
        discoveryResult = discovery;
        if (discovery.assets.length > 0) {
          await upsertDiscoveredAssets(tenantId, doc._id.toString(), discovery.assets, typedCloudProvider);
        }
        // Mark as connected if discovery succeeds
        await ObservabilityConnection.updateOne(
          { _id: doc._id },
          { $set: { status: 'connected', last_health_check_at: new Date(), health_check_message: `Discovered ${discovery.assets.length} resources` } },
        );
      } catch (err: any) {
        await ObservabilityConnection.updateOne(
          { _id: doc._id },
          { $set: { status: 'error', last_health_check_at: new Date(), health_check_message: err?.message || 'Discovery failed' } },
        );
      }
    } else if (doc.mode === 'managed') {
      // LGTM-based discovery — query Mimir for infrastructure telemetry
      const MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
      try {
        const lgtmResult = await discoverFromLgtm(MIMIR_URL, tenantId);
        discoveryResult = lgtmResult;
        if (lgtmResult.assets.length > 0) {
          await upsertDiscoveredAssets(tenantId, doc._id.toString(), lgtmResult.assets);
        }
      } catch (_err) {
        // Non-fatal
      }
    }

    // Re-read the doc to get updated status
    const updatedDoc = await ObservabilityConnection.findById(doc._id);

    res.status(201).json({
      data: serialize(updatedDoc || doc),
      discovery: discoveryResult ? {
        services: discoveryResult.services || [],
        asset_count: discoveryResult.assets?.length || 0,
        recommended_alerts: discoveryResult.recommended_alerts || [],
        recommended_dashboards: discoveryResult.recommended_dashboards || [],
      } : null,
    });
  },
);

// Discover cloud services
const discoverSchema = z.object({
  provider: z.enum(['aws', 'gcp', 'azure', 'scaleway', 'digitalocean', 'heroku', 'supabase', 'vercel']),
  credentials: z.record(z.string()),
});

router.post(
  '/discover',
  rbac('observability-connections:create'),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const body = discoverSchema.parse(req.body);
    const result = await discoverCloudServices(body.provider, body.credentials);

    // If a connection_id is provided, upsert discovered assets
    const connectionId = req.query.connection_id as string | undefined;
    if (connectionId && result.assets.length > 0) {
      const upsertResult = await upsertDiscoveredAssets(tenantId, connectionId, result.assets);
      const seenCloudIds = result.assets.map((a) => a.cloud_id);
      await removeStaleAssets(tenantId, connectionId, seenCloudIds);
      (result as any).asset_sync = upsertResult;
    }

    res.json({ data: result });
  },
);

// Update connection
router.patch(
  '/:id',
  rbac('observability-connections:update'),
  auditMiddleware({ action: 'observability_connection.update', resourceType: 'observability_connection', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const body = updateSchema.parse(req.body);
    const doc = await ObservabilityConnection.findOneAndUpdate(
      { _id: req.params.id, tenant_id: tenantId },
      { $set: body },
      { new: true, runValidators: true },
    );
    if (!doc) return res.status(404).json({ error: 'Connection not found' });

    // Flush the per-tenant/provider label cache so the next incoming
    // drain batch picks up the customer's edited labels within one
    // request — otherwise the 60s TTL would lag visible effect.
    const provider = (doc.config as any)?.cloud_provider;
    if (provider) invalidateLabelsCache(tenantId, provider);

    res.json({ data: serialize(doc) });
  },
);

// GET /api/v1/observability-connections/label-suggestions
// Powers autocomplete in the Create/Edit connection dialogs so operators
// don't have to memorise conventions. Returns:
//   - recommended_keys   — standard label names (environment, team, tier…)
//   - values.environment — static suggestions + whatever this tenant has used
//   - values.team        — the tenant's own Team collection (SSoT for team names)
//   - values.tier        — static suggestions
//   - values.<other>     — union of whatever values the tenant has used for
//                          custom keys across existing connections
router.get(
  '/label-suggestions',
  rbac('observability-connections:read'),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;

    const [connections, teams] = await Promise.all([
      ObservabilityConnection.find({ tenant_id: tenantId }).select('default_labels').lean(),
      Team.find({ tenant_id: tenantId }).select('name').lean().catch(() => []),
    ]);

    const seenValuesByKey = new Map<string, Set<string>>();
    for (const c of connections) {
      const raw = (c as any).default_labels;
      if (!raw) continue;
      const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
      for (const [k, v] of entries) {
        if (!seenValuesByKey.has(String(k))) seenValuesByKey.set(String(k), new Set());
        seenValuesByKey.get(String(k))!.add(String(v));
      }
    }

    const envValues = new Set<string>(SUGGESTED_ENVIRONMENTS);
    (seenValuesByKey.get('environment') || []).forEach((v) => envValues.add(v));

    const teamValues = new Set<string>((teams as any[]).map((t) => t.name).filter(Boolean));
    (seenValuesByKey.get('team') || []).forEach((v) => teamValues.add(v));

    const tierValues = new Set<string>(SUGGESTED_TIERS);
    (seenValuesByKey.get('tier') || []).forEach((v) => tierValues.add(v));

    // All keys this tenant has used, minus the three we treat as first-class.
    const customKeys: Record<string, string[]> = {};
    for (const [k, vs] of seenValuesByKey.entries()) {
      if (k === 'environment' || k === 'team' || k === 'tier') continue;
      customKeys[k] = Array.from(vs).sort();
    }

    res.json({
      data: {
        recommended_keys: RECOMMENDED_LABEL_KEYS,
        reserved_keys: Array.from(RESERVED_LABEL_KEYS).sort(),
        values: {
          environment: Array.from(envValues).sort(),
          team: Array.from(teamValues).sort(),
          tier: Array.from(tierValues).sort(),
          ...customKeys,
        },
      },
    });
  },
);

// Delete connection
router.delete(
  '/:id',
  rbac('observability-connections:delete'),
  auditMiddleware({ action: 'observability_connection.delete', resourceType: 'observability_connection', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const doc = await ObservabilityConnection.findOneAndDelete({
      _id: req.params.id,
      tenant_id: tenantId,
    });
    if (!doc) return res.status(404).json({ error: 'Connection not found' });

    // Clean up all assets discovered via this connection
    await removeStaleAssets(tenantId, doc._id.toString(), []);

    res.json({ message: 'Connection deleted' });
  },
);

// POST /observability-connections/:id/migrate-heroku-drains
// Rewrites every legacy 2-segment SREonCall drain URL on the Heroku
// account reachable by this connection's API key to the new
// /:appName 3-segment shape. Audited. Pass ?dry_run=true for a
// preview. Requires connections:update because it mutates external
// third-party state on the customer's behalf.
router.post(
  '/:id/migrate-heroku-drains',
  rbac('observability-connections:update'),
  auditMiddleware({
    action: 'observability_connection.migrate_heroku_drains',
    resourceType: 'observability_connection',
    getResourceId: (req) => req.params['id'] as string,
  }),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const dryRun = String(req.query.dry_run || '').toLowerCase() === 'true';
    try {
      const report = await migrateHerokuDrainsForConnection(tenantId, req.params.id as string, {
        dryRun,
      });
      res.json({ data: report });
    } catch (err: any) {
      // Surface the real reason in both `detail` (RFC 7807 / APIError
      // preferred field) and `error` (legacy consumers).
      res.status(400).json({ detail: err.message, error: err.message });
    }
  },
);

// Validate cloud credentials before creating a connection
router.post(
  '/validate-credentials',
  rbac('observability-connections:create'),
  async (req: Request, res: Response) => {
    const { cloud_provider, credentials } = req.body;

    if (!cloud_provider || !credentials) {
      return res.status(400).json({ error: 'cloud_provider and credentials are required' });
    }

    try {
      const discovery = await discoverCloudServices(cloud_provider, credentials);
      res.json({
        valid: true,
        message: `Credentials verified. Found ${discovery.assets.length} resources.`,
        asset_count: discovery.assets.length,
      });
    } catch (err: any) {
      // Return 400 (not 401) so the web API client does not trigger a
      // global signOut — 401 is reserved for auth failures.
      // Use `detail` field so the web APIError class surfaces it as
      // err.message in the catch handler.
      const detail = err?.message || 'Invalid credentials. Please check and try again.';
      res.status(400).json({
        valid: false,
        message: detail,
        detail,
      });
    }
  },
);

// Health check a connection
router.post(
  '/:id/health-check',
  rbac('observability-connections:update'),
  async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const doc = await ObservabilityConnection.findOne({
      _id: req.params.id,
      tenant_id: tenantId,
    });
    if (!doc) return res.status(404).json({ error: 'Connection not found' });

    // Test connectivity to the configured endpoints
    const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
    const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';
    const MANAGED_TEMPO_URL = process.env.MANAGED_TEMPO_URL  || 'http://10.10.1.21:3200';

    const checks: { name: string; url: string }[] = [];
    if (doc.mode === 'managed') {
      checks.push(
        { name: 'mimir', url: `${MANAGED_MIMIR_URL}/ready` },
        { name: 'loki',  url: `${MANAGED_LOKI_URL}/ready` },
        { name: 'tempo', url: `${MANAGED_TEMPO_URL}/ready` },
      );
    } else if (doc.mode === 'byos') {
      if (doc.endpoints?.metrics_url) checks.push({ name: 'metrics', url: `${doc.endpoints.metrics_url}/-/ready` });
      if (doc.endpoints?.logs_url)    checks.push({ name: 'logs',    url: `${doc.endpoints.logs_url}/ready` });
      if (doc.endpoints?.traces_url)  checks.push({ name: 'traces',  url: `${doc.endpoints.traces_url}/ready` });
    }

    const cloudProvider = doc.config?.cloud_provider as string | undefined;
    const typedCloudProvider = cloudProvider && SUPPORTED_CLOUD_PROVIDERS.includes(cloudProvider as SupportedCloudProvider)
      ? cloudProvider as SupportedCloudProvider
      : null;
    const isSupportedCloudProvider = !!typedCloudProvider;
    const isCloudBackedThirdParty = doc.mode === 'third_party' && isSupportedCloudProvider;
    let cloudDiscovery: Awaited<ReturnType<typeof discoverCloudServices>> | null = null;
    const errors: string[] = [];
    await Promise.all(
      checks.map(async (c) => {
        try {
          // SSRF protection for BYOS endpoints
          if (doc.mode === 'byos') await assertUrlSafe(c.url);
          const resp = await fetch(c.url, { signal: AbortSignal.timeout(5000) });
          if (!resp.ok) errors.push(`${c.name}: HTTP ${resp.status}`);
        } catch (err: any) {
          errors.push(`${c.name}: ${err.message || 'unreachable'}`);
        }
      }),
    );

    if (isCloudBackedThirdParty) {
      try {
        const credentials = (doc.config?.credentials as Record<string, string>) || {};
        cloudDiscovery = await discoverCloudServices(typedCloudProvider!, credentials);
      } catch (err: any) {
        errors.push(`discovery: ${err?.message || 'provider API unreachable'}`);
      }
    }

    const newStatus = errors.length === 0 ? 'connected' : 'error';
    const msg = errors.length === 0
      ? isCloudBackedThirdParty && cloudDiscovery
        ? `Discovered ${cloudDiscovery.assets.length} resources`
        : 'All endpoints reachable'
      : errors.join('; ');

    await ObservabilityConnection.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: newStatus,
          last_health_check_at: new Date(),
          health_check_message: msg,
        },
      },
    );

    // Re-discover and sync assets during health check
    if (typedCloudProvider && isSupportedCloudProvider) {
      try {
        const discovery = cloudDiscovery ?? await discoverCloudServices(typedCloudProvider, (doc.config?.credentials as Record<string, string>) || {});
        if (discovery.assets.length > 0) {
          await upsertDiscoveredAssets(tenantId, doc._id.toString(), discovery.assets, typedCloudProvider);
          const seenCloudIds = discovery.assets.map((a) => a.cloud_id);
          await removeStaleAssets(tenantId, doc._id.toString(), seenCloudIds);
        }
      } catch (_err) {
        // Non-fatal
      }
    } else if (doc.mode === 'managed') {
      // LGTM-based re-discovery for managed connections.
      // Look for a sibling cloud connection on the same tenant so the
      // LGTM-discovered assets are tagged with the right cloud provider
      // instead of defaulting to self_managed.
      try {
        const sibling = await ObservabilityConnection.findOne({
          tenant_id: tenantId,
          'config.cloud_provider': { $exists: true, $ne: null },
        }).lean();
        const siblingProvider = (sibling?.config as any)?.cloud_provider as string | undefined;
        const lgtmResult = await discoverFromLgtm(MANAGED_MIMIR_URL, tenantId, siblingProvider);
        if (lgtmResult.assets.length > 0) {
          await upsertDiscoveredAssets(tenantId, doc._id.toString(), lgtmResult.assets, siblingProvider);
          const seenCloudIds = lgtmResult.assets.map((a: any) => a.cloud_id);
          await removeStaleAssets(tenantId, doc._id.toString(), seenCloudIds);
        }
      } catch (_err) {
        // Non-fatal
      }
    }

    res.json({ status: newStatus, message: msg });
  },
);

export default router;
