import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z.string().url().default('mongodb://localhost:27017/sreoncall?replicaSet=rs0'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  NATS_URL: z.string().default('nats://localhost:4222'),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  MEILISEARCH_URL: z.string().url().default('http://localhost:7700'),
  MEILISEARCH_MASTER_KEY: z.string().default('masterKey'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  PLATFORM_ADMIN_EMAIL: z.string().email().default('admin@sreoncall.dev'),
  // Required env var — no in-source default. Anyone running the API or the
  // seed script must set this explicitly. Prevents a leaked default from
  // becoming the platform-admin password on a fresh deployment.
  PLATFORM_ADMIN_PASSWORD: z.string().min(8),

  VAULT_ADDR: z.string().optional(),
  VAULT_TOKEN: z.string().optional(),

  INTERNAL_API_URL: z.string().url().default('http://localhost:4000'),

  // Stripe billing (all optional — billing features gracefully degrade)
  // Communications hub
  COMMS_ENCRYPTION_KEY: z.string().length(64, 'Must be 32 bytes hex').optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Plivo
  PLIVO_AUTH_TOKEN: z.string().optional(),

  // Teams Bot Framework
  TEAMS_WEBHOOK_SECRET: z.string().optional(),

  // AI Notetaker — Recall.ai meeting bot + pluggable speech-to-text.
  // All optional: when RECALL_API_KEY is unset the meeting-bot path is disabled
  // (uploads still work); STT defaults to Whisper via OPENAI_API_KEY.
  RECALL_API_KEY: z.string().optional(),
  RECALL_API_REGION: z.enum(['us-east-1', 'us-west-2', 'eu-central-1']).default('us-east-1'),
  RECALL_WEBHOOK_SECRET: z.string().optional(),
  STT_PROVIDER: z.enum(['whisper', 'deepgram', 'recall']).default('whisper'),
  DEEPGRAM_API_KEY: z.string().optional(),
  // Public base URL Recall.ai calls back for bot status / transcript webhooks.
  NOTETAKER_PUBLIC_BASE_URL: z.string().url().optional(),
  // Calendar auto-capture — OAuth apps whose credentials we pass to Recall's
  // Calendar V2 API (developer-hosted OAuth). Optional; when unset the matching
  // provider's "Connect calendar" flow is disabled.
  GOOGLE_CALENDAR_CLIENT_ID: z.string().optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CALENDAR_CLIENT_ID: z.string().optional(),
  MICROSOFT_CALENDAR_CLIENT_SECRET: z.string().optional(),
  // Microsoft tenant mode: 'common' (multitenant) or a specific tenant id.
  MICROSOFT_CALENDAR_TENANT: z.string().default('common'),

  // Agent platform (all optional — sensible defaults)
  AGENT_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_MAX_ACTIONS_PER_EXECUTION: z.coerce.number().int().positive().default(10),
  AGENT_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  AGENT_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(3_600_000),
  AGENT_TOKEN_COST_PER_MILLION_INPUT: z.coerce.number().int().default(300),
  AGENT_TOKEN_COST_PER_MILLION_OUTPUT: z.coerce.number().int().default(1500),

  // Stripe billing (all optional — billing features gracefully degrade)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_BUSINESS: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),
  APP_URL: z.string().url().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  ROUTE53_HOSTED_ZONE_ID: z.string().optional(),
  TENANT_BASE_DOMAIN: z.string().optional(),
  TENANT_INGRESS_TARGET_IP: z.string().optional(),
  TENANT_INGRESS_UI_URL: z.string().optional(),
  TENANT_INGRESS_UPSTREAM: z.string().optional(),
  TENANT_PROVISIONING_ENABLED: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${formatted}`);
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}

export default getConfig;
