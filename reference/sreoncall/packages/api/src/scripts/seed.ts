import bcrypt from 'bcrypt';
import { getConfig } from '../config/index';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { PlanDefinition } from '../models/plan-definition.model';
import { getPlanLimits } from '../services/billing.service';
import { GlobalConfig } from '../models/global-config.model';
import { FeatureFlag } from '../models/feature-flag.model';
import { logger } from '../utils/logger';
import { initializeTenant, createWebsiteSyntheticCheck } from '../services/tenant-init.service';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { discoverCloudServices } from '../services/cloud-discovery.service';
import { discoverFromLgtm } from '../services/lgtm-discovery.service';
import { upsertDiscoveredAssets } from '../services/asset.service';

const BCRYPT_ROUNDS = 12;

export async function seedPlatform(): Promise<void> {
  const config = getConfig();

  // Always seed plan definitions, global configs, feature flags (idempotent)
  await seedPlanDefinitions();
  await seedGlobalConfigs();
  await seedFeatureFlags();

  // Ensure every tenant has a Default project
  await seedDefaultProjects();

  // Backfill website synthetic checks for tenants that have a website set
  await seedWebsiteSyntheticChecks();

  // Seed infrastructure assets for tenants with cloud connections
  await seedInfrastructureAssets();

  // Check if platform tenant already exists
  const existingTenant = await Tenant.findOne({ slug: 'platform' });
  if (existingTenant) {
    logger.info('Platform tenant already exists, skipping seed');
    return;
  }

  logger.info('Seeding platform tenant and admin user...');

  // Create platform tenant with enterprise plan
  const tenant = await Tenant.create({
    slug: 'platform',
    name: 'SREonCall Platform',
    status: 'active',
    plan: 'enterprise',
    plan_limits: {
      max_users: 10000,
      max_tickets_per_month: 1000000,
      max_storage_gb: 1000,
      api_rate_limit: 10000,
      custom_fields: true,
      sla_management: true,
      custom_workflows: true,
      audit_log_retention_days: 365,
    },
    is_platform_tenant: true,
    auth_settings: {
      password_policy: {
        min_length: 12,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_special: true,
        max_age_days: 90,
        history_count: 10,
      },
      session_policy: {
        max_sessions: 3,
        session_timeout_minutes: 480,
        idle_timeout_minutes: 30,
      },
      sso_enabled: false,
      mfa_required: false,
    },
  });

  // Hash the platform admin password
  const passwordHash = await bcrypt.hash(config.PLATFORM_ADMIN_PASSWORD, BCRYPT_ROUNDS);

  // Create platform admin user
  await User.create({
    tenant_id: tenant._id,
    email: config.PLATFORM_ADMIN_EMAIL,
    email_verified: true,
    name: 'Platform Admin',
    roles: ['platform_admin'],
    status: 'active',
    source: 'local',
    password_hash: passwordHash,
    force_password_change: true,
  });

  logger.info('Platform seed complete', {
    tenant_slug: 'platform',
    admin_email: config.PLATFORM_ADMIN_EMAIL,
  });
}

async function seedPlanDefinitions(): Promise<void> {
  logger.info('Upserting canonical plan definitions...');

  const plans = [
    {
      name: 'free',
      display_name: 'Free',
      description: 'For solo SREs and evaluation.',
      price_monthly_cents: 0,
      price_yearly_cents: 0,
      is_active: true,
      is_popular: false,
      sort_order: 0,
      features: ['∞ services', '3 users', 'Email notifications', 'Basic observability (3-day retention)'],
      limits: getPlanLimits('free'),
    },
    {
      name: 'startup',
      display_name: 'Startup',
      description: 'For small teams up to 10 people.',
      price_monthly_cents: 114900,
      price_yearly_cents: 99900,
      is_active: true,
      is_popular: false,
      sort_order: 1,
      features: ['∞ services', '10 users', 'SMS & voice notifications', 'eBPF auto-instrumentation', '7-day observability retention'],
      limits: getPlanLimits('startup'),
    },
    {
      name: 'growth',
      display_name: 'Growth',
      description: 'For growing teams up to 50 people.',
      price_monthly_cents: 229900,
      price_yearly_cents: 199900,
      is_active: true,
      is_popular: true,
      sort_order: 2,
      features: ['∞ services', '50 users', 'AI-powered RCA', 'AI agent (1)', 'WhatsApp notifications', 'BYOS integrations', '15-day observability retention'],
      limits: getPlanLimits('growth'),
    },
    {
      name: 'enterprise',
      display_name: 'Enterprise',
      description: 'For large organisations up to 200+ people.',
      price_monthly_cents: 689900,
      price_yearly_cents: 599900,
      is_active: true,
      is_popular: false,
      sort_order: 3,
      features: ['∞ services', '200 users', 'SSO & SCIM', '5 AI agents', 'MSP multi-tenant', '30-day observability retention'],
      limits: getPlanLimits('enterprise'),
    },
  ];

  for (const plan of plans) {
    await PlanDefinition.findOneAndUpdate(
      { name: plan.name },
      plan,
      { upsert: true, new: true }
    );
  }
  logger.info(`Upserted ${plans.length} plan definitions`);
}

async function seedGlobalConfigs(): Promise<void> {
  const existingCount = await GlobalConfig.countDocuments();
  if (existingCount > 0) {
    logger.info('Global configs already exist, skipping seed');
    return;
  }

  logger.info('Seeding default global configs...');

  const configs = [
    // Platform
    { key: 'platform.maintenance_mode', value: false, description: 'Enable maintenance mode (blocks non-admin access)', category: 'platform' },
    { key: 'platform.signup_enabled', value: true, description: 'Allow new tenant signups', category: 'platform' },
    { key: 'platform.default_plan', value: 'free', description: 'Default plan for new tenants', category: 'platform' },
    { key: 'platform.max_tenants', value: 1000, description: 'Maximum number of tenants allowed', category: 'platform' },

    // Auth
    { key: 'auth.session_timeout_minutes', value: 480, description: 'Default session timeout in minutes', category: 'auth' },
    { key: 'auth.max_concurrent_sessions', value: 5, description: 'Max concurrent sessions per user', category: 'auth' },
    { key: 'auth.invite_token_ttl_hours', value: 72, description: 'Invite token expiry in hours', category: 'auth' },
    { key: 'auth.password_reset_ttl_hours', value: 1, description: 'Password reset link expiry in hours', category: 'auth' },

    // Email
    { key: 'email.from_address', value: 'no-reply@sreoncall.com', description: 'Default sender email address', category: 'email' },
    { key: 'email.from_name', value: 'SREonCall', description: 'Default sender display name', category: 'email' },

    // Agents
    { key: 'agents.default_timeout_ms', value: 30000, description: 'Default AI agent execution timeout (ms)', category: 'agents' },
    { key: 'agents.max_actions_per_execution', value: 10, description: 'Max actions per agent execution', category: 'agents' },
    { key: 'agents.circuit_breaker_threshold', value: 3, description: 'Failures before circuit breaker trips', category: 'agents' },
    { key: 'agents.circuit_breaker_cooldown_ms', value: 3600000, description: 'Circuit breaker cooldown (ms)', category: 'agents' },

    // Limits
    { key: 'limits.webhook_delivery_ttl_days', value: 30, description: 'Webhook delivery record retention (days)', category: 'limits' },
    { key: 'limits.default_audit_log_retention_days', value: 90, description: 'Default audit log retention when tenant has no plan limit', category: 'limits' },
    { key: 'limits.onboarding_token_ttl_hours', value: 72, description: 'Onboarding invite token expiry (hours)', category: 'limits' },

    // Observability
    { key: 'observability.lgtm_mimir_url', value: 'http://10.10.1.21:9009', description: 'Managed Mimir endpoint for metrics', category: 'observability' },
    { key: 'observability.lgtm_loki_url', value: 'http://10.10.1.21:3100', description: 'Managed Loki endpoint for logs', category: 'observability' },
    { key: 'observability.lgtm_tempo_url', value: 'http://10.10.1.21:3200', description: 'Managed Tempo endpoint for traces', category: 'observability' },
    { key: 'observability.otel_grpc_endpoint', value: 'http://10.10.1.21:4317', description: 'OTel Collector gRPC ingestion endpoint', category: 'observability' },
    { key: 'observability.otel_http_endpoint', value: 'http://10.10.1.21:4318', description: 'OTel Collector HTTP ingestion endpoint', category: 'observability' },
  ];

  await GlobalConfig.insertMany(configs);
  logger.info(`Seeded ${configs.length} global configs`);
}

async function seedFeatureFlags(): Promise<void> {
  logger.info('Seeding default feature flags (create-if-missing)...');

  const flags = [
    { key: 'ai_agents_enabled', description: 'Enable AI agent workflows and execution', default_value: true },
    { key: 'observability_enabled', description: 'Enable observability features (metrics, logs, traces)', default_value: true },
    { key: 'observability_discovery_enabled', description: 'Enable the observability discovery API (browse label inventory: clusters/namespaces/services/pods). Off by default; enable per-tenant.', default_value: false },
    { key: 'synthetic_monitoring_enabled', description: 'Enable synthetic monitoring checks', default_value: true },
    { key: 'status_pages_enabled', description: 'Enable public status page creation', default_value: true },
    { key: 'slack_integration_enabled', description: 'Enable Slack OAuth integration', default_value: true },
    { key: 'scim_provisioning_enabled', description: 'Enable SCIM provisioning endpoints', default_value: true },
    { key: 'sso_enabled', description: 'Enable SSO/OIDC/SAML login', default_value: true },
    { key: 'billing_enabled', description: 'Enable Stripe billing and subscription management', default_value: false },
    { key: 'custom_domains_enabled', description: 'Allow tenants to configure custom domains', default_value: true },
    { key: 'provider_consumer_enabled', description: 'Enable MSP provider/consumer model and bridge sync', default_value: true },
    { key: 'runbook_automation_enabled', description: 'Enable runbook execution and automation', default_value: true },
    { key: 'dashboard_templates_enabled', description: 'Enable dashboard template instantiation', default_value: true },
    { key: 'onboarding_workflow_enabled', description: 'Enable customer onboarding workflow', default_value: true },
  ];

  // Create-if-missing: insert only flags that don't already exist, and NEVER overwrite an
  // existing flag's value or tenant overrides (an admin may have changed them). This lets
  // newly-introduced flags auto-provision on already-seeded environments, instead of being
  // skipped wholesale just because some flags already exist.
  const result = await FeatureFlag.bulkWrite(
    flags.map((f) => ({
      updateOne: {
        filter: { key: f.key },
        update: {
          $setOnInsert: {
            key: f.key,
            description: f.description,
            default_value: f.default_value,
            tenant_overrides: [],
          },
        },
        upsert: true,
      },
    })),
  );
  const created = result.upsertedCount ?? 0;
  logger.info(`Feature flags: ${created} created, ${flags.length - created} already present`);
}

async function seedDefaultProjects(): Promise<void> {
  const tenants = await Tenant.find({ status: { $ne: 'deleted' } }).select('_id slug');
  let seeded = 0;
  for (const tenant of tenants) {
    try {
      await initializeTenant(tenant._id);
      seeded++;
    } catch (err: any) {
      logger.warn('Failed to seed default project for tenant', {
        tenant_slug: tenant.slug,
        error: err.message,
      });
    }
  }
  logger.info(`Default project check complete for ${tenants.length} tenants (${seeded} processed)`);
}

async function seedWebsiteSyntheticChecks(): Promise<void> {
  const tenants = await Tenant.find({ status: { $ne: 'deleted' }, website: { $exists: true, $nin: [null, ''] } }).select('_id slug website');
  if (tenants.length === 0) {
    logger.info('No tenants with website set, skipping synthetic check backfill');
    return;
  }

  let created = 0;
  for (const tenant of tenants) {
    try {
      // Find a tenant_admin user to attribute the check to
      const adminUser = await User.findOne({ tenant_id: tenant._id, roles: 'tenant_admin', status: 'active' });
      const userId = adminUser?._id || '000000000000000000000000';
      await createWebsiteSyntheticCheck(tenant._id, userId, tenant.website!);
      created++;
    } catch (err: any) {
      logger.warn('Failed to backfill website synthetic check', {
        tenant_slug: tenant.slug,
        error: err.message,
      });
    }
  }
  logger.info(`Website synthetic check backfill complete: ${created}/${tenants.length} tenants processed`);
}

async function seedInfrastructureAssets(): Promise<void> {
  const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';

  const allConnections = await ObservabilityConnection.find({});
  if (allConnections.length === 0) {
    logger.info('No observability connections found, skipping asset discovery');
    return;
  }

  for (const conn of allConnections) {
    const tenantId = conn.tenant_id.toString();
    const connectionId = conn._id.toString();
    const cloudProvider = conn.config?.cloud_provider as string | undefined;

    try {
      if (cloudProvider && ['aws', 'gcp', 'azure'].includes(cloudProvider)) {
        // Cloud provider API discovery
        const credentials = (conn.config?.credentials as Record<string, string>) || {};
        const discovery = await discoverCloudServices(cloudProvider as 'aws' | 'gcp' | 'azure', credentials);
        await upsertDiscoveredAssets(tenantId, connectionId, discovery.assets);
        logger.info('Discovered cloud assets', { tenantId, connectionId, provider: cloudProvider, count: discovery.assets.length });
      } else if (conn.mode === 'managed') {
        // LGTM-based discovery — query Mimir for telemetry-reported infrastructure
        const metricsUrl = conn.endpoints?.metrics_url || MANAGED_MIMIR_URL;
        const lgtmResult = await discoverFromLgtm(metricsUrl, tenantId);
        if (lgtmResult.assets.length > 0) {
          await upsertDiscoveredAssets(tenantId, connectionId, lgtmResult.assets);
          logger.info('Discovered LGTM assets', { tenantId, connectionId, count: lgtmResult.assets.length, summary: lgtmResult.summary });
        } else {
          logger.info('No LGTM assets found for tenant', { tenantId, connectionId });
        }
      }
    } catch (err: any) {
      logger.warn('Failed to discover assets for connection', { tenantId, connectionId, error: err.message });
    }
  }
}

// Allow running directly: npx tsx src/scripts/seed.ts
if (require.main === module) {
  (async () => {
    const { loadConfig } = await import('../config/index');
    loadConfig();
    const { connectDatabase, disconnectDatabase } = await import('../config/database');
    await connectDatabase();
    await seedPlatform();
    await disconnectDatabase();
    process.exit(0);
  })().catch((err) => {
    logger.error('Seed script failed', { error: err.message });
    process.exit(1);
  });
}
