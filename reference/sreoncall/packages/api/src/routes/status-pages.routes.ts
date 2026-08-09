import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { requirePlanLimit } from '../middleware/planLimit.middleware';
import * as statusPageService from '../services/status-page.service';
import mongoose from 'mongoose';

const router = Router();

const componentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  status: z
    .enum(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'])
    .optional(),
});

const settingsSchema = z.object({
  show_on_login: z.boolean().optional(),
  access_control: z.object({
    visibility: z.enum(['public', 'private']).optional(),
    allowed_viewer_emails: z.array(z.string().email()).optional(),
    allowed_viewer_domains: z.array(z.string().min(3).max(253)).optional(),
  }).optional(),
  display_options: z.object({
    show_incidents: z.boolean().optional(),
    show_weekly_summary: z.boolean().optional(),
    show_rca_followups: z.boolean().optional(),
    selected_service_ids: z.array(z.string()).optional(),
    selected_synthetic_check_ids: z.array(z.string()).optional(),
  }).optional(),
  localization: z.object({
    additional_locales_enabled: z.boolean().optional(),
    default_language: z.string().max(10).optional(),
  }).optional(),
  branding: z.object({
    primary_color: z.string().max(20).optional(),
    custom_domain: z.string().max(200).optional(),
  }).optional(),
}).optional();

const customAnnouncementSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(2000).optional(),
  type: z.enum(['info', 'warning', 'critical']).optional(),
}).optional();

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  is_public: z.boolean().optional(),
  components: z.array(componentSchema).optional(),
  settings: settingsSchema,
  custom_announcement: customAnnouncementSchema,
});

const updateSchema = createSchema.partial().extend({
  settings: settingsSchema,
  custom_announcement: customAnnouncementSchema,
});

const createUpdateSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(5000).optional(),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'informational']),
  visibility: z.enum(['public', 'internal']).optional(),
  affected_components: z.array(z.object({
    component_id: z.string(),
    name: z.string(),
    status_before: z.string().optional(),
    status_after: z.string().optional(),
  })).optional(),
  notify_subscribers: z.boolean().optional(),
});

const patchUpdateSchema = createUpdateSchema.partial();

function serializePage(p: any, resolvedComponents?: any[]) {
  return {
    id: p._id.toString(),
    slug: p.slug,
    name: p.name,
    description: p.description,
    is_public: p.is_public,
    components: resolvedComponents ?? (p.components || []).map((c: any) => ({
      id: c._id?.toString(),
      name: c.name,
      description: c.description,
      status: c.status,
      service_id: c.service_id?.toString() || null,
    })),
    custom_domain: p.custom_domain || null,
    settings: p.settings ? {
      show_on_login: p.settings.show_on_login ?? false,
      access_control: {
        visibility: p.settings.access_control?.visibility || 'public',
        allowed_viewer_emails: p.settings.access_control?.allowed_viewer_emails || [],
        allowed_viewer_domains: p.settings.access_control?.allowed_viewer_domains || [],
      },
      display_options: {
        show_incidents: p.settings.display_options?.show_incidents ?? true,
        show_weekly_summary: p.settings.display_options?.show_weekly_summary ?? false,
        show_rca_followups: p.settings.display_options?.show_rca_followups ?? false,
        selected_service_ids: (p.settings.display_options?.selected_service_ids || []).map((id: any) => id.toString()),
        selected_synthetic_check_ids: (p.settings.display_options?.selected_synthetic_check_ids || []).map((id: any) => id.toString()),
      },
      localization: {
        additional_locales_enabled: p.settings.localization?.additional_locales_enabled ?? false,
        default_language: p.settings.localization?.default_language || 'en',
      },
      branding: {
        primary_color: p.settings.branding?.primary_color || '#E8521A',
        custom_domain: p.settings.branding?.custom_domain || '',
      },
    } : undefined,
    custom_announcement: p.custom_announcement ? {
      enabled: p.custom_announcement.enabled ?? false,
      title: p.custom_announcement.title || '',
      body: p.custom_announcement.body || '',
      type: p.custom_announcement.type || 'info',
    } : undefined,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// Resolve selected services + synthetic checks into a unified components array
async function resolveComponents(page: any): Promise<any[]> {
  const components: any[] = [];
  const serviceIds = page.settings?.display_options?.selected_service_ids || [];
  const checkIds = page.settings?.display_options?.selected_synthetic_check_ids || [];

  // Resolve services
  if (serviceIds.length > 0) {
    const Service = mongoose.model('Service');
    const SyntheticCheck = mongoose.model('SyntheticCheck');
    const services = await Service.find({ _id: { $in: serviceIds } }).lean();
    // Look up synthetic checks linked to these services for uptime data
    const linkedChecks = await SyntheticCheck.find({ service_id: { $in: serviceIds } }).lean();
    const checkByService = new Map<string, any>();
    for (const chk of linkedChecks) {
      const sid = (chk as any).service_id?.toString();
      if (sid && (!checkByService.has(sid) || ((chk as any).uptime_24h ?? 100) < (checkByService.get(sid).uptime_24h ?? 100))) {
        checkByService.set(sid, chk);
      }
    }
    for (const svc of services) {
      const linked = checkByService.get((svc as any)._id.toString());
      components.push({
        id: (svc as any)._id.toString(),
        name: (svc as any).name,
        description: (svc as any).description || '',
        status: mapServiceStatus((svc as any).status),
        service_id: (svc as any)._id.toString(),
        source: 'service',
        type: (svc as any).type || null,
        uptime_24h: linked ? ((linked as any).uptime_24h ?? null) : null,
      });
    }
  }

  // Resolve synthetic checks
  if (checkIds.length > 0) {
    const SyntheticCheck = mongoose.model('SyntheticCheck');
    const checks = await SyntheticCheck.find({ _id: { $in: checkIds } }).lean();
    for (const chk of checks) {
      components.push({
        id: (chk as any)._id.toString(),
        name: (chk as any).name,
        description: `${(chk as any).type?.toUpperCase()} check` + ((chk as any).url ? ` — ${(chk as any).url}` : ''),
        status: mapCheckStatus((chk as any).last_status, (chk as any).status),
        synthetic_check_id: (chk as any)._id.toString(),
        source: 'synthetic_check',
        type: (chk as any).type || null,
        last_status: (chk as any).last_status,
        uptime_24h: (chk as any).uptime_24h ?? null,
      });
    }
  }

  // Also include manual components from the page
  for (const c of (page.components || [])) {
    components.push({
      id: c._id?.toString(),
      name: c.name,
      description: c.description,
      status: c.status,
      service_id: c.service_id?.toString() || null,
      source: 'manual',
    });
  }

  return components;
}

function mapServiceStatus(status: string): string {
  // Map service statuses to status page component statuses
  const map: Record<string, string> = {
    healthy: 'operational',
    operational: 'operational',
    degraded: 'degraded',
    partial_outage: 'partial_outage',
    major_outage: 'major_outage',
    maintenance: 'maintenance',
    at_risk: 'degraded',
    unknown: 'operational',
  };
  return map[status] || 'operational';
}

function mapCheckStatus(lastStatus: string | null, checkStatus: string): string {
  if (checkStatus === 'paused') return 'maintenance';
  if (!lastStatus) return 'operational';
  const map: Record<string, string> = {
    up: 'operational',
    degraded: 'degraded',
    down: 'major_outage',
  };
  return map[lastStatus] || 'operational';
}

function serializeUpdate(u: any) {
  return {
    id: u._id.toString(),
    status_page_id: u.status_page_id.toString(),
    title: u.title,
    body: u.body,
    status: u.status,
    visibility: u.visibility,
    affected_components: (u.affected_components || []).map((c: any) => ({
      component_id: c.component_id?.toString(),
      name: c.name,
      status_before: c.status_before,
      status_after: c.status_after,
    })),
    created_by: u.created_by?.toString(),
    notify_subscribers: u.notify_subscribers,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

function serializeSubscriber(s: any) {
  return {
    id: s._id.toString(),
    email: s.email,
    confirmed: s.confirmed,
    created_at: s.created_at,
  };
}

// ─── Status Page CRUD ───────────────────────────────────────────────────────

router.get('/', rbac('status-pages:read'), async (req: Request, res: Response) => {
  const pages = await statusPageService.listStatusPages(req.tenantId);
  // Resolve components for each page
  const serialized = await Promise.all(
    pages.map(async (p) => {
      const resolved = await resolveComponents(p);
      return serializePage(p, resolved);
    })
  );
  res.json({ data: serialized });
});

router.get('/:id', rbac('status-pages:read'), async (req: Request, res: Response) => {
  const page = await statusPageService.getStatusPageById(req.tenantId, req.params.id as string);
  const resolved = await resolveComponents(page);
  res.json(serializePage(page, resolved));
});

router.post('/',
  rbac('status-pages:create'),
  requirePlanLimit('max_status_pages', (req) =>
    mongoose.model('StatusPage').countDocuments({ tenant_id: req.tenantId })
  ),
  async (req: Request, res: Response) => {
  const body = createSchema.parse(req.body);
  const page = await statusPageService.createStatusPage({
    ...body,
    tenant_id: req.tenantId,
  });
  const resolved = await resolveComponents(page);
  res.status(201).json(serializePage(page, resolved));
});

router.patch('/:id', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const page = await statusPageService.updateStatusPage(
    req.tenantId,
    req.params.id as string,
    body
  );
  const resolved = await resolveComponents(page);
  res.json(serializePage(page, resolved));
});

router.delete('/:id', rbac('status-pages:delete'), async (req: Request, res: Response) => {
  await statusPageService.deleteStatusPage(req.tenantId, req.params.id as string);
  res.status(204).send();
});

// ─── Status Updates (nested) ────────────────────────────────────────────────

router.get('/:id/updates', rbac('status-pages:read'), async (req: Request, res: Response) => {
  const updates = await statusPageService.listStatusUpdates(
    req.tenantId,
    req.params.id as string,
    {
      limit: parseInt(req.query.limit as string) || 50,
      skip: parseInt(req.query.skip as string) || 0,
    }
  );
  res.json({ data: updates.map(serializeUpdate) });
});

router.post('/:id/updates', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const body = createUpdateSchema.parse(req.body);
  const update = await statusPageService.createStatusUpdate(
    req.tenantId,
    req.params.id as string,
    req.userId,
    body
  );
  res.status(201).json(serializeUpdate(update));
});

router.patch('/:id/updates/:updateId', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const body = patchUpdateSchema.parse(req.body);
  const update = await statusPageService.updateStatusUpdate(
    req.tenantId,
    req.params.id as string,
    req.params.updateId as string,
    body
  );
  res.json(serializeUpdate(update));
});

router.delete('/:id/updates/:updateId', rbac('status-pages:delete'), async (req: Request, res: Response) => {
  await statusPageService.deleteStatusUpdate(
    req.tenantId,
    req.params.id as string,
    req.params.updateId as string
  );
  res.status(204).send();
});

// ─── Subscribers (nested) ───────────────────────────────────────────────────

router.get('/:id/subscribers', rbac('status-pages:read'), async (req: Request, res: Response) => {
  const subs = await statusPageService.listSubscribers(req.tenantId, req.params.id as string);
  res.json({ data: subs.map(serializeSubscriber) });
});

router.post('/:id/subscribers', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const sub = await statusPageService.addSubscriber(req.tenantId, req.params.id as string, email);
  const isNew = sub.created_at && (Date.now() - new Date(sub.created_at).getTime()) < 1000;
  res.status(isNew ? 201 : 200).json(serializeSubscriber(sub));
});

router.delete('/:id/subscribers/:subId', rbac('status-pages:update'), async (req: Request, res: Response) => {
  await statusPageService.removeSubscriber(
    req.tenantId,
    req.params.id as string,
    req.params.subId as string
  );
  res.status(204).send();
});

// ─── Scheduled Maintenance ──────────────────────────────────────────────────

const maintenanceSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  affected_components: z.array(z.string()).optional(),
  notify_subscribers: z.boolean().optional(),
  auto_update_status: z.boolean().optional(),
});

// POST /api/v1/status-pages/:id/maintenances
router.post('/:id/maintenances', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const input = maintenanceSchema.parse(req.body);
  const page = await statusPageService.addScheduledMaintenance(
    req.tenantId,
    req.params.id as string,
    req.userId,
    {
      ...input,
      scheduled_start: new Date(input.scheduled_start),
      scheduled_end: new Date(input.scheduled_end),
    }
  );
  const maintenance = page.scheduled_maintenances[page.scheduled_maintenances.length - 1];
  res.status(201).json(maintenance);
});

// PATCH /api/v1/status-pages/:id/maintenances/:maintenanceId
router.patch('/:id/maintenances/:maintenanceId', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const page = await statusPageService.updateScheduledMaintenance(
    req.tenantId,
    req.params.id as string,
    req.params.maintenanceId as string,
    req.body
  );
  const maintenance = page.scheduled_maintenances.find(
    (m: any) => m._id?.toString() === req.params.maintenanceId
  );
  res.json(maintenance);
});

// DELETE /api/v1/status-pages/:id/maintenances/:maintenanceId
router.delete('/:id/maintenances/:maintenanceId', rbac('status-pages:update'), async (req: Request, res: Response) => {
  await statusPageService.deleteScheduledMaintenance(
    req.tenantId,
    req.params.id as string,
    req.params.maintenanceId as string
  );
  res.status(204).send();
});

// ─── Component Status Override ──────────────────────────────────────────────

// PUT /api/v1/status-pages/:id/components/:componentId/override
router.put('/:id/components/:componentId/override', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const { status, reason } = z.object({
    status: z.enum(['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']),
    reason: z.string().max(500).optional(),
  }).parse(req.body);

  const page = await statusPageService.updateStatusPage(req.tenantId, req.params.id as string, {
    settings: {
      component_overrides: {
        [req.params.componentId as string]: {
          status,
          reason: reason || '',
          set_by: req.userId,
          set_at: new Date(),
        },
      },
    },
  });

  res.json({ component_id: req.params.componentId, status, reason });
});

// DELETE /api/v1/status-pages/:id/components/:componentId/override
router.delete('/:id/components/:componentId/override', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const page = await statusPageService.getStatusPageById(req.tenantId, req.params.id as string);
  const overrides = { ...(page.settings?.component_overrides || {}) };
  delete overrides[req.params.componentId as string];

  await statusPageService.updateStatusPage(req.tenantId, req.params.id as string, {
    settings: { component_overrides: overrides },
  });

  res.status(204).send();
});

// ─── Custom Domain ──────────────────────────────────────────────────────────

// PUT /api/v1/status-pages/:id/custom-domain
router.put('/:id/custom-domain', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const { domain } = z.object({ domain: z.string().min(3).max(253) }).parse(req.body);
  const result = await statusPageService.setCustomDomain(req.tenantId, req.params.id as string, domain);
  res.json({
    domain,
    ...result,
    instructions: [
      `1. Add a CNAME record: ${domain} → ${result.cname_target}`,
      `2. Add a TXT record: ${domain} → ${result.verification_token}`,
      `3. Call POST /api/v1/status-pages/${req.params.id}/custom-domain/verify to verify`,
    ],
  });
});

// POST /api/v1/status-pages/:id/custom-domain/verify
router.post('/:id/custom-domain/verify', rbac('status-pages:update'), async (req: Request, res: Response) => {
  const result = await statusPageService.verifyCustomDomain(req.tenantId, req.params.id as string);
  if (result.verified) {
    res.json({ verified: true, message: 'Custom domain verified successfully.' });
  } else {
    res.status(400).json({ verified: false, error: result.error });
  }
});

// DELETE /api/v1/status-pages/:id/custom-domain
router.delete('/:id/custom-domain', rbac('status-pages:update'), async (req: Request, res: Response) => {
  await statusPageService.removeCustomDomain(req.tenantId, req.params.id as string);
  res.status(204).send();
});

export default router;
