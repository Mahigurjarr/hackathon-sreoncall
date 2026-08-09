import { GlobalConfig, GlobalConfigDocument } from '../../models/global-config.model';
import { AppError } from '../../middleware/errorHandler.middleware';
import { clearConfigCache } from './config-reader.service';

export async function listGlobalConfigs(category?: string): Promise<GlobalConfigDocument[]> {
  const filter: Record<string, any> = {};
  if (category) filter.category = category;
  return GlobalConfig.find(filter).sort({ category: 1, key: 1 });
}

export async function getGlobalConfig(key: string): Promise<GlobalConfigDocument> {
  const config = await GlobalConfig.findOne({ key });
  if (!config) throw AppError.notFound('Global config');
  return config;
}

export async function upsertGlobalConfig(
  key: string,
  value: any,
  description?: string,
  category?: string,
): Promise<GlobalConfigDocument> {
  const existing = await GlobalConfig.findOne({ key });
  if (existing) {
    existing.value = value;
    if (description !== undefined) existing.description = description;
    if (category !== undefined) existing.category = category;
    await existing.save();
    clearConfigCache();
    return existing;
  }

  const doc = await GlobalConfig.create({
    key,
    value,
    description: description || '',
    category: category || 'general',
  });
  clearConfigCache();
  return doc;
}
