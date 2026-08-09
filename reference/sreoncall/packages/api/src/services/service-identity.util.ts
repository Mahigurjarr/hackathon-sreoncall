import { Types } from 'mongoose';
import { Service } from '../models/service.model';

// Only generic "this is a workload" wrapper suffixes with no real
// service-identity meaning are stripped. Deliberately excludes anything with
// real semantic meaning (-api, -worker, -gateway, -cache, -db, etc.) — those
// likely name genuinely different components, not the same one relabeled.
const GENERIC_SUFFIXES = ['-service', '-svc', '-deployment', '-deploy'];

export function normalizeServiceName(name: string): string {
  const lower = name.trim().toLowerCase();
  for (const suffix of GENERIC_SUFFIXES) {
    if (lower.length > suffix.length && lower.endsWith(suffix)) {
      return lower.slice(0, -suffix.length);
    }
  }
  return lower;
}

interface IndexedService {
  _id: Types.ObjectId;
  name: string;
  aliases?: string[];
}

export interface ServiceNameIndex {
  tenantId: string;
  byName: Map<string, IndexedService>;
  byNormalized: Map<string, IndexedService>;
}

export async function buildServiceNameIndex(tenantId: string): Promise<ServiceNameIndex> {
  const services = await Service.find({ tenant_id: tenantId, deleted_at: null })
    .select('_id name aliases')
    .lean();

  const index: ServiceNameIndex = { tenantId, byName: new Map(), byNormalized: new Map() };
  for (const svc of services) {
    indexService(index, svc as unknown as IndexedService);
  }
  return index;
}

function indexService(index: ServiceNameIndex, svc: IndexedService): void {
  index.byName.set(svc.name.toLowerCase(), svc);
  for (const alias of svc.aliases ?? []) {
    index.byName.set(alias.toLowerCase(), svc);
  }
  const normalized = normalizeServiceName(svc.name);
  if (!index.byNormalized.has(normalized)) {
    index.byNormalized.set(normalized, svc);
  }
}

/**
 * Registers a just-created service into the index so later lookups within
 * the same discovery job/batch find it without a repeat query.
 */
export function registerServiceInIndex(index: ServiceNameIndex, svc: IndexedService): void {
  indexService(index, svc);
}

/**
 * Resolves a raw discovered name to an existing service — first by exact
 * name/alias match, then by normalized (generic-suffix-stripped) match. A
 * normalized-only match records the raw name as an alias on the matched
 * service (persisted + reflected in the index) rather than merging blindly,
 * so the next scan hits it as an exact match. Returns null if nothing
 * matches — the caller should create a new Service and call
 * registerServiceInIndex() on the result.
 */
export async function resolveServiceByName(
  index: ServiceNameIndex,
  rawName: string,
): Promise<{ serviceId: Types.ObjectId } | null> {
  const key = rawName.toLowerCase();
  const exact = index.byName.get(key);
  if (exact) return { serviceId: exact._id };

  const normalized = normalizeServiceName(rawName);
  const normMatch = index.byNormalized.get(normalized);
  if (normMatch) {
    if (!(normMatch.aliases ?? []).some((a) => a.toLowerCase() === key)) {
      await Service.updateOne({ _id: normMatch._id }, { $addToSet: { aliases: rawName } });
      normMatch.aliases = [...(normMatch.aliases ?? []), rawName];
    }
    index.byName.set(key, normMatch);
    return { serviceId: normMatch._id };
  }

  return null;
}
