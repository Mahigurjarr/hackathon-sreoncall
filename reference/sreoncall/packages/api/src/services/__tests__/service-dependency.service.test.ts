import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

const findOneMock = vi.fn();
const findOneAndUpdateMock = vi.fn();
const findMock = vi.fn();
const updateOneMock = vi.fn();

vi.mock('../../models/service-dependency.model', () => ({
  ServiceDependency: {
    findOne: (...args: any[]) => findOneMock(...args),
    findOneAndUpdate: (...args: any[]) => findOneAndUpdateMock(...args),
    find: (...args: any[]) => findMock(...args),
    updateOne: (...args: any[]) => updateOneMock(...args),
  },
}));

vi.mock('../../models/service-map-version.model', () => ({ ServiceMapVersion: {} }));
vi.mock('../../models/dependency-discovery-job.model', () => ({ DependencyDiscoveryJob: {} }));
vi.mock('../../models/service.model', () => ({ Service: {} }));

const wouldCreateCycleMock = vi.fn();
const buildApprovedAdjacencyMock = vi.fn();
const hasPathMock = vi.fn();
const addEdgeMock = vi.fn();

vi.mock('../service-dependency-graph.util', () => ({
  wouldCreateCycle: (...args: any[]) => wouldCreateCycleMock(...args),
  buildApprovedAdjacency: (...args: any[]) => buildApprovedAdjacencyMock(...args),
  hasPath: (...args: any[]) => hasPathMock(...args),
  addEdge: (...args: any[]) => addEdgeMock(...args),
}));

const getSettingsMock = vi.fn();
vi.mock('../service-topology-settings.service', () => ({
  getSettings: (...args: any[]) => getSettingsMock(...args),
}));

const createAuditLogMock = vi.fn();
vi.mock('../audit.service', () => ({
  createAuditLog: (...args: any[]) => createAuditLogMock(...args),
}));

import { approve, bulkApprove, tryAutoApprove } from '../service-dependency.service';

const TENANT = new Types.ObjectId().toString();
const DEP_ID = new Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

function mockFindOneLean(doc: any) {
  findOneMock.mockReturnValue({ lean: vi.fn().mockResolvedValue(doc) });
}

describe('approve', () => {
  it('hard-blocks approval when it would create a cycle', async () => {
    mockFindOneLean({
      status: 'proposed',
      source_service_id: new Types.ObjectId('000000000000000000000001'),
      target_service_id: new Types.ObjectId('000000000000000000000002'),
    });
    wouldCreateCycleMock.mockResolvedValue(true);

    await expect(approve(TENANT, DEP_ID, 'user-1')).rejects.toThrow(/cycle/i);
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
  });

  it('approves when no cycle would be created', async () => {
    mockFindOneLean({
      status: 'proposed',
      source_service_id: new Types.ObjectId('000000000000000000000001'),
      target_service_id: new Types.ObjectId('000000000000000000000002'),
    });
    wouldCreateCycleMock.mockResolvedValue(false);
    findOneAndUpdateMock.mockResolvedValue({ status: 'approved' });

    const result = await approve(TENANT, DEP_ID, 'user-1');
    expect(result).toEqual({ status: 'approved' });
    expect(findOneAndUpdateMock).toHaveBeenCalled();
  });

  it('skips the cycle check entirely for an already-approved edge', async () => {
    mockFindOneLean({ status: 'approved', source_service_id: 'a', target_service_id: 'b' });
    findOneAndUpdateMock.mockResolvedValue({ status: 'approved' });

    await approve(TENANT, DEP_ID, 'user-1');
    expect(wouldCreateCycleMock).not.toHaveBeenCalled();
  });
});

describe('bulkApprove', () => {
  it('skips ids that would create a cycle and approves the rest', async () => {
    const idApprovable = new Types.ObjectId().toString();
    const idCyclic = new Types.ObjectId().toString();

    findMock.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: idApprovable, status: 'proposed', source_service_id: 'a', target_service_id: 'b' },
        { _id: idCyclic, status: 'proposed', source_service_id: 'c', target_service_id: 'd' },
      ]),
    });
    buildApprovedAdjacencyMock.mockResolvedValue(new Map());
    hasPathMock.mockImplementation((_adj: any, from: string) => from === 'd'); // only the cyclic one's reverse path exists
    updateOneMock.mockResolvedValue({});

    const result = await bulkApprove(TENANT, [idApprovable, idCyclic], 'user-1');

    expect(result.modified).toBe(1);
    expect(result.skipped_cycle).toEqual([idCyclic]);
    expect(updateOneMock).toHaveBeenCalledTimes(1);
    expect(addEdgeMock).toHaveBeenCalledTimes(1);
  });
});

describe('tryAutoApprove', () => {
  function baseDoc(overrides: Partial<any> = {}) {
    return {
      status: 'proposed',
      discovery_method: 'auto_otel',
      criticality: 'medium',
      observation_count: 10,
      source_service_id: new Types.ObjectId('000000000000000000000001'),
      target_service_id: new Types.ObjectId('000000000000000000000002'),
      ...overrides,
    };
  }

  function baseSettings(overrides: Partial<any> = {}) {
    return {
      auto_approval: {
        enabled: true,
        thresholds: {
          auto_otel: { enabled: true, base_observation_threshold: 3 },
          auto_network: { enabled: true, base_observation_threshold: 7 },
          ai_parsed: { enabled: false, base_observation_threshold: 5 },
          document_upload: { enabled: false, base_observation_threshold: 5 },
        },
        criticality_multiplier: { critical: 4, high: 2.5, medium: 1, low: 0.5 },
        ...overrides,
      },
    };
  }

  it('no-ops when the edge is not proposed', async () => {
    findOneMock.mockResolvedValue(baseDoc({ status: 'approved' }));
    expect(await tryAutoApprove(TENANT, DEP_ID, 'worker:test')).toBe(false);
    expect(getSettingsMock).not.toHaveBeenCalled();
  });

  it('no-ops when tenant auto-approval is disabled', async () => {
    findOneMock.mockResolvedValue(baseDoc());
    getSettingsMock.mockResolvedValue(baseSettings({ enabled: false }));
    expect(await tryAutoApprove(TENANT, DEP_ID, 'worker:test')).toBe(false);
  });

  it('no-ops when the discovery method is disabled by default (ai_parsed)', async () => {
    findOneMock.mockResolvedValue(baseDoc({ discovery_method: 'ai_parsed', observation_count: 999 }));
    getSettingsMock.mockResolvedValue(baseSettings());
    expect(await tryAutoApprove(TENANT, DEP_ID, 'worker:test')).toBe(false);
  });

  it('no-ops when observation_count is below the criticality-scaled threshold', async () => {
    // critical multiplier 4 * base 3 = 12 required; only 10 observed.
    findOneMock.mockResolvedValue(baseDoc({ criticality: 'critical', observation_count: 10 }));
    getSettingsMock.mockResolvedValue(baseSettings());
    expect(await tryAutoApprove(TENANT, DEP_ID, 'worker:test')).toBe(false);
  });

  it('hard-blocks (no-op) when it would create a cycle, even past the threshold', async () => {
    findOneMock.mockResolvedValue(baseDoc());
    getSettingsMock.mockResolvedValue(baseSettings());
    wouldCreateCycleMock.mockResolvedValue(true);
    expect(await tryAutoApprove(TENANT, DEP_ID, 'worker:test')).toBe(false);
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('approves and writes an audit log once every gate passes', async () => {
    findOneMock.mockResolvedValue(baseDoc());
    getSettingsMock.mockResolvedValue(baseSettings());
    wouldCreateCycleMock.mockResolvedValue(false);
    updateOneMock.mockResolvedValue({ modifiedCount: 1 });

    const result = await tryAutoApprove(TENANT, DEP_ID, 'worker:test');

    expect(result).toBe(true);
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: DEP_ID, tenant_id: TENANT, status: 'proposed' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'approved', auto_approved: true }) }),
    );
    expect(createAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'service_dependency.auto_approved',
        actor: expect.objectContaining({ type: 'system', ip: 'unknown' }),
      }),
    );
  });

  it('returns false without erroring when it loses the race to a concurrent approval/rejection', async () => {
    findOneMock.mockResolvedValue(baseDoc());
    getSettingsMock.mockResolvedValue(baseSettings());
    wouldCreateCycleMock.mockResolvedValue(false);
    updateOneMock.mockResolvedValue({ modifiedCount: 0 }); // another writer already changed status

    const result = await tryAutoApprove(TENANT, DEP_ID, 'worker:test');
    expect(result).toBe(false);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });
});
