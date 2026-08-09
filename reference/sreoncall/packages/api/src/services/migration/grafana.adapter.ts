import { GRAFANA_PANEL_MAP } from './metric-mappings';
import { translateGrafanaQuery, TranslationResult } from './query-translator';
import { logger } from '../../utils/logger';
import { assertUrlSafe } from '../../utils/ssrf-guard';

export interface MigrationCredentials {
  apiKey: string;
  endpoint?: string;
  appKey?: string;
}

export interface MigrationResource {
  id: string;
  title: string;
  type: 'dashboard' | 'alert';
  panelCount?: number;
  lastModified?: string;
}

export interface ImportedDashboard {
  name: string;
  description: string;
  panels: Array<{
    id: string;
    title: string;
    type: string;
    grid: { x: number; y: number; w: number; h: number };
    query: string;
    translation: TranslationResult;
  }>;
  tags: string[];
  warnings: string[];
}

export interface ImportedAlert {
  name: string;
  query: string;
  condition: string;
  translation: TranslationResult;
  warnings: string[];
}

export async function connectGrafana(creds: MigrationCredentials): Promise<{ connected: boolean; dashboards: number; alerts: number }> {
  const endpoint = creds.endpoint || 'http://localhost:3000';
  await assertUrlSafe(endpoint);

  try {
    const resp = await fetch(`${endpoint}/api/search?type=dash-db`, {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      logger.warn('Grafana dashboard search failed', { status: resp.status, endpoint, body: body.slice(0, 500) });
      return { connected: false, dashboards: 0, alerts: 0 };
    }
    const dashboards = await resp.json() as any[];

    const alertResp = await fetch(`${endpoint}/api/v1/provisioning/alert-rules`, {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const alerts = alertResp.ok ? (await alertResp.json() as any[]) : [];

    return { connected: true, dashboards: dashboards.length, alerts: alerts.length };
  } catch (err: any) {
    logger.warn('Grafana connection failed', { error: err.message, endpoint });
    return { connected: false, dashboards: 0, alerts: 0 };
  }
}

export async function fetchGrafanaDashboards(creds: MigrationCredentials): Promise<MigrationResource[]> {
  const endpoint = creds.endpoint || 'http://localhost:3000';
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/search?type=dash-db`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return [];
  const results = await resp.json() as any[];

  return results.map((d: any) => ({
    id: d.uid,
    title: d.title,
    type: 'dashboard' as const,
    panelCount: d.panelCount ?? 0,
    lastModified: d.updatedAt ?? d.updated ?? '',
  }));
}

export async function fetchGrafanaAlerts(creds: MigrationCredentials): Promise<MigrationResource[]> {
  const endpoint = creds.endpoint || 'http://localhost:3000';
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/v1/provisioning/alert-rules`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return [];
  const results = await resp.json() as any[];

  return results.map((a: any) => ({
    id: a.uid || a.id?.toString() || '',
    title: a.title || a.name || 'Untitled Alert',
    type: 'alert' as const,
    lastModified: a.updated ?? '',
  }));
}

export async function importGrafanaDashboard(creds: MigrationCredentials, uid: string): Promise<ImportedDashboard> {
  const endpoint = creds.endpoint || 'http://localhost:3000';
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/dashboards/uid/${uid}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await resp.json() as any;
  const dash = body.dashboard;
  const warnings: string[] = [];

  const panels = (dash.panels ?? []).map((p: any, i: number) => {
    const query = p.targets?.[0]?.expr || p.targets?.[0]?.query || '';
    const translation = translateGrafanaQuery(query);
    const mappedType = GRAFANA_PANEL_MAP[p.type] || 'line_chart';
    if (!GRAFANA_PANEL_MAP[p.type]) warnings.push(`Unknown panel type "${p.type}" mapped to line_chart`);

    return {
      id: `imported-${i}`,
      title: p.title || `Panel ${i + 1}`,
      type: mappedType,
      grid: {
        x: p.gridPos?.x ?? 0,
        y: p.gridPos?.y ?? (i * 4),
        w: p.gridPos?.w ?? 12,
        h: p.gridPos?.h ?? 4,
      },
      query: translation.promql,
      translation,
    };
  });

  return {
    name: dash.title || 'Imported Dashboard',
    description: dash.description || `Imported from Grafana (${uid})`,
    panels,
    tags: [...(dash.tags || []), 'imported', 'grafana'],
    warnings,
  };
}

export async function importGrafanaAlert(creds: MigrationCredentials, uid: string): Promise<ImportedAlert> {
  const endpoint = creds.endpoint || 'http://localhost:3000';
  await assertUrlSafe(endpoint);

  const resp = await fetch(`${endpoint}/api/v1/provisioning/alert-rules/${uid}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  const rule = await resp.json() as any;
  const warnings: string[] = [];

  const query = rule.data?.[0]?.model?.expr || '';
  const translation = translateGrafanaQuery(query);
  const condition = rule.condition || '';

  return {
    name: rule.title || rule.name || 'Imported Alert',
    query: translation.promql,
    condition,
    translation,
    warnings,
  };
}
