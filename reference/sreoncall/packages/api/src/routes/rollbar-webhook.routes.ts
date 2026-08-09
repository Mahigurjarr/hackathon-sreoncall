/**
 * Rollbar Webhook Receiver — POST /api/v1/webhooks/rollbar
 *
 * Accepts Rollbar webhook payloads and creates SREonCall incidents/alerts.
 * Authentication: ingestion token via `X-Rollbar-Token` header or `?token=` query param.
 *
 * Supported event types:
 *   - new_item / reactivated_item  → create incident
 *   - occurrence_rate              → create high-severity incident (error rate spike)
 *   - resolved_item                → auto-resolve matching open incident
 *   - exp_repeat_item              → create incident (reoccurrence)
 *   - deploy                       → create change request record
 *
 * Webhook URL for Rollbar:
 *   POST https://<domain>/api/v1/webhooks/rollbar?token=<ingestion_token>
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { IngestionToken } from '../models/ingestion-token.model';
import { Incident } from '../models/incident.model';
import { User } from '../models/user.model';
import * as incidentService from '../services/incident.service';
import { logger } from '../utils/logger';

const router = Router();

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const rollbarItemSchema = z.object({
  id: z.number().optional(),
  title: z.string().optional().default('Rollbar Error'),
  level: z.string().optional().default('error'),
  environment: z.string().optional().default('unknown'),
  framework: z.string().optional(),
  total_occurrences: z.number().optional(),
  last_occurrence_timestamp: z.number().optional(),
  first_occurrence_timestamp: z.number().optional(),
  project_id: z.number().optional(),
  counter: z.number().optional(),
  activating_occurrence: z.object({
    trace: z.object({
      exception: z.object({
        class: z.string().optional(),
        message: z.string().optional(),
      }).optional(),
    }).optional(),
  }).optional(),
}).passthrough();

const rollbarPayloadSchema = z.object({
  event_name: z.string(),
  data: z.object({
    item: rollbarItemSchema.optional(),
    occurrences: z.number().optional(),
    trigger: z.object({
      window_size: z.number().optional(),
      threshold: z.number().optional(),
    }).optional(),
    deploy: z.object({
      environment: z.string().optional(),
      revision: z.string().optional(),
      local_username: z.string().optional(),
      comment: z.string().optional(),
    }).optional(),
  }).passthrough(),
}).passthrough();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map Rollbar severity level to SREonCall SEV 1-5 */
function rollbarLevelToSev(level: string | undefined): number {
  switch (level?.toLowerCase()) {
    case 'critical': return 1;
    case 'error':    return 2;
    case 'warning':  return 3;
    case 'info':     return 4;
    case 'debug':    return 4;
    default:         return 3;
  }
}

/** Map Rollbar severity to incident_severity string */
function rollbarLevelToIncidentSeverity(level: string | undefined): string {
  switch (level?.toLowerCase()) {
    case 'critical': return 'SEV1';
    case 'error':    return 'SEV2';
    case 'warning':  return 'SEV3';
    case 'info':     return 'SEV4';
    case 'debug':    return 'SEV4';
    default:         return 'SEV3';
  }
}

/** Find or fallback to a system user for the tenant (for created_by field) */
async function getSystemUserId(tenantId: Types.ObjectId): Promise<Types.ObjectId | null> {
  const adminUser = await User.findOne({
    tenant_id: tenantId,
    status: 'active',
    roles: 'Admin',
  }).select('_id').lean();

  if (adminUser) return (adminUser as any)._id as Types.ObjectId;

  const anyUser = await User.findOne({
    tenant_id: tenantId,
    status: 'active',
  }).select('_id').lean();

  return anyUser ? ((anyUser as any)._id as Types.ObjectId) : null;
}

/** Build a dedup label for a Rollbar item */
function rollbarDedupLabel(itemId: number | undefined): string {
  return itemId ? `rollbar_item_id:${itemId}` : '';
}

// ─── Token Authentication ─────────────────────────────────────────────────────

async function authenticateToken(req: Request): Promise<{ tenantId: Types.ObjectId; tokenId: Types.ObjectId } | null> {
  const rawToken = (req.headers['x-rollbar-token'] as string) || (req.query.token as string);
  if (!rawToken) return null;

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const token = await IngestionToken.findOne({ token_hash: tokenHash }).lean();

  if (!token) return null;
  if (token.revoked_at) return null;
  if (token.expires_at && token.expires_at < new Date()) return null;

  // Update last_used_at
  await IngestionToken.updateOne({ _id: token._id }, { $set: { last_used_at: new Date() } });

  return {
    tenantId: token.tenant_id as unknown as Types.ObjectId,
    tokenId: token._id as unknown as Types.ObjectId,
  };
}

// ─── POST /api/v1/webhooks/rollbar ───────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  // Authenticate
  const auth = await authenticateToken(req);
  if (!auth) {
    res.status(401).json({ detail: 'Invalid or missing token. Provide X-Rollbar-Token header or ?token= query param.' });
    return;
  }

  const { tenantId } = auth;

  // Find a system user for incident creation
  const creatorId = await getSystemUserId(tenantId);
  if (!creatorId) {
    logger.warn('Rollbar webhook: no active user found for tenant', { tenantId: tenantId.toString() });
    res.status(500).json({ detail: 'No active user found for tenant to create incidents.' });
    return;
  }

  // Parse the payload
  let payload: z.infer<typeof rollbarPayloadSchema>;
  try {
    payload = rollbarPayloadSchema.parse(req.body);
  } catch (err: any) {
    logger.warn('Rollbar webhook: invalid payload', { error: err.message });
    res.status(400).json({ detail: 'Invalid Rollbar webhook payload.', errors: err.errors });
    return;
  }

  const { event_name, data } = payload;
  const item = data.item;

  logger.info('Rollbar webhook received', {
    event_name,
    tenantId: tenantId.toString(),
    rollbar_item_id: item?.id,
    level: item?.level,
  });

  try {
    switch (event_name) {
      // ── New or reactivated error item → create incident ──
      case 'new_item':
      case 'reactivated_item':
      case 'exp_repeat_item': {
        if (!item) {
          res.status(400).json({ detail: 'Missing data.item for this event type.' });
          return;
        }

        // Dedup: check if an open incident already exists for this Rollbar item
        const dedupLabel = rollbarDedupLabel(item.id);
        if (dedupLabel) {
          const existing = await Incident.findOne({
            tenant_id: tenantId,
            labels: dedupLabel,
            status: { $nin: ['resolved', 'closed'] },
          }).lean();

          if (existing) {
            logger.info('Rollbar webhook: duplicate incident skipped', {
              rollbar_item_id: item.id,
              existing_incident_id: (existing as any)._id.toString(),
            });
            res.status(200).json({
              action: 'skipped',
              reason: 'duplicate',
              incident_id: (existing as any)._id.toString(),
              incident_number: (existing as any).number,
            });
            return;
          }
        }

        const exceptionClass = item.activating_occurrence?.trace?.exception?.class || '';
        const exceptionMsg = item.activating_occurrence?.trace?.exception?.message || '';
        const severity = rollbarLevelToSev(item.level);
        const sevLabel = rollbarLevelToIncidentSeverity(item.level);

        const description = [
          `**Rollbar ${event_name}** — ${sevLabel}`,
          '',
          `**Error:** ${exceptionClass}${exceptionMsg ? ': ' + exceptionMsg : ''}`,
          `**Environment:** ${item.environment}`,
          item.framework ? `**Framework:** ${item.framework}` : '',
          item.total_occurrences ? `**Total Occurrences:** ${item.total_occurrences}` : '',
          item.id ? `**Rollbar Item ID:** ${item.id}` : '',
          item.project_id ? `**Rollbar Project ID:** ${item.project_id}` : '',
        ].filter(Boolean).join('\n');

        const labels = [
          'rollbar',
          `source:rollbar`,
          `event:${event_name}`,
          `env:${item.environment}`,
          `level:${item.level}`,
        ];
        if (dedupLabel) labels.push(dedupLabel);
        if (exceptionClass) labels.push(`exception:${exceptionClass}`);

        const title = exceptionClass
          ? `[Rollbar] ${exceptionClass}: ${item.title.slice(0, 200)}`
          : `[Rollbar] ${item.title.slice(0, 250)}`;

        const inc = await incidentService.createIncident({
          tenant_id: tenantId,
          created_by: creatorId,
          title,
          description,
          severity,
          source: 'webhook',
          labels,
        });

        logger.info('Incident created from Rollbar webhook', {
          incidentId: inc._id.toString(),
          event_name,
          rollbar_item_id: item.id,
        });

        res.status(201).json({
          action: 'created',
          incident_id: inc._id.toString(),
          incident_number: inc.number,
          severity,
        });
        return;
      }

      // ── Occurrence rate spike → create high-severity incident ──
      case 'occurrence_rate': {
        const occurrences = data.occurrences || 0;
        const windowSize = data.trigger?.window_size || 300;
        const threshold = data.trigger?.threshold || 0;

        const dedupLabel = item?.id ? rollbarDedupLabel(item.id) : '';
        if (dedupLabel) {
          const existing = await Incident.findOne({
            tenant_id: tenantId,
            labels: dedupLabel,
            status: { $nin: ['resolved', 'closed'] },
          }).lean();

          if (existing) {
            res.status(200).json({
              action: 'skipped',
              reason: 'duplicate',
              incident_id: (existing as any)._id.toString(),
            });
            return;
          }
        }

        const title = item
          ? `[Rollbar Rate Spike] ${item.title.slice(0, 200)} — ${occurrences} occurrences in ${windowSize}s`
          : `[Rollbar Rate Spike] ${occurrences} occurrences in ${windowSize}s (threshold: ${threshold})`;

        const description = [
          `**Rollbar occurrence_rate alert**`,
          '',
          `**Occurrences:** ${occurrences} in ${windowSize} seconds`,
          `**Threshold:** ${threshold}`,
          item?.environment ? `**Environment:** ${item.environment}` : '',
          item?.title ? `**Error:** ${item.title}` : '',
          item?.id ? `**Rollbar Item ID:** ${item.id}` : '',
        ].filter(Boolean).join('\n');

        const labels = ['rollbar', 'source:rollbar', 'event:occurrence_rate'];
        if (dedupLabel) labels.push(dedupLabel);
        if (item?.environment) labels.push(`env:${item.environment}`);

        const inc = await incidentService.createIncident({
          tenant_id: tenantId,
          created_by: creatorId,
          title,
          description,
          severity: 2, // High severity for rate spikes
          source: 'webhook',
          labels,
        });

        logger.info('Incident created from Rollbar rate spike', {
          incidentId: inc._id.toString(),
          occurrences,
          windowSize,
        });

        res.status(201).json({
          action: 'created',
          incident_id: inc._id.toString(),
          incident_number: inc.number,
          severity: 2,
        });
        return;
      }

      // ── Resolved item → auto-resolve matching open incident ──
      case 'resolved_item': {
        if (!item?.id) {
          res.status(200).json({ action: 'ignored', reason: 'No item ID to match for resolution.' });
          return;
        }

        const dedupLabel = rollbarDedupLabel(item.id);
        const openIncident = await Incident.findOne({
          tenant_id: tenantId,
          labels: dedupLabel,
          status: { $nin: ['resolved', 'closed'] },
        });

        if (!openIncident) {
          logger.info('Rollbar resolved_item: no matching open incident', { rollbar_item_id: item.id });
          res.status(200).json({ action: 'ignored', reason: 'No matching open incident found.' });
          return;
        }

        await incidentService.resolveIncident(
          tenantId,
          openIncident._id.toString(),
          creatorId,
          `Auto-resolved via Rollbar (item #${item.id} marked resolved).`,
        );

        logger.info('Incident auto-resolved from Rollbar', {
          incidentId: openIncident._id.toString(),
          rollbar_item_id: item.id,
        });

        res.status(200).json({
          action: 'resolved',
          incident_id: openIncident._id.toString(),
          incident_number: openIncident.number,
        });
        return;
      }

      // ── Deploy event → create change request record ──
      case 'deploy': {
        const deploy = data.deploy || {};
        const environment = deploy.environment || item?.environment || 'unknown';
        const revision = deploy.revision || 'unknown';
        const deployUser = deploy.local_username || 'unknown';
        const comment = deploy.comment || '';

        // Use ChangeRequest model to record the deployment
        const { ChangeRequest } = await import('../models/change-request.model');
        const { getNextSequence } = await import('../models/counter.model');

        const number = await getNextSequence(tenantId, 'change');

        await ChangeRequest.create({
          tenant_id: tenantId,
          number,
          title: `[Rollbar Deploy] ${environment} — revision ${revision.slice(0, 12)}`,
          description: [
            `**Rollbar deployment event**`,
            '',
            `**Environment:** ${environment}`,
            `**Revision:** ${revision}`,
            `**Deployed by:** ${deployUser}`,
            comment ? `**Comment:** ${comment}` : '',
          ].filter(Boolean).join('\n'),
          type: 'standard',
          status: 'completed',
          risk_score: 'low',
          created_by: creatorId,
          labels: ['rollbar', 'source:rollbar', 'event:deploy', `env:${environment}`],
        });

        logger.info('Change request created from Rollbar deploy', { environment, revision });

        res.status(201).json({
          action: 'change_created',
          environment,
          revision,
        });
        return;
      }

      // ── Unknown event → acknowledge but ignore ──
      default: {
        logger.info('Rollbar webhook: unhandled event type', { event_name });
        res.status(200).json({ action: 'ignored', reason: `Unhandled event type: ${event_name}` });
        return;
      }
    }
  } catch (err: any) {
    logger.error('Rollbar webhook processing error', { error: err.message, stack: err.stack, event_name });
    res.status(500).json({ detail: 'Internal error processing Rollbar webhook.' });
  }
});

// ─── GET /api/v1/webhooks/rollbar/test ────────────────────────────────────────
// Connectivity probe — returns 200 so Rollbar can verify the endpoint is reachable

router.get('/test', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Rollbar webhook endpoint is reachable' });
});

export default router;
