import { DATADOG_WIDGET_MAP } from './metric-mappings';
import { translateDatadogQuery, TranslationResult } from './query-translator';
import { logger } from '../../utils/logger';
import { assertUrlSafe } from '../../utils/ssrf-guard';
import type { MigrationCredentials, MigrationResource, ImportedDashboard, ImportedAlert } from './grafana.adapter';

const DATADOG_API = 'https://api.datadoghq.com';

export async function connectDatadog(creds: MigrationCredentials): Promise<{ connected: boolean; dashboards: number; alerts: number }> {
  const endpoint = creds.endpoint || DATADOG_API;
  await assertUrlSafe(endpoint);

  try {
    const resp = await fetch(`${endpoint}/api/v1/dashboard`, {
      headers: {
        'DD-API-KEY': creds.apiKey,
        'DD-APPLICATION-KEY': creds.appKey || '',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { connected: false, dashboards: 0, alerts: 0 };
    const body = await resp.json() as any;
    const dashboards = body.dashboards?.length ?? 0;

    const alertResp = await fetch(`${endpoint}/api/v1/monitor`, {
      headers: {
        'DD-API-KEY': creds.apiKey,
        'DD-APPLICATION-KEY': creds.appKey || '',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const alerts = alertResp.ok ? ((await alertResp.json()) as any[]).length : 0;

    return { connected: true, dashboards, alerts };
  } catch (err: any) {
    logger.warn('Datadog connection failed', { error: err.message });
    return { connected: false, dashboards: 0, alerts: 0 };
  }
}

export async function fetchDatadogDashboards(creds: MigrationCredentials): Promise<MigrationResource[]> {
  const endpoint = creds.endpoint || DATADOG_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/v1/dashboard`, {
    headers: {
      'DD-API-KEY': creds.apiKey,
      'DD-APPLICATION-KEY': creds.appKey || '',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return [];
  const body = await resp.json() as any;

  return (body.dashboards ?? []).map((d: any) => ({
    id: d.id,
    title: d.title || 'Untitled Dashboard',
    type: 'dashboard' as const,
    panelCount: d.widgets?.length ?? 0,
    lastModified: d.modified_at ?? '',
  }));
}

export async function fetchDatadogAlerts(creds: MigrationCredentials): Promise<MigrationResource[]> {
  const endpoint = creds.endpoint || DATADOG_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/v1/monitor`, {
    headers: {
      'DD-API-KEY': creds.apiKey,
      'DD-APPLICATION-KEY': creds.appKey || '',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return [];
  const results = await resp.json() as any[];

  return results.map((m: any) => ({
    id: m.id?.toString() || '',
    title: m.name || 'Untitled Monitor',
    type: 'alert' as const,
    lastModified: m.modified ?? '',
  }));
}

export async function importDatadogDashboard(creds: MigrationCredentials, dashboardId: string): Promise<ImportedDashboard> {
  const endpoint = creds.endpoint || DATADOG_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/v1/dashboard/${dashboardId}`, {
    headers: {
      'DD-API-KEY': creds.apiKey,
      'DD-APPLICATION-KEY': creds.appKey || '',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const dash = await resp.json() as any;
  const warnings: string[] = [];

  const panels = (dash.widgets ?? []).map((w: any, i: number) => {
    const def = w.definition || {};
    const queryStr = def.requests?.[0]?.q || def.requests?.[0]?.queries?.[0]?.query || '';
    const translation: TranslationResult = queryStr
      ? translateDatadogQuery(queryStr)
      : { promql: '', confidence: 'unsupported' as const, warnings: ['No query found in widget'] };

    const widgetType = def.type || 'timeseries';
    const mappedType = DATADOG_WIDGET_MAP[widgetType] || 'line_chart';
    if (!DATADOG_WIDGET_MAP[widgetType]) warnings.push(`Unknown Datadog widget type "${widgetType}" mapped to line_chart`);

    const layout = w.layout || {};
    return {
      id: `imported-${i}`,
      title: def.title || `Panel ${i + 1}`,
      type: mappedType,
      grid: {
        x: layout.x ?? 0,
        y: layout.y ?? (i * 4),
        w: Math.min(Math.round((layout.width ?? 4) * 2), 24),
        h: Math.min(Math.round((layout.height ?? 2) * 2), 24),
      },
      query: translation.promql,
      translation,
    };
  });

  return {
    name: dash.title || 'Imported Dashboard',
    description: dash.description || `Imported from Datadog (${dashboardId})`,
    panels,
    tags: ['imported', 'datadog'],
    warnings,
  };
}

export async function importDatadogAlert(creds: MigrationCredentials, monitorId: string): Promise<ImportedAlert> {
  const endpoint = creds.endpoint || DATADOG_API;
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/v1/monitor/${monitorId}`, {
    headers: {
      'DD-API-KEY': creds.apiKey,
      'DD-APPLICATION-KEY': creds.appKey || '',
    },
    signal: AbortSignal.timeout(10_000),
  });
  const monitor = await resp.json() as any;

  const queryStr = monitor.query || '';
  const translation = translateDatadogQuery(queryStr);

  return {
    name: monitor.name || 'Imported Alert',
    query: translation.promql,
    condition: monitor.type || '',
    translation,
    warnings: translation.warnings,
  };
}
