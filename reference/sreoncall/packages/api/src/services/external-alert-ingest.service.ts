import { createHash, randomBytes } from 'crypto';
import { Types } from 'mongoose';
import { ExternalAlertSource, ExternalAlertSourceDocument, ExternalAlertPlatform } from '../models/external-alert-source.model';
import { Incident } from '../models/incident.model';
import { User } from '../models/user.model';
import * as incidentService from './incident.service';
import { applyAlertStatusToService } from './service.service';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedAlert {
  fingerprint: string;
  title: string;
  description: string;
  severity: number; // 1–4
  labels: Record<string, string>;
  status: 'firing' | 'resolved';
  external_id?: string;
}

export interface CreateSourceInput {
  name: string;
  description?: string;
  platform: ExternalAlertPlatform;
  default_severity?: number;
  auto_create_incident?: boolean;
  auto_resolve?: boolean;
  escalation_policy_id?: string;
  service_id?: string;
  labels?: string[];
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function generateToken(): { raw: string; hash: string; prefix: string } {
  const raw = `srk_ext_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 16);
  return { raw, hash, prefix };
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Source management ────────────────────────────────────────────────────────

export async function createSource(
  tenantId: string,
  userId: string,
  input: CreateSourceInput,
): Promise<{ source: ExternalAlertSourceDocument; rawToken: string }> {
  const { raw, hash, prefix } = generateToken();
  const source = await ExternalAlertSource.create({
    tenant_id: new Types.ObjectId(tenantId),
    name: input.name,
    description: input.description || '',
    platform: input.platform,
    token_hash: hash,
    token_prefix: prefix,
    default_severity: input.default_severity ?? 3,
    auto_create_incident: input.auto_create_incident ?? true,
    auto_resolve: input.auto_resolve ?? true,
    escalation_policy_id: input.escalation_policy_id ? new Types.ObjectId(input.escalation_policy_id) : null,
    service_id: input.service_id ? new Types.ObjectId(input.service_id) : null,
    labels: input.labels || [],
    created_by: new Types.ObjectId(userId),
  });
  return { source, rawToken: raw };
}

export async function listSources(tenantId: string): Promise<ExternalAlertSourceDocument[]> {
  return ExternalAlertSource.find({ tenant_id: new Types.ObjectId(tenantId) }).sort({ created_at: -1 });
}

export async function deleteSource(tenantId: string, sourceId: string): Promise<void> {
  const doc = await ExternalAlertSource.findOneAndDelete({
    _id: sourceId,
    tenant_id: new Types.ObjectId(tenantId),
  });
  if (!doc) throw new Error('External alert source not found');
}

export async function rotateToken(
  tenantId: string,
  sourceId: string,
): Promise<{ source: ExternalAlertSourceDocument; rawToken: string }> {
  const { raw, hash, prefix } = generateToken();
  const source = await ExternalAlertSource.findOneAndUpdate(
    { _id: sourceId, tenant_id: new Types.ObjectId(tenantId) },
    { $set: { token_hash: hash, token_prefix: prefix, last_used_at: null } },
    { new: true },
  );
  if (!source) throw new Error('External alert source not found');
  return { source, rawToken: raw };
}

export async function validateToken(rawToken: string): Promise<ExternalAlertSourceDocument | null> {
  if (!rawToken?.startsWith('srk_ext_')) return null;
  const hash = hashToken(rawToken);
  const source = await ExternalAlertSource.findOne({ token_hash: hash });
  if (!source) return null;
  // fire-and-forget last_used_at update
  ExternalAlertSource.updateOne({ _id: source._id }, { $set: { last_used_at: new Date() } }).catch(() => {});
  return source;
}

// ─── Severity mapping ─────────────────────────────────────────────────────────

function mapSeverity(raw: string | undefined, defaultSev: number): number {
  if (!raw) return defaultSev;
  const s = raw.toLowerCase();
  if (s === 'critical' || s === 'p1' || s === 'sev1' || s === 's1') return 1;
  if (s === 'high' || s === 'p2' || s === 'sev2' || s === 's2' || s === 'error') return 2;
  if (s === 'medium' || s === 'warning' || s === 'warn' || s === 'p3' || s === 'sev3' || s === 's3') return 3;
  if (s === 'low' || s === 'info' || s === 'p4' || s === 'sev4' || s === 's4') return 4;
  return defaultSev;
}

// ─── Payload parsers ──────────────────────────────────────────────────────────

function parseGroundcoverPayload(body: any, defaultSev: number): ParsedAlert[] {
  // Groundcover can send Alertmanager-style payloads too — detect by 'alerts' array
  if (Array.isArray(body.alerts)) {
    return parseAlertmanagerPayload(body, defaultSev);
  }

  // Groundcover PagerDuty Events API v2 compatible format — detect by event_action
  if (body.event_action) {
    return parseGenericPayload(body, defaultSev);
  }

  // Groundcover hybrid format: has dedup_key + endsAt (Alertmanager-inspired but not wrapped in alerts[])
  // endsAt non-empty (and not zero time) = resolved; empty = firing
  if (body.dedup_key !== undefined) {
    const endsAt = body.endsAt || '';
    const bodyStatus = (body.status || '').toLowerCase();
    const isResolved = (endsAt !== '' && endsAt !== '0001-01-01T00:00:00Z') || bodyStatus === 'resolved' || bodyStatus === 'normal' || bodyStatus === 'ok';
    const title = body.title || body.name || 'Groundcover Alert';
    const description = body.description || body.annotations?.description || body.annotations?.summary || '';
    const labels: Record<string, string> = {
      ...(body.labels || {}),
      source: 'groundcover',
    };
    return [{
      fingerprint: body.dedup_key,
      title,
      description,
      severity: mapSeverity(body.severity, defaultSev),
      labels,
      status: isResolved ? 'resolved' : 'firing',
      external_id: body.dedup_key,
    }];
  }

  // Native Groundcover monitor webhook format
  const status = (body.state || body.type || body.status || '').toLowerCase();
  const isFiring = status === 'firing' || status === 'alert' || status === 'triggered';
  const isResolved = status === 'ok' || status === 'resolved' || status === 'normal';

  if (!isFiring && !isResolved) {
    logger.warn('Groundcover: unrecognised status field', { status });
  }

  const monitorId = body.monitorId || body.monitor?.id || body.id || '';
  const monitorName = body.name || body.monitorName || body.monitor?.name || 'Alert';
  const fingerprint = `gc:${monitorId || monitorName}`;

  const labels: Record<string, string> = {
    ...(body.labels || {}),
    source: 'groundcover',
    ...(monitorId ? { monitor_id: monitorId } : {}),
  };

  const description = body.description || body.message || body.monitor?.description || '';

  return [{
    fingerprint,
    title: `[Groundcover] ${monitorName}`,
    description,
    severity: mapSeverity(body.severity || body.alertSeverity, defaultSev),
    labels,
    status: isResolved ? 'resolved' : 'firing',
    external_id: monitorId,
  }];
}

function parseAlertmanagerPayload(body: any, defaultSev: number): ParsedAlert[] {
  // Prometheus Alertmanager webhook format — also used by Grafana Alerting
  const alerts: any[] = Array.isArray(body.alerts) ? body.alerts : [];
  if (alerts.length === 0) return [];

  return alerts.map((a: any) => {
    const labels = { ...(a.labels || {}), ...(body.commonLabels || {}) };
    const annotations = { ...(a.annotations || {}), ...(body.commonAnnotations || {}) };

    const alertname = labels.alertname || 'Alert';
    const status = (a.status || body.status || 'firing').toLowerCase();
    const isFiring = status === 'firing';

    const fingerprint = a.fingerprint || `am:${alertname}:${JSON.stringify(labels).slice(0, 100)}`;
    const title = annotations.summary || annotations.title || alertname;
    const description = annotations.description || annotations.message || '';

    return {
      fingerprint,
      title: `[Alert] ${title}`,
      description,
      severity: mapSeverity(labels.severity || labels.priority, defaultSev),
      labels: labels as Record<string, string>,
      status: isFiring ? 'firing' : 'resolved',
      external_id: a.fingerprint,
    };
  });
}

function parseGrafanaPayload(body: any, defaultSev: number): ParsedAlert[] {
  // Grafana Alerting unified webhook (v0.1 format)
  const alerts: any[] = Array.isArray(body.alerts) ? body.alerts : [];
  if (alerts.length > 0) {
    // Newer Grafana sends Alertmanager-compatible format
    return parseAlertmanagerPayload(body, defaultSev);
  }

  // Older Grafana webhook (legacy)
  const status = (body.state || body.status || 'alerting').toLowerCase();
  const isFiring = status === 'alerting' || status === 'firing';
  const title = body.title || body.ruleName || 'Grafana Alert';
  const fingerprint = `grafana:${body.ruleId || body.ruleName || title}`;

  return [{
    fingerprint,
    title: `[Grafana] ${title}`,
    description: body.message || body.ruleUrl || '',
    severity: mapSeverity(body.severity, defaultSev),
    labels: { source: 'grafana', rule_url: body.ruleUrl || '' },
    status: isFiring ? 'firing' : 'resolved',
    external_id: String(body.ruleId || ''),
  }];
}

function parseDatadogPayload(body: any, defaultSev: number): ParsedAlert[] {
  // Datadog monitor webhook format
  const status = (body.alert_type || body.event_type || '').toLowerCase();
  const isFiring = status.includes('alert') || status.includes('triggered') || status.includes('no data');
  const isResolved = status.includes('recover') || status.includes('resolved');

  const monitorId = String(body.id || '');
  const title = body.title || body.monitor?.name || 'Datadog Alert';
  const fingerprint = `dd:${monitorId || title}`;

  return [{
    fingerprint,
    title: `[Datadog] ${title}`,
    description: body.body || body.text || body.message || '',
    severity: mapSeverity(body.priority, defaultSev),
    labels: {
      source: 'datadog',
      ...(monitorId ? { monitor_id: monitorId } : {}),
      ...(body.tags ? { tags: Array.isArray(body.tags) ? body.tags.join(',') : body.tags } : {}),
    },
    status: isResolved ? 'resolved' : 'firing',
    external_id: monitorId,
  }];
}

function parseGenericPayload(body: any, defaultSev: number): ParsedAlert[] {
  // Generic / PagerDuty-style format
  // Supports: status, title, message/description, severity, labels, fingerprint, dedup_key
  const rawStatus = (body.status || body.event_action || 'firing').toLowerCase();
  const isFiring = rawStatus === 'firing' || rawStatus === 'trigger';
  const isResolved = rawStatus === 'resolved' || rawStatus === 'resolve';

  const title = body.title || body.name || body.alertname || 'External Alert';
  // dedup_key (PagerDuty-style) takes precedence over fingerprint for dedup
  const fingerprint = body.dedup_key || body.dedup_id || body.fingerprint || `generic:${title}`;

  const description = body.description || body.message || body.summary || '';
  const sevRaw = body.severity || (body.payload && body.payload.severity) || '';

  const labels: Record<string, string> = {
    ...(body.labels || {}),
    ...(body.payload?.custom_details || {}),
  };

  return [{
    fingerprint,
    title,
    description,
    severity: mapSeverity(sevRaw, defaultSev),
    labels,
    status: isResolved ? 'resolved' : 'firing',
    external_id: body.dedup_key || body.id || body.fingerprint || '',
  }];
}

export function parsePayload(platform: ExternalAlertPlatform, body: any, defaultSev: number): ParsedAlert[] {
  try {
    switch (platform) {
      case 'groundcover': return parseGroundcoverPayload(body, defaultSev);
      case 'alertmanager': return parseAlertmanagerPayload(body, defaultSev);
      case 'grafana': return parseGrafanaPayload(body, defaultSev);
      case 'datadog': return parseDatadogPayload(body, defaultSev);
      case 'generic':
      default:
        return parseGenericPayload(body, defaultSev);
    }
  } catch (err: any) {
    logger.warn('External alert payload parse error', { platform, error: err.message });
    return [];
  }
}

// ─── Incident resolution ──────────────────────────────────────────────────────

async function findAdminUser(tenantId: Types.ObjectId): Promise<Types.ObjectId | null> {
  const admin = await User.findOne({ tenant_id: tenantId, status: 'active', roles: 'Admin' })
    .select('_id').lean();
  if (admin) return (admin as any)._id;
  const any = await User.findOne({ tenant_id: tenantId, status: 'active' }).select('_id').lean();
  return any ? (any as any)._id : null;
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

export async function ingestAlerts(
  source: ExternalAlertSourceDocument,
  alerts: ParsedAlert[],
): Promise<{ created: number; deduplicated: number; resolved: number }> {
  let created = 0;
  let deduplicated = 0;
  let resolved = 0;

  const actorId = await findAdminUser(source.tenant_id);
  if (!actorId && source.auto_create_incident) {
    logger.warn('No active user found for tenant; skipping incident creation', {
      tenantId: source.tenant_id,
      sourceId: source._id,
    });
    return { created, deduplicated, resolved };
  }

  for (const alert of alerts) {
    try {
      if (alert.status === 'resolved') {
        if (!source.auto_resolve) continue;

        const existing = await Incident.findOne({
          tenant_id: source.tenant_id,
          'custom_fields.external_source_id': source._id.toString(),
          'custom_fields.external_alert_fingerprint': alert.fingerprint,
          status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
        });

        if (existing) {
          await incidentService.resolveIncident(
            source.tenant_id,
            existing._id.toString(),
            actorId!,
            `Auto-resolved by ${source.name} (${source.platform})`,
          );
          resolved++;
          logger.info('External alert auto-resolved incident', {
            incidentId: existing._id,
            sourceId: source._id,
            fingerprint: alert.fingerprint,
          });

          // Clear the linked service's status — without this it would stay
          // degraded until an unrelated cascade event happened to touch it.
          if (source.service_id) {
            await applyAlertStatusToService(source.tenant_id.toString(), source.service_id.toString(), 'operational');
          }
        }
        continue;
      }

      // Firing — check for dedup before creating
      if (!source.auto_create_incident) continue;

      const existingOpen = await Incident.findOne({
        tenant_id: source.tenant_id,
        'custom_fields.external_source_id': source._id.toString(),
        'custom_fields.external_alert_fingerprint': alert.fingerprint,
        status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
      });

      if (existingOpen) {
        // Refresh the last-firing-at marker so the stale-detection worker
        // knows this alert is still actively firing. Without this, the worker
        // would auto-resolve a long-running incident that's still firing.
        await Incident.updateOne(
          { _id: existingOpen._id },
          { $set: { 'custom_fields.external_alert_last_firing_at': new Date() } },
        );
        deduplicated++;
        continue;
      }

      const inc = await incidentService.createIncident({
        tenant_id: source.tenant_id,
        created_by: actorId!,
        title: alert.title,
        description: alert.description,
        severity: alert.severity as 1 | 2 | 3 | 4,
        source: 'webhook',
        labels: [
          ...source.labels,
          ...Object.entries(alert.labels).map(([k, v]) => `${k}:${v}`),
        ],
        escalation_policy_id: source.escalation_policy_id?.toString(),
        affected_service_ids: source.service_id ? [source.service_id.toString()] : [],
      });

      // Route through the cascade-aware path — the admin-configured service
      // mapping on this source already existed but was never wired to a
      // status update, so the cascade engine never engaged for these alerts.
      if (source.service_id) {
        const svcStatus = alert.severity === 1 ? 'major_outage' : alert.severity === 2 ? 'partial_outage' : 'degraded';
        await applyAlertStatusToService(source.tenant_id.toString(), source.service_id.toString(), svcStatus, inc._id.toString());
      }

      // Attach external fingerprint for dedup and auto-resolve. Also set
      // external_alert_last_firing_at so the stale-detection worker can
      // auto-resolve this incident if no further firing pings arrive within
      // the stale threshold (handles platforms like Groundcover that don't
      // send explicit "resolved" webhooks).
      await Incident.updateOne(
        { _id: inc._id },
        {
          $set: {
            'custom_fields.external_source_id': source._id.toString(),
            'custom_fields.external_alert_fingerprint': alert.fingerprint,
            'custom_fields.external_platform': source.platform,
            'custom_fields.external_alert_last_firing_at': new Date(),
            ...(alert.external_id ? { 'custom_fields.external_alert_id': alert.external_id } : {}),
          },
        },
      );

      created++;
      logger.info('External alert created incident', {
        incidentId: inc._id,
        sourceId: source._id,
        platform: source.platform,
        fingerprint: alert.fingerprint,
      });
    } catch (err: any) {
      logger.error('Failed to process external alert', {
        sourceId: source._id,
        fingerprint: alert.fingerprint,
        error: err.message,
      });
    }
  }

  return { created, deduplicated, resolved };
}
