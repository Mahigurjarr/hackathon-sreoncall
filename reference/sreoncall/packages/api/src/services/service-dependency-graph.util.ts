import { ServiceDependency } from '../models/service-dependency.model';

export type ApprovedAdjacency = Map<string, string[]>;

/** Fetches the current approved-edge adjacency list (source -> [targets]) for a tenant. */
export async function buildApprovedAdjacency(tenantId: string): Promise<ApprovedAdjacency> {
  const edges = await ServiceDependency.find(
    { tenant_id: tenantId, status: 'approved' },
    { source_service_id: 1, target_service_id: 1 },
  ).lean();

  const adjacency: ApprovedAdjacency = new Map();
  for (const edge of edges) {
    const source = edge.source_service_id.toString();
    const target = edge.target_service_id.toString();
    if (!adjacency.has(source)) adjacency.set(source, []);
    adjacency.get(source)!.push(target);
  }
  return adjacency;
}

/** BFS forward from `fromId` over the given adjacency, looking for `toId`. */
export function hasPath(adjacency: ApprovedAdjacency, fromId: string, toId: string): boolean {
  if (fromId === toId) return true;

  const visited = new Set<string>([fromId]);
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}

/** Records a newly-approved edge into an in-memory adjacency map (for multi-edge batches). */
export function addEdge(adjacency: ApprovedAdjacency, sourceServiceId: string, targetServiceId: string): void {
  if (!adjacency.has(sourceServiceId)) adjacency.set(sourceServiceId, []);
  adjacency.get(sourceServiceId)!.push(targetServiceId);
}

/**
 * Returns true if approving an edge source -> target would create a cycle,
 * i.e. a path already exists from `targetServiceId` back to `sourceServiceId`
 * among currently-approved edges for this tenant.
 */
export async function wouldCreateCycle(
  tenantId: string,
  sourceServiceId: string,
  targetServiceId: string,
): Promise<boolean> {
  if (sourceServiceId === targetServiceId) return true;
  const adjacency = await buildApprovedAdjacency(tenantId);
  return hasPath(adjacency, targetServiceId, sourceServiceId);
}
