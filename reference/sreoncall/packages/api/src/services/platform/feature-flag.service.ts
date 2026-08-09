import { Types } from 'mongoose';
import { FeatureFlag, FeatureFlagDocument } from '../../models/feature-flag.model';
import { AppError } from '../../middleware/errorHandler.middleware';

export async function listFeatureFlags(): Promise<FeatureFlagDocument[]> {
  return FeatureFlag.find().sort({ key: 1 });
}

export async function getFeatureFlagById(id: string): Promise<FeatureFlagDocument> {
  const flag = await FeatureFlag.findById(id);
  if (!flag) throw AppError.notFound('Feature flag');
  return flag;
}

export async function createFeatureFlag(input: {
  key: string;
  description?: string;
  default_value?: boolean;
  tenant_overrides?: Array<{ tenant_id: string; value: boolean }>;
}): Promise<FeatureFlagDocument> {
  return FeatureFlag.create({
    key: input.key,
    description: input.description || '',
    default_value: input.default_value ?? false,
    tenant_overrides: (input.tenant_overrides || []).map((o) => ({
      tenant_id: new Types.ObjectId(o.tenant_id),
      value: o.value,
    })),
  });
}

export async function updateFeatureFlag(
  id: string,
  update: Partial<{
    description: string;
    default_value: boolean;
    tenant_overrides: Array<{ tenant_id: string; value: boolean }>;
  }>,
): Promise<FeatureFlagDocument> {
  const flag = await FeatureFlag.findById(id);
  if (!flag) throw AppError.notFound('Feature flag');

  if (update.description !== undefined) flag.description = update.description;
  if (update.default_value !== undefined) flag.default_value = update.default_value;
  if (update.tenant_overrides !== undefined) {
    flag.tenant_overrides = update.tenant_overrides.map((o) => ({
      tenant_id: new Types.ObjectId(o.tenant_id),
      value: o.value,
    })) as any;
  }

  await flag.save();
  return flag;
}

export async function deleteFeatureFlag(id: string): Promise<void> {
  const result = await FeatureFlag.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw AppError.notFound('Feature flag');
}

export async function getEffectiveValue(key: string, tenantId: Types.ObjectId | string): Promise<boolean> {
  const flag = await FeatureFlag.findOne({ key });
  if (!flag) return false;

  const override = flag.tenant_overrides.find(
    (o) => o.tenant_id.toString() === tenantId.toString(),
  );
  return override ? override.value : flag.default_value;
}

/** Effective boolean value of every known flag for one tenant. */
export async function getAllEffectiveValues(
  tenantId: Types.ObjectId | string,
): Promise<Record<string, boolean>> {
  const flags = await FeatureFlag.find().lean();
  const out: Record<string, boolean> = {};
  for (const f of flags as any[]) {
    const override = (f.tenant_overrides || []).find(
      (o: any) => o.tenant_id.toString() === tenantId.toString(),
    );
    out[f.key] = override ? override.value : f.default_value;
  }
  return out;
}
