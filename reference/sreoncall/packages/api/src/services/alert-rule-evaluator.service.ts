import { ObservabilityConnection } from '../models/observability-connection.model';
import { AlertRule, IAlertRule } from '../models/alert-rule.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import type { CreateAlertRuleInput } from './alert-rule.service';
import { AppError } from '../middleware/errorHandler.middleware';
import { QueryExecutionError, throwOnBadQuery } from '../utils/query-error';

const QUERY_TIMEOUT_MS = 10_000;
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_LOKI_URL  = process.env.MANAGED_LOKI_URL  || 'http://10.10.1.21:3100';

export interface DryRunResult {
  source_type: NonNullable<CreateAlertRuleInput['source_type']>;
  value: number | null;
  triggered: boolean;
  labels: Record<string, string>;
  query_executed: string | null;
  explanation: string;
  /** Set when the query itself was rejected by the backend (bad PromQL/LogQL
   *  syntax). The UI surfaces this as an error rather than "would stay OK". */
  error?: string;
}

export interface SavedRuleTestResult {
  kind: 'evaluation' | 'webhook';
  message: string;
  source_type: NonNullable<CreateAlertRuleInput['source_type']>;
  result?: DryRunResult;
  ingress_path?: string;
  connectivity_test_path?: string;
  sample_payload?: Record<string, unknown>;
  curl_command?: string;
}

interface QueryResult {
  value: number;
  labels: Record<string, string>;
  allSeries?: Array<{ value: number; labels: Record<string, string> }>;
}

async function resolveMimirUrl(tenantId: string): Promise<string> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
    mode: 'byos',
  }).sort({ created_at: -1 });

  if (conn?.endpoints?.metrics_url) {
    return conn.endpoints.metrics_url;
  }

  return MANAGED_MIMIR_URL;
}

async function resolveLokiUrl(tenantId: string): Promise<string> {
  const conn = await ObservabilityConnection.findOne({
    tenant_id: tenantId,
    status: { $in: ['connected', 'pending'] },
    mode: 'byos',
  }).sort({ created_at: -1 });

  if (conn?.endpoints?.logs_url) {
    return conn.endpoints.logs_url;
  }

  return MANAGED_LOKI_URL;
}

async function queryMimir(promql: string, tenantId: string, mimirUrl: string): Promise<QueryResult | null> {
  const url = `${mimirUrl}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': tenantId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) { await throwOnBadQuery(resp); return null; }

    const json: any = await resp.json();
    if (json.status === 'error') throw new QueryExecutionError(json.error || 'query error', 400);
    if (json.status === 'success' && Array.isArray(json.data?.result) && json.data.result.length > 0) {
      const allSeries: Array<{ value: number; labels: Record<string, string> }> = [];
      for (const r of json.data.result) {
        const v = parseFloat(r.value?.[1]);
        if (Number.isNaN(v)) continue;
        const labels: Record<string, string> = {};
        if (r.metric && typeof r.metric === 'object') {
          for (const [k, val] of Object.entries(r.metric)) {
            if (typeof val === 'string') labels[k] = val;
          }
        }
        allSeries.push({ value: v, labels });
      }
      if (allSeries.length === 0) return null;
      return { value: allSeries[0].value, labels: allSeries[0].labels, allSeries };
    }
    return null;
  } catch (err) {
    if (err instanceof QueryExecutionError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function queryLoki(logql: string, tenantId: string, lokiUrl: string, windowMinutes: number): Promise<QueryResult | null> {
  const hasAggregation = /\b(sum|count_over_time|rate|avg|max|min|topk|bottomk|count|bytes_over_time|absent_over_time|quantile_over_time)\s*[({]/.test(logql);
  const wrapped = hasAggregation ? logql : `sum(count_over_time(${logql} [${windowMinutes}m]))`;
  const params = new URLSearchParams({
    query: wrapped,
    time: String(Date.now() * 1e6),
    limit: '1',
  });
  const url = `${lokiUrl}/loki/api/v1/query?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': tenantId, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) { await throwOnBadQuery(resp); return null; }

    const json: any = await resp.json();
    if (json.status === 'error') throw new QueryExecutionError(json.error || 'query error', 400);
    if (json.status !== 'success' || !json.data) return null;
    const resultType = json.data.resultType;
    const result = json.data.result;
    if (resultType === 'vector') {
      if (!Array.isArray(result) || result.length === 0) return { value: 0, labels: {} };
      let total = 0;
      const labels: Record<string, string> = {};
      for (const r of result) {
        const v = parseFloat(r.value?.[1]);
        if (!Number.isNaN(v)) total += v;
        if (Object.keys(labels).length === 0 && r.metric && typeof r.metric === 'object') {
          for (const [k, val] of Object.entries(r.metric)) {
            if (typeof val === 'string') labels[k] = val;
          }
        }
      }
      return { value: total, labels };
    }
    if (resultType === 'scalar' || resultType === 'matrix') {
      const v = parseFloat(Array.isArray(result) ? (result[0]?.value?.[1] ?? result[1]) : result?.[1]);
      return { value: Number.isNaN(v) ? 0 : v, labels: {} };
    }
    if (resultType === 'streams') {
      let total = 0;
      const labels: Record<string, string> = {};
      for (const stream of result || []) {
        total += (stream.values?.length ?? 0);
        if (Object.keys(labels).length === 0 && stream.stream && typeof stream.stream === 'object') {
          for (const [k, v] of Object.entries(stream.stream)) {
            if (typeof v === 'string') labels[k] = v;
          }
        }
      }
      return { value: total, labels };
    }
    return null;
  } catch (err) {
    if (err instanceof QueryExecutionError) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function compareValue(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

function chooseWorstSeries(result: QueryResult, operator: string, threshold: number): QueryResult {
  if (!result.allSeries || result.allSeries.length <= 1) return result;
  let chosen = result.allSeries[0];
  for (const s of result.allSeries) {
    if ((operator === 'gt' || operator === 'gte') && s.value > chosen.value) chosen = s;
    else if ((operator === 'lt' || operator === 'lte') && s.value < chosen.value) chosen = s;
    else if (operator === 'eq' && s.value === threshold) { chosen = s; break; }
  }
  return { value: chosen.value, labels: chosen.labels, allSeries: result.allSeries };
}

interface CondDryRun {
  triggered: boolean;
  value: number | null;
  labels: Record<string, string>;
  noData: boolean;
  query_executed: string;
  /** Backend rejected this condition's query (bad syntax). */
  error?: string;
}

/** Evaluate one query-backed condition for a dry run (mirrors the worker). */
async function evalQueryConditionDryRun(
  sourceType: 'managed_promql' | 'managed_logql',
  cond: { metric?: string; operator: string; threshold?: number; window_minutes?: number; query?: string | null },
  tenantId: string,
): Promise<CondDryRun> {
  const operator = cond.operator;
  const threshold = cond.threshold ?? 0;
  const windowMinutes = cond.window_minutes ?? 5;
  const expr = (cond.query && cond.query.trim()) ? cond.query.trim() : (cond.metric ?? '');

  try {
    if (sourceType === 'managed_logql') {
      const lokiUrl = await resolveLokiUrl(tenantId);
      const result = await queryLoki(expr, tenantId, lokiUrl, windowMinutes);
      if (operator === 'expr') {
        return { triggered: (result?.value ?? 0) > 0, value: result?.value ?? null, labels: result?.labels ?? {}, noData: false, query_executed: expr };
      }
      if (operator === 'absent') {
        return { triggered: (result?.value ?? 0) === 0, value: result?.value ?? null, labels: result?.labels ?? {}, noData: false, query_executed: expr };
      }
      const value = result?.value ?? null;
      return { triggered: value === null ? false : compareValue(value, operator, threshold), value, labels: result?.labels ?? {}, noData: value === null, query_executed: expr };
    }

    const mimirUrl = await resolveMimirUrl(tenantId);
    const raw = await queryMimir(expr, tenantId, mimirUrl);
    const result = raw ? chooseWorstSeries(raw, operator, threshold) : null;
    if (operator === 'expr') {
      return { triggered: result !== null, value: result?.value ?? null, labels: result?.labels ?? {}, noData: false, query_executed: expr };
    }
    if (operator === 'absent') {
      return { triggered: result === null, value: result?.value ?? null, labels: result?.labels ?? {}, noData: false, query_executed: expr };
    }
    const value = result?.value ?? null;
    return { triggered: value === null ? false : compareValue(value, operator, threshold), value, labels: result?.labels ?? {}, noData: value === null, query_executed: expr };
  } catch (err) {
    if (err instanceof QueryExecutionError) {
      // A malformed query is neither firing nor plain no-data — flag it so the
      // dry run reports the syntax error instead of a misleading "stay OK".
      return { triggered: false, value: null, labels: {}, noData: true, query_executed: expr, error: err.message };
    }
    throw err;
  }
}

export async function dryRunAlertRule(
  tenantId: string,
  input: CreateAlertRuleInput & { sample_value?: number | null },
): Promise<DryRunResult> {
  const sourceType = input.source_type ?? 'managed_promql';
  const metric = input.condition.metric;
  const operator = input.condition.operator;
  const threshold = input.condition.threshold;
  const windowMinutes = input.condition.window_minutes ?? 5;

  if (sourceType === 'byos_webhook') {
    const sampleValue = input.sample_value ?? 1;
    return {
      source_type: sourceType,
      value: sampleValue,
      triggered: compareValue(sampleValue, operator, threshold),
      labels: {},
      query_executed: null,
      explanation: `Compared sample webhook value ${sampleValue} against ${operator} ${threshold}.`,
    };
  }

  if (sourceType === 'synthetic') {
    const check = input.synthetic_check_id
      ? await SyntheticCheck.findOne({ _id: input.synthetic_check_id, tenant_id: tenantId }).lean()
      : null;
    if (!check) {
      return {
        source_type: sourceType,
        value: null,
        triggered: false,
        labels: {},
        query_executed: null,
        explanation: 'No synthetic check selected or found for dry run.',
      };
    }

    const field = (input.query?.trim() || metric || 'consecutive_failures').trim();
    let value: number | null = null;
    switch (field) {
      case 'consecutive_failures': value = check.consecutive_failures ?? 0; break;
      case 'last_response_time_ms': value = check.last_response_time_ms ?? null; break;
      case 'uptime_1h': value = check.uptime_1h ?? null; break;
      case 'uptime_24h': value = check.uptime_24h ?? null; break;
      case 'uptime_7d': value = check.uptime_7d ?? null; break;
      case 'uptime_30d': value = (check as any).uptime_30d ?? null; break;
      case 'uptime_90d': value = (check as any).uptime_90d ?? null; break;
      case 'status':
        value = check.last_status === 'down' ? 2 : check.last_status === 'degraded' ? 1 : check.last_status === 'up' ? 0 : null;
        break;
      default:
        value = check.consecutive_failures ?? 0;
        break;
    }

    return {
      source_type: sourceType,
      value,
      triggered: value === null ? false : compareValue(value, operator, threshold),
      labels: {
        check_id: (check as any)._id.toString(),
        check_name: check.name,
        check_type: check.type,
        last_status: check.last_status || 'unknown',
      },
      query_executed: field,
      explanation: value === null
        ? `Synthetic check "${check.name}" has no value for ${field} yet.`
        : `Read synthetic field ${field}=${value} from "${check.name}" and compared it to ${operator} ${threshold}.`,
    };
  }

  // Compound (conditions[]), native-expression (`expr`) or absence (`absent`) rules.
  const hasCompound = Array.isArray(input.conditions) && input.conditions.length > 0;
  if ((sourceType === 'managed_promql' || sourceType === 'managed_logql') && (hasCompound || operator === 'expr' || operator === 'absent')) {
    const conds = hasCompound ? input.conditions! : [input.condition];
    const logic = input.condition_logic === 'or' ? 'or' : 'and';
    const evals: CondDryRun[] = [];
    for (const c of conds) {
      evals.push(await evalQueryConditionDryRun(sourceType, c, tenantId));
    }
    const joinWord = logic === 'and' ? ' AND ' : ' OR ';

    // A malformed query in ANY condition is reported as an error, not "stay OK".
    const errored = evals.filter((e) => e.error);
    if (errored.length > 0) {
      const lang = sourceType === 'managed_logql' ? 'LogQL' : 'PromQL';
      const errMsg = errored.map((e) => `${e.query_executed}: ${e.error}`).join('; ');
      return {
        source_type: sourceType,
        value: null,
        triggered: false,
        labels: {},
        query_executed: evals.map((e) => e.query_executed).join(joinWord),
        error: errMsg,
        explanation: `${lang} query error — the rule cannot be evaluated: ${errMsg}`,
      };
    }

    const evaluable = evals.filter((e) => !e.noData);
    const triggered = evaluable.length === 0
      ? false
      : (logic === 'and' ? evals.every((e) => e.triggered) : evals.some((e) => e.triggered));
    const rep = evals.find((e) => e.triggered) ?? evaluable[0] ?? evals[0];
    return {
      source_type: sourceType,
      value: rep?.value ?? null,
      triggered,
      labels: rep?.labels ?? {},
      query_executed: evals.map((e) => e.query_executed).join(joinWord),
      explanation: evaluable.length === 0
        ? 'No data returned for any condition in this dry run.'
        : `Evaluated ${conds.length} condition(s) combined with ${logic.toUpperCase()}: ${evals.map((e) => `${e.query_executed}${e.triggered ? ' ✓' : ' ✗'}`).join(joinWord)}. Rule would ${triggered ? 'FIRE' : 'stay OK'}.`,
    };
  }

  if (sourceType === 'managed_logql') {
    const expr = input.query?.trim() || metric;
    const lokiUrl = await resolveLokiUrl(tenantId);
    try {
      const result = await queryLoki(expr, tenantId, lokiUrl, windowMinutes);
      const value = result?.value ?? null;
      return {
        source_type: sourceType,
        value,
        triggered: value === null ? false : compareValue(value, operator, threshold),
        labels: result?.labels ?? {},
        query_executed: expr,
        explanation: value === null
          ? 'No LogQL result returned for this dry run.'
          : `Executed LogQL and compared ${value} to ${operator} ${threshold}.`,
      };
    } catch (err) {
      if (!(err instanceof QueryExecutionError)) throw err;
      return {
        source_type: sourceType, value: null, triggered: false, labels: {}, query_executed: expr,
        error: err.message,
        explanation: `LogQL query error — the rule cannot be evaluated: ${err.message}`,
      };
    }
  }

  const promql = input.query?.trim() || metric;
  const mimirUrl = await resolveMimirUrl(tenantId);
  try {
    const rawResult = await queryMimir(promql, tenantId, mimirUrl);
    const result = rawResult ? chooseWorstSeries(rawResult, operator, threshold) : null;
    const value = result?.value ?? null;
    return {
      source_type: sourceType,
      value,
      triggered: value === null ? false : compareValue(value, operator, threshold),
      labels: result?.labels ?? {},
      query_executed: promql,
      explanation: value === null
        ? 'No PromQL result returned for this dry run.'
        : `Executed PromQL and compared ${value} to ${operator} ${threshold}.`,
    };
  } catch (err) {
    if (!(err instanceof QueryExecutionError)) throw err;
    return {
      source_type: sourceType, value: null, triggered: false, labels: {}, query_executed: promql,
      error: err.message,
      explanation: `PromQL query error — the rule cannot be evaluated: ${err.message}`,
    };
  }
}

export async function testSavedAlertRule(
  tenantId: string,
  ruleId: string,
): Promise<SavedRuleTestResult> {
  const rule = await AlertRule.findOne({ _id: ruleId, tenant_id: tenantId }).lean() as (IAlertRule & { _id: any }) | null;
  if (!rule) {
    throw AppError.notFound('Alert rule');
  }

  if (rule.source_type === 'byos_webhook') {
    const ingressPath = rule.webhook_secret
      ? `/api/v1/public/alert-rules/webhooks/${rule._id.toString()}/${rule.webhook_secret}`
      : null;
    const connectivityTestPath = ingressPath ? `${ingressPath}/test` : null;
    const samplePayload = {
      status: 'firing',
      value: 1,
      labels: {
        source: 'vendor',
        rule_name: rule.name,
      },
      message: `Sample event for ${rule.name}`,
    };

    return {
      kind: 'webhook',
      message: 'Webhook rules are event-driven. Use the generated ingress URL to send a real test event.',
      source_type: rule.source_type,
      ingress_path: ingressPath ?? undefined,
      connectivity_test_path: connectivityTestPath ?? undefined,
      sample_payload: samplePayload,
      curl_command: ingressPath
        ? `curl -X POST "${ingressPath}" -H "Content-Type: application/json" -d '${JSON.stringify(samplePayload)}'`
        : undefined,
    };
  }

  // SNMP trap rules are evaluated at runtime exactly like managed_promql rules
  // (the snmp-trapper agent forwards trap data into Mimir as ordinary metrics,
  // and alert-rule.worker.ts has no special case for 'snmp_trap' — it falls
  // through to the same PromQL evaluation path). So the dry run below, which
  // already handles managed_promql generically, is correct for snmp_trap too.

  const dryRun = await dryRunAlertRule(tenantId, {
    name: rule.name,
    description: rule.description,
    service_id: rule.service_id ? rule.service_id.toString() : null,
    status: rule.status,
    severity: rule.severity,
    source_type: rule.source_type,
    synthetic_check_id: rule.synthetic_check_id ? rule.synthetic_check_id.toString() : null,
    query: rule.query ?? null,
    condition: {
      metric: rule.condition.metric,
      operator: rule.condition.operator,
      threshold: rule.condition.threshold,
      window_minutes: rule.condition.window_minutes,
      query: rule.condition.query ?? null,
    },
    conditions: (rule.conditions ?? []).map((c) => ({
      metric: c.metric,
      operator: c.operator,
      threshold: c.threshold,
      window_minutes: c.window_minutes,
      query: c.query ?? null,
    })),
    condition_logic: rule.condition_logic,
    for_duration_seconds: rule.for_duration_seconds,
    auto_create_incident: rule.auto_create_incident,
    incident_severity: rule.incident_severity,
    webhook_url: rule.webhook_url,
  });

  return {
    kind: 'evaluation',
    message: dryRun.triggered ? 'The rule would currently fire.' : 'The rule would currently stay OK.',
    source_type: rule.source_type,
    result: dryRun,
  };
}
