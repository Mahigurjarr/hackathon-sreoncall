import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

function proposalDoc(overrides: Record<string, any> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(),
    tenant_id: new Types.ObjectId(),
    created_by_api_key_id: new Types.ObjectId(),
    tool_name: 'propose_runbook',
    target_type: 'runbook',
    summary: 'test',
    payload: {},
    status: 'pending',
    applied_entity_id: null,
    apply_error: null,
    reviewed_by: null,
    reviewed_at: null,
    ...overrides,
  };
  doc.save = vi.fn(async () => doc);
  return doc;
}

const mcpProposalFindOneMock = vi.fn();
const mcpProposalFindOneAndUpdateMock = vi.fn();
const apiKeyFindByIdMock = vi.fn();
const createRunbookMock = vi.fn(async (..._args: any[]) => ({ _id: new Types.ObjectId() }));
const createAlertRuleMock = vi.fn(async (..._args: any[]) => ({ _id: new Types.ObjectId() }));
const addOverrideMock = vi.fn(async (..._args: any[]) => ({ _id: new Types.ObjectId() }));
const createTicketMock = vi.fn(async (..._args: any[]) => ({ _id: new Types.ObjectId() }));
const createChangeMock = vi.fn(async (..._args: any[]) => ({ _id: new Types.ObjectId() }));

vi.mock('../../models/mcp-proposal.model', () => ({
  McpProposal: {
    findOne: (...args: any[]) => mcpProposalFindOneMock(...args),
    findOneAndUpdate: (...args: any[]) => mcpProposalFindOneAndUpdateMock(...args),
    find: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../models/api-key.model', () => ({
  ApiKey: { findById: (...args: any[]) => apiKeyFindByIdMock(...args) },
}));

vi.mock('../runbook.service', () => ({ createRunbook: (...args: any[]) => createRunbookMock(...args) }));
vi.mock('../alert-rule.service', () => ({ createAlertRule: (...args: any[]) => createAlertRuleMock(...args) }));
vi.mock('../oncall-schedule.service', () => ({ addOverride: (...args: any[]) => addOverrideMock(...args) }));
vi.mock('../ticket.service', () => ({ createTicket: (...args: any[]) => createTicketMock(...args) }));
vi.mock('../change.service', () => ({ createChange: (...args: any[]) => createChangeMock(...args) }));

import { approveProposal, rejectProposal } from '../mcp-proposal.service';

const TENANT = new Types.ObjectId();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approveProposal — new target_types', () => {
  it('applies a runbook proposal via runbookService.createRunbook, attributed to the api key creator', async () => {
    const apiKeyId = new Types.ObjectId();
    const createdBy = new Types.ObjectId();
    const proposal = proposalDoc({
      tenant_id: TENANT,
      target_type: 'runbook',
      created_by_api_key_id: apiKeyId,
      payload: { title: 'My runbook' },
    });
    mcpProposalFindOneAndUpdateMock.mockResolvedValue(proposal);
    apiKeyFindByIdMock.mockResolvedValue({ _id: apiKeyId, created_by: createdBy });

    const result = await approveProposal(TENANT, proposal._id.toString(), new Types.ObjectId());

    expect(createRunbookMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My runbook', tenant_id: TENANT, created_by: createdBy }),
    );
    expect(result.status).toBe('applied');
    expect(result.applied_entity_id).toBeTruthy();
  });

  it('applies an alert_rule proposal via alertRuleService.createAlertRule', async () => {
    const apiKeyId = new Types.ObjectId();
    const createdBy = new Types.ObjectId();
    const payload = { name: 'High CPU', condition: { metric: 'cpu', operator: 'gt', threshold: 90 } };
    const proposal = proposalDoc({
      tenant_id: TENANT,
      target_type: 'alert_rule',
      created_by_api_key_id: apiKeyId,
      payload,
    });
    mcpProposalFindOneAndUpdateMock.mockResolvedValue(proposal);
    apiKeyFindByIdMock.mockResolvedValue({ _id: apiKeyId, created_by: createdBy });

    const result = await approveProposal(TENANT, proposal._id.toString(), new Types.ObjectId());

    expect(createAlertRuleMock).toHaveBeenCalledWith(TENANT.toString(), createdBy.toString(), payload);
    expect(result.status).toBe('applied');
  });

  it('applies an oncall_override proposal via oncallScheduleService.addOverride', async () => {
    const apiKeyId = new Types.ObjectId();
    const createdBy = new Types.ObjectId();
    const scheduleId = new Types.ObjectId().toString();
    const userId = new Types.ObjectId().toString();
    const proposal = proposalDoc({
      tenant_id: TENANT,
      target_type: 'oncall_override',
      created_by_api_key_id: apiKeyId,
      payload: { schedule_id: scheduleId, user_id: userId, start: '2026-08-01T00:00:00Z', end: '2026-08-02T00:00:00Z', reason: 'PTO cover' },
    });
    mcpProposalFindOneAndUpdateMock.mockResolvedValue(proposal);
    apiKeyFindByIdMock.mockResolvedValue({ _id: apiKeyId, created_by: createdBy });

    const result = await approveProposal(TENANT, proposal._id.toString(), new Types.ObjectId());

    expect(addOverrideMock).toHaveBeenCalledWith(TENANT.toString(), scheduleId, {
      user_id: userId,
      start: '2026-08-01T00:00:00Z',
      end: '2026-08-02T00:00:00Z',
      reason: 'PTO cover',
      created_by: createdBy.toString(),
    });
    expect(result.status).toBe('applied');
  });

  it('marks the proposal apply_failed (not reverted to pending) when the underlying service throws', async () => {
    const apiKeyId = new Types.ObjectId();
    const createdBy = new Types.ObjectId();
    const proposal = proposalDoc({
      tenant_id: TENANT,
      target_type: 'runbook',
      created_by_api_key_id: apiKeyId,
      payload: { title: 'Bad runbook' },
    });
    mcpProposalFindOneAndUpdateMock.mockResolvedValue(proposal);
    apiKeyFindByIdMock.mockResolvedValue({ _id: apiKeyId, created_by: createdBy });
    createRunbookMock.mockRejectedValueOnce(new Error('validation failed'));

    const result = await approveProposal(TENANT, proposal._id.toString(), new Types.ObjectId());

    expect(result.status).toBe('apply_failed');
    expect(result.apply_error).toBe('validation failed');
  });

  it('marks the proposal apply_failed when the originating API key no longer exists, instead of throwing with the claim already committed', async () => {
    const proposal = proposalDoc({ tenant_id: TENANT, target_type: 'runbook' });
    mcpProposalFindOneAndUpdateMock.mockResolvedValue(proposal);
    apiKeyFindByIdMock.mockResolvedValue(null);

    const result = await approveProposal(TENANT, proposal._id.toString(), new Types.ObjectId());

    expect(result.status).toBe('apply_failed');
    expect(result.apply_error).toBe('Originating API key no longer exists');
    expect(createRunbookMock).not.toHaveBeenCalled();
  });
});

describe('approveProposal / rejectProposal — concurrent transition guard', () => {
  it('approveProposal rejects a second concurrent call once the first has already claimed the proposal', async () => {
    // findOneAndUpdate's `status: 'pending'` filter is what makes this
    // atomic: a second caller racing the first gets no match (null) because
    // the first call already flipped status away from 'pending' in the same
    // DB round trip a plain fetch-then-save could never guarantee.
    const proposal = proposalDoc({ tenant_id: TENANT, status: 'approved' });
    mcpProposalFindOneAndUpdateMock.mockResolvedValueOnce(null);
    mcpProposalFindOneMock.mockResolvedValueOnce(proposal);

    await expect(approveProposal(TENANT, proposal._id.toString(), new Types.ObjectId())).rejects.toThrow(
      "Proposal is already 'approved'",
    );
    expect(apiKeyFindByIdMock).not.toHaveBeenCalled();
  });

  it('rejectProposal rejects a second concurrent call once the first has already claimed the proposal', async () => {
    const proposal = proposalDoc({ tenant_id: TENANT, status: 'rejected' });
    mcpProposalFindOneAndUpdateMock.mockResolvedValueOnce(null);
    mcpProposalFindOneMock.mockResolvedValueOnce(proposal);

    await expect(rejectProposal(TENANT, proposal._id.toString(), new Types.ObjectId())).rejects.toThrow(
      "Proposal is already 'rejected'",
    );
  });

  it('rejectProposal atomically transitions pending -> rejected', async () => {
    const proposal = proposalDoc({ tenant_id: TENANT, status: 'rejected' });
    mcpProposalFindOneAndUpdateMock.mockResolvedValueOnce(proposal);

    const reviewerId = new Types.ObjectId();
    const result = await rejectProposal(TENANT, proposal._id.toString(), reviewerId);

    expect(mcpProposalFindOneAndUpdateMock).toHaveBeenCalledWith(
      { _id: proposal._id.toString(), tenant_id: TENANT, status: 'pending' },
      { $set: expect.objectContaining({ status: 'rejected', reviewed_by: reviewerId }) },
      { new: true },
    );
    expect(result.status).toBe('rejected');
  });
});
