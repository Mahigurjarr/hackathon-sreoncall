import { Types } from 'mongoose';
import { Milestone, MilestoneDocument } from '../models/milestone.model';
import { Ticket } from '../models/ticket.model';
import { WorkLog } from '../models/work-log.model';
import { AppError } from '../middleware/errorHandler.middleware';

export interface CreateMilestoneInput {
  name: string;
  description?: string;
  project_id?: string | null;
  status?: 'planned' | 'active' | 'completed' | 'cancelled';
  start_date: string;
  target_date: string;
}

export interface UpdateMilestoneInput {
  name?: string;
  description?: string;
  project_id?: string | null;
  status?: 'planned' | 'active' | 'completed' | 'cancelled';
  start_date?: string;
  target_date?: string;
}

export interface ListMilestonesFilter {
  project_id?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface MilestoneProgress {
  total_tickets: number;
  completed_tickets: number;
  pct_complete: number;
  estimated_hours: number;
  actual_hours: number;
  overdue: boolean;
}

export async function listMilestones(tenantId: string, filter: ListMilestonesFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId, deleted_at: null };

  if (filter.project_id) {
    query.project_id = new Types.ObjectId(filter.project_id);
  }
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.cursor) {
    query._id = { $gt: filter.cursor };
  }

  const docs = await Milestone.find(query).sort({ target_date: 1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await Milestone.countDocuments({ tenant_id: tenantId, deleted_at: null }),
    },
  };
}

export async function getMilestoneById(tenantId: string, id: string) {
  const doc = await Milestone.findOne({ _id: id, tenant_id: tenantId, deleted_at: null }).lean();
  if (!doc) throw AppError.notFound('Milestone not found');
  return doc;
}

export async function createMilestone(tenantId: string, userId: string, input: CreateMilestoneInput) {
  const startDate = new Date(input.start_date);
  const targetDate = new Date(input.target_date);

  if (targetDate <= startDate) {
    throw AppError.badRequest('target_date must be after start_date');
  }

  const doc = await Milestone.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    description: input.description ?? '',
    project_id: input.project_id ? new Types.ObjectId(input.project_id) : null,
    status: input.status ?? 'planned',
    start_date: startDate,
    target_date: targetDate,
  });
  return doc.toObject();
}

export async function updateMilestone(tenantId: string, id: string, input: UpdateMilestoneInput) {
  const update: Record<string, any> = {};

  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.project_id !== undefined) {
    update.project_id = input.project_id ? new Types.ObjectId(input.project_id) : null;
  }
  if (input.start_date !== undefined) update.start_date = new Date(input.start_date);
  if (input.target_date !== undefined) update.target_date = new Date(input.target_date);
  if (input.status !== undefined) {
    update.status = input.status;
    if (input.status === 'completed') {
      update.completed_at = new Date();
    }
  }

  const doc = await Milestone.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: update },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Milestone not found');
  return doc;
}

export async function deleteMilestone(tenantId: string, id: string) {
  const doc = await Milestone.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: { deleted_at: new Date() } },
    { new: true },
  );
  if (!doc) throw AppError.notFound('Milestone not found');
}

export async function getMilestoneProgress(tenantId: string, milestoneId: string): Promise<MilestoneProgress> {
  const milestone = await Milestone.findOne({ _id: milestoneId, tenant_id: tenantId, deleted_at: null }).lean();
  if (!milestone) throw AppError.notFound('Milestone not found');

  const tenantOid = new Types.ObjectId(tenantId);
  const milestoneOid = new Types.ObjectId(milestoneId);

  // Aggregate ticket stats
  const ticketAgg = await Ticket.aggregate([
    { $match: { tenant_id: tenantOid, milestone_id: milestoneOid, deleted_at: { $eq: null } } },
    {
      $group: {
        _id: null,
        total_tickets: { $sum: 1 },
        completed_tickets: {
          $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed', 'done']] }, 1, 0] },
        },
        estimated_minutes: { $sum: { $ifNull: ['$time_estimate_minutes', 0] } },
      },
    },
  ]);

  const stats = ticketAgg[0] || { total_tickets: 0, completed_tickets: 0, estimated_minutes: 0 };

  // Get ticket IDs for work log query
  const ticketIds = await Ticket.find(
    { tenant_id: tenantOid, milestone_id: milestoneOid, deleted_at: { $eq: null } },
    { _id: 1 },
  ).lean();
  const ticketIdList = ticketIds.map((t) => t._id);

  // Sum approved work log minutes
  let actualMinutes = 0;
  if (ticketIdList.length > 0) {
    const workLogAgg = await WorkLog.aggregate([
      {
        $match: {
          tenant_id: tenantOid,
          entity_type: 'ticket',
          entity_id: { $in: ticketIdList },
          status: 'approved',
        },
      },
      { $group: { _id: null, total: { $sum: '$duration_minutes' } } },
    ]);
    actualMinutes = workLogAgg[0]?.total ?? 0;
  }

  const pctComplete = stats.total_tickets > 0
    ? Math.round((stats.completed_tickets / stats.total_tickets) * 100)
    : 0;

  const overdue = milestone.status !== 'completed' &&
    milestone.status !== 'cancelled' &&
    new Date() > milestone.target_date;

  return {
    total_tickets: stats.total_tickets,
    completed_tickets: stats.completed_tickets,
    pct_complete: pctComplete,
    estimated_hours: Math.round((stats.estimated_minutes / 60) * 100) / 100,
    actual_hours: Math.round((actualMinutes / 60) * 100) / 100,
    overdue,
  };
}
