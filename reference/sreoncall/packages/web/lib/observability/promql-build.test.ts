import { describe, it, expect } from 'vitest';
import { buildMetricQuery, inferMetricTypeFromName } from './promql-build';

describe('buildMetricQuery', () => {
  it('returns empty string for an empty metric name', () => {
    expect(buildMetricQuery('', {}, { type: 'counter' })).toBe('');
    expect(buildMetricQuery('', { cluster: 'c' }, { type: 'gauge' })).toBe('');
  });

  // --- counter ---

  it('wraps a counter selector in rate(...) with the default 5m window', () => {
    expect(buildMetricQuery('http_requests_total', { cluster: 'eks-prod-eu' }, { type: 'counter' })).toBe(
      'rate(http_requests_total{cluster="eks-prod-eu"}[5m])',
    );
  });

  it('overrides the rate window when opts.window is supplied', () => {
    expect(buildMetricQuery('http_requests_total', {}, { type: 'counter', window: '1m' })).toBe(
      'rate(http_requests_total[1m])',
    );
  });

  it('wraps counter rate() in <agg>(...) when agg is set and by is not', () => {
    expect(buildMetricQuery('http_requests_total', {}, { type: 'counter', agg: 'sum' })).toBe(
      'sum(rate(http_requests_total[5m]))',
    );
  });

  it('wraps counter rate() in <agg> by(<by>)(...) when both agg and by are set', () => {
    expect(
      buildMetricQuery('http_requests_total', { cluster: 'c' }, { type: 'counter', agg: 'avg', by: 'namespace' }),
    ).toBe('avg by(namespace)(rate(http_requests_total{cluster="c"}[5m]))');
  });

  it('does not add by(...) for a counter when agg is "(raw)", even if by is set', () => {
    expect(buildMetricQuery('http_requests_total', {}, { type: 'counter', agg: '(raw)', by: 'namespace' })).toBe(
      'rate(http_requests_total[5m])',
    );
  });

  it('does not add by(...) for a counter when by is "(none)"', () => {
    expect(buildMetricQuery('http_requests_total', {}, { type: 'counter', agg: 'sum', by: '(none)' })).toBe(
      'sum(rate(http_requests_total[5m]))',
    );
  });

  // --- histogram ---

  it('builds histogram_quantile with le as the only inner by() dimension when by is unset', () => {
    expect(buildMetricQuery('http_request_duration_seconds_bucket', {}, { type: 'histogram' })).toBe(
      'histogram_quantile(0.95, sum by(le)(rate(http_request_duration_seconds_bucket[5m])))',
    );
  });

  it('puts le ALWAYS first inside by(), with an extra grouping dimension appended', () => {
    expect(
      buildMetricQuery(
        'http_request_duration_seconds_bucket',
        { cluster: 'c' },
        { type: 'histogram', by: 'namespace' },
      ),
    ).toBe('histogram_quantile(0.95, sum by(le,namespace)(rate(http_request_duration_seconds_bucket{cluster="c"}[5m])))');
  });

  it('respects a window override for a histogram', () => {
    expect(buildMetricQuery('http_request_duration_seconds_bucket', {}, { type: 'histogram', window: '30s' })).toBe(
      'histogram_quantile(0.95, sum by(le)(rate(http_request_duration_seconds_bucket[30s])))',
    );
  });

  it('never re-wraps the finished histogram_quantile(...) in another agg — agg is ignored for histograms', () => {
    expect(
      buildMetricQuery('http_request_duration_seconds_bucket', {}, { type: 'histogram', agg: 'avg', by: 'pod' }),
    ).toBe('histogram_quantile(0.95, sum by(le,pod)(rate(http_request_duration_seconds_bucket[5m])))');
  });

  // --- gauge / summary / unknown: raw selector, optional agg/by ---

  it('returns a raw selector for a gauge with no agg', () => {
    expect(buildMetricQuery('node_memory_usage_bytes', { pod: 'p1' }, { type: 'gauge' })).toBe(
      'node_memory_usage_bytes{pod="p1"}',
    );
  });

  it('wraps a gauge selector in <agg> by(<by>)(...) when both are set', () => {
    expect(buildMetricQuery('node_memory_usage_bytes', {}, { type: 'gauge', agg: 'max', by: 'pod' })).toBe(
      'max by(pod)(node_memory_usage_bytes)',
    );
  });

  it('does not wrap a gauge selector when only by is set (no agg)', () => {
    expect(buildMetricQuery('node_memory_usage_bytes', {}, { type: 'gauge', by: 'pod' })).toBe(
      'node_memory_usage_bytes',
    );
  });

  it('returns a raw selector for a summary with no agg', () => {
    expect(buildMetricQuery('request_latency_summary', {}, { type: 'summary' })).toBe('request_latency_summary');
  });

  it('wraps a summary selector in <agg>(...) when agg is set', () => {
    expect(buildMetricQuery('request_latency_summary', {}, { type: 'summary', agg: 'avg' })).toBe(
      'avg(request_latency_summary)',
    );
  });

  it('returns a raw selector for an unknown type', () => {
    expect(buildMetricQuery('some_weird_metric', {}, { type: 'unknown' })).toBe('some_weird_metric');
  });

  // --- selector shape: clean name vs __name__ form, sorting, escaping ---

  it('uses the __name__="..." form for a metric name containing a colon (recording rule)', () => {
    expect(buildMetricQuery('job:http_requests:rate5m', { cluster: 'c' }, { type: 'gauge' })).toBe(
      '{__name__="job:http_requests:rate5m",cluster="c"}',
    );
  });

  it('uses the __name__="..." form (no extra labels) for a colon name with an empty selection', () => {
    expect(buildMetricQuery('job:http_requests:rate5m', {}, { type: 'gauge' })).toBe(
      '{__name__="job:http_requests:rate5m"}',
    );
  });

  it('sorts selection keys regardless of input order', () => {
    expect(buildMetricQuery('m', { b: '2', a: '1' }, { type: 'gauge' })).toBe('m{a="1",b="2"}');
  });

  it('escapes backslashes and quotes so a value cannot break out of the selector', () => {
    expect(buildMetricQuery('node_memory_usage_bytes', { pod: 'a"} ,x="y' }, { type: 'gauge' })).toBe(
      'node_memory_usage_bytes{pod="a\\"} ,x=\\"y"}',
    );
  });

  it('escapes a literal backslash before escaping quotes', () => {
    expect(buildMetricQuery('node_memory_usage_bytes', { path: 'C:\\temp' }, { type: 'gauge' })).toBe(
      'node_memory_usage_bytes{path="C:\\\\temp"}',
    );
  });
});

describe('inferMetricTypeFromName', () => {
  it('infers histogram from a _bucket suffix', () => {
    expect(inferMetricTypeFromName('http_request_duration_seconds_bucket')).toBe('histogram');
  });

  it('infers counter from a _total suffix', () => {
    expect(inferMetricTypeFromName('http_requests_total')).toBe('counter');
  });

  it('infers counter from a _count suffix', () => {
    expect(inferMetricTypeFromName('http_request_duration_seconds_count')).toBe('counter');
  });

  it('infers counter from a _sum suffix', () => {
    expect(inferMetricTypeFromName('http_request_duration_seconds_sum')).toBe('counter');
  });

  it('falls back to unknown for a name with no recognized suffix', () => {
    expect(inferMetricTypeFromName('node_memory_usage_bytes')).toBe('unknown');
    expect(inferMetricTypeFromName('up')).toBe('unknown');
  });

  it('composes with buildMetricQuery to produce histogram_quantile for a bucket metric with empty metadata', () => {
    const metric = 'http_request_duration_seconds_bucket';
    const query = buildMetricQuery(metric, {}, { type: inferMetricTypeFromName(metric) });
    expect(query).toBe('histogram_quantile(0.95, sum by(le)(rate(http_request_duration_seconds_bucket[5m])))');
  });
});
