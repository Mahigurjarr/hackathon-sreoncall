import { Types } from 'mongoose';
import {
  ChangeRequest,
  ChangeRequestDocument,
  ChangeStatus,
  RiskScore,
  ApprovalDecision,
  PirOutcome,
} from '../models/change-request.model';
import { getNextSequence } from '../models/counter.model';
import { FreezeWindow } from '../models/freeze-window.model';
import '../models/service.model'; // side-effect: register Service schema for populate
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { getJetStream } from '../config/nats';
import { publishAgentTrigger } from './agent-trigger.service';
import { StringCodec } from 'nats';

const sc = StringCodec();

// ─── Event publishing ─────────────────────────────────────────────────────────

async function publishChangeEvent(
  eventType: string,
  cr: ChangeRequestDocument,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const js = getJetStream();
    await js.publish(
      `changes.${eventType}`,
      sc.encode(
        JSON.stringify({
          event: eventType,
          tenant_id: cr.tenant_id.toString(),
          change_id: cr._id.toString(),
          number: cr.number,
          status: cr.status,
          timestamp: new Date().toISOString(),
          ...extra,
        })
      )
    );
  } catch (err: any) {
    logger.error('Failed to publish change event', { eventType, error: err.message });
  }
}

// ─── Risk scoring helper (simple rule-based; Claude integration is Phase 2) ──

function computeRiskScore(input: {
  type: string;
  affectedServiceCount: number;
  rollback_plan: string;
  justification: string;
}): RiskScore {
  if (input.type === 'emergency') return 'high';
  if (input.affectedServiceCount >= 5) return 'critical';
  if (input.affectedServiceCount >= 3) return 'high';
  if (input.affectedServiceCount >= 1) return 'medium';
  if (!input.rollback_plan.trim()) return 'high';
  return 'low';
}

// ─── Conflict detection (checks overlapping windows for same tenant) ──────────

async function detectConflicts(
  tenantId: Types.ObjectId,
  window: { start: Date; end: Date } | null,
  excludeId?: string,
  affectedServiceIds?: Types.ObjectId[],
): Promise<{ warnings: string[]; freeze_conflict: boolean }> {
  if (!window) return { warnings: [], freeze_conflict: false };

  const filter: Record<string, unknown> = {
    tenant_id: tenantId,
    status: { $in: ['approved', 'scheduled', 'in_progress'] },
    'implementation_window.start': { $lt: window.end },
    'implementation_window.end':   { $gt: window.start },
  };
  if (excludeId) filter['_id'] = { $ne: new Types.ObjectId(excludeId) };

  const conflicts = await ChangeRequest.find(filter)
    .select('number title affected_service_ids')
    .limit(10);

  const warnings = conflicts.map(
    (c) => `Overlaps with CR-${String(c.number).padStart(4, '0')}: ${c.title}`
  );

  // A freeze window with no service_ids applies platform-wide; otherwise it
  // only conflicts with changes touching one of its listed services.
  const overlappingFreezes = await FreezeWindow.find({
    tenant_id: tenantId,
    start: { $lt: window.end },
    end: { $gt: window.start },
  }).select('name service_ids');

  const freezeMatches = overlappingFreezes.filter((f) => {
    if (f.service_ids.length === 0) return true;
    if (!affectedServiceIds || affectedServiceIds.length === 0) return false;
    const affectedSet = new Set(affectedServiceIds.map((id) => id.toString()));
    return f.service_ids.some((id) => affectedSet.has(id.toString()));
  });

  for (const f of freezeMatches) {
    warnings.push(`Falls within freeze window: ${f.name}`);
  }

  return { warnings, freeze_conflict: freezeMatches.length > 0 };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ChangeFilter {
  tenant_id: Types.ObjectId;
  status?: string;
  type?: string;
  search?: string;
  labels?: string[];
}

export async function listChanges(
  filter: ChangeFilter,
  pagination: PaginationParams
): Promise<PaginatedResult<ChangeRequestDocument>> {
  const base: Record<string, unknown> = { tenant_id: filter.tenant_id };
  if (filter.status) base.status = filter.status;
  if (filter.type)   base.type   = filter.type;
  if (filter.labels?.length) base.labels = { $in: filter.labels };
  if (filter.search) base.title  = { $regex: filter.search, $options: 'i' };

  const pag = { ...pagination, sort_by: pagination.sort_by || 'createdAt' };
  const { filter: cursorFilter, sort } = buildCursorFilter(pag, base);

  const results = await ChangeRequest.find(cursorFilter)
    .sort(sort)
    .limit(pagination.limit + 1)
    .populate('created_by', 'name email avatar_url')
    .populate('approval_chain.approvers.user_id', 'name email')
    .populate('approval_chain.decisions.user_id', 'name email');

  const total = await ChangeRequest.countDocuments(base);
  return paginateResults(results, pag, total);
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getChangeById(
  tenantId: Types.ObjectId,
  id: string
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId })
    .populate('created_by', 'name email avatar_url')
    .populate('approval_chain.approvers.user_id', 'name email avatar_url')
    .populate('approval_chain.decisions.user_id', 'name email avatar_url')
    .populate('affected_service_ids', 'name')
    .populate('pir.reviewed_by', 'name email')
    .populate('requester_id', 'name email avatar_url')
    .populate('change_owner_id', 'name email avatar_url')
    .populate('notes.user_id', 'name email avatar_url');
  if (!cr) throw AppError.notFound('Change request');
  return cr;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createChange(input: {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  type?: string;
  title: string;
  description?: string;
  justification?: string;
  rollback_plan?: string;
  risk_score?: string;
  affected_service_ids?: string[];
  implementation_window?: { start: string; end: string; timezone?: string } | null;
  labels?: string[];
  requester_id?: string;
  change_owner_id?: string;
  roll_out_date?: string;
  approval_chain?: Array<{
    type?: string;
    required_approvals?: number;
    approvers: Array<{ user_id: string; role?: string }>;
  }>;
}): Promise<ChangeRequestDocument> {
  const number = await getNextSequence(input.tenant_id, 'change');
  const affectedIds = (input.affected_service_ids || []).map((id) => new Types.ObjectId(id));

  const riskScore = (input.risk_score as RiskScore) ?? computeRiskScore({
    type: input.type || 'normal',
    affectedServiceCount: affectedIds.length,
    rollback_plan: input.rollback_plan || '',
    justification: input.justification || '',
  });

  const window = input.implementation_window
    ? { start: new Date(input.implementation_window.start), end: new Date(input.implementation_window.end), timezone: input.implementation_window.timezone || 'UTC' }
    : null;

  const approvalChain = (input.approval_chain || []).map((step, idx) => ({
    step: idx + 1,
    type: step.type || 'sequential',
    required_approvals: step.required_approvals ?? 1,
    approvers: step.approvers.map((a) => ({ user_id: new Types.ObjectId(a.user_id), role: a.role || null, external: (a as any).external ?? false, external_email: (a as any).external_email ?? null })),
    decisions: [],
    completed_at: null,
  }));

  const cr = await ChangeRequest.create({
    tenant_id: input.tenant_id,
    number,
    type: input.type || 'normal',
    title: input.title,
    description: input.description || '',
    justification: input.justification || '',
    rollback_plan: input.rollback_plan || '',
    risk: { score: riskScore, ai_score: null, factors: [], blast_radius_description: '' },
    affected_service_ids: affectedIds,
    implementation_window: window,
    status: 'draft',
    approval_chain: approvalChain,
    current_step: 0,
    pir: null,
    ai_conflict_warnings: [],
    ai_window_suggestions: [],
    freeze_window_conflict: false,
    labels: input.labels || [],
    created_by: input.created_by,
    requester_id: input.requester_id ? new Types.ObjectId(input.requester_id) : input.created_by,
    change_owner_id: input.change_owner_id ? new Types.ObjectId(input.change_owner_id) : null,
    roll_out_date: input.roll_out_date ? new Date(input.roll_out_date) : null,
    notes: [],
  });

  logger.info('Change request created', { changeId: cr._id, number, type: cr.type });
  publishChangeEvent('created', cr).catch(() => {});
  return cr;
}

// ─── Update (patch) ───────────────────────────────────────────────────────────

export async function updateChange(
  tenantId: Types.ObjectId,
  id: string,
  update: {
    title?: string;
    description?: string;
    justification?: string;
    rollback_plan?: string;
    type?: string;
    risk_score?: string;
    labels?: string[];
    requester_id?: string;
    change_owner_id?: string;
    roll_out_date?: string | null;
    affected_service_ids?: string[];
    implementation_window?: { start: string; end: string; timezone?: string } | null;
    approval_chain?: Array<{
      type?: string;
      required_approvals?: number;
      approvers: Array<{ user_id: string; role?: string }>;
    }>;
  }
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');

  if (!['draft', 'submitted'].includes(cr.status))
    throw AppError.badRequest(`Cannot edit a change in status '${cr.status}'`);

  if (update.title !== undefined)         cr.title         = update.title;
  if (update.description !== undefined)   cr.description   = update.description;
  if (update.justification !== undefined) cr.justification = update.justification;
  if (update.rollback_plan !== undefined) cr.rollback_plan = update.rollback_plan;
  if (update.type !== undefined)          cr.type          = update.type as any;
  if (update.labels !== undefined)        cr.labels        = update.labels;
  if (update.requester_id !== undefined) cr.requester_id = new Types.ObjectId(update.requester_id) as any;
  if (update.change_owner_id !== undefined) cr.change_owner_id = update.change_owner_id ? new Types.ObjectId(update.change_owner_id) as any : null;
  if (update.roll_out_date !== undefined) cr.roll_out_date = update.roll_out_date ? new Date(update.roll_out_date) as any : null;

  if (update.risk_score !== undefined)
    cr.risk.score = update.risk_score as RiskScore;

  if (update.affected_service_ids !== undefined)
    cr.affected_service_ids = update.affected_service_ids.map((i) => new Types.ObjectId(i));

  if (update.implementation_window !== undefined) {
    cr.implementation_window = update.implementation_window
      ? { start: new Date(update.implementation_window.start), end: new Date(update.implementation_window.end), timezone: update.implementation_window.timezone || 'UTC' }
      : null;
  }

  if (update.approval_chain !== undefined) {
    cr.approval_chain = (update.approval_chain).map((step, idx) => ({
      _id: new Types.ObjectId(),
      step: idx + 1,
      type: (step.type || 'sequential') as any,
      required_approvals: step.required_approvals ?? 1,
      approvers: step.approvers.map((a) => ({ user_id: new Types.ObjectId(a.user_id), role: a.role || null, external: (a as any).external ?? false, external_email: (a as any).external_email ?? null })),
      decisions: [],
      completed_at: null,
    }));
    cr.current_step = 0;
  }

  await cr.save();
  logger.info('Change request updated', { changeId: id });
  return cr;
}

// ─── Submit for approval ──────────────────────────────────────────────────────

export async function submitChange(
  tenantId: Types.ObjectId,
  id: string
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (cr.status !== 'draft') throw AppError.badRequest(`Change is already '${cr.status}'`);

  // Detect window conflicts before submitting
  const { warnings, freeze_conflict } = await detectConflicts(tenantId, cr.implementation_window, id, cr.affected_service_ids);
  cr.ai_conflict_warnings = warnings;
  cr.freeze_window_conflict = freeze_conflict;

  if (cr.approval_chain.length > 0) {
    cr.status = 'pending_approval';
    cr.current_step = 1;
  } else {
    // No approval chain → auto-approve standard changes
    cr.status = cr.type === 'standard' ? 'approved' : 'submitted';
  }

  await cr.save();
  logger.info('Change request submitted', { changeId: id, status: cr.status });
  publishChangeEvent('submitted', cr).catch(() => {});

  // Trigger change-risk agent on submission (Phase 3)
  publishAgentTrigger('change-risk', {
    type: 'event', event_type: 'change.submitted', source_id: cr._id.toString(),
  }, tenantId.toString()).catch(() => {});

  return cr;
}

// ─── Approve / Reject a step ──────────────────────────────────────────────────

export async function decideApproval(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  decision: ApprovalDecision,
  comment: string
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (cr.status !== 'pending_approval') throw AppError.badRequest('Change is not pending approval');

  const step = cr.approval_chain.find((s) => s.step === cr.current_step);
  if (!step) throw AppError.badRequest('No active approval step found');

  // Validate the actor is an approver for this step
  const isApprover = step.approvers.some((a) => a.user_id.equals(actorId));
  if (!isApprover) throw AppError.badRequest('You are not an approver for this step');

  // Prevent duplicate vote
  const alreadyVoted = step.decisions.some((d) => d.user_id.equals(actorId));
  if (alreadyVoted) throw AppError.badRequest('You have already submitted a decision');

  step.decisions.push({ user_id: actorId, decision, comment, decided_at: new Date() });

  if (decision === 'rejected') {
    // Any rejection fails the whole step
    step.completed_at = new Date();
    cr.status = 'rejected';
    await cr.save();
    logger.info('Change request rejected', { changeId: id, by: actorId });
    publishChangeEvent('rejected', cr).catch(() => {});
    return cr;
  }

  // Count approvals
  const approvals = step.decisions.filter((d) => d.decision === 'approved').length;
  if (approvals >= step.required_approvals) {
    step.completed_at = new Date();

    // Advance to next step
    const nextStep = cr.approval_chain.find((s) => s.step === cr.current_step + 1);
    if (nextStep) {
      cr.current_step += 1;
      logger.info('Approval step completed, advancing', { changeId: id, nextStep: cr.current_step });
    } else {
      // All steps complete
      cr.status = 'approved';
      cr.current_step = 0;
      logger.info('Change request fully approved', { changeId: id });
      publishChangeEvent('approved', cr).catch(() => {});
    }
  }

  await cr.save();
  return cr;
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export async function scheduleChange(
  tenantId: Types.ObjectId,
  id: string,
  window: { start: string; end: string; timezone?: string }
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (!['approved', 'submitted'].includes(cr.status))
    throw AppError.badRequest(`Cannot schedule a change in status '${cr.status}'`);

  cr.implementation_window = {
    start: new Date(window.start),
    end:   new Date(window.end),
    timezone: window.timezone || 'UTC',
  };
  cr.status       = 'scheduled';
  cr.scheduled_at = new Date();

  // Re-run conflict detection
  const { warnings, freeze_conflict } = await detectConflicts(tenantId, cr.implementation_window, id, cr.affected_service_ids);
  cr.ai_conflict_warnings  = warnings;
  cr.freeze_window_conflict = freeze_conflict;

  await cr.save();
  logger.info('Change request scheduled', { changeId: id, window });
  publishChangeEvent('scheduled', cr).catch(() => {});
  return cr;
}

// ─── Start implementation ────────────────────────────────────────────────────

export async function implementChange(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  // emergency changes in 'submitted' can be implemented immediately (no approval chain)
  const canImplement = ['approved', 'scheduled'].includes(cr.status) ||
    (cr.type === 'emergency' && cr.status === 'submitted');
  if (!canImplement)
    throw AppError.badRequest(`Cannot implement a change in status '${cr.status}'`);

  cr.status         = 'in_progress';
  cr.implemented_at = new Date();

  await cr.save();
  logger.info('Change implementation started', { changeId: id, by: actorId });
  publishChangeEvent('in_progress', cr).catch(() => {});
  return cr;
}

// ─── Complete ────────────────────────────────────────────────────────────────

export async function completeChange(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (cr.status !== 'in_progress')
    throw AppError.badRequest(`Cannot complete a change in status '${cr.status}'`);

  cr.status       = 'completed';
  cr.completed_at = new Date();

  // Auto-create PIR for normal/emergency changes
  if (cr.type !== 'standard') {
    cr.pir = { status: 'pending', outcome: null, notes: null, reviewed_by: null, reviewed_at: null };
  }

  await cr.save();
  logger.info('Change request completed', { changeId: id });
  publishChangeEvent('completed', cr).catch(() => {});
  return cr;
}

// ─── Rollback ────────────────────────────────────────────────────────────────

export async function rollbackChange(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  reason: string
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (!['in_progress', 'completed'].includes(cr.status))
    throw AppError.badRequest(`Cannot rollback a change in status '${cr.status}'`);

  cr.status = 'rolled_back';

  // PIR required on rollback
  cr.pir = {
    status: 'pending',
    outcome: 'rolled_back',
    notes: reason || null,
    reviewed_by: null,
    reviewed_at: null,
  };

  await cr.save();
  logger.info('Change rolled back', { changeId: id, reason, by: actorId });
  publishChangeEvent('rolled_back', cr).catch(() => {});
  return cr;
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelChange(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (['completed', 'rolled_back', 'cancelled'].includes(cr.status))
    throw AppError.badRequest(`Cannot cancel a change in status '${cr.status}'`);

  cr.status       = 'cancelled';
  cr.cancelled_at = new Date();
  await cr.save();
  logger.info('Change request cancelled', { changeId: id, by: actorId });
  return cr;
}

// ─── PIR (Post-Implementation Review) ────────────────────────────────────────

export async function submitPir(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  input: { outcome: PirOutcome; notes?: string; waived?: boolean }
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  if (!['completed', 'rolled_back'].includes(cr.status))
    throw AppError.badRequest('PIR can only be submitted for completed or rolled-back changes');

  const now = new Date();
  cr.pir = {
    status:      input.waived ? 'waived' : 'completed',
    outcome:     input.outcome,
    notes:       input.notes || null,
    reviewed_by: actorId,
    reviewed_at: now,
  };

  await cr.save();
  logger.info('PIR submitted', { changeId: id, outcome: input.outcome, by: actorId });
  publishChangeEvent('pir_completed', cr, { outcome: input.outcome }).catch(() => {});
  return cr;
}


// ─── Notes ────────────────────────────────────────────────────────────────────

export async function addNote(
  tenantId: Types.ObjectId,
  id: string,
  actorId: Types.ObjectId,
  body: string,
  type: 'comment' | 'state_change' | 'discussion' = 'comment'
): Promise<ChangeRequestDocument> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId });
  if (!cr) throw AppError.notFound('Change request');
  (cr as any).notes.push({ user_id: actorId, body, type, created_at: new Date() });
  await cr.save();
  return cr;
}

export async function getNotes(
  tenantId: Types.ObjectId,
  id: string
): Promise<any[]> {
  const cr = await ChangeRequest.findOne({ _id: id, tenant_id: tenantId })
    .populate('notes.user_id', 'name email avatar_url');
  if (!cr) throw AppError.notFound('Change request');
  return (cr as any).notes || [];
}

// ─── Calendar view ────────────────────────────────────────────────────────────

export async function getCalendar(
  tenantId: Types.ObjectId,
  from: Date,
  to: Date
): Promise<ChangeRequestDocument[]> {
  return ChangeRequest.find({
    tenant_id: tenantId,
    status: { $in: ['approved', 'scheduled', 'in_progress', 'completed'] },
    'implementation_window.start': { $lt: to },
    'implementation_window.end':   { $gt: from },
  })
    .select('number title type status risk implementation_window created_by')
    .populate('created_by', 'name email')
    .sort({ 'implementation_window.start': 1 });
}
