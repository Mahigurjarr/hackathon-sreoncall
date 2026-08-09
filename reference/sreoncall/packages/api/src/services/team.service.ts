import { Types } from 'mongoose';
import { Team, TeamDocument } from '../models/team.model';
import { PaginationParams, PaginatedResult, buildCursorFilter, paginateResults } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';

const TEAM_POPULATES = [
  { path: 'members', select: 'name email' },
  { path: 'team_lead', select: 'name email' },
  { path: 'manager', select: 'name email' },
  { path: 'created_by', select: 'name email' },
];

export async function listTeams(
  tenantId: Types.ObjectId,
  pagination: PaginationParams
): Promise<PaginatedResult<TeamDocument>> {
  const baseFilter = { tenant_id: tenantId };
  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'created_at' };
  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);
  let query = Team.find(cursorFilter);
  for (const pop of TEAM_POPULATES) query = query.populate(pop.path, pop.select);
  const results = await query.sort(sort).limit(pagination.limit + 1);
  const total = await Team.countDocuments(baseFilter);
  return paginateResults(results, paginationWithDefaults, total);
}

export async function getTeamById(tenantId: Types.ObjectId, id: string): Promise<TeamDocument> {
  let query = Team.findOne({ _id: id, tenant_id: tenantId });
  for (const pop of TEAM_POPULATES) query = query.populate(pop.path, pop.select);
  const team = await query;
  if (!team) throw AppError.notFound('Team not found');
  return team;
}

export async function createTeam(input: {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  name: string;
  description?: string;
  members?: string[];
  team_lead?: string | null;
  manager?: string | null;
}): Promise<TeamDocument> {
  return Team.create({
    tenant_id: input.tenant_id,
    name: input.name,
    description: input.description || '',
    members: (input.members ?? []).map((id) => new Types.ObjectId(id)),
    team_lead: input.team_lead ? new Types.ObjectId(input.team_lead) : null,
    manager: input.manager ? new Types.ObjectId(input.manager) : null,
    created_by: input.created_by,
  });
}

export async function updateTeam(
  tenantId: Types.ObjectId,
  id: string,
  update: Partial<{
    name: string;
    description: string;
    members: string[];
    team_lead: string | null;
    manager: string | null;
  }>
): Promise<TeamDocument> {
  const team = await Team.findOne({ _id: id, tenant_id: tenantId });
  if (!team) throw AppError.notFound('Team not found');
  if (update.name !== undefined) team.name = update.name;
  if (update.description !== undefined) team.description = update.description;
  if (update.members !== undefined) {
    team.members = update.members.map((uid) => new Types.ObjectId(uid)) as any;
  }
  if (update.team_lead !== undefined) {
    team.team_lead = update.team_lead ? new Types.ObjectId(update.team_lead) : null;
  }
  if (update.manager !== undefined) {
    team.manager = update.manager ? new Types.ObjectId(update.manager) : null;
  }
  await team.save();
  return team;
}

export async function addMember(tenantId: Types.ObjectId, id: string, userId: string): Promise<TeamDocument> {
  const team = await Team.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $addToSet: { members: new Types.ObjectId(userId) } },
    { new: true }
  ).populate('members', 'name email');
  if (!team) throw AppError.notFound('Team not found');
  return team;
}

export async function removeMember(tenantId: Types.ObjectId, id: string, userId: string): Promise<TeamDocument> {
  const team = await Team.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $pull: { members: new Types.ObjectId(userId) } },
    { new: true }
  ).populate('members', 'name email');
  if (!team) throw AppError.notFound('Team not found');
  return team;
}

export async function deleteTeam(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await Team.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Team not found');
}

export async function checkMemberConflicts(
  tenantId: Types.ObjectId,
  userIds: string[],
  excludeTeamId?: string,
): Promise<Array<{ user_id: string; user_name: string; team_id: string; team_name: string }>> {
  const filter: Record<string, unknown> = {
    tenant_id: tenantId,
    members: { $in: userIds.map((id) => new Types.ObjectId(id)) },
  };
  if (excludeTeamId) {
    filter['_id'] = { $ne: new Types.ObjectId(excludeTeamId) };
  }
  const teams = await Team.find(filter).populate('members', 'name email').lean();
  const conflicts: Array<{ user_id: string; user_name: string; team_id: string; team_name: string }> = [];
  const userIdSet = new Set(userIds);
  for (const team of teams) {
    for (const member of team.members) {
      const memberId = member.toString();
      if (userIdSet.has(memberId)) {
        const populated = member as any;
        conflicts.push({
          user_id: memberId,
          user_name: populated.name || 'Unknown',
          team_id: team._id.toString(),
          team_name: team.name,
        });
      }
    }
  }
  return conflicts;
}
