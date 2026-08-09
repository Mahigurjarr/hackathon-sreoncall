import { describe, it, expect, vi } from 'vitest';
import { Types } from 'mongoose';

const findMock = vi.fn();

vi.mock('../../models/service-dependency.model', () => ({
  ServiceDependency: {
    find: (...args: any[]) => findMock(...args),
  },
}));

import { wouldCreateCycle, buildApprovedAdjacency, hasPath, addEdge } from '../service-dependency-graph.util';

function mockEdges(edges: Array<{ source: string; target: string }>) {
  findMock.mockReturnValue({
    lean: vi.fn().mockResolvedValue(
      edges.map((e) => ({
        source_service_id: new Types.ObjectId(e.source),
        target_service_id: new Types.ObjectId(e.target),
      })),
    ),
  });
}

const A = '000000000000000000000001';
const B = '000000000000000000000002';
const C = '000000000000000000000003';
const D = '000000000000000000000004';

describe('wouldCreateCycle', () => {
  it('returns true for a direct self-loop', async () => {
    mockEdges([]);
    expect(await wouldCreateCycle('tenant', A, A)).toBe(true);
  });

  it('returns false for a straight chain (no cycle)', async () => {
    // Existing approved: A -> B -> C. Proposing C -> D should not cycle.
    mockEdges([
      { source: A, target: B },
      { source: B, target: C },
    ]);
    expect(await wouldCreateCycle('tenant', C, D)).toBe(false);
  });

  it('detects a direct cycle (A -> B approved, proposing B -> A)', async () => {
    mockEdges([{ source: A, target: B }]);
    expect(await wouldCreateCycle('tenant', B, A)).toBe(true);
  });

  it('detects a multi-hop cycle (A -> B -> C approved, proposing C -> A)', async () => {
    mockEdges([
      { source: A, target: B },
      { source: B, target: C },
    ]);
    expect(await wouldCreateCycle('tenant', C, A)).toBe(true);
  });

  it('does not flag a diamond shape as a cycle', async () => {
    // A -> B, A -> C, B -> D, C -> D. Proposing A -> D is not a new cycle
    // (D has no outgoing edges back to A).
    mockEdges([
      { source: A, target: B },
      { source: A, target: C },
      { source: B, target: D },
      { source: C, target: D },
    ]);
    expect(await wouldCreateCycle('tenant', A, D)).toBe(false);
  });
});

describe('buildApprovedAdjacency / hasPath / addEdge', () => {
  it('builds an adjacency list and finds a transitive path', async () => {
    mockEdges([
      { source: A, target: B },
      { source: B, target: C },
    ]);
    const adjacency = await buildApprovedAdjacency('tenant');
    expect(hasPath(adjacency, A, C)).toBe(true);
    expect(hasPath(adjacency, C, A)).toBe(false);
  });

  it('addEdge mutates the adjacency so a later hasPath check sees it', async () => {
    mockEdges([]);
    const adjacency = await buildApprovedAdjacency('tenant');
    expect(hasPath(adjacency, A, B)).toBe(false);
    addEdge(adjacency, A, B);
    expect(hasPath(adjacency, A, B)).toBe(true);
  });
});
