import * as grafana from './grafana.adapter';
import * as datadog from './datadog.adapter';
import * as newrelic from './newrelic.adapter';
import * as groundcover from './groundcover.adapter';
import type { MigrationCredentials, MigrationResource, ImportedDashboard, ImportedAlert } from './grafana.adapter';

export type Provider = 'grafana' | 'datadog' | 'newrelic' | 'groundcover';
export type { MigrationCredentials, MigrationResource, ImportedDashboard, ImportedAlert };

export async function connect(provider: Provider, creds: MigrationCredentials): Promise<{ connected: boolean; dashboards: number; alerts: number }> {
  switch (provider) {
    case 'grafana': return grafana.connectGrafana(creds);
    case 'groundcover': return groundcover.connectGroundcover(creds);
    case 'datadog': return datadog.connectDatadog(creds);
    case 'newrelic': return newrelic.connectNewRelic(creds);
  }
}

export async function fetchDashboards(provider: Provider, creds: MigrationCredentials): Promise<MigrationResource[]> {
  switch (provider) {
    case 'grafana': return grafana.fetchGrafanaDashboards(creds);
    case 'groundcover': return groundcover.fetchGroundcoverDashboards(creds);
    case 'datadog': return datadog.fetchDatadogDashboards(creds);
    case 'newrelic': return newrelic.fetchNewRelicDashboards(creds);
  }
}

export async function fetchAlerts(provider: Provider, creds: MigrationCredentials): Promise<MigrationResource[]> {
  switch (provider) {
    case 'grafana': return grafana.fetchGrafanaAlerts(creds);
    case 'groundcover': return groundcover.fetchGroundcoverAlerts(creds);
    case 'datadog': return datadog.fetchDatadogAlerts(creds);
    case 'newrelic': return newrelic.fetchNewRelicAlerts(creds);
  }
}

export async function importDashboard(provider: Provider, creds: MigrationCredentials, resourceId: string): Promise<ImportedDashboard> {
  switch (provider) {
    case 'grafana': return grafana.importGrafanaDashboard(creds, resourceId);
    case 'groundcover': return groundcover.importGroundcoverDashboard(creds, resourceId);
    case 'datadog': return datadog.importDatadogDashboard(creds, resourceId);
    case 'newrelic': return newrelic.importNewRelicDashboard(creds, resourceId);
  }
}

export async function importAlert(provider: Provider, creds: MigrationCredentials, resourceId: string): Promise<ImportedAlert> {
  switch (provider) {
    case 'grafana': return grafana.importGrafanaAlert(creds, resourceId);
    case 'groundcover': return groundcover.importGroundcoverAlert(creds, resourceId);
    case 'datadog': return datadog.importDatadogAlert(creds, resourceId);
    case 'newrelic': return newrelic.importNewRelicAlert(creds, resourceId);
  }
}
