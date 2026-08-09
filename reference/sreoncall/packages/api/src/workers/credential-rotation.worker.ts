import * as registryService from '../services/credential-registry.service';
import * as rotationService from '../services/credential-rotation.service';
import { sendCredentialRotationEmail } from '../services/email.service';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { logger } from '../utils/logger';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let intervalHandle: ReturnType<typeof setInterval> | null = null;
const notifiedDueSoon = new Set<string>(); // Track notifications to avoid spam

/**
 * The credential registry is platform-level (internal infra secrets, no
 * tenant_id) — recipients are the platform tenant's platform_admin users, not
 * any customer tenant's users.
 */
async function getPlatformAdminEmails(): Promise<string[]> {
  const platformTenant = await Tenant.findOne({ is_platform_tenant: true }).select('_id').lean();
  if (!platformTenant) return [];
  const admins = await User.find({
    tenant_id: platformTenant._id,
    roles: 'platform_admin',
    status: 'active',
  }).select('email').lean();
  return admins.map((a) => a.email).filter(Boolean);
}

async function notifyPlatformAdmins(
  opts: Omit<Parameters<typeof sendCredentialRotationEmail>[0], 'to'>,
): Promise<void> {
  const recipients = await getPlatformAdminEmails();
  if (recipients.length === 0) {
    logger.warn('Credential rotation: no platform admins to notify', { credentialKey: opts.credentialKey });
    return;
  }
  await Promise.all(
    recipients.map((to) =>
      sendCredentialRotationEmail({ ...opts, to }).catch((err: any) =>
        logger.warn('Failed to send credential rotation email', { to, credentialKey: opts.credentialKey, error: err.message })
      )
    )
  );
}

async function tick(): Promise<void> {
  try {
    // 1. Refresh statuses
    await registryService.refreshStatuses();

    // 2. Check for auto-rotation due credentials
    const dueCredentials = await registryService.getDueCredentials();
    for (const cred of dueCredentials) {
      logger.info('Auto-rotating credential', { key: cred.key, name: cred.name });
      await registryService.markRotationStarted(cred.key);
      try {
        const result = await rotationService.rotateCredential(cred.key);
        if (result.success) {
          await registryService.markRotationComplete(cred.key, 'system', result.newValueHint);
          logger.info('Credential auto-rotated successfully', { key: cred.key });
          await notifyPlatformAdmins({ credentialName: cred.name, credentialKey: cred.key, kind: 'success' });
        } else {
          await registryService.markRotationFailed(cred.key, 'system', result.error || 'Unknown error');
          logger.error('Credential auto-rotation failed', { key: cred.key, error: result.error });
          await notifyPlatformAdmins({ credentialName: cred.name, credentialKey: cred.key, kind: 'failure', error: result.error });
        }
      } catch (err: any) {
        await registryService.markRotationFailed(cred.key, 'system', err.message);
        logger.error('Credential auto-rotation error', { key: cred.key, error: err.message });
        await notifyPlatformAdmins({ credentialName: cred.name, credentialKey: cred.key, kind: 'failure', error: err.message });
      }
    }

    // 3. Check for due-soon warnings (notify once per credential per day)
    const dueSoon = await registryService.getDueSoonCredentials();
    for (const cred of dueSoon) {
      if (!notifiedDueSoon.has(cred.key)) {
        notifiedDueSoon.add(cred.key);
        logger.info('Credential rotation due soon', { key: cred.key, name: cred.name, next_rotation_at: cred.next_rotation_at });
        await notifyPlatformAdmins({ credentialName: cred.name, credentialKey: cred.key, kind: 'due_soon', nextRotationAt: cred.next_rotation_at });
      }
    }
  } catch (err: any) {
    logger.error('Credential rotation worker tick failed', { error: err.message });
  }
}

export async function startCredentialRotationWorker(): Promise<void> {
  if (intervalHandle) return;
  // Clear daily notification tracking at midnight-ish (reset set every 24h)
  setInterval(() => notifiedDueSoon.clear(), 24 * 60 * 60 * 1000);
  intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
  // Run initial check after 30 seconds (let other services initialize first)
  setTimeout(tick, 30_000);
  logger.info('Credential rotation worker started (interval: 1h)');
}

export async function stopCredentialRotationWorker(): Promise<void> {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  logger.info('Credential rotation worker stopped');
}
