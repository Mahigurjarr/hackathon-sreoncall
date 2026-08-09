import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as executionService from '../services/runbook-execution.service';
import { serializeExecution } from './runbooks.routes';

const router = Router();

// GET /api/v1/runbook-executions
router.get('/', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const executions = await executionService.listExecutions(req.tenantId.toString(), {
    runbook_id: req.query.runbook_id as string | undefined,
    status:     req.query.status as string | undefined,
    limit:      req.query.limit ? Number(req.query.limit) : 50,
  });
  res.json({ data: executions.map(serializeExecution) });
});

// GET /api/v1/runbook-executions/:id
router.get('/:id', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const execution = await executionService.getExecutionById(
    req.tenantId.toString(),
    req.params['id'] as string,
  );
  res.json(serializeExecution(execution));
});

// POST /api/v1/runbook-executions/:id/steps/:stepIdx/complete  — manual step
router.post(
  '/:id/steps/:stepIdx/complete',
  rbac('runbooks:update'),
  async (req: Request, res: Response) => {
    const stepIdx = parseInt(req.params['stepIdx'] as string, 10);
    if (isNaN(stepIdx) || stepIdx < 0) {
      res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'Invalid step index' });
      return;
    }
    const body = z.object({ output: z.string().optional() }).parse(req.body);
    const execution = await executionService.completeManualStep(
      req.tenantId.toString(),
      req.params['id'] as string,
      stepIdx,
      { output: body.output, operator_id: req.userId.toString() },
    );
    res.json(serializeExecution(execution));
  },
);

// POST /api/v1/runbook-executions/:id/steps/:stepIdx/approve  — approval gate
router.post(
  '/:id/steps/:stepIdx/approve',
  rbac('runbooks:update'),
  async (req: Request, res: Response) => {
    const stepIdx = parseInt(req.params['stepIdx'] as string, 10);
    if (isNaN(stepIdx) || stepIdx < 0) {
      res.status(400).json({ type: 'https://sreoncall.io/problems/bad-request', title: 'Bad Request', status: 400, detail: 'Invalid step index' });
      return;
    }
    const body = z.object({
      decision: z.enum(['approved', 'rejected']),
      comment:  z.string().max(1000).optional(),
    }).parse(req.body);
    const execution = await executionService.approveStep(
      req.tenantId.toString(),
      req.params['id'] as string,
      stepIdx,
      { user_id: req.userId.toString(), decision: body.decision, comment: body.comment },
    );
    res.json(serializeExecution(execution));
  },
);

// POST /api/v1/runbook-executions/:id/cancel
router.post(
  '/:id/cancel',
  rbac('runbooks:update'),
  async (req: Request, res: Response) => {
    const execution = await executionService.cancelExecution(
      req.tenantId.toString(),
      req.params['id'] as string,
      req.userId.toString(),
    );
    res.json(serializeExecution(execution));
  },
);

export default router;
