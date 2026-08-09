import { describe, it, expect, vi, beforeEach } from 'vitest';

const getChildren = vi.fn();
vi.mock('../observability-discovery.service', () => ({
  getChildren: (...a: any[]) => getChildren(...a),
}));
const listMetricNames = vi.fn();
const listMetricLabelNamesForScope = vi.fn();
vi.mock('../observability-metrics-discovery.service', () => ({
  listMetricNames: (...a: any[]) => listMetricNames(...a),
  listMetricLabelNamesForScope: (...a: any[]) => listMetricLabelNamesForScope(...a),
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../observability-logs-discovery.service', () => ({
  listLogLabelNamesGrounding: vi.fn().mockResolvedValue({ values: ['cluster', 'namespace', 'service_name'], total: 3, truncated: false }),
}));

import { buildGroundedPrompt, getPromptInventory, getGroundingContext, getLogQLGroundingContext } from '../ai-observability-grounding';
import { OBSERVABILITY_GENERATE_LOGQL_PROMPT } from '../ai-observability-prompt';

const BASE = 'BASE PROMPT';

describe('buildGroundedPrompt', () => {
  it('appends a live context section with the real names', () => {
    const out = buildGroundedPrompt(BASE, {
      clusters: ['eks-prod-eu'],
      namespaces: ['payments', 'checkout'],
      services: ['checkout-api', 'ledger-api'],
      metrics: [],
      labels: [],
      truncated: false,
    });
    expect(out.startsWith('BASE PROMPT')).toBe(true);
    expect(out).toContain('eks-prod-eu');
    expect(out).toContain('payments');
    expect(out).toContain('checkout-api');
    expect(out).toContain('Available context');
  });

  it('appends metric and label blocks when present', () => {
    const out = buildGroundedPrompt(BASE, {
      clusters: [],
      namespaces: [],
      services: [],
      metrics: ['container_cpu_usage_seconds_total'],
      labels: ['http_response_status_code'],
      truncated: false,
    });
    expect(out).toContain('container_cpu_usage_seconds_total');
    expect(out).toContain('http_response_status_code');
    expect(out).toContain('metrics (__name__)');
    expect(out).toContain('label names');
  });

  it('notes truncation when set', () => {
    const out = buildGroundedPrompt(BASE, { clusters: [], namespaces: [], services: ['a'], metrics: [], labels: [], truncated: true });
    expect(out.toLowerCase()).toContain('truncated');
  });

  it('returns the base unchanged when inventory is empty', () => {
    const out = buildGroundedPrompt(BASE, { clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
    expect(out).toBe(BASE);
  });
});

describe('getPromptInventory', () => {
  beforeEach(() => getChildren.mockReset());

  it('collects clusters, namespaces, services from discovery (capped)', async () => {
    getChildren.mockImplementation(async (_org: string, level: string) => {
      if (level === 'cluster') return { values: ['eks-prod-eu'], total: 1, truncated: false };
      if (level === 'namespace') return { values: ['payments'], total: 1, truncated: false };
      if (level === 'service') return { values: ['checkout-api'], total: 1, truncated: false };
      return { values: [], total: 0, truncated: false };
    });
    const inv = await getPromptInventory('org1');
    expect(inv.clusters).toContain('eks-prod-eu');
    expect(inv.namespaces).toContain('payments');
    expect(inv.services).toContain('checkout-api');
  });

  it('returns empty inventory (no throw) when discovery misbehaves', async () => {
    // Malformed discovery response → the SUT's own access throws inside its try/catch.
    // (We avoid a mock that itself throws, which Vitest 4 attributes to the test.)
    getChildren.mockResolvedValue(undefined);
    const inv = await getPromptInventory('org1');
    expect(inv).toEqual({ clusters: [], namespaces: [], services: [], metrics: [], labels: [], truncated: false });
  });
});

describe('getGroundingContext', () => {
  beforeEach(() => {
    getChildren.mockReset();
    listMetricNames.mockReset();
    listMetricLabelNamesForScope.mockReset();
  });

  it('merges entities with scoped metrics and labels sourced from the flat-scope metrics-discovery service', async () => {
    getChildren.mockImplementation(async (_org: string, level: string) => {
      if (level === 'cluster') return { values: ['eks-prod-eu'], total: 1, truncated: false };
      if (level === 'namespace') return { values: ['payments'], total: 1, truncated: false };
      if (level === 'service') return { values: ['checkout-api'], total: 1, truncated: false };
      return { values: [], total: 0, truncated: false };
    });
    listMetricNames.mockResolvedValue({ values: ['container_cpu_usage_seconds_total'], total: 1, truncated: false });
    listMetricLabelNamesForScope.mockResolvedValue({ values: ['http_response_status_code'], total: 1, truncated: true });

    // A non-K8s label like `job` must flow through untouched — proves the scope is flat/source-agnostic.
    const flatScope = { service_name: 'checkout-api', job: 'checkout-worker' };
    const inv = await getGroundingContext('org1', flatScope);
    expect(inv.services).toContain('checkout-api');
    expect(inv.metrics).toEqual(['container_cpu_usage_seconds_total']);
    expect(inv.labels).toEqual(['http_response_status_code']);
    expect(inv.truncated).toBe(true); // OR of the three sources
    expect(listMetricNames).toHaveBeenCalledWith('org1', flatScope);
    expect(listMetricLabelNamesForScope).toHaveBeenCalledWith('org1', flatScope);
  });
});

describe('getLogQLGroundingContext', () => {
  it('puts stream-label names in labels, metrics empty', async () => {
    const inv = await getLogQLGroundingContext('http://loki', 'org1', { cluster: 'eks' });
    expect(inv.labels).toEqual(['cluster', 'namespace', 'service_name']);
    expect(inv.metrics).toEqual([]);
  });
});

describe('OBSERVABILITY_GENERATE_LOGQL_PROMPT', () => {
  it('LogQL generate prompt includes LogQL patterns and a logql JSON contract', () => {
    expect(OBSERVABILITY_GENERATE_LOGQL_PROMPT).toMatch(/LogQL/);
    expect(OBSERVABILITY_GENERATE_LOGQL_PROMPT).toMatch(/"logql"/);
  });
});
