import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as workLogSettingsService from '../services/work-log-settings.service';

const router = Router();

const approverSchema = z.object({
  user_id: z.string().min(1),
  scope: z.enum(['tenant', 'project']).default('tenant'),
  project_id: z.string().optional(),
});

const updateSchema = z.object({
  approvers: z.array(approverSchema).optional(),
  digest_interval_days: z.number().min(1).max(30).optional(),
  auto_approve_threshold_minutes: z.number().min(0).optional(),
  approval_sla_days: z.number().min(0).optional(),
  approval_sla_action: z.enum(['escalate', 'auto_approve', 'notify_admin']).optional(),
});

// GET /api/v1/work-log-settings
router.get('/', rbac('work_log_settings:read'), async (req: Request, res: Response) => {
  const settings = await workLogSettingsService.getSettings(req.tenantId);
  res.json({ data: settings });
});

// PATCH /api/v1/work-log-settings
router.patch('/', rbac('work_log_settings:update'), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const settings = await workLogSettingsService.updateSettings(req.tenantId, body as any);
  res.json({ data: settings });
});

export default router;
