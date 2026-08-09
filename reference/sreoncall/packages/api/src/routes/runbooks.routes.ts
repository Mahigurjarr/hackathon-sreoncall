import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import * as runbookService from '../services/runbook.service';
import * as executionService from '../services/runbook-execution.service';
import { parsePaginationParams } from '../utils/pagination';

const router = Router();

// ─── Serializers ───────────────────────────────────────────────────────────────

function serializeAuthor(r: any) {
  // Support both created_by (new) and author_id (legacy)
  const raw = r.created_by ?? r.author_id;
  if (!raw || typeof raw === 'string' || raw._bsontype === 'ObjectId') {
    return { id: raw?.toString() || null, name: 'Unknown', email: '' };
  }
  return { id: raw._id?.toString() || null, name: raw.name || 'Unknown', email: raw.email || '' };
}

function serializeStep(s: any) {
  return {
    id:               s._id?.toString() || null,
    order:            s.order,
    title:            s.title,
    instructions:     s.instructions || '',
    type:             s.type || 'manual',
    requires_approval:s.requires_approval ?? false,
    approval_roles:   s.approval_roles || [],
    timeout_seconds:  s.timeout_seconds ?? 300,
    working_directory:s.working_directory || '',
    environment_vars: s.environment_vars || {},
    api_method:       s.api_method || 'GET',
    api_url:          s.api_url || '',
    api_headers:      s.api_headers || {},
    api_body:         s.api_body || '',
    attachments:      (s.attachments || []).map((a: any) => ({
      file_id: a.file_id, original_name: a.original_name, mime_type: a.mime_type, size_bytes: a.size_bytes,
    })),
  };
}

function serializeRunbook(r: any, requestTenantId?: string) {
  const isFromProvider = requestTenantId && r.tenant_id?.toString() !== requestTenantId;
  return {
    id:              r._id.toString(),
    title:           r.title,
    description:     r.description || '',
    content:         r.content || '',
    category:        r.category || 'general',
    status:          r.status || 'draft',
    visibility:      r.visibility || 'tenant',
    source:          isFromProvider ? 'provider' : 'own',
    source_tenant_id:r.source_tenant_id?.toString() || null,
    steps:           (r.steps || []).map(serializeStep),
    variables:       r.variables || [],
    tags:            r.tags || [],
    service_ids:     (r.service_ids || []).map((id: any) => id.toString()),
    author:          serializeAuthor(r),
    ai_generated:    r.ai_generated ?? false,
    version:         r.version ?? 1,
    stats: {
      executions:           r.stats?.executions ?? 0,
      successful:           r.stats?.successful ?? 0,
      failed:               r.stats?.failed ?? 0,
      avg_duration_seconds: r.stats?.avg_duration_seconds ?? null,
      last_executed_at:     r.stats?.last_executed_at ?? null,
    },
    version_history_count: (r.version_history || []).length,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function serializeExecution(e: any) {
  return {
    id:               e._id.toString(),
    runbook_id:       e.runbook_id.toString(),
    runbook_title:    e.runbook_title,
    runbook_version:  e.runbook_version,
    status:           e.status,
    triggered_by:     e.triggered_by?.toString() || null,
    triggered_by_incident_id: e.triggered_by_incident_id?.toString() || null,
    current_step:     e.current_step,
    steps_state: (e.steps_state || []).map((s: any) => ({
      id:               s._id?.toString() || null,
      step_id:          s.step_id,
      order:            s.order,
      title:            s.title,
      type:             s.type,
      requires_approval:s.requires_approval,
      status:           s.status,
      started_at:       s.started_at,
      completed_at:     s.completed_at,
      duration_ms:      s.duration_ms,
      output:           s.output || '',
      error:            s.error || null,
      approved_by:      s.approved_by?.toString() || null,
      approved_at:      s.approved_at,
      approval_comment: s.approval_comment,
    })),
    variables:      e.variables || {},
    started_at:     e.started_at,
    completed_at:   e.completed_at,
    duration_ms:    e.duration_ms,
    output_log:     e.output_log || [],
    created_at:     e.createdAt,
    updated_at:     e.updatedAt,
  };
}

// ─── Zod schemas ───────────────────────────────────────────────────────────────

const stepSchema = z.object({
  order:            z.number().int().min(0).optional(),
  title:            z.string().min(1).max(300),
  instructions:     z.string().max(50000).optional(),
  type:             z.enum(['manual', 'bash_script', 'api_call', 'ansible_playbook']).optional(),
  requires_approval:z.boolean().optional(),
  approval_roles:   z.array(z.string()).optional(),
  timeout_seconds:  z.number().int().min(1).optional(),
  working_directory:z.string().optional(),
  environment_vars: z.record(z.string()).optional(),
  api_method:       z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  api_url:          z.string().optional(),
  api_headers:      z.record(z.string()).optional(),
  api_body:         z.string().optional(),
  attachments:      z.array(z.object({
    file_id: z.string(), original_name: z.string(), mime_type: z.string(), size_bytes: z.number(),
  })).optional(),
});

const variableSchema = z.object({
  name:          z.string().min(1).max(100),
  default_value: z.string().optional(),
  description:   z.string().optional(),
  required:      z.boolean().optional(),
});

const createSchema = z.object({
  title:       z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  content:     z.string().max(200000).optional(),
  category:    z.string().max(100).optional(),
  steps:       z.array(stepSchema).optional(),
  variables:   z.array(variableSchema).optional(),
  tags:        z.array(z.string()).optional(),
  service_ids: z.array(z.string()).optional(),
  ai_generated:z.boolean().optional(),
});

const updateSchema = createSchema.partial().extend({
  status:      z.enum(['draft', 'published']).optional(),
  change_note: z.string().max(500).optional(),
});

const executeSchema = z.object({
  variables:   z.record(z.string()).optional(),
  incident_id: z.string().nullable().optional(),
});

// ─── Routes ────────────────────────────────────────────────────────────────────

// GET /api/v1/runbooks
router.get('/', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
  const tenantType = (req.tenant as any)?.type;
  const result = await runbookService.listRunbooks(
    {
      tenant_id:  req.tenantId,
      search:     req.query.search as string | undefined,
      tags,
      service_id: req.query.service_id as string | undefined,
      status:     req.query.status as string | undefined,
      category:   req.query.category as string | undefined,
    },
    pagination,
    tenantType,
  );
  res.json({ data: result.data.map((r) => serializeRunbook(r, req.tenantId.toString())), pagination: result.pagination });
});

// GET /api/v1/runbooks/:id
router.get('/:id', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const runbook = await runbookService.getRunbookById(req.tenantId, req.params['id'] as string);
  res.json(serializeRunbook(runbook));
});

// GET /api/v1/runbooks/:id/versions
router.get('/:id/versions', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const runbook = await runbookService.getRunbookById(req.tenantId, req.params['id'] as string);
  const history = (runbook.version_history || [])
    .slice()
    .reverse()   // newest first
    .map((v: any) => ({
      version:    v.version,
      title:      v.title,
      step_count: (v.steps || []).length,
      changed_by: v.changed_by?.toString() || null,
      changed_at: v.changed_at,
      change_note:v.change_note || '',
    }));
  res.json({ current_version: runbook.version, history });
});

// POST /api/v1/runbooks
router.post(
  '/',
  rbac('runbooks:create'),
  auditMiddleware({ action: 'runbook.create', resourceType: 'runbook' }),
  async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const runbook = await runbookService.createRunbook({
      ...body,
      tenant_id:  req.tenantId.toString(),
      created_by: req.userId.toString(),
    });
    res.status(201).json(serializeRunbook(runbook));
  },
);

// PATCH /api/v1/runbooks/:id
router.patch(
  '/:id',
  rbac('runbooks:update'),
  auditMiddleware({ action: 'runbook.update', resourceType: 'runbook', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);
    const runbook = await runbookService.updateRunbook(
      req.tenantId,
      req.params['id'] as string,
      body,
      req.userId,
    );
    res.json(serializeRunbook(runbook));
  },
);

// DELETE /api/v1/runbooks/:id
router.delete(
  '/:id',
  rbac('runbooks:delete'),
  auditMiddleware({ action: 'runbook.delete', resourceType: 'runbook', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    await runbookService.deleteRunbook(req.tenantId, req.params['id'] as string);
    res.status(204).send();
  },
);

// PATCH /api/v1/runbooks/:id/visibility — toggle sharing (provider only)
router.patch(
  '/:id/visibility',
  rbac('runbooks:update'),
  async (req: Request, res: Response) => {
    const visibilitySchema = z.object({
      visibility: z.enum(['tenant', 'provider_shared']),
    });
    const body = visibilitySchema.parse(req.body);
    const runbook = await runbookService.toggleVisibility(req.tenantId, req.params['id'] as string, body.visibility);
    res.json(serializeRunbook(runbook, req.tenantId.toString()));
  },
);

// POST /api/v1/runbooks/:id/execute
router.post(
  '/:id/execute',
  rbac('runbooks:create'),
  auditMiddleware({ action: 'runbook.execute', resourceType: 'runbook', getResourceId: (req) => req.params['id'] as string }),
  async (req: Request, res: Response) => {
    const body = executeSchema.parse(req.body);
    const execution = await executionService.startExecution(
      req.tenantId.toString(),
      req.params['id'] as string,
      req.userId.toString(),
      { variables: body.variables, incident_id: body.incident_id },
    );
    res.status(201).json(serializeExecution(execution));
  },
);

// GET /api/v1/runbooks/:id/executions
router.get('/:id/executions', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const executions = await executionService.listExecutions(req.tenantId.toString(), {
    runbook_id: req.params['id'] as string,
    status:     req.query.status as string | undefined,
    limit:      req.query.limit ? Number(req.query.limit) : 20,
  });
  res.json({ data: executions.map(serializeExecution) });
});

export { serializeExecution };
export default router;
