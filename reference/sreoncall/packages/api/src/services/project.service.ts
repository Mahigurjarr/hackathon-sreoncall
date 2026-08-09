import { Project, IProject } from '../models/project.model';
import { BoardMember } from '../models/board-member.model';
import { AppError } from '../middleware/errorHandler.middleware';

export interface CreateProjectInput {
  name: string;
  description?: string;
  key?: string;
  color?: string;
  visibility?: 'org' | 'private';
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  key?: string;
  color?: string;
  visibility?: 'org' | 'private';
}

// Accent palette for project chips/dots. New projects round-robin through it
// (by existing project count) so adjacent projects get distinct colors.
export const PROJECT_COLORS = [
  '#2563EB', '#16A34A', '#7C3AED', '#DC2626',
  '#EA580C', '#0891B2', '#DB2777', '#CA8A04',
];

/** Derive a short uppercase base key from a project name. */
export function deriveProjectKeyBase(name: string): string {
  const cleaned = (name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  let base: string;
  if (words.length >= 2) {
    base = words.map((w) => w[0]).join('').slice(0, 5);
  } else {
    base = (words[0] || 'PRJ').slice(0, 4);
  }
  if (base.length < 2) base = (base + 'PRJ').slice(0, 3);
  return base;
}

/**
 * Build a per-tenant unique project key. Starts from the name-derived base and
 * appends an incrementing suffix on collision (INFRA, INFRA2, INFRA3, …).
 */
export async function generateUniqueProjectKey(
  tenantId: string,
  name: string,
  desired?: string,
): Promise<string> {
  const base = (desired && desired.trim())
    ? desired.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    : deriveProjectKeyBase(name);
  const safeBase = base || 'PRJ';

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? safeBase : `${safeBase}${attempt + 1}`.slice(0, 8);
    const exists = await Project.findOne({
      tenant_id: tenantId,
      key: candidate,
    }).lean();
    if (!exists) return candidate;
  }
  // Extremely unlikely fallback — keep it unique with a timestamp tail.
  return `${safeBase}${Date.now().toString(36).toUpperCase()}`.slice(0, 8);
}

export interface ListProjectsFilter {
  search?: string;
  limit?: number;
  cursor?: string;
  userId?: string;
}

export async function listProjects(tenantId: string, filter: ListProjectsFilter = {}) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId, deleted_at: null };

  if (filter.search) {
    query.$or = [
      { name: { $regex: filter.search, $options: 'i' } },
      { description: { $regex: filter.search, $options: 'i' } },
    ];
  }
  if (filter.cursor) {
    query._id = { $gt: filter.cursor };
  }

  if (filter.userId) {
    const memberBoardIds = await BoardMember.find({
      user_id: filter.userId,
      tenant_id: tenantId,
    }).distinct('board_id');

    const visibilityFilter = {
      $or: [
        { visibility: 'org' },
        { visibility: { $exists: false } },
        { _id: { $in: memberBoardIds }, visibility: 'private' },
      ],
    };

    if (query.$or) {
      query.$and = [{ $or: query.$or }, visibilityFilter];
      delete query.$or;
    } else {
      Object.assign(query, visibilityFilter);
    }
  }

  const docs = await Project.find(query).sort({ name: 1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  return {
    data,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?._id?.toString() ?? null : null,
      total: await Project.countDocuments({ tenant_id: tenantId, deleted_at: null }),
    },
  };
}

export async function getProjectById(tenantId: string, id: string) {
  const doc = await Project.findOne({ _id: id, tenant_id: tenantId, deleted_at: null }).lean();
  if (!doc) throw AppError.notFound('Project not found');
  return doc;
}

export async function createProject(tenantId: string, userId: string, input: CreateProjectInput) {
  const key = await generateUniqueProjectKey(tenantId, input.name, input.key);
  const count = await Project.countDocuments({ tenant_id: tenantId, deleted_at: null });
  const color = input.color || PROJECT_COLORS[count % PROJECT_COLORS.length];

  const doc = await Project.create({
    tenant_id: tenantId,
    created_by: userId,
    name: input.name,
    description: input.description ?? '',
    key,
    color,
    visibility: input.visibility ?? 'org',
  });
  return doc.toObject();
}

export async function updateProject(tenantId: string, id: string, input: UpdateProjectInput) {
  const update: Record<string, any> = { ...input };

  // Normalize + enforce per-tenant uniqueness when the key is being changed.
  if (input.key !== undefined) {
    const normalized = input.key.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!normalized) throw AppError.badRequest('Project key must contain letters or digits.');
    const clash = await Project.findOne({
      tenant_id: tenantId,
      key: normalized,
      _id: { $ne: id },
    }).lean();
    if (clash) throw AppError.conflict(`Project key "${normalized}" is already in use.`);
    update.key = normalized;
  }

  const doc = await Project.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: update },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Project not found');
  return doc;
}

export async function deleteProject(tenantId: string, id: string) {
  const doc = await Project.findOneAndUpdate(
    { _id: id, tenant_id: tenantId, deleted_at: null },
    { $set: { deleted_at: new Date() }, $unset: { key: '' } },
    { new: true },
  );
  if (!doc) throw AppError.notFound('Project not found');
}
