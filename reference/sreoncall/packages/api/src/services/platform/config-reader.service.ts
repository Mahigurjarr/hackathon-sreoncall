import { GlobalConfig } from '../../models/global-config.model';
import { logger } from '../../utils/logger';

// In-memory cache with TTL to avoid hitting DB on every request
const cache = new Map<string, { value: any; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Read a global config value by key, with optional fallback.
 * Results are cached in memory for 60s.
 */
export async function getConfigValue<T = any>(key: string, fallback: T): Promise<T> {
  // Check cache first
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  try {
    const doc = await GlobalConfig.findOne({ key }).lean();
    const value = doc ? doc.value : fallback;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value as T;
  } catch (err: any) {
    logger.warn('Failed to read global config, using fallback', { key, error: err.message });
    return fallback;
  }
}

/**
 * Read multiple global config values by category.
 * Returns a key→value map with the given defaults for missing keys.
 */
export async function getConfigsByCategory(
  category: string,
  defaults: Record<string, any>,
): Promise<Record<string, any>> {
  try {
    const docs = await GlobalConfig.find({ category }).lean();
    const result = { ...defaults };
    for (const doc of docs) {
      result[doc.key] = doc.value;
      cache.set(doc.key, { value: doc.value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result;
  } catch (err: any) {
    logger.warn('Failed to read global configs by category, using defaults', { category, error: err.message });
    return defaults;
  }
}

/**
 * Clear the in-memory cache (useful after config updates).
 */
export function clearConfigCache(): void {
  cache.clear();
}
