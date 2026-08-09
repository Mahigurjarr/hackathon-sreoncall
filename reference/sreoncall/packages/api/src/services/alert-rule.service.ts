import { AlertRule, IAlertRule } from '../models/alert-rule.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export type AlertOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'expr' | 'absent';

export interface AlertConditionInput {
  metric?: string;
  operator: AlertOperator;
  threshold?: number;
  window_minutes?: number;
  query?: string | null;
}

/**
 * If an escalation policy or on-call schedule is attached, force
 * auto_create_incident=true so notifications always flow through the
 * incident dispatcher (never silently dropped).
 */
function enforceIncidentPathForEscalation<T extends {
  routing?: { escalation_policy_id?: string | null; oncall_schedule_id?: string | null; additional_channels?: string[] };
  auto_create_incident?: boolean;
  name?: string;
}>(input: T): T {
  const hasEscalation = !!(input.routing && (input.routing.escalation_policy_id || input.routing.oncall_schedule_id));
  if (hasEscalation) {
    if (input.auto_create_incident === false) {
      logger.warn('alert-rule: auto_create_incident=false overridden to true because escalation policy / on-call schedule is attached', {
        name: input.name,
      });
    }
    input.auto_create_incident = true;
  }
  return input;
}

export interface CreateAlertRuleInput {
  name: string;
  description?: string;
  service_id?: string | null;
  status?: 'active' | 'inactive';
  severity?: IAlertRule['severity'];
  source_type?: 'managed_promql' | 'managed_logql' | 'byos_webhook' | 'synthetic' | 'snmp_trap';
  synthetic_check_id?: string | null;
  query?: string | null;
  condition: {
    metric: string;
    operator: AlertOperator;
    threshold: number;
    window_minutes?: number;
    query?: string | null;
  };
  conditions?: AlertConditionInput[];
  condition_logic?: 'and' | 'or';
  for_duration_seconds?: number;
  labels?: Record<string, string>;
  routing?: {
    escalation_policy_id?: string | null;
    oncall_schedule_id?: string | null;
    additional_channels?: string[];
  };
  auto_create_incident?: boolean;
  incident_severity?: IAlertRule['incident_severity'];
  notification_channels?: string[];
  is_predefined?: boolean;
  template_id?: string | null;
  category?: string | null;
  webhook_url?: string | null;
}

export interface UpdateAlertRuleInput {
  name?: string;
  description?: string;
  service_id?: string | null;
  status?: 'active' | 'inactive';
  severity?: IAlertRule['severity'];
  source_type?: 'managed_promql' | 'managed_logql' | 'byos_webhook' | 'synthetic' | 'snmp_trap';
  synthetic_check_id?: string | null;
  query?: string | null;
  condition?: Partial<IAlertRule['condition']>;
  conditions?: AlertConditionInput[];
  condition_logic?: 'and' | 'or';
  for_duration_seconds?: number;
  labels?: Record<string, string>;
  routing?: {
    escalation_policy_id?: string | null;
    oncall_schedule_id?: string | null;
    additional_channels?: string[];
  };
  auto_create_incident?: boolean;
  incident_severity?: IAlertRule['incident_severity'];
  notification_channels?: string[];
  webhook_url?: string | null;
}

export interface ListAlertRulesFilter {
  status?: string;
  severity?: string;
  service_id?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

async function normalizeAndValidateInput(
  tenantId: string,
  input: CreateAlertRuleInput | UpdateAlertRuleInput,
  existing?: {
    source_type?: string;
    synthetic_check_id?: string | null;
    query?: string | null;
    metric?: string | null;
  },
) {
  const nextSourceType = (input.source_type ?? existing?.source_type ?? 'managed_promql') as NonNullable<CreateAlertRuleInput['source_type']>;

  // ── Compound conditions ────────────────────────────────────────────────
  // Multiple simultaneous conditions combined with AND/OR. Only meaningful for
  // query-backed sources (PromQL/LogQL). Normalized FIRST so the single-
  // condition validation below sees a mirrored `condition`/`query` and doesn't
  // reject a pure metric-threshold compound rule for "missing query".
  if (input.conditions !== undefined) {
    if (nextSourceType !== 'managed_promql' && nextSourceType !== 'managed_logql') {
      // Compound conditions don't apply to webhook/synthetic/snmp sources.
      input.conditions = [];
    } else {
      const qLang = nextSourceType === 'managed_logql' ? 'LogQL' : 'PromQL';
      const ruleLevelQuery = ((input.query ?? existing?.query) ?? '').trim();
      const normalized = (input.conditions ?? []).map((c, idx) => {
        const operator = c.operator ?? 'gt';
        const metric = (c.metric ?? '').trim();
        const query = (c.query ?? '').trim();
        // `expr` and `absent` are both query-driven (no threshold): expr fires on
        // a non-empty result, absent fires on an empty one. Both just need a query.
        if (operator === 'expr' || operator === 'absent') {
          const effExpr = query || ruleLevelQuery;
          if (!effExpr) throw AppError.badRequest(`Condition ${idx + 1}: ${qLang} expression is required for the "${operator}" operator`);
          return { metric: metric || effExpr, operator, threshold: 0, window_minutes: c.window_minutes ?? 5, query: effExpr };
        }
        if (!metric) throw AppError.badRequest(`Condition ${idx + 1}: metric is required`);
        if (typeof c.threshold !== 'number' || Number.isNaN(c.threshold)) {
          throw AppError.badRequest(`Condition ${idx + 1}: numeric threshold is required`);
        }
        return { metric, operator, threshold: c.threshold, window_minutes: c.window_minutes ?? 5, query: query || null };
      });
      input.conditions = normalized;
      if (normalized.length > 0) {
        const first = normalized[0];
        // Mirror the first condition into the legacy `condition` field so older
        // readers/evaluators keep working.
        input.condition = {
          metric: first.metric,
          operator: first.operator,
          threshold: first.threshold,
          window_minutes: first.window_minutes,
          query: first.query,
        };
        // Ensure a rule-level query exists (PromQL/LogQL sources require one);
        // use the first condition's expression as the representative query.
        if (!((input.query ?? '').trim())) input.query = first.query || first.metric;
        // A single-item compound rule reduces to a plain single-condition rule.
        if (normalized.length === 1) input.conditions = [];
      }
    }
  }

  // When the caller omits a field on an update (e.g. toggling `status`), fall
  // back to the persisted value rather than treating the field as absent.
  // Without this, a `{status: 'active'}` PATCH would fail validation with
  // "PromQL query is required" because the validator saw no query on input.
  const existingQuery = existing?.query != null ? existing.query.trim() || null : null;
  const existingMetric = existing?.metric != null ? existing.metric.trim() || null : null;
  const nextQuery =
    input.query === undefined
      ? existingQuery
      : (input.query?.trim() || null);
  const nextMetric =
    input.condition?.metric === undefined
      ? existingMetric ?? undefined
      : input.condition.metric.trim();

  if (nextSourceType === 'managed_promql' || nextSourceType === 'managed_logql') {
    const effectiveQuery = nextQuery ?? null;
    // An empty metric falls back to the query — required for native `expr`
    // conditions, which have no separate metric name.
    const effectiveMetric = (nextMetric && nextMetric.trim() ? nextMetric : undefined) ?? effectiveQuery ?? undefined;
    if (!effectiveQuery) throw AppError.badRequest(`${nextSourceType === 'managed_logql' ? 'LogQL' : 'PromQL'} query is required`);
    if (!effectiveMetric) throw AppError.badRequest('Condition metric is required');
    // Only assign when caller provided a value; don't persist the fallback
    // into `input` or we'd re-write the field on every toggle.
    if (input.query !== undefined) input.query = effectiveQuery;
    if (input.condition?.metric !== undefined) input.condition.metric = effectiveMetric;
    if ('synthetic_check_id' in input) input.synthetic_check_id = null;
  }

  if (nextSourceType === 'synthetic') {
    const nextSyntheticCheckId = ('synthetic_check_id' in input ? input.synthetic_check_id : undefined) ?? existing?.synthetic_check_id ?? null;
    if (!nextSyntheticCheckId) throw AppError.badRequest('synthetic_check_id is required for synthetic rules');
    const check = await SyntheticCheck.findOne({ _id: nextSyntheticCheckId, tenant_id: tenantId }).select('_id');
    if (!check) throw AppError.badRequest('Synthetic check not found');
    if (!nextMetric) throw AppError.badRequest('Synthetic signal is required');
    if (input.condition) input.condition.metric = nextMetric;
    if (input.query !== undefined) input.query = nextQuery ?? nextMetric;
    if ('synthetic_check_id' in input) input.synthetic_check_id = nextSyntheticCheckId;
  }

  if (nextSourceType === 'byos_webhook') {
    const effectiveMetric = nextMetric ?? 'incoming_value';
    if (input.condition) {
      input.condition.metric = effectiveMetric;
      input.condition.window_minutes = 5;
    }
    input.query = null;
    if ('synthetic_check_id' in input) input.synthetic_check_id = null;
    if ('for_duration_seconds' in input && input.for_duration_seconds !== undefined) {
      input.for_duration_seconds = 0;
    }
  }
}

export async function listAlertRules(tenantId: string, filter: ListAlertRulesFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };

  if (filter.status) query.status = filter.status;
  if (filter.severity) query.severity = filter.severity;
  if (filter.service_id) query.service_id = filter.service_id;
  if (filter.search) {
    query.$or = [
      { name: { $regex: filter.search, $options: 'i' } },
      { description: { $regex: filter.search, $options: 'i' } },
    ];
  }
  if (filter.cursor) query._id = { $gt: filter.cursor };

  const docs = await AlertRule.find(query)
    .populate('service_id', 'name type current_status')
    .sort({ created_at: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await AlertRule.countDocuments({ tenant_id: tenantId }),
    },
  };
}

export async function getAlertRuleById(tenantId: string, id: string) {
  const doc = await AlertRule.findOne({ _id: id, tenant_id: tenantId })
    .populate('service_id', 'name type current_status')
    .lean();
  if (!doc) throw AppError.notFound('Alert rule not found');
  return doc;
}

export async function createAlertRule(tenantId: string, userId: string, input: CreateAlertRuleInput) {
  // Fix 5: force incident path when escalation policy / on-call schedule is attached
  input = enforceIncidentPathForEscalation({ ...input });
  await normalizeAndValidateInput(tenantId, input);

  // Fix 4: smarter auto_create_incident default for predefined template activations.
  // Only apply when the caller did not explicitly set the field.
  let autoCreateIncident: boolean;
  if (input.auto_create_incident !== undefined) {
    autoCreateIncident = input.auto_create_incident;
  } else if (input.is_predefined) {
    const sev = input.severity ?? 'medium';
    autoCreateIncident = sev === 'critical' || sev === 'high';
  } else {
    autoCreateIncident = true;
  }
  const webhookSecret = input.source_type === 'byos_webhook'
    ? crypto.randomBytes(24).toString('hex')
    : null;

  const doc = await AlertRule.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    description: input.description ?? '',
    service_id: input.service_id ?? null,
    status: input.status ?? 'active',
    severity: input.severity ?? 'medium',
    source_type: input.source_type ?? 'managed_promql',
    synthetic_check_id: input.synthetic_check_id ?? null,
    query: input.query ?? null,
    condition: {
      metric: input.condition.metric,
      operator: input.condition.operator,
      threshold: input.condition.threshold,
      window_minutes: input.condition.window_minutes ?? 5,
      query: input.condition.query ?? null,
    },
    conditions: (input.conditions ?? []).map((c) => ({
      metric: c.metric ?? '',
      operator: c.operator,
      threshold: c.threshold ?? 0,
      window_minutes: c.window_minutes ?? 5,
      query: c.query ?? null,
    })),
    condition_logic: input.condition_logic ?? 'and',
    for_duration_seconds: input.for_duration_seconds ?? 300,
    labels: input.labels ?? {},
    routing: input.routing ? {
      escalation_policy_id: input.routing.escalation_policy_id ?? null,
      oncall_schedule_id: input.routing.oncall_schedule_id ?? null,
      additional_channels: input.routing.additional_channels ?? [],
    } : undefined,
    auto_create_incident: autoCreateIncident,
    incident_severity: input.incident_severity ?? 'sev3',
    notification_channels: input.notification_channels ?? [],
    webhook_url: input.webhook_url ?? null,
    webhook_secret: webhookSecret,
    is_predefined: input.is_predefined ?? false,
    template_id: input.template_id ?? null,
    category: input.category ?? null,
  });
  return doc.toObject();
}

export async function updateAlertRule(tenantId: string, id: string, input: UpdateAlertRuleInput) {
  // Fix 5: force incident path when escalation policy / on-call schedule is attached.
  // Consider either the incoming routing (if provided) or the existing rule's routing.
  let effectiveRouting = input.routing;
  if (effectiveRouting === undefined) {
    const existing = await AlertRule.findOne({ _id: id, tenant_id: tenantId }).select('routing name').lean();
    if (existing?.routing) {
      effectiveRouting = {
        escalation_policy_id: existing.routing.escalation_policy_id ? existing.routing.escalation_policy_id.toString() : null,
        oncall_schedule_id: existing.routing.oncall_schedule_id ? existing.routing.oncall_schedule_id.toString() : null,
        additional_channels: existing.routing.additional_channels ?? [],
      };
    }
  }
  const enforced = enforceIncidentPathForEscalation({
    routing: effectiveRouting,
    auto_create_incident: input.auto_create_incident,
    name: input.name,
  });
  if (enforced.auto_create_incident !== undefined) {
    input.auto_create_incident = enforced.auto_create_incident;
  }

  const existingForValidation = await AlertRule.findOne({ _id: id, tenant_id: tenantId })
    .select('source_type synthetic_check_id webhook_secret query condition.metric')
    .lean();
  if (!existingForValidation) throw AppError.notFound('Alert rule not found');
  await normalizeAndValidateInput(tenantId, input, {
    source_type: existingForValidation?.source_type,
    synthetic_check_id: (existingForValidation as any)?.synthetic_check_id?.toString?.() ?? null,
    query: (existingForValidation as any)?.query ?? null,
    metric: (existingForValidation as any)?.condition?.metric ?? null,
  });

  const update: any = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.service_id !== undefined) update.service_id = input.service_id;
  if (input.status !== undefined) update.status = input.status;
  if (input.severity !== undefined) update.severity = input.severity;
  if (input.source_type !== undefined) update.source_type = input.source_type;
  if (input.synthetic_check_id !== undefined) update.synthetic_check_id = input.synthetic_check_id;
  if (input.query !== undefined) update.query = input.query;
  if (input.condition !== undefined) {
    for (const [k, v] of Object.entries(input.condition)) {
      update[`condition.${k}`] = v;
    }
  }
  if (input.conditions !== undefined) update.conditions = input.conditions;
  if (input.condition_logic !== undefined) update.condition_logic = input.condition_logic;
  if (input.for_duration_seconds !== undefined) update.for_duration_seconds = input.for_duration_seconds;
  if (input.labels !== undefined) update.labels = input.labels;
  if (input.routing !== undefined) update.routing = input.routing;
  if (input.auto_create_incident !== undefined) update.auto_create_incident = input.auto_create_incident;
  if (input.incident_severity !== undefined) update.incident_severity = input.incident_severity;
  if (input.notification_channels !== undefined) update.notification_channels = input.notification_channels;
  if (input.webhook_url !== undefined) update.webhook_url = input.webhook_url;
  if (input.source_type === 'byos_webhook') {
    update.webhook_secret = (existingForValidation as any).webhook_secret ?? crypto.randomBytes(24).toString('hex');
  } else if (input.source_type !== undefined) {
    update.webhook_secret = null;
  }

  const doc = await AlertRule.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: update },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Alert rule not found');
  return doc;
}

export async function deleteAlertRule(tenantId: string, id: string) {
  const doc = await AlertRule.findOneAndDelete({ _id: id, tenant_id: tenantId });
  if (!doc) throw AppError.notFound('Alert rule not found');
}

export async function triggerAlertRule(tenantId: string, id: string) {
  const doc = await AlertRule.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: { last_triggered_at: new Date() }, $inc: { trigger_count: 1 } },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Alert rule not found');
  return doc;
}
