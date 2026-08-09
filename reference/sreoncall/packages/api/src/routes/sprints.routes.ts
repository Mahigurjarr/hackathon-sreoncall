import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Sprint } from '../models/sprint.model';
import { Ticket } from '../models/ticket.model';
import { rbac } from '../middleware/rbac.middleware';
import { boardAccessMiddleware } from '../middleware/boardAccess.middleware';
import { AppError } from '../middleware/errorHandler.middleware';

const router = Router();

const createSprintSchema = z.object({
  name:       z.string().min(1).max(200),
  goal:       z.string().max(2000).optional(),
  start_date: z.string().datetime(),
  end_date:   z.string().datetime(),
  project_id: z.string().optional(),
});

const updateSprintSchema = z.object({
  name:       z.string().min(1).max(200).optional(),
  goal:       z.string().max(2000).optional(),
  status:     z.enum(['planning', 'active', 'completed']).optional(),
  start_date: z.string().datetime().optional(),
  end_date:   z.string().datetime().optional(),
});

const assignSchema = z.object({
  ticket_ids: z.array(z.string()).min(1).max(200),
});

// GET /api/v1/sprints
router.get('/', rbac('tickets:read'), boardAccessMiddleware, async (req: Request, res: Response) => {
  const query: Record<string, any> = { tenant_id: req.tenantId };
  if (req.query.project_id) query.project_id = new Types.ObjectId(req.query.project_id as string);
  if (req.query.status)     query.status = req.query.status;

  const sprints = await Sprint.find(query).sort({ createdAt: -1 });
  res.json({ data: sprints });
});

// POST /api/v1/sprints
router.post('/', rbac('tickets:create'), boardAccessMiddleware, async (req: Request, res: Response) => {
  const body = createSprintSchema.parse(req.body);

  if (new Date(body.end_date) <= new Date(body.start_date)) {
    throw AppError.badRequest('end_date must be after start_date');
  }

  const sprint = await Sprint.create({
    tenant_id:  req.tenantId,
    project_id: body.project_id ? new Types.ObjectId(body.project_id) : null,
    name:       body.name,
    goal:       body.goal ?? '',
    start_date: new Date(body.start_date),
    end_date:   new Date(body.end_date),
    created_by: req.userId,
  });

  res.status(201).json(sprint);
});

// GET /api/v1/sprints/:id
router.get('/:id', rbac('tickets:read'), async (req: Request, res: Response) => {
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');
  res.json(sprint);
});

// PATCH /api/v1/sprints/:id
router.patch('/:id', rbac('tickets:update'), async (req: Request, res: Response) => {
  const body = updateSprintSchema.parse(req.body);
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');

  if (body.name       !== undefined) sprint.name       = body.name;
  if (body.goal       !== undefined) sprint.goal       = body.goal;
  if (body.start_date !== undefined) sprint.start_date = new Date(body.start_date);
  if (body.end_date   !== undefined) sprint.end_date   = new Date(body.end_date);
  if (body.status     !== undefined) {
    sprint.status = body.status;
    if (body.status === 'completed') sprint.completed_at = new Date();
  }

  await sprint.save();
  res.json(sprint);
});

// POST /api/v1/sprints/:id/complete — complete sprint with carry-over option
// body: { carry_over_to?: sprint_id | 'backlog' }  (defaults to 'backlog')
router.post('/:id/complete', rbac('tickets:update'), async (req: Request, res: Response) => {
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');
  if (sprint.status !== 'active') throw AppError.badRequest('Only active sprints can be completed.');

  const carryOverTo: string = req.body?.carry_over_to ?? 'backlog';

  // Find incomplete tickets
  const incomplete = await Ticket.find({
    tenant_id: req.tenantId,
    sprint_id: sprint._id,
    status: { $nin: ['resolved', 'closed', 'done'] },
  }).select('_id').lean();

  const incompleteIds = incomplete.map((t) => t._id);
  const completedCount = await Ticket.countDocuments({ tenant_id: req.tenantId, sprint_id: sprint._id }) - incompleteIds.length;

  if (incompleteIds.length > 0) {
    if (carryOverTo === 'backlog') {
      await Ticket.updateMany(
        { _id: { $in: incompleteIds }, tenant_id: req.tenantId },
        { $set: { sprint_id: null, is_backlog: true } }
      );
    } else {
      // Carry over to another sprint
      const targetSprint = await Sprint.findOne({ _id: carryOverTo, tenant_id: req.tenantId });
      if (!targetSprint) throw AppError.notFound('Target sprint');
      await Ticket.updateMany(
        { _id: { $in: incompleteIds }, tenant_id: req.tenantId },
        { $set: { sprint_id: new Types.ObjectId(carryOverTo), is_backlog: false } }
      );
    }
  }

  sprint.status = 'completed';
  sprint.completed_at = new Date();
  await sprint.save();

  res.json({
    sprint,
    completed_tickets: completedCount,
    carried_over: incompleteIds.length,
    carry_over_to: carryOverTo,
  });
});

// DELETE /api/v1/sprints/:id — moves all tickets back to backlog
router.delete('/:id', rbac('tickets:delete'), async (req: Request, res: Response) => {
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');
  if (sprint.status === 'active') {
    throw AppError.badRequest('Cannot delete an active sprint. Complete it first.');
  }

  await Ticket.updateMany(
    { tenant_id: req.tenantId, sprint_id: sprint._id },
    { $set: { sprint_id: null, is_backlog: true } }
  );
  await sprint.deleteOne();
  res.status(204).send();
});

// GET /api/v1/sprints/:id/tickets
router.get('/:id/tickets', rbac('tickets:read'), async (req: Request, res: Response) => {
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');

  const tickets = await Ticket.find({ tenant_id: req.tenantId, sprint_id: sprint._id })
    .populate('assignee_id', 'name email avatar_url')
    .sort({ createdAt: 1 });

  res.json({ data: tickets });
});

// POST /api/v1/sprints/:id/tickets — assign tickets to sprint
router.post('/:id/tickets', rbac('tickets:update'), async (req: Request, res: Response) => {
  const { ticket_ids } = assignSchema.parse(req.body);
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');

  const ids = ticket_ids.map((id) => new Types.ObjectId(id));
  const result = await Ticket.updateMany(
    { _id: { $in: ids }, tenant_id: req.tenantId },
    { $set: { sprint_id: sprint._id, is_backlog: false } }
  );

  res.json({ assigned_count: result.modifiedCount });
});

// DELETE /api/v1/sprints/:id/tickets — remove tickets from sprint (sends to backlog)
router.delete('/:id/tickets', rbac('tickets:update'), async (req: Request, res: Response) => {
  const { ticket_ids } = assignSchema.parse(req.body);
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');

  const ids = ticket_ids.map((id) => new Types.ObjectId(id));
  const result = await Ticket.updateMany(
    { _id: { $in: ids }, tenant_id: req.tenantId, sprint_id: sprint._id },
    { $set: { sprint_id: null, is_backlog: true } }
  );

  res.json({ removed_count: result.modifiedCount });
});

// GET /api/v1/sprints/:id/progress
router.get('/:id/progress', rbac('tickets:read'), async (req: Request, res: Response) => {
  const sprint = await Sprint.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!sprint) throw AppError.notFound('Sprint');

  const total   = await Ticket.countDocuments({ tenant_id: req.tenantId, sprint_id: sprint._id });
  const done    = await Ticket.countDocuments({ tenant_id: req.tenantId, sprint_id: sprint._id, status: { $in: ['resolved', 'closed', 'done'] } });
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;

  res.json({ total_tickets: total, completed_tickets: done, pct_complete: pct });
});

export default router;
