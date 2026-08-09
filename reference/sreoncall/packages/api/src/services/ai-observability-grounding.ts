import { getChildren } from './observability-discovery.service';
import { listMetricNames, listMetricLabelNamesForScope } from './observability-metrics-discovery.service';
import { listLogLabelNamesGrounding } from './observability-logs-discovery.service';
import { logger } from '../utils/logger';

export interface PromptInventory {
  clusters: string[];
  namespaces: string[];
  services: string[];
  /** Metric names (__name__) available for the current scope. */
  metrics: string[];
  /** Label names present for the current scope. */
  labels: string[];
  truncated: boolean;
}

/**
 * Append a live "Available entities" section to the static observability prompt so the
 * model uses the customer's real cluster/namespace/service names. Returns `base` unchanged
 * when the inventory is empty (nothing useful to ground on).
 */
export function buildGroundedPrompt(base: string, inv: PromptInventory): string {
  const hasAny =
    inv.clusters.length ||
    inv.namespaces.length ||
    inv.services.length ||
    inv.metrics?.length ||
    inv.labels?.length;
  if (!hasAny) return base;

  const lines: string[] = ['', '## Available context (live, this customer)'];
  lines.push(
    'Prefer these REAL names when building queries. Do not invent metric names, label names, or label values that are not listed.',
  );
  if (inv.clusters.length) lines.push(`- clusters: ${inv.clusters.join(', ')}`);
  if (inv.namespaces.length) lines.push(`- namespaces: ${inv.namespaces.join(', ')}`);
  if (inv.services.length) lines.push(`- services (service_name): ${inv.services.join(', ')}`);
  if (inv.metrics?.length) lines.push(`- metrics (__name__): ${inv.metrics.join(', ')}`);
  if (inv.labels?.length) lines.push(`- label names: ${inv.labels.join(', ')}`);
  if (inv.truncated) {
    lines.push(
      'Note: these lists are truncated; more exist. Use a regex matcher if you need a broader match.',
    );
  }
  return `${base}\n${lines.join('\n')}\n`;
}

const MAX_CLUSTERS = 20;
const MAX_NAMESPACES = 40;
const MAX_SERVICES = 80;

/** Fetch a compact, capped inventory for prompt grounding. Never throws. */
export async function getPromptInventory(orgId: string): Promise<PromptInventory> {
  try {
    const clustersRes = await getChildren(orgId, 'cluster', {});
    const clusters = clustersRes.values.slice(0, MAX_CLUSTERS);

    const namespaces = new Set<string>();
    const services = new Set<string>();
    let truncated = clustersRes.truncated;

    for (const cluster of clusters) {
      if (namespaces.size >= MAX_NAMESPACES) {
        truncated = true;
        break;
      }
      const nsRes = await getChildren(orgId, 'namespace', { cluster });
      truncated = truncated || nsRes.truncated;
      for (const ns of nsRes.values) {
        if (namespaces.size >= MAX_NAMESPACES) {
          truncated = true;
          break;
        }
        namespaces.add(ns);
        if (services.size < MAX_SERVICES) {
          const svcRes = await getChildren(orgId, 'service', { cluster, namespace: ns });
          truncated = truncated || svcRes.truncated;
          for (const s of svcRes.values) {
            if (services.size >= MAX_SERVICES) {
              truncated = true;
              break;
            }
            services.add(s);
          }
        }
      }
    }

    return {
      clusters,
      namespaces: Array.from(namespaces),
      services: Array.from(services),
      metrics: [],
      labels: [],
      truncated,
    };
  } catch (err: any) {
    logger.warn('getPromptInventory failed; falling back to static prompt', { orgId, error: err?.message });
    return { clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false };
  }
}

/**
 * Full grounding inventory for AI query generation: whole-tenant entity names PLUS the
 * metric names and label vocabulary available for the CURRENT scope. The entity list helps
 * the model when a question names a different entity than the current selection; the scoped
 * metric/label lists keep generated metric and label names real. `scope` is a flat, source-agnostic
 * label selection (e.g. `{job, instance, service_name, ...}` — not just K8s cluster/namespace/service),
 * so metric + label names are sourced from the flat-scope-aware metrics-discovery service rather than
 * the K8s-only `observability-discovery.service`. Never throws — a partial failure yields partial
 * context (generation still proceeds, just less grounded).
 */
export async function getGroundingContext(
  orgId: string,
  scope: Record<string, string> = {},
): Promise<PromptInventory> {
  const [entities, metrics, labels] = await Promise.all([
    getPromptInventory(orgId),
    listMetricNames(orgId, scope),
    listMetricLabelNamesForScope(orgId, scope),
  ]);
  return {
    ...entities,
    metrics: metrics.values,
    labels: labels.values,
    truncated: entities.truncated || metrics.truncated || labels.truncated,
  };
}

/** Grounding inventory for LogQL generation: the Loki instance's real stream-label names.
 *  `_scope` is currently unused (label names are effectively global; kept for call-signature
 *  symmetry with the metrics `getGroundingContext`). Never throws (best-effort) — generation
 *  proceeds even if discovery is unavailable. */
export async function getLogQLGroundingContext(
  lokiUrl: string,
  orgId: string,
  _scope: Record<string, string> = {},
): Promise<PromptInventory> {
  const labels = await listLogLabelNamesGrounding(lokiUrl, orgId);
  return { clusters: [], namespaces: [], services: [], metrics: [], labels: labels.values, truncated: labels.truncated };
}
