import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { BreachReport } from '../../models/breach-report.model';
import {
  createBreachReport,
  notifyAffectedUsers,
  generateAuthorityReport,
} from '../../services/breach-notification.service';

const router = Router();

function serialize(b: any) {
  return {
    _id: b._id.toString(),
    title: b.title,
    description: b.description,
    severity: b.severity,
    status: b.status,
    detected_at: b.detected_at?.toISOString?.() ?? b.detected_at,
    contained_at: b.contained_at?.toISOString?.() ?? b.contained_at ?? null,
    resolved_at: b.resolved_at?.toISOString?.() ?? b.resolved_at ?? null,
    reported_to_authority_at: b.reported_to_authority_at?.toISOString?.() ?? b.reported_to_authority_at ?? null,
    affected_tenants: (b.affected_tenants ?? []).map((t: any) => t.toString?.() ?? t),
    affected_user_count: b.affected_user_count,
    data_categories_affected: b.data_categories_affected ?? [],
    root_cause: b.root_cause ?? null,
    remediation_steps: b.remediation_steps ?? [],
    reported_by: b.reported_by?.toString?.() ?? b.reported_by,
    authority_report_deadline: b.authority_report_deadline?.toISOString?.() ?? b.authority_report_deadline,
    notifications_sent: b.notifications_sent,
    createdAt: b.createdAt?.toISOString?.() ?? b.createdAt,
    updatedAt: b.updatedAt?.toISOString?.() ?? b.updatedAt,
  };
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  affected_tenants: z.array(z.string()).default([]),
  affected_user_count: z.number().int().min(0).default(0),
  data_categories_affected: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  status: z.enum(['detected', 'investigating', 'contained', 'resolved', 'reported']).optional(),
  root_cause: z.string().max(5000).optional(),
  remediation_steps: z.array(z.string()).optional(),
  contained_at: z.string().datetime().optional(),
  resolved_at: z.string().datetime().optional(),
  reported_to_authority_at: z.string().datetime().optional(),
});

// GET /platform/breach-reports
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  const reports = await BreachReport.find(filter).sort({ detected_at: -1 }).limit(200);
  res.json({ data: reports.map(serialize) });
});

// GET /platform/breach-reports/:id
router.get('/:id', async (req: Request, res: Response) => {
  const report = await BreachReport.findById(req.params['id']);
  if (!report) {
    res.status(404).json({ error: 'Breach report not found' });
    return;
  }
  res.json({ data: serialize(report) });
});

// POST /platform/breach-reports
router.post('/', async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const report = await createBreachReport({
    ...body,
    reported_by: req.userId,
  });
  res.status(201).json({ data: serialize(report) });
});

// PATCH /platform/breach-reports/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const update: Record<string, unknown> = { ...body };
  for (const key of ['contained_at', 'resolved_at', 'reported_to_authority_at'] as const) {
    if (body[key]) update[key] = new Date(body[key] as string);
  }
  const report = await BreachReport.findByIdAndUpdate(req.params['id'], update, { new: true });
  if (!report) {
    res.status(404).json({ error: 'Breach report not found' });
    return;
  }
  res.json({ data: serialize(report) });
});

// POST /platform/breach-reports/:id/notify
router.post('/:id/notify', async (req: Request, res: Response) => {
  const notified = await notifyAffectedUsers(req.params['id'] as string);
  res.json({ notified });
});

// GET /platform/breach-reports/:id/report
router.get('/:id/report', async (req: Request, res: Response) => {
  const report = await generateAuthorityReport(req.params['id'] as string);
  res.json(report);
});

export default router;
