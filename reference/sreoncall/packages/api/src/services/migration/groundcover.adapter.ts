import { GROUNDCOVER_WIDGET_MAP, GROUNDCOVER_METRIC_MAP } from './metric-mappings';
import { translateGrafanaQuery, TranslationResult } from './query-translator';
import { logger } from '../../utils/logger';
import { assertUrlSafe } from '../../utils/ssrf-guard';
import type { MigrationCredentials, MigrationResource, ImportedDashboard, ImportedAlert } from './grafana.adapter';

const GROUNDCOVER_API = 'https://api.groundcover.com';

function gcHeaders(creds: MigrationCredentials): Record<string, string> {
  return {
    'Authorization': `Bearer ${creds.apiKey}`,
    'X-Backend-Id': creds.appKey || '',
    'Accept': 'application/json',
  };
}

export async function connectGroundcover(creds: MigrationCredentials): Promise<{ connected: boolean; dashboards: number; alerts: number }> {
  const endpoint = creds.endpoint || GROUNDCOVER_API;
  await assertUrlSafe(endpoint);

  try {
    const resp = await fetch(`${endpoint}/api/dashboards`, {
      headers: gcHeaders(creds),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn('Groundcover dashboard list failed', { status: resp.status, body: body.slice(0, 500) });
      return { connected: false, dashboards: 0, alerts: 0 };
    }
    const dashBody = await resp.json() as any;
    const dashboards = Array.isArray(dashBody) ? dashBody : dashBody.dashboards ?? dashBody.data ?? [];

    const alertResp = await fetch(`${endpoint}/api/monitors/list`, {
      method: 'POST',
      headers: { ...gcHeaders(creds), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
    let alerts = 0;
    if (alertResp.ok) {
      const alertBody = await alertResp.json() as any;
      const alertList = Array.isArray(alertBody) ? alertBody : alertBody.monitors ?? alertBody.data ?? [];
      alerts = alertList.length;
    }

    return { connected: true, dashboards: dashboards.length, alerts };
  } catch (err: any) {
    logger.warn('Groundcover connection failed', { error: err.message, endpoint });
    return { connected: false, dashboards: 0, alerts: 0 };
  }
}

export async function fetchGroundcoverDashboards(creds: MigrationCredentials): Promise<MigrationResource[]> {
  const endpoint = creds.endpoint || GROUNDCOVER_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/dashboards`, {
    headers: gcHeaders(creds),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return [];
  const body = await resp.json() as any;
  const results = Array.isArray(body) ? body : body.dashboards ?? body.data ?? [];

  if (results.length > 0) {
    logger.info('Groundcover dashboard sample', { keys: Object.keys(results[0]) });
  }

  return results.map((d: any) => ({
    id: d.id || d._id || d.uid || d.uuid || d.dashboardId || d.name || '',
    title: d.name || d.title || 'Untitled Dashboard',
    type: 'dashboard' as const,
    panelCount: 0,
    lastModified: d.updatedAt ?? d.updated_at ?? '',
  }));
}

export async function fetchGroundcoverAlerts(creds: MigrationCredentials): Promise<MigrationResource[]> {
  const endpoint = creds.endpoint || GROUNDCOVER_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/monitors/list`, {
    method: 'POST',
    headers: { ...gcHeaders(creds), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return [];
  const body = await resp.json() as any;
  const results = Array.isArray(body) ? body : body.monitors ?? body.data ?? [];

  if (results.length > 0) {
    logger.info('Groundcover monitor sample', { keys: Object.keys(results[0]) });
  }

  return results.map((m: any) => ({
    id: m.id || m._id || m.uid || m.uuid || m.monitorId || m.name || '',
    title: m.title || m.name || 'Untitled Monitor',
    type: 'alert' as const,
    lastModified: m.updatedAt ?? m.updated_at ?? '',
  }));
}

function buildPromQLFromBuilder(q: any): string {
  const rawMetric = q.metric?.name || '';
  if (!rawMetric) return '';
  const metric = GROUNDCOVER_METRIC_MAP[rawMetric] || rawMetric;

  const filters = (q.filters ?? [])
    .map((f: string) => {
      const sep = f.indexOf(':');
      if (sep === -1) return '';
      return `${f.slice(0, sep)}="${f.slice(sep + 1)}"`;
    })
    .filter(Boolean)
    .join(', ');

  const selector = filters ? `${metric}{${filters}}` : metric;
  const aggr = q.aggregationType;
  if (aggr && aggr !== 'No Function' && aggr !== 'none') {
    return `${aggr}(${selector})`;
  }
  return selector;
}

function resolveGroundcoverVars(expr: string, variables: any): string {
  let resolved = expr;

  resolved = resolved.replace(/\$range/g, '5m');

  const varDefaults: Record<string, string> = {};
  if (Array.isArray(variables)) {
    for (const v of variables) {
      const name = v.spec?.variableName;
      const defaults = v.spec?.values?.default;
      if (name && defaults?.[0]) {
        varDefaults[name] = defaults[0];
      }
    }
  } else if (variables && typeof variables === 'object') {
    for (const [key, val] of Object.entries(variables as Record<string, any>)) {
      const name = key.replace(/^\$/, '');
      const values = val?.values ?? val?.default;
      if (Array.isArray(values) && values[0]) {
        varDefaults[name] = values[0];
      }
    }
  }

  for (const [name, defaultVal] of Object.entries(varDefaults)) {
    if (defaultVal === '*') {
      resolved = resolved.replace(new RegExp(`(\\w+)="\\$${name}"`, 'g'), `$1=~".*"`);
    } else {
      resolved = resolved.replace(new RegExp(`\\$${name}`, 'g'), defaultVal);
    }
  }

  resolved = resolved.replace(/(\w+)="\$(\w+)"/g, '$1=~".*"');
  resolved = resolved.replace(/\$\w+/g, '.*');

  for (const [gcMetric, stdMetric] of Object.entries(GROUNDCOVER_METRIC_MAP)) {
    if (resolved.includes(gcMetric)) {
      resolved = resolved.split(gcMetric).join(stdMetric);
    }
  }

  // Merge double selectors: metric{a="1"}{b="2"} → metric{a="1", b="2"}
  resolved = resolved.replace(/\}(\s*)\{/g, ', ');

  // Remove Groundcover-specific labels that don't exist in standard Prometheus
  resolved = resolved.replace(/,?\s*scope=~"\.\*"/g, '');
  resolved = resolved.replace(/,?\s*clusterId=~"\.\*"/g, '');

  // Clean up leading/trailing commas in selectors
  resolved = resolved.replace(/\{\s*,\s*/g, '{');
  resolved = resolved.replace(/\s*,\s*\}/g, '}');

  return resolved;
}

function extractWidgetQuery(w: any, variables?: any): string {
  if (!w.queries?.length) return '';

  const primaryQuery = w.queries.find((q: any) => q.dataType !== 'metrics-formula') ?? w.queries[0];

  let expr = '';
  if (primaryQuery.expr) {
    expr = primaryQuery.expr;
  } else if (primaryQuery.metric?.name) {
    expr = buildPromQLFromBuilder(primaryQuery);
  }

  if (expr && variables) {
    expr = resolveGroundcoverVars(expr, variables);
  }

  return expr;
}

function flattenLayout(layoutItems: any[]): Map<string, { x: number; y: number; w: number; h: number }> {
  const map = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const item of layoutItems) {
    map.set(item.id, {
      x: item.x ?? 0,
      y: item.y ?? 0,
      w: item.w ?? 12,
      h: item.h ?? 4,
    });
    if (item.children) {
      for (const child of item.children) {
        map.set(child.id, {
          x: child.x ?? 0,
          y: (item.y ?? 0) + (child.y ?? 0),
          w: child.w ?? 12,
          h: child.h ?? 4,
        });
      }
    }
  }
  return map;
}

export async function importGroundcoverDashboard(creds: MigrationCredentials, dashboardId: string): Promise<ImportedDashboard> {
  const endpoint = creds.endpoint || GROUNDCOVER_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/dashboards/${dashboardId}`, {
    headers: gcHeaders(creds),
    signal: AbortSignal.timeout(15_000),
  });
  const dash = await resp.json() as any;
  const warnings: string[] = [];

  let preset: any = {};
  try {
    preset = typeof dash.preset === 'string' ? JSON.parse(dash.preset) : (dash.preset ?? {});
  } catch {
    warnings.push('Could not parse dashboard preset JSON');
  }

  const widgets: any[] = preset.widgets ?? [];
  const layoutMap = flattenLayout(preset.layout ?? []);

  const dataWidgets = widgets.filter((w: any) => w.type === 'widget');

  const panels = dataWidgets.map((w: any, i: number) => {
    const query = extractWidgetQuery(w, preset.variables);
    const translation: TranslationResult = query
      ? translateGrafanaQuery(query)
      : { promql: '', confidence: 'unsupported' as const, warnings: ['No query found in widget'] };

    const vizType = w.visualizationConfig?.type ?? w.queries?.[0]?.visualizationConfig?.type ?? '';
    const vizMap: Record<string, string> = {
      'time-series': 'line_chart',
      'stat': 'stat',
      'table': 'table',
      'bar': 'bar_chart',
      'gauge': 'gauge',
      'heatmap': 'heatmap',
    };
    const panelType = vizMap[vizType] || 'line_chart';

    const grid = layoutMap.get(w.id) ?? { x: 0, y: i * 4, w: 12, h: 4 };

    return {
      id: `imported-${i}`,
      title: w.name || `Panel ${i + 1}`,
      type: panelType,
      grid,
      query: translation.promql,
      translation,
    };
  });

  return {
    name: dash.name || dash.title || 'Imported Dashboard',
    description: dash.description || `Imported from Groundcover (${dashboardId})`,
    panels,
    tags: ['imported', 'groundcover'],
    warnings,
  };
}

let monitorCache: { key: string; monitors: any[]; ts: number } | null = null;

async function getMonitorList(creds: MigrationCredentials): Promise<any[]> {
  const cacheKey = `${creds.apiKey}:${creds.appKey || ''}`;
  if (monitorCache && monitorCache.key === cacheKey && Date.now() - monitorCache.ts < 60_000) {
    return monitorCache.monitors;
  }

  const endpoint = creds.endpoint || GROUNDCOVER_API;
  const resp = await fetch(`${endpoint}/api/monitors/list`, {
    method: 'POST',
    headers: { ...gcHeaders(creds), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return [];
  const body = await resp.json() as any;
  const monitors = Array.isArray(body) ? body : body.monitors ?? body.data ?? [];

  monitorCache = { key: cacheKey, monitors, ts: Date.now() };
  return monitors;
}

export async function importGroundcoverAlert(creds: MigrationCredentials, monitorId: string): Promise<ImportedAlert> {
  const endpoint = creds.endpoint || GROUNDCOVER_API;
  await assertUrlSafe(endpoint);

  const monitors = await getMonitorList(creds);
  const monitor = monitors.find((m: any) =>
    (m.id || m._id || m.uid || m.uuid || m.monitorId || m.name || '') === monitorId
  );

  if (!monitor) {
    return {
      name: 'Unknown Monitor',
      query: '',
      condition: '',
      translation: { promql: '', confidence: 'unsupported', warnings: [`Monitor ${monitorId} not found`] },
      warnings: [`Monitor ${monitorId} not found in list`],
    };
  }

  const model = monitor.model ?? {};
  const query = model.query ?? model.expr ?? monitor.query ?? '';
  const translation = translateGrafanaQuery(query);

  const condition = model.condition
    ?? (model.operator && model.threshold != null ? `${model.operator} ${model.threshold}` : '');

  return {
    name: monitor.title || monitor.name || 'Imported Monitor',
    query: translation.promql,
    condition,
    translation,
    warnings: translation.warnings,
  };
}
