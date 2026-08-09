import { Types } from 'mongoose';
import { Sprint } from '../models/sprint.model';
import { Ticket } from '../models/ticket.model';
import { AppError } from '../middleware/errorHandler.middleware';

export interface CreateSprintInput {
  name: string;
  project_id?: string | null;
  start_date: string;
  end_date: string;
}

export interface UpdateSprintInput {
  name?: string;
  project_id?: string | null;
  start_date?: string;
  end_date?: string;
  status?: 'planning' | 'active' | 'completed';
}

export async function listSprints(tenantId: string, filter: { project_id?: string; status?: string } = {}) {
  const query: any = { tenant_id: tenantId, deleted_at: null };
  if (filter.project_id) query.project_id = new Types.ObjectId(filter.project_id);
  if (filter.status) query.status = filter.status;
  return Sprint.find(query).sort({ start_date: -1 }).lean();
}

export async function getSprintById(tenantId: string, id: string) {
  const doc = await Sprint.findOne({ _id: id, tenant_id: tenantId, deleted_at: null }).lean();
  if (!doc) throw AppError.notFound('Sprint not found');
  return doc;
}

export async function createSprint(tenantId: string, userId: string, input: CreateSprintInput) {
  const startDate = new Date(input.start_date);
  const endDate = new Date(input.end_date);
  if (endDate <= startDate) throw AppError.badRequest('end_date must be after start_date');

  const doc = await Sprint.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    project_id: input.project_id ? new Types.ObjectId(input.project_id) : null,
    start_date: startDate,
    end_date: endDate,
    status: 'planning',
  });
  return doc.toObject();
}

export async function updateSprint(tenantId: string, id: string, input: UpdateSprintInput) {
  const update: Record<string, any> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.project_id !== undefined) update.project_id = input.project_id ? new Types.ObjectId(input.project_id) : null;
  if (input.start_date !== undefined) update.start_date = new Date(input.start_date);
  if (input.end_date !== undefined) update.end_date = new Date(input.end_date);
  if (input.status !== undefined) update.status = input.status;

  const doc = await Sprint.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: update },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Sprint not found');
  return doc;
}

export async function deleteSprint(tenantId: string, id: string) {
  const sprint = await Sprint.findOne({ _id: id, tenant_id: tenantId, deleted_at: null }).lean();
  if (!sprint) throw AppError.notFound('Sprint not found');
  if (sprint.status !== 'planning') throw AppError.badRequest('Only sprints in planning status can be deleted');

  await Sprint.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: { deleted_at: new Date() } },
  );

  // Unassign all tickets from this sprint
  await Ticket.updateMany(
    { tenant_id: tenantId, sprint_id: new Types.ObjectId(id) },
    { $set: { sprint_id: null } },
  );
}

export async function assignTicketsToSprint(tenantId: string, sprintId: string, ticketIds: string[]) {
  const sprint = await Sprint.findOne({ _id: sprintId, tenant_id: tenantId, deleted_at: null }).lean();
  if (!sprint) throw AppError.notFound('Sprint not found');

  await Ticket.updateMany(
    { _id: { $in: ticketIds.map((id) => new Types.ObjectId(id)) }, tenant_id: tenantId },
    { $set: { sprint_id: new Types.ObjectId(sprintId) } },
  );
}

export async function removeTicketsFromSprint(tenantId: string, sprintId: string, ticketIds: string[]) {
  const sprint = await Sprint.findOne({ _id: sprintId, tenant_id: tenantId, deleted_at: null }).lean();
  if (!sprint) throw AppError.notFound('Sprint not found');

  await Ticket.updateMany(
    { _id: { $in: ticketIds.map((id) => new Types.ObjectId(id)) }, tenant_id: tenantId, sprint_id: new Types.ObjectId(sprintId) },
    { $set: { sprint_id: null } },
  );
}

export async function getSprintTickets(tenantId: string, sprintId: string) {
  const sprint = await Sprint.findOne({ _id: sprintId, tenant_id: tenantId, deleted_at: null }).lean();
  if (!sprint) throw AppError.notFound('Sprint not found');

  return Ticket.find({ tenant_id: tenantId, sprint_id: new Types.ObjectId(sprintId) })
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url')
    .lean();
}

export async function getSprintProgress(tenantId: string, sprintId: string) {
  const sprint = await Sprint.findOne({ _id: sprintId, tenant_id: tenantId, deleted_at: null }).lean();
  if (!sprint) throw AppError.notFound('Sprint not found');

  const agg = await Ticket.aggregate([
    {
      $match: {
        tenant_id: new Types.ObjectId(tenantId),
        sprint_id: new Types.ObjectId(sprintId),
        deleted_at: { $eq: null },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed', 'done']] }, 1, 0] } },
      },
    },
  ]);

  const stats = agg[0] || { total: 0, done: 0 };
  return {
    total_tickets: stats.total,
    completed_tickets: stats.done,
    pct_complete: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
  };
}
