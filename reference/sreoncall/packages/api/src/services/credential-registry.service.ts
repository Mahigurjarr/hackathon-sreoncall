import { CredentialRegistry, CredentialRegistryDocument, ICredentialRegistry } from '../models/credential-registry.model';
import { logger } from '../utils/logger';

interface SeedEntry {
  key: string;
  name: string;
  category: ICredentialRegistry['category'];
  rotation_mode: ICredentialRegistry['rotation_mode'];
  rotation_interval_days: number;
  env_var_keys: string[];
  notify_before_days: number;
  rotation_instructions: string | null;
}

const SEED_CREDENTIALS: SeedEntry[] = [
  {
    key: 'jwt_secret',
    name: 'JWT Secret',
    category: 'internal',
    rotation_mode: 'auto',
    rotation_interval_days: 30,
    env_var_keys: ['JWT_SECRET'],
    notify_before_days: 7,
    rotation_instructions: null,
  },
  {
    key: 'mongodb',
    name: 'MongoDB',
    category: 'internal',
    rotation_mode: 'auto',
    rotation_interval_days: 90,
    env_var_keys: ['MONGODB_URI'],
    notify_before_days: 7,
    rotation_instructions: null,
  },
  {
    key: 'redis',
    name: 'Redis',
    category: 'internal',
    rotation_mode: 'auto',
    rotation_interval_days: 90,
    env_var_keys: ['REDIS_URL'],
    notify_before_days: 7,
    rotation_instructions: null,
  },
  {
    key: 'nats',
    name: 'NATS JetStream',
    category: 'internal',
    rotation_mode: 'auto',
    rotation_interval_days: 90,
    env_var_keys: ['NATS_URL'],
    notify_before_days: 7,
    rotation_instructions: null,
  },
  {
    key: 'minio',
    name: 'MinIO',
    category: 'internal',
    rotation_mode: 'auto',
    rotation_interval_days: 90,
    env_var_keys: ['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'],
    notify_before_days: 7,
    rotation_instructions: null,
  },
  {
    key: 'meilisearch',
    name: 'Meilisearch',
    category: 'internal',
    rotation_mode: 'auto',
    rotation_interval_days: 90,
    env_var_keys: ['MEILISEARCH_MASTER_KEY'],
    notify_before_days: 7,
    rotation_instructions: null,
  },
  {
    key: 'slack',
    name: 'Slack App',
    category: 'external',
    rotation_mode: 'manual',
    rotation_interval_days: 180,
    env_var_keys: ['SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'],
    notify_before_days: 14,
    rotation_instructions:
      'Go to api.slack.com > Your Apps > SREonCall > Basic Information. Regenerate Client Secret and Signing Secret. Update api.env and restart services.',
  },
  {
    key: 'plivo',
    name: 'Plivo',
    category: 'external',
    rotation_mode: 'manual',
    rotation_interval_days: 180,
    env_var_keys: ['PLIVO_AUTH_TOKEN'],
    notify_before_days: 14,
    rotation_instructions:
      'Go to console.plivo.com > Account > Auth Token. Click regenerate. Update PLIVO_AUTH_TOKEN in api.env and restart services.',
  },
  {
    key: 'aws_ses',
    name: 'AWS SES / SMTP',
    category: 'external',
    rotation_mode: 'manual',
    rotation_interval_days: 180,
    env_var_keys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'SMTP_USER', 'SMTP_PASS'],
    notify_before_days: 14,
    rotation_instructions:
      'Go to AWS IAM console > Users > sreoncallv2 > Security credentials. Create new access key, deactivate old one. For SMTP, generate new SMTP credentials from SES console. Update api.env and restart.',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    category: 'external',
    rotation_mode: 'manual',
    rotation_interval_days: 180,
    env_var_keys: ['OPENAI_API_KEY'],
    notify_before_days: 14,
    rotation_instructions:
      'Go to platform.openai.com > API keys. Create new key, revoke old one. Update OPENAI_API_KEY in api.env and restart.',
  },
  {
    key: 'comms_encryption',
    name: 'Comms Encryption Key',
    category: 'internal',
    rotation_mode: 'manual',
    rotation_interval_days: 365,
    env_var_keys: ['COMMS_ENCRYPTION_KEY'],
    notify_before_days: 30,
    rotation_instructions:
      'WARNING: Rotating this key requires re-encrypting all existing channel tokens. Run the migration script before updating the key. Generate: openssl rand -hex 32',
  },
];

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function seedCredentials(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const now = new Date();

  for (const entry of SEED_CREDENTIALS) {
    const existing = await CredentialRegistry.findOne({ key: entry.key }).lean();
    if (existing) {
      skipped++;
      continue;
    }

    await CredentialRegistry.create({
      key: entry.key,
      name: entry.name,
      category: entry.category,
      rotation_mode: entry.rotation_mode,
      rotation_interval_days: entry.rotation_interval_days,
      env_var_keys: entry.env_var_keys,
      notify_before_days: entry.notify_before_days,
      rotation_instructions: entry.rotation_instructions,
      status: 'healthy',
      last_rotated_at: now,
      next_rotation_at: addDays(now, entry.rotation_interval_days),
      rotated_by: null,
      current_value_hint: null,
      history: [],
    });

    created++;
    logger.info('Credential seeded', { key: entry.key });
  }

  logger.info('Credential registry seed complete', { created, skipped });
  return { created, skipped };
}

export async function listCredentials(): Promise<ICredentialRegistry[]> {
  return CredentialRegistry.find({}).sort({ category: 1, name: 1 }).lean();
}

export async function getCredential(key: string): Promise<ICredentialRegistry | null> {
  return CredentialRegistry.findOne({ key }).lean();
}

export async function updateCredentialSettings(
  key: string,
  updates: Partial<
    Pick<
      ICredentialRegistry,
      | 'name'
      | 'rotation_mode'
      | 'rotation_interval_days'
      | 'notify_before_days'
      | 'rotation_instructions'
      | 'env_var_keys'
    >
  >
): Promise<ICredentialRegistry | null> {
  const setFields: Record<string, unknown> = { ...updates };

  if (updates.rotation_interval_days !== undefined) {
    const current = await CredentialRegistry.findOne({ key }).lean();
    if (current) {
      const base = current.last_rotated_at ?? new Date();
      setFields.next_rotation_at = addDays(base, updates.rotation_interval_days);
    }
  }

  return CredentialRegistry.findOneAndUpdate({ key }, { $set: setFields }, { new: true }).lean();
}

export async function markRotationStarted(key: string): Promise<ICredentialRegistry | null> {
  return CredentialRegistry.findOneAndUpdate(
    { key },
    { $set: { status: 'rotating' } },
    { new: true }
  ).lean();
}

export async function markRotationComplete(
  key: string,
  rotatedBy: string,
  valueHint: string | null
): Promise<ICredentialRegistry | null> {
  const now = new Date();
  const current = await CredentialRegistry.findOne({ key }).lean();
  if (!current) return null;

  const next_rotation_at = addDays(now, current.rotation_interval_days);

  const historyEntry = {
    rotated_at: now,
    rotated_by: rotatedBy,
    status: 'success' as const,
    error: null,
  };

  return CredentialRegistry.findOneAndUpdate(
    { key },
    {
      $set: {
        status: 'healthy',
        last_rotated_at: now,
        next_rotation_at,
        rotated_by: rotatedBy,
        current_value_hint: valueHint,
      },
      $push: {
        history: {
          $each: [historyEntry],
          $slice: -10,
        },
      },
    },
    { new: true }
  ).lean();
}

export async function markRotationFailed(
  key: string,
  rotatedBy: string,
  error: string
): Promise<ICredentialRegistry | null> {
  const now = new Date();

  const historyEntry = {
    rotated_at: now,
    rotated_by: rotatedBy,
    status: 'failed' as const,
    error,
  };

  return CredentialRegistry.findOneAndUpdate(
    { key },
    {
      $set: { status: 'failed' },
      $push: {
        history: {
          $each: [historyEntry],
          $slice: -10,
        },
      },
    },
    { new: true }
  ).lean();
}

export async function getDueCredentials(): Promise<ICredentialRegistry[]> {
  const now = new Date();
  return CredentialRegistry.find({
    rotation_mode: 'auto',
    next_rotation_at: { $lte: now },
    status: { $ne: 'rotating' },
  }).lean();
}

export async function getDueSoonCredentials(): Promise<ICredentialRegistry[]> {
  const now = new Date();
  return CredentialRegistry.find({
    status: 'healthy',
    $expr: {
      $lte: [
        '$next_rotation_at',
        {
          $dateAdd: {
            startDate: now,
            unit: 'day',
            amount: '$notify_before_days',
          },
        },
      ],
    },
  }).lean();
}

export async function refreshStatuses(): Promise<void> {
  const now = new Date();
  const sevenDaysAgo = addDays(now, -7);

  // Set 'due' where next_rotation_at <= now and status is 'healthy'
  const dueResult = await CredentialRegistry.updateMany(
    { next_rotation_at: { $lte: now }, status: 'healthy' },
    { $set: { status: 'due' } }
  );

  // Set 'overdue' where next_rotation_at is more than 7 days past and status is 'due'
  const overdueResult = await CredentialRegistry.updateMany(
    { next_rotation_at: { $lte: sevenDaysAgo }, status: 'due' },
    { $set: { status: 'overdue' } }
  );

  logger.info('Credential statuses refreshed', {
    due_updated: dueResult.modifiedCount,
    overdue_updated: overdueResult.modifiedCount,
  });
}
