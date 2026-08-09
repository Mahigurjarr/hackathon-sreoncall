import { translateNRQLQuery, TranslationResult } from './query-translator';
import { logger } from '../../utils/logger';
import { assertUrlSafe } from '../../utils/ssrf-guard';
import type { MigrationCredentials, MigrationResource, ImportedDashboard, ImportedAlert } from './grafana.adapter';

const NEWRELIC_GRAPHQL = 'https://api.newrelic.com/graphql';

async function nerdGraphQuery(creds: MigrationCredentials, query: string, variables?: Record<string, any>): Promise<any> {
  const endpoint = creds.endpoint || NEWRELIC_GRAPHQL;
  await assertUrlSafe(endpoint);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': creds.apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`NerdGraph request failed: ${resp.status}`);
  }

  const body = await resp.json() as any;
  if (body.errors?.length) {
    throw new Error(`NerdGraph errors: ${body.errors.map((e: any) => e.message).join(', ')}`);
  }

  return body.data;
}

export async function connectNewRelic(creds: MigrationCredentials): Promise<{ connected: boolean; dashboards: number; alerts: number }> {
  try {
    const data = await nerdGraphQuery(creds, `{
      actor {
        entitySearch(query: "type = 'DASHBOARD'") {
          count
        }
      }
    }`);
    const dashboardCount = data?.actor?.entitySearch?.count ?? 0;

    const alertData = await nerdGraphQuery(creds, `{
      actor {
        entitySearch(query: "type = 'MONITOR'") {
          count
        }
      }
    }`);
    const alertCount = alertData?.actor?.entitySearch?.count ?? 0;

    return { connected: true, dashboards: dashboardCount, alerts: alertCount };
  } catch (err: any) {
    logger.warn('New Relic connection failed', { error: err.message });
    return { connected: false, dashboards: 0, alerts: 0 };
  }
}

export async function fetchNewRelicDashboards(creds: MigrationCredentials): Promise<MigrationResource[]> {
  try {
    const data = await nerdGraphQuery(creds, `{
      actor {
        entitySearch(query: "type = 'DASHBOARD'") {
          results {
            entities {
              guid
              name
              ... on DashboardEntityOutline {
                dashboardParentGuid
                updatedAt
              }
            }
          }
        }
      }
    }`);

    const entities = data?.actor?.entitySearch?.results?.entities ?? [];
    return entities.map((e: any) => ({
      id: e.guid,
      title: e.name || 'Untitled Dashboard',
      type: 'dashboard' as const,
      lastModified: e.updatedAt ?? '',
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch New Relic dashboards', { error: err.message });
    return [];
  }
}

export async function fetchNewRelicAlerts(creds: MigrationCredentials): Promise<MigrationResource[]> {
  try {
    const data = await nerdGraphQuery(creds, `{
      actor {
        entitySearch(query: "type = 'MONITOR'") {
          results {
            entities {
              guid
              name
            }
          }
        }
      }
    }`);

    const entities = data?.actor?.entitySearch?.results?.entities ?? [];
    return entities.map((e: any) => ({
      id: e.guid,
      title: e.name || 'Untitled Alert',
      type: 'alert' as const,
    }));
  } catch (err: any) {
    logger.warn('Failed to fetch New Relic alerts', { error: err.message });
    return [];
  }
}

export async function importNewRelicDashboard(creds: MigrationCredentials, guid: string): Promise<ImportedDashboard> {
  const data = await nerdGraphQuery(creds, `{
    actor {
      entity(guid: "${guid}") {
        name
        ... on DashboardEntity {
          description
          pages {
            name
            widgets {
              title
              visualization { id }
              rawConfiguration
            }
          }
        }
      }
    }
  }`);

  const entity = data?.actor?.entity;
  const warnings: string[] = [];
  const allWidgets: ImportedDashboard['panels'] = [];

  const pages = entity?.pages ?? [];
  let panelIdx = 0;

  for (const page of pages) {
    for (const widget of page.widgets ?? []) {
      const rawConfig = widget.rawConfiguration || {};
      const nrqlQueries = rawConfig.nrqlQueries || [];
      const nrql = nrqlQueries[0]?.query || '';

      const translation: TranslationResult = nrql
        ? translateNRQLQuery(nrql)
        : { promql: '', confidence: 'unsupported' as const, warnings: ['No NRQL query found'] };

      const vizId = widget.visualization?.id || 'viz.line';
      const vizType = vizId.replace('viz.', '');
      const typeMap: Record<string, string> = {
        'line': 'line_chart',
        'area': 'line_chart',
        'bar': 'bar_chart',
        'billboard': 'stat',
        'table': 'table',
        'heatmap': 'heatmap',
        'pie': 'bar_chart',
      };
      const mappedType = typeMap[vizType] || 'line_chart';

      allWidgets.push({
        id: `imported-${panelIdx}`,
        title: widget.title || `Panel ${panelIdx + 1}`,
        type: mappedType,
        grid: {
          x: (panelIdx % 2) * 12,
          y: Math.floor(panelIdx / 2) * 4,
          w: 12,
          h: 4,
        },
        query: translation.promql,
        translation,
      });
      panelIdx++;
    }
  }

  return {
    name: entity?.name || 'Imported Dashboard',
    description: entity?.description || `Imported from New Relic (${guid})`,
    panels: allWidgets,
    tags: ['imported', 'newrelic'],
    warnings,
  };
}

export async function importNewRelicAlert(creds: MigrationCredentials, guid: string): Promise<ImportedAlert> {
  const data = await nerdGraphQuery(creds, `{
    actor {
      entity(guid: "${guid}") {
        name
        ... on NrqlAlertConditionEntity {
          nrqlCondition {
            nrql { query }
            terms { operator threshold thresholdDuration }
          }
        }
      }
    }
  }`);

  const entity = data?.actor?.entity;
  const nrql = entity?.nrqlCondition?.nrql?.query || '';
  const translation = nrql
    ? translateNRQLQuery(nrql)
    : { promql: '' as string, confidence: 'unsupported' as const, warnings: ['No NRQL query found'] };

  const terms = entity?.nrqlCondition?.terms?.[0];
  const condition = terms
    ? `${terms.operator || '>'} ${terms.threshold ?? 0} for ${terms.thresholdDuration ?? 300}s`
    : '';

  return {
    name: entity?.name || 'Imported Alert',
    query: translation.promql,
    condition,
    translation,
    warnings: translation.warnings,
  };
}
