import { Types } from 'mongoose';
import { IAlertRule, AlertRule } from '../models/alert-rule.model';
import { Incident } from '../models/incident.model';
import { Service } from '../models/service.model';
import { ServiceDependency } from '../models/service-dependency.model';
import { User } from '../models/user.model';
import * as notificationService from './notification.service';
import * as incidentService from './incident.service';
import { publishAgentTrigger } from './agent-trigger.service';
import { logger } from '../utils/logger';

const ALERT_DEDUP_COOLDOWN_MS = Math.max(parseInt(process.env.ALERT_DEDUP_COOLDOWN_MS || '', 10) || 5 * 60_000, 5 * 60_000);

const tenantFallbackUserCache = new Map<string, Types.ObjectId | null>();

function getRuleId(rule: IAlertRule): string {
  return ((rule as any)._id || (rule as any).id).toString();
}

async function resolveRuleCreator(rule: IAlertRule): Promise<Types.ObjectId | null> {
  if (rule.created_by) return rule.created_by as unknown as Types.ObjectId;
  const tenantKey = (rule.tenant_id as any).toString();
  if (tenantFallbackUserCache.has(tenantKey)) return tenantFallbackUserCache.get(tenantKey)!;
  const admin = await User.findOne({ tenant_id: rule.tenant_id, status: 'active', roles: 'Admin' })
    .select('_id').lean();
  const fallback = admin
    ? (admin as any)._id as Types.ObjectId
    : ((await User.findOne({ tenant_id: rule.tenant_id, status: 'active' }).select('_id').lean()) as any)?._id ?? null;
  tenantFallbackUserCache.set(tenantKey, fallback);
  return fallback;
}

async function sendSlackWebhook(
  webhookUrl: string,
  rule: IAlertRule,
  value: number,
  state: 'firing' | 'resolved',
  note?: string,
): Promise<void> {
  const isFiring = state === 'firing';
  const { operator, threshold } = rule.condition;
  const opSymbol: Record<string, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==' };
  const color = isFiring
    ? (rule.severity === 'critical' ? '#DC2626' : rule.severity === 'high' ? '#F59E0B' : '#3B82F6')
    : '#16A34A';

  const payload = {
    attachments: [{
      color,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: isFiring ? `:rotating_light: *FIRING* — ${rule.name}` : `:white_check_mark: *RESOLVED* — ${rule.name}`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Severity:*\n${rule.severity.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Current Value:*\n${value.toFixed(4)}` },
            { type: 'mrkdwn', text: `*Condition:*\n${rule.condition.metric} ${opSymbol[operator] || operator} ${threshold}` },
            { type: 'mrkdwn', text: `*Window:*\n${rule.condition.window_minutes}m` },
          ],
        },
        ...(note ? [{
          type: 'context',
          elements: [{ type: 'mrkdwn', text: note }],
        }] : []),
      ],
    }],
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      logger.error('Slack webhook failed', { ruleId: getRuleId(rule), status: resp.status });
    }
  } catch (err: any) {
    logger.error('Slack webhook error', { ruleId: getRuleId(rule), error: err.message });
  }
}

async function createIncidentForRule(
  rule: IAlertRule,
  value: number,
  queryLabels: Record<string, string>,
  note?: string,
): Promise<void> {
  const ruleCreator = await resolveRuleCreator(rule);
  if (!rule.auto_create_incident || !ruleCreator) return;

  const cooldownAgo = new Date(Date.now() - ALERT_DEDUP_COOLDOWN_MS);
  const existingIncident = await Incident.findOne({
    tenant_id: rule.tenant_id,
    source_alert_id: getRuleId(rule),
    $or: [
      { status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] } },
      { status: { $in: ['resolved', 'closed'] }, updatedAt: { $gte: cooldownAgo } },
    ],
  });
  if (existingIncident) return;

  const sevMap: Record<string, number> = { sev1: 1, sev2: 2, sev3: 3, sev4: 4 };
  let escalationPolicyId: string | undefined;
  if (rule.routing?.escalation_policy_id) {
    escalationPolicyId = rule.routing.escalation_policy_id.toString();
  } else if (rule.service_id) {
    const svc = await Service.findById(rule.service_id);
    if (svc?.escalation_policy_id) escalationPolicyId = svc.escalation_policy_id.toString();
  }

  let serviceName = '';
  if (rule.service_id) {
    const svc = await Service.findById(rule.service_id).select('name').lean();
    serviceName = svc ? (svc as any).name : '';
  }

  const titleSuffix = serviceName ? ` — ${serviceName}` : (queryLabels.check_name ? ` — ${queryLabels.check_name}` : '');
  const title = `[Alert] ${rule.name}${titleSuffix}`;

  const opSymbolMap: Record<string, string> = { gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '==' };
  const { operator, threshold } = rule.condition;
  const summaryLine = `Metric breached threshold: current value **${value.toFixed(2)}** (threshold: ${opSymbolMap[operator] || operator} ${threshold}).`;

  const infraMap: [string, string | undefined][] = [
    ['Instance', queryLabels.instance],
    ['Node', queryLabels.node],
    ['Namespace', queryLabels.namespace],
    ['Pod', queryLabels.pod],
    ['Container', queryLabels.container],
    ['Deployment', queryLabels.deployment],
    ['DaemonSet', queryLabels.daemonset],
    ['StatefulSet', queryLabels.statefulset],
    ['HPA', queryLabels.horizontalpodautoscaler],
    ['PVC', queryLabels.persistentvolumeclaim],
    ['Job', queryLabels.job],
    ['K8s Job', queryLabels.job_name],
    ['Ingress', queryLabels.ingress],
    ['Device', queryLabels.device],
    ['Mountpoint', queryLabels.mountpoint],
    ['Interface', queryLabels.ifName],
    ['BGP Peer', queryLabels.bgpPeerRemoteAddr],
    ['Sensor', queryLabels.entPhysicalDescr],
    ['Sysname', queryLabels.sysname || queryLabels.sysName],
    ['GPU', queryLabels.gpu],
    ['Stream', queryLabels.stream_name],
    ['Consumer', queryLabels.consumer_name],
    ['EC2 Instance', queryLabels.dimension_InstanceId],
    ['RDS Instance', queryLabels.dimension_DBInstanceIdentifier],
    ['Lambda Function', queryLabels.dimension_FunctionName],
    ['Load Balancer', queryLabels.dimension_LoadBalancer],
    ['SQS Queue', queryLabels.dimension_QueueName],
    ['Dest IP', queryLabels.dest_ip],
    ['Dest Port', queryLabels.dest_port],
    ['Service', queryLabels.service_name || queryLabels.service],
    ['Resource', queryLabels.resource],
    ['Reason', queryLabels.reason],
  ];
  const activeInfra = infraMap.filter(([, v]) => v);
  const infraSection = activeInfra.length > 0
    ? `\n### Infrastructure\n| Component | Value |\n|-----------|-------|\n${activeInfra.map(([k, v]) => `| ${k} | \`${v}\` |`).join('\n')}`
    : '';

  const investigationLine = '\n### Investigation\n1. Check the **Observability** tab for live metrics and logs';

  const description = note
    ? `${note}\n\n${summaryLine}${infraSection}${investigationLine}`
    : `${summaryLine}${infraSection}${investigationLine}`;

  const inc = await incidentService.createIncident({
    tenant_id: rule.tenant_id as any,
    created_by: ruleCreator as any,
    title,
    description,
    severity: sevMap[rule.incident_severity] ?? 3,
    source: 'alert',
    escalation_policy_id: escalationPolicyId,
    affected_service_ids: rule.service_id ? [rule.service_id.toString()] : [],
  });
  await Incident.updateOne({ _id: inc._id }, { $set: { source_alert_id: getRuleId(rule) } });

  if (rule.service_id) {
    try {
      const sevStatus = rule.severity === 'critical' ? 'major_outage' : rule.severity === 'high' ? 'partial_outage' : 'degraded';
      await Service.updateOne(
        { _id: rule.service_id, tenant_id: rule.tenant_id },
        { $set: { current_status: sevStatus } },
      );
      const deps = await ServiceDependency.find({
        tenant_id: rule.tenant_id,
        source_service_id: rule.service_id,
        status: 'approved',
      });
      if (deps.length > 0) {
        const depServiceIds = deps.map((d) => d.target_service_id);
        await Service.updateMany(
          { _id: { $in: depServiceIds }, tenant_id: rule.tenant_id, current_status: 'operational' },
          { $set: { current_status: 'degraded' } },
        );
      }
    } catch (err: any) {
      logger.debug('Failed to auto-set service status', { error: err.message });
    }
  }
}

export async function handleRuleFiring(
  rule: IAlertRule,
  value: number,
  queryLabels: Record<string, string> = {},
  note?: string,
): Promise<void> {
  const now = new Date();
  const activeSilence = (rule.active_silences || []).find((s: any) => {
    const start = s.start ? new Date(s.start) : null;
    const end = s.end ? new Date(s.end) : null;
    return start && end && now >= start && now <= end;
  });

  const updateFields: Record<string, any> = {
    alert_state: 'firing',
    last_value: value,
    last_firing_labels: queryLabels,
    last_webhook_at: rule.source_type === 'byos_webhook' ? now : (rule as any).last_webhook_at ?? null,
  };

  const lastTriggered = rule.last_triggered_at ? new Date(rule.last_triggered_at).getTime() : 0;
  const inCooldown = lastTriggered && (Date.now() - lastTriggered < ALERT_DEDUP_COOLDOWN_MS);
  if (!inCooldown) {
    updateFields.last_triggered_at = now;
    updateFields.trigger_count = (rule.trigger_count || 0) + 1;
  }

  await AlertRule.updateOne({ _id: getRuleId(rule) }, { $set: updateFields });
  if (activeSilence || inCooldown) return;

  if (rule.webhook_url) {
    await sendSlackWebhook(rule.webhook_url, rule, value, 'firing', note);
  }

  const ruleCreator = await resolveRuleCreator(rule);
  if (ruleCreator) {
    try {
      await notificationService.createNotification({
        tenant_id: rule.tenant_id as any,
        user_id: ruleCreator as any,
        type: 'alert',
        title: `Alert: ${rule.name}`,
        body: note || `Alert rule "${rule.name}" triggered. Current value: ${value.toFixed(2)}.`,
        resource_type: 'alert_rule',
        resource_id: getRuleId(rule),
      });
    } catch (err: any) {
      logger.error('Failed to create alert notification', { ruleId: getRuleId(rule), error: err.message });
    }
  }

  const tenantStr = (rule.tenant_id as any).toString();
  publishAgentTrigger('incident-triage', {
    type: 'event', event_type: 'alert.fired', source_id: getRuleId(rule),
  }, tenantStr).catch((err: any) => logger.error('Agent trigger failed (triage)', { error: err.message }));
  publishAgentTrigger('alert-intelligence', {
    type: 'event', event_type: 'alert.fired', source_id: getRuleId(rule),
  }, tenantStr).catch((err: any) => logger.error('Agent trigger failed (alert-intel)', { error: err.message }));

  await createIncidentForRule(rule, value, queryLabels, note);
}

export async function handleRuleResolved(
  rule: IAlertRule,
  value: number,
  note?: string,
): Promise<void> {
  const previousState = rule.alert_state || 'ok';
  const updateFields: Record<string, any> = {
    alert_state: 'ok',
    last_value: value,
    last_triggered_at: null,
    pending_since: null,
    pending_fingerprint: null,
  };
  await AlertRule.updateOne({ _id: getRuleId(rule) }, { $set: updateFields });

  if (previousState !== 'firing') return;

  if (rule.webhook_url) {
    await sendSlackWebhook(rule.webhook_url, rule, value, 'resolved', note);
  }

  const ruleCreator = await resolveRuleCreator(rule);
  if (ruleCreator) {
    try {
      await notificationService.createNotification({
        tenant_id: rule.tenant_id as any,
        user_id: ruleCreator as any,
        type: 'alert',
        title: `Resolved: ${rule.name}`,
        body: note || `Alert rule "${rule.name}" has resolved. Current value: ${value.toFixed(2)}.`,
        resource_type: 'alert_rule',
        resource_id: getRuleId(rule),
      });
    } catch (err: any) {
      logger.error('Failed to create resolved notification', { ruleId: getRuleId(rule), error: err.message });
    }
  }

  if (!rule.auto_create_incident) return;

  try {
    const openIncident = await Incident.findOne({
      tenant_id: rule.tenant_id,
      source_alert_id: getRuleId(rule),
      status: { $in: ['open', 'acknowledged', 'investigating', 'monitoring'] },
    });
    if (!openIncident) return;
    const resolvedAt = new Date();
    const mttrSeconds = Math.floor((resolvedAt.getTime() - openIncident.createdAt.getTime()) / 1000);
    await Incident.updateOne(
      { _id: openIncident._id },
      {
        $set: {
          status: 'resolved',
          resolved_at: resolvedAt,
          'metrics.resolved_at': resolvedAt,
          'metrics.mttr_seconds': mttrSeconds,
        },
        $push: {
          timeline: {
            type: 'status_change',
            actor_id: ruleCreator,
            message: `Auto-resolved: alert "${rule.name}" is no longer firing.`,
            metadata: { old_status: openIncident.status, new_status: 'resolved', mttr_seconds: mttrSeconds },
            created_at: resolvedAt,
          },
        },
      },
    );
  } catch (err: any) {
    logger.error('Failed to auto-resolve incident', { ruleId: getRuleId(rule), error: err.message });
  }
}
