export interface GoldenSignalDef {
  key: string;
  title: string;
  unit: 'percent' | 'ms' | 'rps' | 'bytes';
  query: string;
}

// `selector` is a PromQL label selector, e.g. {namespace="n",service_name="s"} (may be '' for all).
// We inject it into each metric's brace block. For an empty selector we still produce valid queries.
function inject(metric: string, selector: string, extra?: string): string {
  const inner = [selector.replace(/^\{|\}$/g, ''), extra].filter(Boolean).join(',');
  return inner ? `${metric}{${inner}}` : metric;
}

export function goldenSignalQueries(selector: string, win = '5m'): GoldenSignalDef[] {
  const reqCount = (extra?: string) => inject('http_server_request_duration_seconds_count', selector, extra);
  const reqBucket = inject('http_server_request_duration_seconds_bucket', selector);
  return [
    {
      key: 'request_rate',
      title: 'Request rate',
      unit: 'rps',
      query: `sum(rate(${reqCount()}[${win}]))`,
    },
    {
      key: 'error_rate',
      title: 'Error rate',
      unit: 'percent',
      query: `sum(rate(${reqCount('http_response_status_code=~"5.."')}[${win}])) / sum(rate(${reqCount()}[${win}])) * 100`,
    },
    {
      key: 'p99_latency',
      title: 'p99 latency',
      unit: 'ms',
      query: `histogram_quantile(0.99, sum(rate(${reqBucket}[${win}])) by (le)) * 1000`,
    },
    {
      key: 'p95_latency',
      title: 'p95 latency',
      unit: 'ms',
      query: `histogram_quantile(0.95, sum(rate(${reqBucket}[${win}])) by (le)) * 1000`,
    },
    {
      key: 'cpu',
      title: 'CPU',
      unit: 'rps',
      query: `sum(rate(${inject('container_cpu_usage_seconds_total', selector)}[${win}]))`,
    },
    {
      key: 'memory',
      title: 'Memory',
      unit: 'bytes',
      query: `sum(${inject('container_memory_working_set_bytes', selector)})`,
    },
  ];
}
