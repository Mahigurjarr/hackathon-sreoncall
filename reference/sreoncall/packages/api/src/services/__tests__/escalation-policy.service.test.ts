import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// Capture what gets persisted so we can assert target_type/targets pass through.
const createdPolicies: any[] = [];

vi.mock('../../models/escalation-policy.model', () => ({
  EscalationPolicy: {
    create: vi.fn(async (doc: any) => {
      const p = { ...doc, _id: new Types.ObjectId() };
      createdPolicies.push(p);
      return p;
    }),
    findOne: vi.fn(),
    countDocuments: vi.fn(async () => 0),
  },
  // Re-export the value shapes the service imports as types (no-op at runtime).
  IEscalationStep: {},
  NotifyChannel: {},
}));

// Team existence/tenant check lives behind Team.countDocuments.
vi.mock('../../models/team.model', () => ({
  Team: { countDocuments: vi.fn() },
}));

// Models/services touched only by unrelated code paths — stub to avoid side effects.
vi.mock('../../models/service.model', () => ({ Service: { countDocuments: vi.fn(async () => 0) } }));
vi.mock('../../models/provider-consumer-link.model', () => ({ ProviderConsumerLink: { findOne: vi.fn() } }));
vi.mock('../../models/incident.model', () => ({ Incident: { findOne: vi.fn() } }));
vi.mock('../incident-bridge.service', () => ({ createBridge: vi.fn() }));
vi.mock('../managed-support.service', () => ({ resolveActiveContractInCoverage: vi.fn() }));

import { EscalationPolicy } from '../../models/escalation-policy.model';
import { Team } from '../../models/team.model';
import { createEscalationPolicy } from '../escalation-policy.service';

const TENANT = new Types.ObjectId();
const CREATED_BY = new Types.ObjectId();

beforeEach(() => {
  createdPolicies.length = 0;
  vi.clearAllMocks();
});

describe('createEscalationPolicy — team targets', () => {
  it('persists a team-typed step when the team belongs to the tenant', async () => {
    const teamId = new Types.ObjectId().toString();
    (Team.countDocuments as any).mockResolvedValue(1);

    await createEscalationPolicy({
      tenant_id: TENANT,
      created_by: CREATED_BY,
      name: 'Team escalation',
      steps: [{ delay_minutes: 5, target_type: 'team', targets: [teamId] }],
    });

    // Validation must be tenant-scoped.
    expect(Team.countDocuments).toHaveBeenCalledWith({ _id: { $in: [teamId] }, tenant_id: TENANT });
    expect(EscalationPolicy.create).toHaveBeenCalledTimes(1);
    const step = createdPolicies[0].steps[0];
    expect(step.target_type).toBe('team');
    expect(step.targets[0].toString()).toBe(teamId);
  });

  it('rejects a malformed team id with a 400', async () => {
    await expect(
      createEscalationPolicy({
        tenant_id: TENANT,
        created_by: CREATED_BY,
        name: 'Bad',
        steps: [{ delay_minutes: 5, target_type: 'team', targets: ['not-an-objectid'] }],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(EscalationPolicy.create).not.toHaveBeenCalled();
  });

  it('rejects a team id that does not exist in the tenant', async () => {
    const teamId = new Types.ObjectId().toString();
    (Team.countDocuments as any).mockResolvedValue(0); // not found / cross-tenant

    await expect(
      createEscalationPolicy({
        tenant_id: TENANT,
        created_by: CREATED_BY,
        name: 'Dangling',
        steps: [{ delay_minutes: 5, target_type: 'team', targets: [teamId] }],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(EscalationPolicy.create).not.toHaveBeenCalled();
  });

  it('does not validate teams for non-team steps', async () => {
    await createEscalationPolicy({
      tenant_id: TENANT,
      created_by: CREATED_BY,
      name: 'User escalation',
      steps: [{ delay_minutes: 5, target_type: 'user', targets: [new Types.ObjectId().toString()] }],
    });
    expect(Team.countDocuments).not.toHaveBeenCalled();
    expect(EscalationPolicy.create).toHaveBeenCalledTimes(1);
  });
});
