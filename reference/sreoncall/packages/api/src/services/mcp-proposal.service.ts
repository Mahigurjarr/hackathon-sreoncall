import { Types } from 'mongoose';
import { McpProposal, McpProposalDocument, McpProposalTargetType } from '../models/mcp-proposal.model';
import { ApiKey } from '../models/api-key.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import * as ticketService from './ticket.service';
import * as changeService from './change.service';
import * as runbookService from './runbook.service';
import * as alertRuleService from './alert-rule.service';
import * as oncallScheduleService from './oncall-schedule.service';

export async function createProposal(input: {
  tenant_id: Types.ObjectId;
  created_by_api_key_id: Types.ObjectId;
  tool_name: string;
  target_type: McpProposalTargetType;
  summary: string;
  payload: Record<string, unknown>;
}): Promise<McpProposalDocument> {
  return McpProposal.create({
    tenant_id: input.tenant_id,
    created_by_api_key_id: input.created_by_api_key_id,
    tool_name: input.tool_name,
    target_type: input.target_type,
    summary: input.summary,
    payload: input.payload,
  });
}

export async function listProposals(
  tenantId: Types.ObjectId,
  status?: string,
): Promise<McpProposalDocument[]> {
  const filter: Record<string, unknown> = { tenant_id: tenantId };
  if (status) filter.status = status;
  return McpProposal.find(filter).sort({ createdAt: -1 }).limit(200);
}

export async function getProposal(tenantId: Types.ObjectId, id: string): Promise<McpProposalDocument> {
  const proposal = await McpProposal.findOne({ _id: id, tenant_id: tenantId });
  if (!proposal) throw AppError.notFound('MCP proposal');
  return proposal;
}

export async function rejectProposal(
  tenantId: Types.ObjectId,
  id: string,
  reviewerId: Types.ObjectId,
): Promise<McpProposalDocument> {
  // Atomically claim the pending -> rejected transition. A plain
  // fetch-check-save (the previous shape) lets two concurrent calls both
  // pass the `status !== 'pending'` check before either write lands; the
  // `status: 'pending'` filter here makes only one of them able to match.
  const proposal = await McpProposal.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, status: 'pending' },
    { $set: { status: 'rejected', reviewed_by: reviewerId, reviewed_at: new Date() } },
    { new: true },
  );
  if (!proposal) {
    const existing = await getProposal(tenantId, id);
    throw AppError.badRequest(`Proposal is already '${existing.status}'`);
  }
  return proposal;
}

/**
 * The only path from a proposal to a real, live entity. Attributes the
 * created entity to whoever generated the API key that proposed it — the
 * approving reviewer is recorded separately on the proposal itself, so both
 * "who asked for this" and "who signed off" stay distinct.
 */
export async function approveProposal(
  tenantId: Types.ObjectId,
  id: string,
  reviewerId: Types.ObjectId,
): Promise<McpProposalDocument> {
  // Same atomic claim as rejectProposal — this is the step that must not
  // run twice, since a double-click or retried request racing past a plain
  // status check would otherwise both proceed to applyProposal() below and
  // create the same ticket/change/override twice.
  const proposal = await McpProposal.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, status: 'pending' },
    { $set: { status: 'approved', reviewed_by: reviewerId, reviewed_at: new Date() } },
    { new: true },
  );
  if (!proposal) {
    const existing = await getProposal(tenantId, id);
    throw AppError.badRequest(`Proposal is already '${existing.status}'`);
  }

  const apiKey = await ApiKey.findById(proposal.created_by_api_key_id);
  if (!apiKey) {
    // The claim above already committed 'approved' — record why apply never
    // ran rather than leaving the proposal stuck with no further transition.
    proposal.status = 'apply_failed';
    proposal.apply_error = 'Originating API key no longer exists';
    await proposal.save();
    return proposal;
  }

  try {
    const appliedId = await applyProposal(tenantId, proposal, apiKey.created_by);
    proposal.status = 'applied';
    proposal.applied_entity_id = appliedId;
  } catch (err: any) {
    logger.error('Failed to apply approved MCP proposal', { proposalId: id, error: err.message });
    proposal.status = 'apply_failed';
    proposal.apply_error = err.message || 'Unknown error';
  }

  await proposal.save();
  return proposal;
}

async function applyProposal(
  tenantId: Types.ObjectId,
  proposal: McpProposalDocument,
  attributedUserId: Types.ObjectId,
): Promise<Types.ObjectId> {
  const payload = proposal.payload as any;

  if (proposal.target_type === 'ticket') {
    const ticket = await ticketService.createTicket({
      ...payload,
      tenant_id: tenantId,
      reporter_id: attributedUserId,
    });
    return ticket._id;
  }

  if (proposal.target_type === 'change_request') {
    const change = await changeService.createChange({
      ...payload,
      tenant_id: tenantId,
      created_by: attributedUserId,
    });
    return change._id;
  }

  if (proposal.target_type === 'runbook') {
    const runbook = await runbookService.createRunbook({
      ...payload,
      tenant_id: tenantId,
      created_by: attributedUserId,
    });
    return runbook._id;
  }

  if (proposal.target_type === 'alert_rule') {
    const rule = await alertRuleService.createAlertRule(tenantId.toString(), attributedUserId.toString(), payload);
    return rule._id;
  }

  if (proposal.target_type === 'oncall_override') {
    const schedule = await oncallScheduleService.addOverride(tenantId.toString(), payload.schedule_id, {
      user_id: payload.user_id,
      start: payload.start,
      end: payload.end,
      reason: payload.reason,
      created_by: attributedUserId.toString(),
    });
    return schedule._id;
  }

  throw new Error(`Unknown proposal target_type: ${proposal.target_type}`);
}
