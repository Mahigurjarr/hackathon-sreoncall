import { Types } from 'mongoose';
import { Runbook, RunbookDocument, RunbookStep } from '../models/runbook.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import {
  PaginationParams,
  PaginatedResult,
  buildCursorFilter,
  paginateResults,
} from '../utils/pagination';
import { AppError } from '../middleware/errorHandler.middleware';

const MAX_VERSION_HISTORY = 20;

// ─── Serializer helper ─────────────────────────────────────────────────────────

export function authorId(r: RunbookDocument): Types.ObjectId | null {
  return (r.created_by || r.author_id) ?? null;
}

// ─── List / Get ───────────────────────────────────────────────────────────────

interface RunbookFilter {
  tenant_id: Types.ObjectId | string;
  search?: string;
  tags?: string[];
  service_id?: string;
  status?: string;
  category?: string;
}

export async function listRunbooks(
  filter: RunbookFilter,
  pagination: PaginationParams,
  tenantType?: string,
): Promise<PaginatedResult<RunbookDocument>> {
  const baseFilter: Record<string, any> = { tenant_id: filter.tenant_id };
  if (filter.tags?.length) baseFilter.tags = { $in: filter.tags };
  if (filter.service_id) baseFilter.service_ids = new Types.ObjectId(filter.service_id);
  if (filter.status) baseFilter.status = filter.status;
  if (filter.category) baseFilter.category = filter.category;
  if (filter.search) baseFilter.$text = { $search: filter.search };

  const paginationWithDefaults = { ...pagination, sort_by: pagination.sort_by || 'created_at' };

  // For consumer tenants, also include provider's shared runbooks
  let providerRunbooks: any[] = [];
  if (tenantType === 'consumer') {
    const link = await ProviderConsumerLink.findOne({
      consumer_tenant_id: new Types.ObjectId(filter.tenant_id.toString()),
      status: 'active',
    });
    if (link && link.scope.includes('runbooks')) {
      providerRunbooks = await Runbook.find({
        tenant_id: link.provider_tenant_id,
        visibility: 'provider_shared',
        status: 'published',
      })
        .populate('created_by', 'name email')
        .populate('author_id', 'name email')
        .sort({ created_at: -1 })
        .limit(50);
    }
  }

  const { filter: cursorFilter, sort } = buildCursorFilter(paginationWithDefaults, baseFilter);

  const results = await Runbook.find(cursorFilter)
    .populate('created_by', 'name email')
    .populate('author_id', 'name email')
    .sort(sort)
    .limit(pagination.limit + 1);

  const total = await Runbook.countDocuments(baseFilter);
  const paginatedResult = paginateResults(results, paginationWithDefaults, total);

  // Append provider runbooks at the end (if consumer tenant and first page)
  if (providerRunbooks.length > 0 && !pagination.cursor) {
    paginatedResult.data = [...paginatedResult.data, ...providerRunbooks];
  }

  return paginatedResult;
}

export async function toggleVisibility(
  tenantId: Types.ObjectId | string,
  runbookId: string,
  visibility: 'tenant' | 'provider_shared',
): Promise<RunbookDocument> {
  const runbook = await Runbook.findOne({ _id: runbookId, tenant_id: tenantId });
  if (!runbook) throw AppError.notFound('Runbook not found');
  runbook.visibility = visibility;
  await runbook.save();
  return runbook;
}

export async function getRunbookById(
  tenantId: Types.ObjectId | string,
  id: string,
): Promise<RunbookDocument> {
  const runbook = await Runbook.findOne({ _id: id, tenant_id: tenantId })
    .populate('created_by', 'name email')
    .populate('author_id', 'name email');
  if (!runbook) throw AppError.notFound('Runbook not found');
  return runbook;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createRunbook(input: {
  tenant_id: Types.ObjectId | string;
  created_by: Types.ObjectId | string;
  title: string;
  description?: string;
  content?: string;
  category?: string;
  steps?: Array<{
    order?: number;
    title: string;
    instructions?: string;
    type?: string;
    requires_approval?: boolean;
    approval_roles?: string[];
    timeout_seconds?: number;
    working_directory?: string;
    environment_vars?: Record<string, string>;
    api_method?: string;
    api_url?: string;
    api_headers?: Record<string, string>;
    api_body?: string;
  }>;
  variables?: Array<{ name: string; default_value?: string; description?: string; required?: boolean }>;
  tags?: string[];
  service_ids?: string[];
  ai_generated?: boolean;
}): Promise<RunbookDocument> {
  const steps = (input.steps ?? []).map((s, i) => ({
    order:              s.order ?? i,
    title:              s.title,
    instructions:       s.instructions || '',
    type:               s.type || 'manual',
    requires_approval:  s.requires_approval ?? false,
    approval_roles:     s.approval_roles ?? [],
    timeout_seconds:    s.timeout_seconds ?? 300,
    working_directory:  s.working_directory ?? '',
    environment_vars:   s.environment_vars ?? {},
    api_method:         s.api_method ?? 'GET',
    api_url:            s.api_url ?? '',
    api_headers:        s.api_headers ?? {},
    api_body:           s.api_body ?? '',
  }));

  return Runbook.create({
    tenant_id:   input.tenant_id,
    created_by:  input.created_by,
    title:       input.title,
    description: input.description || '',
    content:     input.content || '',
    category:    input.category || 'general',
    status:      'draft',
    steps,
    variables:   input.variables ?? [],
    tags:        input.tags ?? [],
    service_ids: (input.service_ids ?? []).map((id) => new Types.ObjectId(id)),
    ai_generated:input.ai_generated ?? false,
    version:     1,
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateRunbook(
  tenantId: Types.ObjectId | string,
  id: string,
  update: Partial<{
    title: string;
    description: string;
    content: string;
    category: string;
    status: 'draft' | 'published';
    steps: any[];
    variables: any[];
    tags: string[];
    service_ids: string[];
    change_note: string;
  }>,
  updatedBy?: Types.ObjectId | string,
): Promise<RunbookDocument> {
  const runbook = await Runbook.findOne({ _id: id, tenant_id: tenantId });
  if (!runbook) throw AppError.notFound('Runbook not found');

  // Snapshot current version before changing
  if ((update.steps !== undefined || update.title !== undefined) && updatedBy) {
    const snapshot = {
      version:    runbook.version,
      title:      runbook.title,
      description:runbook.description,
      steps:      runbook.steps.map((s) => ({ ...(s as any).toObject ? (s as any).toObject() : s })),
      changed_by: new Types.ObjectId(updatedBy.toString()),
      changed_at: new Date(),
      change_note:update.change_note || '',
    };
    runbook.version_history.push(snapshot as any);
    // Keep last MAX_VERSION_HISTORY snapshots
    if (runbook.version_history.length > MAX_VERSION_HISTORY) {
      runbook.version_history = runbook.version_history.slice(-MAX_VERSION_HISTORY) as any;
    }
    runbook.version = runbook.version + 1;
  }

  if (update.title       !== undefined) runbook.title       = update.title;
  if (update.description !== undefined) runbook.description = update.description;
  if (update.content     !== undefined) runbook.content     = update.content;
  if (update.category    !== undefined) runbook.category    = update.category;
  if (update.status      !== undefined) runbook.status      = update.status;
  if (update.tags        !== undefined) runbook.tags        = update.tags;
  if (update.service_ids !== undefined) {
    runbook.service_ids = update.service_ids.map((sid) => new Types.ObjectId(sid)) as any;
  }
  if (update.variables !== undefined) runbook.variables = update.variables as any;

  if (update.steps !== undefined) {
    runbook.steps = update.steps.map((s: any, i: number) => ({
      order:              s.order ?? i,
      title:              s.title,
      instructions:       s.instructions || '',
      type:               s.type || 'manual',
      requires_approval:  s.requires_approval ?? false,
      approval_roles:     s.approval_roles ?? [],
      timeout_seconds:    s.timeout_seconds ?? 300,
      working_directory:  s.working_directory ?? '',
      environment_vars:   s.environment_vars ?? {},
      api_method:         s.api_method ?? 'GET',
      api_url:            s.api_url ?? '',
      api_headers:        s.api_headers ?? {},
      api_body:           s.api_body ?? '',
    })) as any;
  }

  await runbook.save();
  return runbook;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteRunbook(
  tenantId: Types.ObjectId | string,
  id: string,
): Promise<void> {
  const result = await Runbook.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Runbook not found');
}

// ─── Stats update (called by execution service) ────────────────────────────────

export async function updateStats(
  tenantId: Types.ObjectId | string,
  runbookId: string,
  outcomeSuccess: boolean,
  durationMs: number,
): Promise<void> {
  const runbook = await Runbook.findOne({ _id: runbookId, tenant_id: tenantId });
  if (!runbook) return;

  const s = runbook.stats;
  s.executions = (s.executions || 0) + 1;
  if (outcomeSuccess) {
    s.successful = (s.successful || 0) + 1;
  } else {
    s.failed = (s.failed || 0) + 1;
  }

  const durationSecs = durationMs / 1000;
  const prevAvg = s.avg_duration_seconds ?? durationSecs;
  const n = s.executions;
  s.avg_duration_seconds = parseFloat(
    ((prevAvg * (n - 1) + durationSecs) / n).toFixed(1),
  );
  s.last_executed_at = new Date();

  await runbook.save();
}
