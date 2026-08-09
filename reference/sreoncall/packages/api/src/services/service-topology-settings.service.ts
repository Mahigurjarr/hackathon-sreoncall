import { Types } from 'mongoose';
import {
  ServiceTopologySettings,
  ServiceTopologySettingsDocument,
  IDiscoveryMethodThreshold,
  ICriticalityMultiplier,
} from '../models/service-topology-settings.model';

export async function getSettings(tenantId: Types.ObjectId): Promise<ServiceTopologySettingsDocument> {
  let settings = await ServiceTopologySettings.findOne({ tenant_id: tenantId });
  if (!settings) {
    settings = await ServiceTopologySettings.create({ tenant_id: tenantId });
  }
  return settings;
}

export async function updateSettings(
  tenantId: Types.ObjectId,
  input: {
    cascade_enabled?: boolean;
    auto_approval?: {
      enabled?: boolean;
      thresholds?: Partial<{
        auto_otel: IDiscoveryMethodThreshold;
        auto_network: IDiscoveryMethodThreshold;
        ai_parsed: IDiscoveryMethodThreshold;
        document_upload: IDiscoveryMethodThreshold;
      }>;
      criticality_multiplier?: Partial<ICriticalityMultiplier>;
    };
  },
): Promise<ServiceTopologySettingsDocument> {
  const settings = await getSettings(tenantId);

  if (input.cascade_enabled !== undefined) settings.cascade_enabled = input.cascade_enabled;

  if (input.auto_approval?.enabled !== undefined) {
    settings.auto_approval.enabled = input.auto_approval.enabled;
  }
  if (input.auto_approval?.thresholds) {
    for (const [method, threshold] of Object.entries(input.auto_approval.thresholds)) {
      if (threshold) {
        (settings.auto_approval.thresholds as any)[method] = threshold;
      }
    }
  }
  if (input.auto_approval?.criticality_multiplier) {
    Object.assign(settings.auto_approval.criticality_multiplier, input.auto_approval.criticality_multiplier);
  }

  await settings.save();
  return settings;
}
