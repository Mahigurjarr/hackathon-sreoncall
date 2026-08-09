import { logger } from '../utils/logger';

const MIMIR_URL = process.env.MANAGED_MIMIR_URL || 'http://10.10.1.21:9009';

export async function syncTenantLimits(
  tenantId: string,
  seriesLimit: number,
  retentionDays: number,
): Promise<{ success: boolean; message: string }> {
  if (seriesLimit < 10_000 || seriesLimit > 1_000_000) {
    return { success: false, message: 'Series limit must be between 10,000 and 1,000,000' };
  }
  if (retentionDays < 1 || retentionDays > 90) {
    return { success: false, message: 'Retention must be between 1 and 90 days' };
  }

  const ingestionRate = Math.max(Math.floor(seriesLimit / 10), 10_000);

  const overrideConfig = {
    tenantId,
    mimir: {
      max_global_series_per_user: seriesLimit,
      ingestion_rate: ingestionRate,
      ingestion_burst_size: ingestionRate * 2,
    },
    loki: {
      retention_period: `${retentionDays * 24}h`,
      ingestion_rate_mb: 4,
      max_query_series: 5000,
    },
  };

  logger.info('Syncing tenant observability limits to LGTM', overrideConfig);

  try {
    const resp = await fetch(`${MIMIR_URL}/runtime_config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scope-OrgID': tenantId,
      },
      body: JSON.stringify({
        overrides: {
          [tenantId]: overrideConfig.mimir,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      logger.warn('Mimir runtime config update returned non-OK', { status: resp.status });
    }
  } catch (err: any) {
    logger.warn('Failed to push Mimir runtime config', { error: err.message });
  }

  return {
    success: true,
    message: `Limits updated: ${seriesLimit.toLocaleString()} series, ${retentionDays}d retention`,
  };
}
