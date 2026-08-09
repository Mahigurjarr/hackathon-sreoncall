import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// A chainable query stub: sort/limit/populate all return self; awaiting yields `result`.
function queryChain(result: any[]) {
  const obj: any = {
    sort: () => obj,
    limit: () => obj,
    populate: () => obj,
    then: (resolve: (v: any[]) => any) => resolve(result),
  };
  return obj;
}

const findMock = vi.fn((..._args: any[]) => queryChain([]));
const countMock = vi.fn(async (..._args: any[]) => 0);

vi.mock('../../models/ticket.model', () => ({
  Ticket: {
    find: (...args: any[]) => findMock(...args),
    countDocuments: (...args: any[]) => countMock(...args),
  },
}));

vi.mock('../../models/team.model', () => ({
  Team: { findOne: vi.fn() },
}));

import { listTickets } from '../ticket.service';

const TENANT = new Types.ObjectId();

beforeEach(() => {
  vi.clearAllMocks();
  findMock.mockReturnValue(queryChain([]));
  countMock.mockResolvedValue(0);
});

describe('listTickets — team_id filter', () => {
  it('rejects a malformed team_id with a 400 before querying', async () => {
    await expect(
      listTickets({ tenant_id: TENANT, team_id: 'not-an-objectid' }, { limit: 50 } as any)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(findMock).not.toHaveBeenCalled();
  });

  it('applies a valid team_id as an ObjectId in the query filter', async () => {
    const teamId = new Types.ObjectId().toString();
    await listTickets({ tenant_id: TENANT, team_id: teamId }, { limit: 50 } as any);

    expect(findMock).toHaveBeenCalledTimes(1);
    const passedFilter = findMock.mock.calls[0][0] as any;
    expect(passedFilter.team_id).toBeInstanceOf(Types.ObjectId);
    expect(passedFilter.team_id.toString()).toBe(teamId);
    expect(passedFilter.tenant_id).toBe(TENANT);
  });

  it('omits team_id from the filter when none is supplied', async () => {
    await listTickets({ tenant_id: TENANT }, { limit: 50 } as any);
    const passedFilter = findMock.mock.calls[0][0] as any;
    expect(passedFilter.team_id).toBeUndefined();
  });
});
