import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { generateToolUseCompletion, generateCompletion } from '../services/ai.service';
import {
  OBSERVABILITY_SYSTEM_PROMPT,
  OBSERVABILITY_GENERATE_PROMPT,
  OBSERVABILITY_GENERATE_LOGQL_PROMPT,
  OBSERVABILITY_TOOLS,
} from '../services/ai-observability-prompt';
import { getEffectiveValue } from '../services/platform/feature-flag.service';
import {
  buildGroundedPrompt,
  getPromptInventory,
  getGroundingContext,
  getLogQLGroundingContext,
} from '../services/ai-observability-grounding';
import {
  resolveOwnOrgId,
  resolveConsumerOrgId,
  resolveLogsEndpoint,
  MANAGED_LOKI_URL,
} from '../services/observability-upstream.service';
import { sanitizeLogScope, buildLogSelector } from '../services/observability-logs-discovery.service';
import { validateLogQL, validatePromQL } from '../services/query-validation.service';
import { sanitizeMetricScope, buildScopeMatcher } from '../services/observability-metrics-discovery.service';
import { logger } from '../utils/logger';

const router = Router();

/* ── Strict JSON schemas for AI query generation (OpenAI structured output; Inc 3) ──
 * Guarantees the model reply is exactly {promql|logql, explanation}. Ignored by non-OpenAI
 * providers, which still return free-form JSON that parseGenerated* handles. */
const PROMQL_GEN_SCHEMA = {
  name: 'promql_generation',
  schema: {
    type: 'object',
    properties: { promql: { type: 'string' }, explanation: { type: 'string' } },
    required: ['promql', 'explanation'],
    additionalProperties: false,
  },
} as const;
const LOGQL_GEN_SCHEMA = {
  name: 'logql_generation',
  schema: {
    type: 'object',
    properties: { logql: { type: 'string' }, explanation: { type: 'string' } },
    required: ['logql', 'explanation'],
    additionalProperties: false,
  },
} as const;

/* ── env vars for managed LGTM ── */
const MANAGED_MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';
const MANAGED_TEMPO_URL = process.env.MANAGED_TEMPO_URL || 'http://10.10.1.21:3200';
const TOOL_TIMEOUT_MS   = 15_000;

/* ── request schema ── */
const querySchema = z.object({
  question: z.string().min(1).max(500),
});

/* ── helpers ── */

function resolveEndpoints(): { metricsUrl: string; logsUrl: string; tempoUrl: string } {
  return {
    metricsUrl: MANAGED_MIMIR_URL,
    logsUrl: MANAGED_LOKI_URL,
    tempoUrl: MANAGED_TEMPO_URL,
  };
}

async function executeToolCall(
  toolName: string,
  toolInput: Record<string, any>,
  orgId: string,
): Promise<{ type: string; query: string; results: any }> {
  const { metricsUrl, logsUrl, tempoUrl } = resolveEndpoints();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    let url: string;
    let queryStr: string;

    if (toolName === 'query_metrics') {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600_000);
      const params = new URLSearchParams({
        query: toolInput.query,
        start: toolInput.start || oneHourAgo.toISOString(),
        end: toolInput.end || now.toISOString(),
        step: toolInput.step || '60s',
      });
      url = `${metricsUrl}/prometheus/api/v1/query_range?${params}`;
      queryStr = toolInput.query;
    } else if (toolName === 'query_logs') {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600_000);
      const params = new URLSearchParams({
        query: toolInput.query,
        start: toolInput.start || oneHourAgo.toISOString(),
        end: toolInput.end || now.toISOString(),
        limit: String(toolInput.limit || 100),
      });
      url = `${logsUrl}/loki/api/v1/query_range?${params}`;
      queryStr = toolInput.query;
    } else if (toolName === 'search_traces') {
      const params = new URLSearchParams({
        'service.name': toolInput.service_name,
      });
      if (toolInput.min_duration) params.set('minDuration', toolInput.min_duration);
      if (toolInput.max_duration) params.set('maxDuration', toolInput.max_duration);
      if (toolInput.limit) params.set('limit', String(toolInput.limit));
      url = `${tempoUrl}/api/search?${params}`;
      queryStr = `service.name=${toolInput.service_name}`;
    } else {
      return { type: toolName, query: '', results: { error: `Unknown tool: ${toolName}` } };
    }

    const resp = await fetch(url, {
      headers: {
        'X-Scope-OrgID': orgId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        type: toolName,
        query: queryStr,
        results: { error: `Upstream ${resp.status}: ${text.slice(0, 500)}` },
      };
    }

    const data = await resp.json();
    return { type: toolName, query: queryStr, results: data };
  } catch (err: any) {
    const message = err.name === 'AbortError' ? 'Query timed out (15s)' : err.message;
    return {
      type: toolName,
      query: toolInput.query || toolInput.service_name || '',
      results: { error: message },
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── POST /query ── */

router.post('/query', rbac('metrics:read'), async (req: Request, res: Response) => {
  const { question } = querySchema.parse(req.body);
  const tenantId = (req as any).tenantId as string;

  logger.info('AI observability query', { tenantId, question: question.slice(0, 100) });

  // Ground the prompt in the customer's live entities, but only when the discovery
  // flag is enabled for this tenant. Flag OFF → static prompt, identical to before.
  let systemPrompt = OBSERVABILITY_SYSTEM_PROMPT;
  try {
    if (await getEffectiveValue('observability_discovery_enabled', tenantId)) {
      const orgId = await resolveOwnOrgId(tenantId);
      const inventory = await getPromptInventory(orgId);
      systemPrompt = buildGroundedPrompt(OBSERVABILITY_SYSTEM_PROMPT, inventory);
    }
  } catch (err: any) {
    logger.warn('AI prompt grounding skipped', { tenantId, error: err?.message });
  }

  // Step 1: Ask the model to generate tool calls
  const toolUseResult = await generateToolUseCompletion({
    system: systemPrompt,
    userMessage: question,
    tools: OBSERVABILITY_TOOLS,
    tenantId,
  });

  // Step 2: Execute each tool call against the backends
  const queries: { type: string; query: string; results: any }[] = [];

  if (toolUseResult.tool_calls.length > 0) {
    const executions = toolUseResult.tool_calls.map((tc) =>
      executeToolCall(tc.tool_name, tc.tool_input, tenantId),
    );
    const results = await Promise.all(executions);
    queries.push(...results);
  }

  // Step 3: Feed results back to the model for a plain-English explanation
  const toolResultsSummary = queries
    .map((q) => `Tool: ${q.type}\nQuery: ${q.query}\nResults:\n${JSON.stringify(q.results, null, 2)}`)
    .join('\n\n---\n\n');

  const explanationPrompt =
    queries.length > 0
      ? `The user asked: "${question}"\n\nHere are the observability query results:\n\n${toolResultsSummary}\n\nProvide a clear, concise explanation of these results with specific numbers. If there were errors, explain what went wrong and suggest alternatives.`
      : `The user asked: "${question}"\n\nNo tool calls were generated. The AI responded with:\n${toolUseResult.text_blocks.join('\n')}\n\nProvide a helpful response based on the above.`;

  const explanation = await generateCompletion({
    system:
      'You are an SRE observability assistant. Summarize query results clearly with specific numbers, percentages, and actionable insights. Be concise.',
    userMessage: explanationPrompt,
    tenantId,
  });

  res.json({
    answer: explanation.text,
    queries: queries.map((q) => ({ type: q.type, query: q.query, results: q.results })),
  });
});

/* ── POST /generate-query ──
 * Natural language → a SINGLE PromQL expression (+ one-line explanation), grounded in the
 * customer's live metric/label/entity names. Generate-only: it does NOT execute the query or
 * narrate results (the frontend renders the chart). Own-tenant or, with consumer_id, a managed
 * consumer in provider mode. */

const generateSchema = z.object({
  question: z.string().min(1).max(500),
  scope: z.record(z.string()).optional(),
  consumer_id: z.string().optional(),
  repair: z
    .object({
      previousQuery: z.string().min(1),
      error: z.string().min(1),
    })
    .optional(),
});

/** Shared "repair" suffix appended to the user message — used both for client-initiated
 * repairs (body.repair, from a query that failed to EXECUTE) and the server's own
 * one-shot advisory syntax-validation repair (a query that failed to PARSE). */
function buildRepairSuffix(label: 'PromQL' | 'LogQL', previousQuery: string, error: string): string {
  return (
    `\n\nYour previous query failed and must be corrected.` +
    `\nprevious ${label}: ${previousQuery}` +
    `\nerror: ${error}` +
    `\nReturn a corrected JSON object.`
  );
}

/** Flat, source-agnostic metric-label scope — any Prometheus label (job, instance, cluster,
 *  namespace, service_name, pod, ...), not just the fixed K8s {cluster,namespace,service,pod} set. */
type GenScope = Record<string, string>;

/** Human-readable scope hint for the prompt — ALL scope keys, sorted for determinism. */
function buildScopeHint(scope: GenScope): string {
  return Object.keys(scope)
    .sort()
    .map((k) => `${k}=${scope[k]}`)
    .join(', ');
}

/** PromQL label selector from a scope, e.g. {instance="i",job="api"} — used as a fallback query.
 *  Reuses the Phase-1a metrics-discovery escaping/sorting helper so escaping logic lives in one place. */
function scopeSelector(scope: GenScope): string {
  return buildScopeMatcher(scope);
}

/** Defensively turn the model's reply into {promql, explanation}. Never throws. */
function parseGenerated(text: string, scope: GenScope): { promql: string; explanation: string } {
  const cleaned = (text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj.promql === 'string' && obj.promql.trim()) {
      const explanation =
        typeof obj.explanation === 'string' && obj.explanation.trim()
          ? obj.explanation.trim()
          : 'Generated query.';
      return { promql: obj.promql.trim(), explanation };
    }
  } catch {
    // not valid JSON — fall through
  }
  // Unstructured reply: use it as the query if non-empty, else fall back to the scope selector.
  const promql = cleaned || scopeSelector(scope) || 'up';
  return { promql, explanation: 'Generated query (model returned unstructured output).' };
}

router.post('/generate-query', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = generateSchema.parse(req.body);
    const tenantId = String(req.tenantId);
    const scope: GenScope = sanitizeMetricScope(body.scope ?? {});

    logger.info('AI generate-query', {
      tenantId,
      consumerId: body.consumer_id,
      repair: !!body.repair,
      question: body.question.slice(0, 100),
    });

    // Resolve the Mimir org for grounding: selected consumer (provider mode) or own tenant.
    let orgId: string;
    if (body.consumer_id) {
      const resolved = await resolveConsumerOrgId(tenantId, body.consumer_id);
      if (!resolved) throw AppError.notFound('Observability consumer');
      orgId = resolved.orgId;
    } else {
      orgId = await resolveOwnOrgId(tenantId);
    }

    // Ground the prompt in live metric/label/entity names — only when the discovery flag is on.
    let systemPrompt = OBSERVABILITY_GENERATE_PROMPT;
    let grounded = false;
    let truncated = false;
    try {
      if (await getEffectiveValue('observability_discovery_enabled', tenantId)) {
        const inv = await getGroundingContext(orgId, scope);
        systemPrompt = buildGroundedPrompt(OBSERVABILITY_GENERATE_PROMPT, inv);
        grounded = !!(
          inv.clusters.length ||
          inv.namespaces.length ||
          inv.services.length ||
          inv.metrics.length ||
          inv.labels.length
        );
        truncated = inv.truncated;
      }
    } catch (err: any) {
      logger.warn('generate-query grounding skipped', { tenantId, error: err?.message });
    }

    // User message: question + scope hint + (optional) repair feedback.
    const scopeHint = buildScopeHint(scope);
    let userMessage = `Question: ${body.question}`;
    if (scopeHint) userMessage += `\nCurrent scope: ${scopeHint}`;
    if (body.repair) {
      userMessage += buildRepairSuffix('PromQL', body.repair.previousQuery, body.repair.error);
    }

    const completion = await generateCompletion({ system: systemPrompt, userMessage, jsonMode: true, tenantId, jsonSchema: PROMQL_GEN_SCHEMA });

    // No OPENAI_API_KEY, tenant not configured, or provider returned an error → fallback.
    // Deterministic selector, not model output — never syntax-validated.
    if (completion.model === 'fallback' || completion.model === 'disabled' || completion.model === 'error') {
      return res.json({
        promql: scopeSelector(scope) || 'up',
        explanation: completion.model === 'disabled'
          ? completion.text
          : completion.model === 'error'
            ? `AI provider error: ${completion.text}`
            : 'AI is unavailable — generated a basic query from your current selection.',
        grounded: false,
        truncated: false,
        valid: true,
        repaired: false,
      });
    }

    let { promql, explanation } = parseGenerated(completion.text, scope);

    // Advisory syntax validation of the real model output. Never blocks: if invalid, spend
    // AT MOST ONE server-side model repair, then return whatever we have with the final
    // valid/repaired state. `repaired: true` tells the caller the shared per-request
    // repair budget is spent (so a later frontend-side repair-once doesn't also fire).
    const initialValidation = validatePromQL(promql);
    let valid = initialValidation.valid;
    let repaired = false;
    if (!valid) {
      repaired = true;
      const repairMessage = userMessage + buildRepairSuffix('PromQL', promql, initialValidation.error || 'syntax error');
      const repairCompletion = await generateCompletion({ system: systemPrompt, userMessage: repairMessage, jsonMode: true, tenantId, jsonSchema: PROMQL_GEN_SCHEMA });
      if (repairCompletion.model !== 'fallback' && repairCompletion.model !== 'disabled' && repairCompletion.model !== 'error') {
        const repairedParsed = parseGenerated(repairCompletion.text, scope);
        promql = repairedParsed.promql;
        explanation = repairedParsed.explanation;
        valid = validatePromQL(promql).valid;
      } else {
        valid = false;
      }
    }

    // Telemetry (Inc 4): the accuracy flywheel. Tenant-scoped; NO raw log/metric content —
    // only the NL question, the generated query, and outcome flags.
    logger.info('ask-bar.generate', {
      tenantId, lang: 'promql', question: body.question.slice(0, 200),
      query: promql.slice(0, 500), grounded, truncated, valid, repaired,
    });

    res.json({ promql, explanation, grounded, truncated, valid, repaired });
  } catch (err) {
    next(err);
  }
});

/* ── POST /generate-logql ──
 * Natural language → a SINGLE LogQL expression (+ one-line explanation), grounded in the
 * customer's live stream-label names. Generate-only: it does NOT execute the query (the
 * frontend renders the log stream). Own-tenant (managed/BYOS via resolveLogsEndpoint) or,
 * with consumer_id, a managed consumer in provider mode. Reuses the same
 * observability_discovery_enabled flag as /generate-query. */

const generateLogqlSchema = z.object({
  question: z.string().min(1).max(500),
  scope: z.record(z.string()).optional(),
  consumer_id: z.string().optional(),
  repair: z.object({ previousQuery: z.string().min(1), error: z.string().min(1) }).optional(),
});

/** Defensively turn the model's reply into {logql, explanation}. Never throws. */
function parseGeneratedLogql(text: string, fallbackSelector: string): { logql: string; explanation: string } {
  const cleaned = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj.logql === 'string' && obj.logql.trim()) {
      const explanation = typeof obj.explanation === 'string' && obj.explanation.trim() ? obj.explanation.trim() : 'Generated query.';
      return { logql: obj.logql.trim(), explanation };
    }
  } catch { /* not JSON */ }
  return { logql: cleaned || fallbackSelector, explanation: 'Generated query (model returned unstructured output).' };
}

router.post('/generate-logql', rbac('metrics:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = generateLogqlSchema.parse(req.body);
    const tenantId = String(req.tenantId);
    const scope = sanitizeLogScope(body.scope ?? {});
    const fallbackSelector = buildLogSelector(scope);

    // Resolve the Loki endpoint for grounding: own (managed/BYOS) or a managed consumer.
    let lokiUrl: string;
    let orgId: string;
    if (body.consumer_id) {
      const resolved = await resolveConsumerOrgId(tenantId, body.consumer_id);
      if (!resolved) throw AppError.notFound('Observability consumer');
      lokiUrl = MANAGED_LOKI_URL;
      orgId = resolved.orgId;
    } else {
      const ep = await resolveLogsEndpoint(tenantId);
      lokiUrl = ep.url;
      orgId = ep.orgId;
    }

    // Ground the prompt in real stream-label names — only when the discovery flag is on
    // (same flag as /generate-query).
    let systemPrompt = OBSERVABILITY_GENERATE_LOGQL_PROMPT;
    let grounded = false;
    let truncated = false;
    try {
      if (await getEffectiveValue('observability_discovery_enabled', tenantId)) {
        const inv = await getLogQLGroundingContext(lokiUrl, orgId, scope);
        systemPrompt = buildGroundedPrompt(OBSERVABILITY_GENERATE_LOGQL_PROMPT, inv);
        grounded = inv.labels.length > 0;
        truncated = inv.truncated;
      }
    } catch (err: any) {
      logger.warn('generate-logql grounding skipped', { tenantId, error: err?.message });
    }

    // User message: question + scope hint + (optional) repair feedback.
    const selectorHint = fallbackSelector ? `\nCurrent scope: ${fallbackSelector}` : '';
    let userMessage = `Question: ${body.question}${selectorHint}`;
    if (body.repair) {
      userMessage += buildRepairSuffix('LogQL', body.repair.previousQuery, body.repair.error);
    }

    const completion = await generateCompletion({ system: systemPrompt, userMessage, jsonMode: true, tenantId, jsonSchema: LOGQL_GEN_SCHEMA });

    // No OPENAI_API_KEY, tenant not configured, or provider returned an error → fallback.
    // Contract: the fallback query is the sanitized scope selector. With an EMPTY scope,
    // buildLogSelector('') is '', so `logql` is ''. LogQL has no safe universal default
    // (unlike PromQL's 'up' — an empty stream selector is invalid), so we intentionally
    // return '' and the frontend must guard it; when there's nothing to fall back to we
    // return a guiding explanation instead of the generic "basic query" text.
    if (completion.model === 'fallback' || completion.model === 'disabled' || completion.model === 'error') {
      const perModel = completion.model === 'disabled'
        ? completion.text
        : completion.model === 'error'
          ? `AI provider error: ${completion.text}`
          : 'AI is unavailable — generated a basic query from your current selection.';
      return res.json({
        logql: fallbackSelector,
        explanation: fallbackSelector
          ? perModel
          : 'Pick a field to filter by, or enable AI, to build a query.',
        grounded: false,
        truncated: false,
        valid: true,
        repaired: false,
      });
    }

    let { logql, explanation } = parseGeneratedLogql(completion.text, fallbackSelector);

    // Advisory syntax validation of the real model output. Never blocks: if invalid, spend
    // AT MOST ONE server-side model repair, then return whatever we have with the final
    // valid/repaired state. `repaired: true` tells the caller the shared per-request
    // repair budget is spent (so a later frontend-side repair-once doesn't also fire).
    const initialValidation = validateLogQL(logql);
    let valid = initialValidation.valid;
    let repaired = false;
    if (!valid) {
      repaired = true;
      const repairMessage = userMessage + buildRepairSuffix('LogQL', logql, initialValidation.error || 'syntax error');
      const repairCompletion = await generateCompletion({ system: systemPrompt, userMessage: repairMessage, jsonMode: true, tenantId, jsonSchema: LOGQL_GEN_SCHEMA });
      if (repairCompletion.model !== 'fallback' && repairCompletion.model !== 'disabled' && repairCompletion.model !== 'error') {
        const repairedParsed = parseGeneratedLogql(repairCompletion.text, fallbackSelector);
        logql = repairedParsed.logql;
        explanation = repairedParsed.explanation;
        valid = validateLogQL(logql).valid;
      } else {
        valid = false;
      }
    }

    // Telemetry (Inc 4): the accuracy flywheel. Tenant-scoped; NO raw log content —
    // only the NL question, the generated query, and outcome flags.
    logger.info('ask-bar.generate', {
      tenantId, lang: 'logql', question: body.question.slice(0, 200),
      query: logql.slice(0, 500), grounded, truncated, valid, repaired,
    });

    res.json({ logql, explanation, grounded, truncated, valid, repaired });
  } catch (err) {
    next(err);
  }
});

/* ── POST /ask-feedback ── (Inc 4)
 * Tiny run-after-edit beacon: the frontend fires this when a user RUNS an AI-originated query,
 * reporting whether they edited the generated query first (`edited`). Feeds the accuracy
 * flywheel (did the model's output need human correction?). Authed + tenant-scoped (this router
 * is mounted behind auth + tenant middleware + observability_enabled). NO raw log/metric content;
 * queries are user-authored expressions, capped. Fire-and-forget: always 204. */
const askFeedbackSchema = z.object({
  lang: z.enum(['promql', 'logql']),
  question: z.string().max(500).optional(),
  generatedQuery: z.string().max(2000).optional(),
  finalQuery: z.string().max(2000).optional(),
  edited: z.boolean(),
  resultCount: z.number().int().nonnegative().optional(),
});

router.post('/ask-feedback', rbac('metrics:read'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = askFeedbackSchema.parse(req.body);
    logger.info('ask-bar.feedback', {
      tenantId: String(req.tenantId),
      lang: body.lang,
      edited: body.edited,
      question: body.question?.slice(0, 200),
      generatedQuery: body.generatedQuery?.slice(0, 500),
      finalQuery: body.finalQuery?.slice(0, 500),
      resultCount: body.resultCount,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
