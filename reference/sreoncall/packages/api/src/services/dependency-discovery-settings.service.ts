import { Types } from 'mongoose';
import {
  DependencyDiscoverySettings,
  DependencyDiscoverySettingsDocument,
  DiscoveryScheduleInterval,
} from '../models/dependency-discovery-settings.model';

const INTERVAL_MS: Record<DiscoveryScheduleInterval, number> = {
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

export function intervalToMs(interval: DiscoveryScheduleInterval): number {
  return INTERVAL_MS[interval];
}

export async function getSettings(tenantId: Types.ObjectId): Promise<DependencyDiscoverySettingsDocument> {
  let settings = await DependencyDiscoverySettings.findOne({ tenant_id: tenantId });
  if (!settings) {
    settings = await DependencyDiscoverySettings.create({ tenant_id: tenantId });
  }
  return settings;
}

export async function updateSettings(
  tenantId: Types.ObjectId,
  input: {
    otel_trace_scanning_enabled?: boolean;
    schedule_interval?: DiscoveryScheduleInterval;
    observability_connection_id?: string | null;
  },
): Promise<DependencyDiscoverySettingsDocument> {
  const settings = await getSettings(tenantId);

  const wasEnabled = settings.otel_trace_scanning_enabled;
  const previousInterval = settings.schedule_interval;

  if (input.otel_trace_scanning_enabled !== undefined) settings.otel_trace_scanning_enabled = input.otel_trace_scanning_enabled;
  if (input.schedule_interval !== undefined) settings.schedule_interval = input.schedule_interval;
  if (input.observability_connection_id !== undefined) {
    settings.observability_connection_id = input.observability_connection_id
      ? new Types.ObjectId(input.observability_connection_id)
      : null;
  }

  // Recompute next_run_at on fresh-enable, re-enable, or interval change —
  // covers first-enable, disable→re-enable, and interval-change surprises
  // with one rule, instead of firing on the very next scheduler tick.
  const justEnabled = settings.otel_trace_scanning_enabled && !wasEnabled;
  const intervalChanged = settings.otel_trace_scanning_enabled && settings.schedule_interval !== previousInterval;
  if (justEnabled || intervalChanged) {
    settings.next_run_at = new Date(Date.now() + intervalToMs(settings.schedule_interval));
  } else if (!settings.otel_trace_scanning_enabled) {
    settings.next_run_at = null;
  }

  await settings.save();
  return settings;
}

/**
 * Pushes a tenant's next scheduled run back by a full interval, as if the
 * scheduler itself had just fired — called after a manual "Run Now" trigger
 * so the background scheduler doesn't immediately re-fire right behind it.
 * No-ops if the tenant has no settings doc or scanning isn't enabled.
 */
export async function bumpNextRunAfterManualTrigger(tenantId: Types.ObjectId): Promise<void> {
  const settings = await DependencyDiscoverySettings.findOne({ tenant_id: tenantId });
  if (!settings || !settings.otel_trace_scanning_enabled) return;
  settings.next_run_at = new Date(Date.now() + intervalToMs(settings.schedule_interval));
  await settings.save();
}
