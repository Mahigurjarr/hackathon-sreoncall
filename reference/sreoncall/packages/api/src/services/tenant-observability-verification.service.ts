import { Asset } from '../models/asset.model';
import { AlertRule } from '../models/alert-rule.model';
import { ObservabilityConnection } from '../models/observability-connection.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { queryLogs, queryMetricInstant } from './lgtm-query.service';

export interface ProviderVerification {
  provider: string;
  connection_name: string | null;
  connection_status: 'connected' | 'error' | 'pending' | 'missing';
  asset_count: number;
  healthy_asset_count: number;
  metrics_status: 'verified' | 'missing' | 'not_supported' | 'unknown';
  logs_status: 'verified' | 'missing' | 'not_supported' | 'unknown';
  alert_coverage_status: 'covered' | 'partial' | 'missing';
  evidence: {
    metric_series_count: number | null;
    log_entry_count: number | null;
    active_alert_rule_count: number;
    no_data_alert_rule_count: number;
  };
  notes: string[];
  gaps: string[];
}

export interface TenantObservabilityVerificationReport {
  generated_at: string;
  summary: {
    providers_detected: number;
    assets_total: number;
    connections_total: number;
    connected_connections: number;
    active_alert_rules: number;
    alert_rules_no_data: number;
    active_synthetic_checks: number;
  };
  tenant_checks: {
    metrics_available: boolean;
    logs_available: boolean;
    tenant_metric_series_count: number | null;
    tenant_log_entry_count: number | null;
  };
  providers: ProviderVerification[];
  global_gaps: string[];
}

const PROVIDERS_WITH_DRAIN_LOGS = new Set(['heroku', 'supabase', 'vercel']);
const PROVIDERS_WITH_DRAIN_METRICS = new Set(['heroku']);

function providerMetricQuery(provider: string): { promql: string | null; note?: string } {
  if (provider === 'heroku') {
    return { promql: 'count({__name__=~"heroku_.*"})' };
  }
  if (provider === 'self_managed') {
    return { promql: 'count(up)' };
  }
  return {
    promql: 'count({__name__=~".+"})',
    note: 'Using tenant-wide metric presence because provider-specific labels are not normalized yet.',
  };
}

function providerLogsQuery(provider: string): { logql: string | null; note?: string } {
  if (provider === 'heroku' || provider === 'supabase' || provider === 'vercel') {
    return { logql: `{job="${provider}"}` };
  }
  return {
    logql: '{job=~".+"}',
    note: 'Using tenant-wide log presence because provider-specific labels are not normalized yet.',
  };
}

export async function generateTenantObservabilityVerificationReport(
  tenantId: string,
): Promise<TenantObservabilityVerificationReport> {
  const now = new Date();
  const start = Math.floor(now.getTime() / 1000) - (15 * 60);

  const [
    connections,
    assets,
    activeRules,
    activeChecks,
    tenantMetricSeriesCount,
    tenantLogEntries,
  ] = await Promise.all([
    ObservabilityConnection.find({ tenant_id: tenantId }).sort({ created_at: -1 }).lean(),
    Asset.find({ tenant_id: tenantId }).select('provider status').lean(),
    AlertRule.find({ tenant_id: tenantId, status: 'active' })
      .select('name query condition.metric source_type alert_state status')
      .lean(),
    SyntheticCheck.find({ tenant_id: tenantId, status: 'active' }).select('_id').lean(),
    queryMetricInstant(tenantId, 'count({__name__=~".+"})'),
    queryLogs(tenantId, '{job=~".+"}', start, Math.floor(now.getTime() / 1000), 20),
  ]);

  const providerCounts = new Map<string, { total: number; healthy: number }>();
  for (const asset of assets) {
    const provider = asset.provider || 'self_managed';
    const current = providerCounts.get(provider) || { total: 0, healthy: 0 };
    current.total += 1;
    if (asset.status === 'healthy') current.healthy += 1;
    providerCounts.set(provider, current);
  }

  const providerSet = new Set<string>();
  for (const provider of providerCounts.keys()) providerSet.add(provider);
  for (const conn of connections) {
    const provider = (conn.config as any)?.cloud_provider;
    if (provider) providerSet.add(provider);
    if (conn.mode === 'managed' && !provider) providerSet.add('self_managed');
  }

  const providerReports = await Promise.all(
    Array.from(providerSet).sort().map(async (provider): Promise<ProviderVerification> => {
      const connection = connections.find((conn: any) => ((conn.config as any)?.cloud_provider || (conn.mode === 'managed' ? 'self_managed' : null)) === provider) || null;
      const counts = providerCounts.get(provider) || { total: 0, healthy: 0 };
      const metricQuery = providerMetricQuery(provider);
      const logsQuery = providerLogsQuery(provider);
      const [metricSeriesCount, logEntries] = await Promise.all([
        metricQuery.promql ? queryMetricInstant(tenantId, metricQuery.promql) : Promise.resolve(null),
        logsQuery.logql ? queryLogs(tenantId, logsQuery.logql, start, Math.floor(now.getTime() / 1000), 10) : Promise.resolve([]),
      ]);

      const rulesForProvider = activeRules.filter((rule: any) => {
        const haystack = [rule.name, rule.query, rule.condition?.metric, rule.source_type]
          .filter((value): value is string => typeof value === 'string')
          .join(' ')
          .toLowerCase();
        return haystack.includes(provider.toLowerCase()) || (provider === 'self_managed' && rule.source_type === 'managed_promql');
      });

      const noDataRules = rulesForProvider.filter((rule: any) => rule.alert_state === 'no_data').length;
      const notes: string[] = [];
      const gaps: string[] = [];

      if (metricQuery.note) notes.push(metricQuery.note);
      if (logsQuery.note) notes.push(logsQuery.note);
      if (counts.total > 0 && !connection) gaps.push('Assets exist but no matching observability connection is configured.');
      if (connection && connection.status !== 'connected') gaps.push(`Connection is ${connection.status}.`);

      const metricsStatus: ProviderVerification['metrics_status'] =
        PROVIDERS_WITH_DRAIN_METRICS.has(provider) || provider === 'self_managed' || !PROVIDERS_WITH_DRAIN_LOGS.has(provider)
          ? ((metricSeriesCount ?? 0) > 0 ? 'verified' : 'missing')
          : 'not_supported';
      const logsStatus: ProviderVerification['logs_status'] =
        PROVIDERS_WITH_DRAIN_LOGS.has(provider) || provider === 'self_managed' || !PROVIDERS_WITH_DRAIN_METRICS.has(provider)
          ? ((logEntries?.length ?? 0) > 0 ? 'verified' : 'missing')
          : 'not_supported';

      if (metricsStatus === 'missing') gaps.push('No live metrics evidence found for this provider in the last check.');
      if (logsStatus === 'missing') gaps.push('No recent logs found for this provider in the last 15 minutes.');
      if (rulesForProvider.length === 0) gaps.push('No provider-specific active alert rules detected.');
      if (noDataRules > 0) gaps.push(`${noDataRules} active alert rule(s) are in no_data state.`);

      let alertCoverageStatus: ProviderVerification['alert_coverage_status'] = 'missing';
      if (rulesForProvider.length > 0 && noDataRules === 0) alertCoverageStatus = 'covered';
      else if (rulesForProvider.length > 0) alertCoverageStatus = 'partial';

      return {
        provider,
        connection_name: connection?.name ?? null,
        connection_status: connection?.status === 'disabled' ? 'error' : (connection?.status ?? 'missing'),
        asset_count: counts.total,
        healthy_asset_count: counts.healthy,
        metrics_status: metricsStatus,
        logs_status: logsStatus,
        alert_coverage_status: alertCoverageStatus,
        evidence: {
          metric_series_count: metricSeriesCount,
          log_entry_count: logEntries.length,
          active_alert_rule_count: rulesForProvider.length,
          no_data_alert_rule_count: noDataRules,
        },
        notes,
        gaps,
      };
    }),
  );

  const globalGaps: string[] = [];
  if ((tenantMetricSeriesCount ?? 0) <= 0) globalGaps.push('No tenant-wide metrics detected.');
  if (tenantLogEntries.length === 0) globalGaps.push('No tenant-wide logs detected in the last 15 minutes.');
  const noDataRuleCount = activeRules.filter((rule: any) => rule.alert_state === 'no_data').length;
  if (noDataRuleCount > 0) globalGaps.push(`${noDataRuleCount} active alert rule(s) are currently in no_data state.`);
  if (activeRules.length === 0) globalGaps.push('No active alert rules configured for this tenant.');

  return {
    generated_at: now.toISOString(),
    summary: {
      providers_detected: providerReports.length,
      assets_total: providerReports.reduce((sum: number, provider: ProviderVerification) => sum + provider.asset_count, 0),
      connections_total: connections.length,
      connected_connections: connections.filter((conn: any) => conn.status === 'connected').length,
      active_alert_rules: activeRules.length,
      alert_rules_no_data: noDataRuleCount,
      active_synthetic_checks: activeChecks.length,
    },
    tenant_checks: {
      metrics_available: (tenantMetricSeriesCount ?? 0) > 0,
      logs_available: tenantLogEntries.length > 0,
      tenant_metric_series_count: tenantMetricSeriesCount,
      tenant_log_entry_count: tenantLogEntries.length,
    },
    providers: providerReports,
    global_gaps: globalGaps,
  };
}
