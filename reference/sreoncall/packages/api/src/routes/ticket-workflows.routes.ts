import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TicketWorkflow } from '../models/ticket-workflow.model';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { AppError } from '../middleware/errorHandler.middleware';

const router = Router();

const stateSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(['todo', 'in_progress', 'done']),
  color: z.string().default('#6B7280'),
  is_initial: z.boolean().default(false),
  is_terminal: z.boolean().default(false),
});

const transitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  allowed_roles: z.array(z.string()).default([]),
  requires_comment: z.boolean().default(false),
});

const createWorkflowSchema = z.object({
  ticket_type: z.string().min(1),
  states: z.array(stateSchema).min(1),
  transitions: z.array(transitionSchema).min(1),
});

const updateWorkflowSchema = z.object({
  states: z.array(stateSchema).min(1).optional(),
  transitions: z.array(transitionSchema).min(1).optional(),
});

// GET /api/v1/ticket-workflows
router.get('/', rbac('workflows:read'), async (req: Request, res: Response) => {
  const workflows = await TicketWorkflow.find({ tenant_id: req.tenantId });
  res.json({ data: workflows });
});

// GET /api/v1/ticket-workflows/:id
router.get('/:id', rbac('workflows:read'), async (req: Request, res: Response) => {
  const workflow = await TicketWorkflow.findOne({
    _id: req.params.id as string,
    tenant_id: req.tenantId,
  });
  if (!workflow) {
    throw AppError.notFound('Workflow');
  }
  res.json(workflow);
});

// POST /api/v1/ticket-workflows
router.post(
  '/',
  rbac('workflows:create'),
  auditMiddleware({ action: 'workflow.create', resourceType: 'ticket_workflow' }),
  async (req: Request, res: Response) => {
    const body = createWorkflowSchema.parse(req.body);

    // Validate: exactly one initial state
    const initialStates = body.states.filter((s) => s.is_initial);
    if (initialStates.length !== 1) {
      throw AppError.badRequest('Workflow must have exactly one initial state.');
    }

    // Validate: at least one terminal state
    const terminalStates = body.states.filter((s) => s.is_terminal);
    if (terminalStates.length === 0) {
      throw AppError.badRequest('Workflow must have at least one terminal state.');
    }

    // Validate: all transition states exist
    const stateNames = new Set(body.states.map((s) => s.name));
    for (const transition of body.transitions) {
      if (!stateNames.has(transition.from)) {
        throw AppError.badRequest(`Transition references unknown state: "${transition.from}"`);
      }
      if (!stateNames.has(transition.to)) {
        throw AppError.badRequest(`Transition references unknown state: "${transition.to}"`);
      }
    }

    const workflow = await TicketWorkflow.create({
      tenant_id: req.tenantId,
      ticket_type: body.ticket_type,
      states: body.states,
      transitions: body.transitions,
    });

    res.status(201).json(workflow);
  }
);

// PATCH /api/v1/ticket-workflows/:id
router.patch(
  '/:id',
  rbac('workflows:update'),
  auditMiddleware({
    action: 'workflow.update',
    resourceType: 'ticket_workflow',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const body = updateWorkflowSchema.parse(req.body);

    const workflow = await TicketWorkflow.findOne({
      _id: req.params.id as string,
      tenant_id: req.tenantId,
    });
    if (!workflow) {
      throw AppError.notFound('Workflow');
    }

    if (body.states) {
      const initialStates = body.states.filter((s) => s.is_initial);
      if (initialStates.length !== 1) {
        throw AppError.badRequest('Workflow must have exactly one initial state.');
      }
      workflow.states = body.states as any;
    }

    if (body.transitions) {
      const stateNames = new Set((body.states || workflow.states).map((s) => s.name));
      for (const transition of body.transitions) {
        if (!stateNames.has(transition.from) || !stateNames.has(transition.to)) {
          throw AppError.badRequest('Transition references unknown state.');
        }
      }
      workflow.transitions = body.transitions as any;
    }

    await workflow.save();
    res.json(workflow);
  }
);

// DELETE /api/v1/ticket-workflows/:id
router.delete(
  '/:id',
  rbac('workflows:delete'),
  auditMiddleware({
    action: 'workflow.delete',
    resourceType: 'ticket_workflow',
    getResourceId: (req) => req.params.id as string,
  }),
  async (req: Request, res: Response) => {
    const result = await TicketWorkflow.deleteOne({
      _id: req.params.id as string,
      tenant_id: req.tenantId,
    });
    if (result.deletedCount === 0) {
      throw AppError.notFound('Workflow');
    }
    res.status(204).send();
  }
);

export default router;
