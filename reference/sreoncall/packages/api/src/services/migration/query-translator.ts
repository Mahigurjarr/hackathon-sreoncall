import { DATADOG_METRIC_MAP, NEWRELIC_METRIC_MAP } from './metric-mappings';

export interface TranslationResult {
  promql: string;
  confidence: 'exact' | 'approximate' | 'unsupported';
  warnings: string[];
}

export function translateGrafanaQuery(query: string): TranslationResult {
  // Grafana already uses PromQL -- pass through
  return { promql: query, confidence: 'exact', warnings: [] };
}

export function translateDatadogQuery(query: string): TranslationResult {
  const warnings: string[] = [];
  let promql = query;
  let confidence: TranslationResult['confidence'] = 'approximate';

  // Parse Datadog query format: avg:metric.name{tag:value}.as_rate()
  const match = query.match(/^(\w+):([a-zA-Z0-9_.]+)\{([^}]*)\}(?:\.(\w+)\(\))?/);
  if (!match) {
    return {
      promql: `/* Unsupported Datadog query: ${query} */`,
      confidence: 'unsupported',
      warnings: ['Could not parse Datadog query syntax'],
    };
  }

  const [, aggr, metric, filters, modifier] = match;

  // Map metric name
  const mappedMetric = DATADOG_METRIC_MAP[metric];
  if (!mappedMetric) {
    warnings.push(`Unknown Datadog metric: ${metric}. Using original name.`);
    promql = metric;
  } else {
    promql = mappedMetric;
  }

  // Map aggregation
  const aggrMap: Record<string, string> = { avg: 'avg', sum: 'sum', max: 'max', min: 'min', count: 'count' };
  const promAggr = aggrMap[aggr] || 'avg';

  // Map filters (tag:value -> {label="value"})
  let labelFilters = '';
  if (filters && filters !== '*') {
    const labels = filters.split(',').map(f => {
      const [key, val] = f.trim().split(':');
      return `${key.replace(/\./g, '_')}="${val}"`;
    }).join(', ');
    labelFilters = `{${labels}}`;
  }

  // Apply rate if modifier
  if (modifier === 'as_rate' || modifier === 'as_count') {
    promql = `${promAggr}(rate(${mappedMetric || metric}${labelFilters}[5m]))`;
  } else {
    promql = `${promAggr}(${mappedMetric || metric}${labelFilters})`;
  }

  return { promql, confidence, warnings };
}

export function translateNRQLQuery(nrql: string): TranslationResult {
  const warnings: string[] = [];
  const confidence: TranslationResult['confidence'] = 'approximate';

  // Basic NRQL parsing: SELECT func(field) FROM EventType WHERE condition
  const selectMatch = nrql.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+SINCE\s+|$)/i);
  if (!selectMatch) {
    return {
      promql: `/* Unsupported NRQL: ${nrql} */`,
      confidence: 'unsupported',
      warnings: ['Could not parse NRQL syntax'],
    };
  }

  const [, selectExpr, fromTable, whereClause] = selectMatch;
  const mappedMetric = NEWRELIC_METRIC_MAP[fromTable] || fromTable.toLowerCase();

  // Parse labels from WHERE clause
  let labels = '';
  if (whereClause) {
    const conditions = whereClause.split(/\s+AND\s+/i);
    const labelParts = conditions.map(c => {
      const m = c.trim().match(/(\w+)\s*=\s*'([^']+)'/);
      if (m) return `${m[1].replace(/Name$/, '_name')}="${m[2]}"`;
      return null;
    }).filter(Boolean);
    if (labelParts.length) labels = `{${labelParts.join(', ')}}`;
  }

  // Parse SELECT function
  if (/count\s*\(\s*\*\s*\)/i.test(selectExpr)) {
    return { promql: `sum(rate(${mappedMetric}_count${labels}[5m]))`, confidence, warnings };
  }
  if (/average\s*\(\s*duration\s*\)/i.test(selectExpr)) {
    return {
      promql: `avg(rate(${mappedMetric}_sum${labels}[5m])) / avg(rate(${mappedMetric}_count${labels}[5m]))`,
      confidence,
      warnings,
    };
  }
  const pctMatch = selectExpr.match(/percentile\s*\(\s*duration\s*,\s*(\d+)\s*\)/i);
  if (pctMatch) {
    const pct = parseInt(pctMatch[1]) / 100;
    return {
      promql: `histogram_quantile(${pct}, sum(rate(${mappedMetric}_bucket${labels}[5m])) by (le))`,
      confidence,
      warnings,
    };
  }
  if (/rate\s*\(\s*count\s*\(\s*\*\s*\)/i.test(selectExpr)) {
    const intervalMatch = selectExpr.match(/(\d+)\s*minute/i);
    const interval = intervalMatch ? `${intervalMatch[1]}m` : '5m';
    return { promql: `sum(rate(${mappedMetric}_count${labels}[${interval}]))`, confidence, warnings };
  }

  warnings.push(`Approximate translation for: ${selectExpr}`);
  return { promql: `${mappedMetric}${labels}`, confidence: 'approximate', warnings };
}
