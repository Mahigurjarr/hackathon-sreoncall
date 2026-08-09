import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import { ValidationSuite } from '../models/validation-suite.model';
import * as validationSuiteService from '../services/validation-suite.service';
import { assertUrlSafe, assertHostSafe } from '../utils/ssrf-guard';

const router = Router();

const checkSchema = z.object({
  name:   z.string().min(1).max(200),
  type:   z.enum(['http', 'tcp', 'custom_script']),
  config: z.object({
    url:                    z.string().url().optional().nullable(),
    method:                 z.string().optional().nullable(),
    headers:                z.record(z.string()).optional().nullable(),
    expected_status:        z.number().int().optional().nullable(),
    expected_body_contains: z.string().optional().nullable(),
    timeout_ms:             z.number().int().positive().optional().nullable(),
    host:                   z.string().optional().nullable(),
    port:                   z.number().int().positive().optional().nullable(),
    webhook_url:            z.string().url().optional().nullable(),
  }).optional().default({}),
  order: z.number().int().min(0).optional(),
});

// GET /api/v1/validation-suites
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const suites = await validationSuiteService.list(req.tenantId.toString(), {
    service_id: req.query.service_id as string | undefined,
    trigger:    req.query.trigger as string | undefined,
    limit:      req.query.limit ? Number(req.query.limit) : 50,
  });
  res.json({ data: suites });
});

// POST /api/v1/validation-suites
router.post('/', rbac('incidents:update'), requirePlanLimit('validation_suites_max', async (req) => {
  return ValidationSuite.countDocuments({ tenant_id: req.tenantId });
}), async (req: Request, res: Response) => {
  const body = z.object({
    name:        z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    service_ids: z.array(z.string()).optional(),
    checks:      z.array(checkSchema).optional(),
    trigger:     z.enum(['manual', 'on_resolution', 'both']).optional(),
  }).parse(req.body);

  // SSRF protection: validate all user-provided URLs before persisting
  if (body.checks) {
    for (const check of body.checks) {
      if (check.config?.url) await assertUrlSafe(check.config.url);
      if (check.config?.webhook_url) await assertUrlSafe(check.config.webhook_url);
      if (check.config?.host) await assertHostSafe(check.config.host, check.config.port);
    }
  }

  const suite = await validationSuiteService.create(
    req.tenantId.toString(),
    req.userId.toString(),
    body,
  );
  res.status(201).json({ data: suite.toObject() });
});

// GET /api/v1/validation-suites/:id
router.get('/:id', rbac('incidents:read'), async (req: Request, res: Response) => {
  const suite = await validationSuiteService.getById(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json({ data: suite.toObject() });
});

// PATCH /api/v1/validation-suites/:id
router.patch('/:id', rbac('incidents:update'), async (req: Request, res: Response) => {
  const body = z.object({
    name:        z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    service_ids: z.array(z.string()).optional(),
    checks:      z.array(checkSchema).optional(),
    trigger:     z.enum(['manual', 'on_resolution', 'both']).optional(),
  }).parse(req.body);

  // SSRF protection: validate all user-provided URLs before persisting
  if (body.checks) {
    for (const check of body.checks) {
      if (check.config?.url) await assertUrlSafe(check.config.url);
      if (check.config?.webhook_url) await assertUrlSafe(check.config.webhook_url);
      if (check.config?.host) await assertHostSafe(check.config.host, check.config.port);
    }
  }

  const suite = await validationSuiteService.update(
    req.tenantId.toString(),
    req.params['id'] as string,
    body,
  );
  res.json({ data: suite.toObject() });
});

// DELETE /api/v1/validation-suites/:id
router.delete('/:id', rbac('incidents:update'), async (req: Request, res: Response) => {
  await validationSuiteService.remove(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.status(204).send();
});

// POST /api/v1/validation-suites/:id/run
router.post('/:id/run', rbac('incidents:update'), async (req: Request, res: Response) => {
  const result = await validationSuiteService.run(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json({ data: result });
});

export default router;
