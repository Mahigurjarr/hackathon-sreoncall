import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

const SSH_HOST = 'ubuntu@10.10.1.22';
const SSH_OPTS = ['-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no'];
const API_ENV_PATH = '/opt/sreoncall/shared/api.env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generatePassword(length = 32): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function escapeForSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

async function sshExec(command: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('ssh', [
      ...SSH_OPTS,
      SSH_HOST,
      command,
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: any) {
    logger.error('sshExec failed', { command, error: err.message });
    throw err;
  }
}

/**
 * Safely update an environment variable in the API env file.
 * Uses a Python one-liner via SSH to avoid shell injection through sed
 * delimiters, single quotes, or other metacharacters.
 */
async function updateEnvVar(key: string, value: string): Promise<void> {
  // Validate the key is a simple env var name (alphanumeric + underscore only)
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env var key: ${key}`);
  }
  // Use Python to safely rewrite the line — no shell interpolation of the value
  // The value is passed as a base64-encoded string to avoid any shell escaping issues
  const b64Value = Buffer.from(value).toString('base64');
  await sshExec(
    `sudo python3 -c "
import base64, re, sys
key='${key}'
val=base64.b64decode('${b64Value}').decode()
path='${API_ENV_PATH}'
with open(path) as f: lines=f.readlines()
found=False
out=[]
for l in lines:
    if l.startswith(key+'='):
        out.append(key+'='+val+'\\n')
        found=True
    else:
        out.append(l)
if not found:
    out.append(key+'='+val+'\\n')
with open(path,'w') as f: f.writelines(out)
"`,
  );
}

async function restartAppServices(): Promise<void> {
  await sshExec('sudo systemctl restart sreoncall-api sreoncall-web');
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

interface RotationResult {
  success: boolean;
  newValueHint: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Individual rotation functions
// ---------------------------------------------------------------------------

async function rotateJwtSecret(): Promise<RotationResult> {
  logger.info('credential-rotation: starting JWT_SECRET rotation');
  try {
    const newSecret = generatePassword(64);
    await updateEnvVar('JWT_SECRET', newSecret);
    await restartAppServices();
    const hint = newSecret.slice(-4);
    logger.info('credential-rotation: JWT_SECRET rotated successfully', { hint });
    return { success: true, newValueHint: `...${hint}` };
  } catch (err: any) {
    logger.error('credential-rotation: JWT_SECRET rotation failed', { error: err.message });
    return { success: false, newValueHint: '', error: err.message };
  }
}

async function rotateMongodb(): Promise<RotationResult> {
  logger.info('credential-rotation: starting MongoDB password rotation');
  try {
    const newPassword = generatePassword(32);

    // Fetch current MONGODB_URI from env file to extract current password
    const { stdout: uriLine } = await sshExec(
      `sudo grep '^MONGODB_URI=' ${API_ENV_PATH}`,
    );
    // e.g. MONGODB_URI=mongodb://sreoncall:<PASS>@localhost:27017/sreoncall?...
    const uriMatch = uriLine.match(/MONGODB_URI=mongodb:\/\/[^:]+:([^@]+)@/);
    const currentPassword = uriMatch ? uriMatch[1] : '';

    const escapedCurrent = escapeForSingleQuote(currentPassword);
    const escapedNew = escapeForSingleQuote(newPassword);

    // Change password in MongoDB
    await sshExec(
      `mongo -u sreoncall --authenticationDatabase admin -p '${escapedCurrent}' ` +
        `--eval "db.getSiblingDB('admin').changeUserPassword('sreoncall', '${escapedNew}')"`,
    );

    // Build new URI and update env
    const newUri = `mongodb://sreoncall:${newPassword}@localhost:27017/sreoncall?replicaSet=rs0&authSource=admin`;
    await updateEnvVar('MONGODB_URI', newUri);
    await restartAppServices();

    const hint = newPassword.slice(-4);
    logger.info('credential-rotation: MongoDB password rotated successfully', { hint });
    return { success: true, newValueHint: `...${hint}` };
  } catch (err: any) {
    logger.error('credential-rotation: MongoDB rotation failed', { error: err.message });
    return { success: false, newValueHint: '', error: err.message };
  }
}

async function rotateRedis(): Promise<RotationResult> {
  logger.info('credential-rotation: starting Redis password rotation');
  try {
    const newPassword = generatePassword(32);

    // Fetch current REDIS_URL from env file to extract current password
    const { stdout: urlLine } = await sshExec(
      `sudo grep '^REDIS_URL=' ${API_ENV_PATH}`,
    );
    // e.g. REDIS_URL=redis://:<PASS>@localhost:6379
    const urlMatch = urlLine.match(/REDIS_URL=redis:\/\/:([^@]+)@/);
    const currentPassword = urlMatch ? urlMatch[1] : '';

    const escapedCurrent = escapeForSingleQuote(currentPassword);
    const escapedNew = escapeForSingleQuote(newPassword);

    // Update Redis runtime config
    await sshExec(
      `redis-cli -a '${escapedCurrent}' CONFIG SET requirepass '${escapedNew}'`,
    );

    // Update Redis config file for persistence across restarts
    await sshExec(
      `sudo sed -i 's|^requirepass .*|requirepass ${escapedNew}|' /etc/redis/redis.conf`,
    );

    // Update env var with new URL
    await updateEnvVar('REDIS_URL', `redis://:${newPassword}@localhost:6379`);
    await restartAppServices();

    const hint = newPassword.slice(-4);
    logger.info('credential-rotation: Redis password rotated successfully', { hint });
    return { success: true, newValueHint: `...${hint}` };
  } catch (err: any) {
    logger.error('credential-rotation: Redis rotation failed', { error: err.message });
    return { success: false, newValueHint: '', error: err.message };
  }
}

async function rotateNats(): Promise<RotationResult> {
  logger.info('credential-rotation: starting NATS password rotation');
  try {
    const newPassword = generatePassword(32);
    const escapedNew = escapeForSingleQuote(newPassword);

    // Find the NATS config file
    const { stdout: configPath } = await sshExec(
      `[ -f /etc/nats/nats-server.conf ] && echo /etc/nats/nats-server.conf || echo /etc/nats-server.conf`,
    );
    const natsConfig = configPath.trim() || '/etc/nats/nats-server.conf';

    // Update the password line for user sreoncall in the NATS config
    await sshExec(
      `sudo sed -i '/user: sreoncall/{n; s|password: .*|password: ${escapedNew}|}' ${natsConfig}`,
    );

    // Restart NATS (try both common service names)
    try {
      await sshExec('sudo systemctl restart nats-server');
    } catch {
      await sshExec('sudo systemctl restart nats');
    }

    // Update env var
    await updateEnvVar('NATS_URL', `nats://sreoncall:${newPassword}@localhost:4222`);
    await restartAppServices();

    const hint = newPassword.slice(-4);
    logger.info('credential-rotation: NATS password rotated successfully', { hint });
    return { success: true, newValueHint: `...${hint}` };
  } catch (err: any) {
    logger.error('credential-rotation: NATS rotation failed', { error: err.message });
    return { success: false, newValueHint: '', error: err.message };
  }
}

async function rotateMinio(): Promise<RotationResult> {
  logger.info('credential-rotation: starting MinIO credential rotation');
  try {
    const newAccessKey = generatePassword(20);
    const newSecretKey = generatePassword(40);

    const escapedSecret = escapeForSingleQuote(newSecretKey);

    // Check if mc (MinIO client) is installed
    const { stdout: mcCheck } = await sshExec('which mc 2>/dev/null || echo ""');
    if (mcCheck.trim()) {
      // Use mc to update the user secret
      await sshExec(
        `mc admin user update local sreoncall '${escapedSecret}'`,
      );
    } else {
      // Fall back to updating MinIO environment file and restarting
      await sshExec(
        `sudo sed -i 's|^MINIO_ACCESS_KEY=.*|MINIO_ACCESS_KEY=${newAccessKey}|' /etc/default/minio`,
      );
      const escapedSecretForFile = escapeForSingleQuote(newSecretKey);
      await sshExec(
        `sudo sed -i 's|^MINIO_SECRET_KEY=.*|MINIO_SECRET_KEY=${escapedSecretForFile}|' /etc/default/minio`,
      );
    }

    await updateEnvVar('MINIO_ACCESS_KEY', newAccessKey);
    await updateEnvVar('MINIO_SECRET_KEY', newSecretKey);

    await sshExec('sudo systemctl restart minio');
    await restartAppServices();

    const hint = newSecretKey.slice(-4);
    logger.info('credential-rotation: MinIO credentials rotated successfully', { hint });
    return { success: true, newValueHint: `...${hint}` };
  } catch (err: any) {
    logger.error('credential-rotation: MinIO rotation failed', { error: err.message });
    return { success: false, newValueHint: '', error: err.message };
  }
}

async function rotateMeilisearch(): Promise<RotationResult> {
  logger.info('credential-rotation: starting Meilisearch master key rotation');
  try {
    const newKey = generatePassword(32);
    const escapedNew = escapeForSingleQuote(newKey);

    // Try to update master key in the Meilisearch systemd env file or config
    // Common locations: /etc/meilisearch.toml, /etc/default/meilisearch, /opt/meilisearch/.env
    await sshExec(
      `if sudo test -f /etc/meilisearch.toml; then ` +
        `sudo sed -i 's|^master_key = .*|master_key = "${newKey}"|' /etc/meilisearch.toml; ` +
      `elif sudo test -f /etc/default/meilisearch; then ` +
        `sudo sed -i 's|^MEILI_MASTER_KEY=.*|MEILI_MASTER_KEY=${escapedNew}|' /etc/default/meilisearch; ` +
      `elif sudo test -f /opt/meilisearch/.env; then ` +
        `sudo sed -i 's|^MEILI_MASTER_KEY=.*|MEILI_MASTER_KEY=${escapedNew}|' /opt/meilisearch/.env; ` +
      `fi`,
    );

    await sshExec('sudo systemctl restart meilisearch');

    await updateEnvVar('MEILISEARCH_MASTER_KEY', newKey);
    await restartAppServices();

    const hint = newKey.slice(-4);
    logger.info('credential-rotation: Meilisearch master key rotated successfully', { hint });
    return { success: true, newValueHint: `...${hint}` };
  } catch (err: any) {
    logger.error('credential-rotation: Meilisearch rotation failed', { error: err.message });
    return { success: false, newValueHint: '', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function rotateCredential(key: string): Promise<RotationResult> {
  switch (key) {
    case 'jwt_secret':
      return rotateJwtSecret();
    case 'mongodb':
      return rotateMongodb();
    case 'redis':
      return rotateRedis();
    case 'nats':
      return rotateNats();
    case 'minio':
      return rotateMinio();
    case 'meilisearch':
      return rotateMeilisearch();
    default:
      return { success: false, newValueHint: '', error: `Unknown credential key: ${key}` };
  }
}
