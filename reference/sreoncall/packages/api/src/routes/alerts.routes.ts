/**
 * Alert Ingestion API — POST /api/v1/alerts/ingest
 *
 * Accepts alert payloads from external monitoring systems and auto-creates
 * incidents. Supported formats:
 *   1. Generic   — { title, description, severity, labels, fingerprint, source }
 *   2. Prometheus Alertmanager — { alerts: [{ labels, annotations, startsAt }] }
 *   3. Datadog   — { alert_title, alert_message, priority, tags }
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as incidentService from '../services/incident.service';
import { AlertRule } from '../models/alert-rule.model';
import { logger } from '../utils/logger';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const genericSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  severity: z.number().int().min(1).max(5).optional().default(3),
  labels: z.array(z.string()).optional().default([]),
  fingerprint: z.string().optional(), // deduplicate by fingerprint
  source: z.enum(['alert', 'webhook']).optional().default('alert'),
  escalation_policy_id: z.string().optional(),
  service_id: z.string().optional(),
  affected_service_ids: z.array(z.string()).optional(),
});

const prometheusAlertSchema = z.object({
  version: z.string().optional(),
  groupKey: z.string().optional(),
  alerts: z.array(
    z.object({
      status: z.enum(['firing', 'resolved']).optional().default('firing'),
      labels: z.record(z.string()).optional().default({}),
      annotations: z.record(z.string()).optional().default({}),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      fingerprint: z.string().optional(),
    })
  ),
});

const datadogSchema = z.object({
  alert_title: z.string().optional(),
  alert_message: z.string().optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  tags: z.string().optional(), // comma-separated
  event_title: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map Prometheus severity label to SEV 1-5 */
function promSeverityToSev(severity: string | undefined): number {
  switch (severity?.toLowerCase()) {
    case 'critical': return 1;
    case 'high':     return 2;
    case 'warning':  return 3;
    case 'low':      return 4;
    default:         return 3;
  }
}

/** Map Datadog priority to SEV 1-5 */
function datadogPriorityToSev(priority: string | undefined): number {
  switch (priority) {
    case 'P1': return 1;
    case 'P2': return 2;
    case 'P3': return 3;
    case 'P4': return 4;
    default:   return 3;
  }
}

// ─── POST /api/v1/alerts/ingest (Generic) ─────────────────────────────────────

router.post('/ingest', async (req: Request, res: Response) => {
  const body = req.body;

  // Detect Prometheus Alertmanager format
  if (Array.isArray(body.alerts)) {
    const parsed = prometheusAlertSchema.parse(body);
    const results: { incident_id: string; number: number; skipped?: boolean }[] = [];

    for (const alert of parsed.alerts) {
      if (alert.status === 'resolved') {
        // Resolved alerts don't create incidents
        results.push({ incident_id: '', number: 0, skipped: true });
        continue;
      }

      const alertname = alert.labels['alertname'] || 'Prometheus Alert';
      const instance  = alert.labels['instance'] || '';
      const summary   = alert.annotations['summary'] || alertname;
      const descr     = alert.annotations['description'] || alert.annotations['message'] || '';
      const severity  = promSeverityToSev(alert.labels['severity']);
      const labels    = Object.entries(alert.labels).map(([k, v]) => `${k}:${v}`);

      // Extract escalation_policy_id and service_id from labels if present
      const escalationPolicyId = alert.labels['escalation_policy_id'] || undefined;
      const serviceId = alert.labels['service_id'] || undefined;

      // Link to the matching AlertRule (unique per tenant by name) so the
      // incident's "Triggered by alert" panel renders with last_firing_labels.
      let sourceAlertId: string | undefined;
      try {
        const rule = await AlertRule.findOneAndUpdate(
          { tenant_id: req.tenantId, name: alertname },
          {
            $set: {
              last_firing_labels: alert.labels,
              alert_state: 'firing',
              last_triggered_at: new Date(),
            },
            $inc: { trigger_count: 1 },
          },
          { new: true },
        );
        if (rule) sourceAlertId = rule._id.toString();
      } catch (err: any) {
        logger.warn('Failed to link incident to AlertRule', { alertname, error: err?.message });
      }

      const inc = await incidentService.createIncident({
        tenant_id: req.tenantId,
        created_by: req.userId,
        title: instance ? `${summary} (${instance})` : summary,
        description: descr,
        severity,
        source: 'alert',
        labels,
        escalation_policy_id: escalationPolicyId,
        affected_service_ids: serviceId ? [serviceId] : [],
        source_alert_id: sourceAlertId,
      });

      logger.info('Incident created from Prometheus alert', {
        incidentId: inc._id,
        alertname,
        fingerprint: alert.fingerprint,
      });

      results.push({ incident_id: inc._id.toString(), number: inc.number });
    }

    res.status(201).json({ created: results.filter(r => !r.skipped).length, results });
    return;
  }

  // Detect Datadog format
  if (body.alert_title || body.event_title) {
    const parsed = datadogSchema.parse(body);
    const title   = parsed.alert_title || parsed.event_title || 'Datadog Alert';
    const descr   = parsed.alert_message || '';
    const severity = datadogPriorityToSev(parsed.priority);
    const labels   = parsed.tags ? parsed.tags.split(',').map(t => t.trim()) : [];

    // Extract escalation_policy_id and service_id from tags (format: key:value)
    const tagMap = new Map(labels.map(t => { const [k, ...v] = t.split(':'); return [k, v.join(':')] as [string, string]; }));
    const ddEscalationPolicyId = tagMap.get('escalation_policy_id') || undefined;
    const ddServiceId = tagMap.get('service_id') || undefined;

    const inc = await incidentService.createIncident({
      tenant_id: req.tenantId,
      created_by: req.userId,
      title,
      description: descr,
      severity,
      source: 'webhook',
      labels,
      escalation_policy_id: ddEscalationPolicyId,
      affected_service_ids: ddServiceId ? [ddServiceId] : [],
    });

    logger.info('Incident created from Datadog alert', { incidentId: inc._id });
    res.status(201).json({ incident_id: inc._id.toString(), number: inc.number });
    return;
  }

  // Generic format
  const parsed = genericSchema.parse(body);
  const genericServiceIds = parsed.affected_service_ids ?? (parsed.service_id ? [parsed.service_id] : []);
  const inc = await incidentService.createIncident({
    tenant_id: req.tenantId,
    created_by: req.userId,
    title: parsed.title,
    description: parsed.description,
    severity: parsed.severity,
    source: parsed.source,
    labels: parsed.labels,
    escalation_policy_id: parsed.escalation_policy_id,
    affected_service_ids: genericServiceIds,
  });

  logger.info('Incident created from generic alert', { incidentId: inc._id });
  res.status(201).json({ incident_id: inc._id.toString(), number: inc.number, severity: inc.severity });
});

// ─── GET /api/v1/alerts/ingest/test ───────────────────────────────────────────
// Connectivity probe — returns 200 so monitoring tools can verify the endpoint

router.get('/ingest/test', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Alert ingestion endpoint is reachable' });
});

export default router;
