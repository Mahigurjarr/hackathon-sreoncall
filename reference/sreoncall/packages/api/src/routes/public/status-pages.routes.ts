import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import * as statusPageService from '../../services/status-page.service';

const router = Router();

// Simple in-memory IP rate limiter for subscription endpoint (5 requests/minute/IP)
const subscribeRateMap = new Map<string, { count: number; resetAt: number }>();
const SUBSCRIBE_RATE_LIMIT = 5;
const SUBSCRIBE_RATE_WINDOW_MS = 60_000;

function checkSubscribeRateLimit(req: Request, res: Response): boolean {
  const ip = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || 'unknown';
  const now = Date.now();
  const entry = subscribeRateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    subscribeRateMap.set(ip, { count: 1, resetAt: now + SUBSCRIBE_RATE_WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > SUBSCRIBE_RATE_LIMIT) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ detail: 'Too many subscription requests. Please try again later.' });
    return false;
  }

  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of subscribeRateMap) {
    if (now > entry.resetAt) subscribeRateMap.delete(ip);
  }
}, 5 * 60_000);

function mapServiceStatus(status: string): string {
  const map: Record<string, string> = {
    healthy: 'operational', operational: 'operational', degraded: 'degraded',
    partial_outage: 'partial_outage', major_outage: 'major_outage',
    maintenance: 'maintenance', at_risk: 'degraded', unknown: 'operational',
  };
  return map[status] || 'operational';
}

function mapCheckStatus(lastStatus: string | null, checkStatus: string): string {
  if (checkStatus === 'paused') return 'maintenance';
  if (!lastStatus) return 'operational';
  const map: Record<string, string> = { up: 'operational', degraded: 'degraded', down: 'major_outage' };
  return map[lastStatus] || 'operational';
}

async function resolvePublicComponents(page: any): Promise<any[]> {
  const components: any[] = [];
  const serviceIds = page.settings?.display_options?.selected_service_ids || [];
  const checkIds = page.settings?.display_options?.selected_synthetic_check_ids || [];
  const overrides: Record<string, any> = page.settings?.component_overrides || {};

  if (serviceIds.length > 0) {
    const Service = mongoose.model('Service');
    const SyntheticCheck = mongoose.model('SyntheticCheck');
    const services = await Service.find({ _id: { $in: serviceIds } }).lean();
    const linkedChecks = await SyntheticCheck.find({ service_id: { $in: serviceIds } }).lean();
    const checkByService = new Map<string, any>();
    for (const chk of linkedChecks) {
      const sid = (chk as any).service_id?.toString();
      if (sid && (!checkByService.has(sid) || ((chk as any).uptime_24h ?? 100) < (checkByService.get(sid).uptime_24h ?? 100))) {
        checkByService.set(sid, chk);
      }
    }
    for (const svc of services) {
      const svcId = (svc as any)._id.toString();
      const linked = checkByService.get(svcId);
      const override = overrides[svcId];
      components.push({
        name: (svc as any).name,
        description: (svc as any).description || '',
        status: override?.status || mapServiceStatus((svc as any).status),
        status_override: override ? { reason: override.reason, set_at: override.set_at } : null,
        uptime_24h: linked ? ((linked as any).uptime_24h ?? null) : null,
        uptime_7d: linked ? ((linked as any).uptime_7d ?? null) : null,
        uptime_30d: linked ? ((linked as any).uptime_30d ?? null) : null,
        uptime_90d: linked ? ((linked as any).uptime_90d ?? null) : null,
      });
    }
  }

  if (checkIds.length > 0) {
    const SyntheticCheck = mongoose.model('SyntheticCheck');
    const checks = await SyntheticCheck.find({ _id: { $in: checkIds } }).lean();
    for (const chk of checks) {
      const chkId = (chk as any)._id.toString();
      const override = overrides[chkId];
      components.push({
        name: (chk as any).name,
        description: `${(chk as any).type?.toUpperCase()} check`,
        status: override?.status || mapCheckStatus((chk as any).last_status, (chk as any).status),
        status_override: override ? { reason: override.reason, set_at: override.set_at } : null,
        uptime_24h: (chk as any).uptime_24h ?? null,
        uptime_7d: (chk as any).uptime_7d ?? null,
        uptime_30d: (chk as any).uptime_30d ?? null,
        uptime_90d: (chk as any).uptime_90d ?? null,
      });
    }
  }

  // Also include manual components
  for (const c of (page.components || [])) {
    components.push({ name: c.name, description: c.description, status: c.status, uptime_24h: null, uptime_7d: null, uptime_30d: null, uptime_90d: null });
  }

  return components;
}

function serializeUpdate(u: any) {
  return {
    id: u._id.toString(),
    title: u.title,
    body: u.body,
    status: u.status,
    affected_components: (u.affected_components || []).map((c: any) => ({
      name: c.name,
      status_before: c.status_before,
      status_after: c.status_after,
    })),
    postmortem_id: u.postmortem_id?.toString() || null,
    incident_id: u.incident_id?.toString() || null,
    created_at: u.created_at,
  };
}

// GET /api/v1/public/status-pages/:slug — public, no auth (private pages require ?viewer_email=)
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const viewerEmail = req.query.viewer_email as string | undefined;
    const page = await statusPageService.getPublicStatusPage(req.params.slug as string, viewerEmail);

    // Fetch tenant branding for white-label status pages
    const Tenant = mongoose.model('Tenant');
    let tenant_branding: Record<string, any> | undefined;
    try {
      const tenant = await Tenant.findById(page.tenant_id).select('branding').lean();
      if (tenant && (tenant as any).branding) {
        const b = (tenant as any).branding;
        // Only include branding if tenant has customized it (not default SREonCall branding)
        if (b.logo_url || (b.primary_color && b.primary_color !== '#4F46E5')) {
          tenant_branding = {
            logo_url: b.logo_url || undefined,
            favicon_url: b.favicon_url || undefined,
            primary_color: b.primary_color || undefined,
            accent_color: b.accent_color || undefined,
          };
        }
      }
    } catch {}

    // Fetch recent public updates
    let recent_updates: any[] = [];
    try {
      const updates = await statusPageService.getPublicUpdates(req.params.slug as string, { limit: 5 });
      recent_updates = updates.map(serializeUpdate);
    } catch {}

    // Resolve services + synthetic checks into components
    const resolvedComponents = await resolvePublicComponents(page);

    // Surface any open incidents tied to the page's selected checks/services.
    // This covers incidents that haven't been manually or auto-published as
    // status_updates yet (e.g., a failing synthetic check whose auto-publish
    // hook pre-dated the feature) so the page always reflects live problems.
    let active_incidents: any[] = [];
    try {
      const Incident = mongoose.model('Incident');
      const serviceIds = (page.settings?.display_options?.selected_service_ids || []).map(
        (id: any) => new mongoose.Types.ObjectId(String(id)),
      );
      const checkIds = (page.settings?.display_options?.selected_synthetic_check_ids || []).map(
        (id: any) => new mongoose.Types.ObjectId(String(id)),
      );

      // Resolve check names so we can match synthetic-check incidents by title.
      let checkNameById = new Map<string, string>();
      if (checkIds.length > 0) {
        const SyntheticCheck = mongoose.model('SyntheticCheck');
        const chks = await SyntheticCheck.find({ _id: { $in: checkIds } }).select('name').lean();
        checkNameById = new Map(chks.map((c: any) => [String(c._id), c.name]));
      }

      const checkTitles = Array.from(checkNameById.values()).map((n) => `[Synthetic Check] ${n} failing`);
      const incidentFilter: any = {
        tenant_id: page.tenant_id,
        status: { $nin: ['resolved', 'closed'] },
        $or: [] as any[],
      };
      if (serviceIds.length > 0) incidentFilter.$or.push({ affected_service_ids: { $in: serviceIds } });
      if (checkTitles.length > 0) incidentFilter.$or.push({ source: 'synthetic_check', title: { $in: checkTitles } });

      if (incidentFilter.$or.length > 0) {
        const open = await Incident.find(incidentFilter)
          .sort({ createdAt: -1 })
          .limit(20)
          .select('_id title severity status createdAt source')
          .lean();
        active_incidents = open.map((i: any) => ({
          id: String(i._id),
          title: i.title,
          severity: i.severity,
          status: i.status,
          created_at: i.createdAt,
          source: i.source,
        }));
      }
    } catch {}

    res.json({
      slug: page.slug,
      name: page.name,
      description: page.description,
      components: resolvedComponents,
      tenant_branding,
      settings: page.settings ? {
        display_options: {
          show_incidents: page.settings.display_options?.show_incidents ?? true,
          show_weekly_summary: page.settings.display_options?.show_weekly_summary ?? false,
          show_rca_followups: page.settings.display_options?.show_rca_followups ?? false,
        },
        branding: {
          primary_color: page.settings.branding?.primary_color || '#E8521A',
          custom_domain: page.settings.branding?.custom_domain || '',
        },
        timezone: page.settings.localization?.timezone || 'UTC',
      } : undefined,
      custom_announcement: page.custom_announcement?.enabled ? {
        enabled: true,
        title: page.custom_announcement.title,
        body: page.custom_announcement.body,
        type: page.custom_announcement.type,
      } : undefined,
      scheduled_maintenances: (page.scheduled_maintenances || [])
        .filter((m: any) => m.status !== 'completed')
        .map((m: any) => ({
          id: m._id?.toString(),
          title: m.title,
          description: m.description,
          status: m.status,
          scheduled_start: m.scheduled_start,
          scheduled_end: m.scheduled_end,
          affected_components: m.affected_components,
        })),
      recent_updates,
      active_incidents,
      updated_at: page.updated_at,
    });
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

// GET /api/v1/public/status-pages/:slug/updates — public updates
router.get('/:slug/updates', async (req: Request, res: Response) => {
  try {
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;

    const updates = await statusPageService.getPublicUpdates(req.params.slug as string, {
      limit: parseInt(req.query.limit as string) || 20,
      skip: parseInt(req.query.skip as string) || 0,
      viewerEmail: req.query.viewer_email as string | undefined,
      from,
      to,
    });
    res.json({ data: updates.map(serializeUpdate) });
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

// GET /api/v1/public/status-pages/:slug/history — incident history grouped by day
// Optional ?component=<name> filters to a single component (service or check)
router.get('/:slug/history', async (req: Request, res: Response) => {
  try {
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const componentFilter = req.query.component as string | undefined;
    // Default to last 90 days if no range specified
    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400).json({ detail: 'Invalid from/to date' });
      return;
    }
    const rangeDays = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    if (rangeDays > 365) {
      res.status(400).json({ detail: 'Range cannot exceed 365 days' });
      return;
    }

    let updates = await statusPageService.getPublicUpdates(req.params.slug as string, {
      limit: 500,
      from,
      to,
      viewerEmail: req.query.viewer_email as string | undefined,
    });

    // Filter by component name if requested
    if (componentFilter) {
      updates = updates.filter((u: any) => {
        const affected = u.affected_components || [];
        return affected.some((c: any) => c.name === componentFilter);
      });
    }

    // Group by day (YYYY-MM-DD) for timeline display
    const byDay: Record<string, any[]> = {};
    for (const u of updates) {
      const dayKey = new Date(u.created_at).toISOString().split('T')[0];
      if (!byDay[dayKey]) byDay[dayKey] = [];
      byDay[dayKey].push(serializeUpdate(u));
    }

    // Build a complete day list (including days with no incidents) for the range
    const days: { date: string; updates: any[]; has_incident: boolean }[] = [];
    const current = new Date(from);
    current.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(to);
    endDay.setUTCHours(0, 0, 0, 0);
    while (current <= endDay) {
      const key = current.toISOString().split('T')[0];
      const dayUpdates = byDay[key] || [];
      days.push({ date: key, updates: dayUpdates, has_incident: dayUpdates.length > 0 });
      current.setUTCDate(current.getUTCDate() + 1);
    }
    days.reverse(); // newest first

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      total: updates.length,
      days,
    });
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

// POST /api/v1/public/status-pages/:slug/subscribe — subscribe (email, sms, webhook)
router.post('/:slug/subscribe', async (req: Request, res: Response) => {
  if (!checkSubscribeRateLimit(req, res)) return;
  try {
    const channel = req.body.channel || 'email';

    if (channel === 'email') {
      const { email } = z.object({ email: z.string().email() }).parse(req.body);
      await statusPageService.publicSubscribe(req.params.slug as string, email);
      res.json({ message: 'Check your email to confirm your subscription.' });
    } else if (channel === 'sms') {
      const { phone } = z.object({ phone: z.string().min(5).max(20) }).parse(req.body);
      await statusPageService.publicSubscribeSms(req.params.slug as string, phone);
      res.json({ message: 'You will receive SMS notifications for status updates.' });
    } else if (channel === 'webhook') {
      const { webhook_url } = z.object({ webhook_url: z.string().url() }).parse(req.body);
      await statusPageService.publicSubscribeWebhook(req.params.slug as string, webhook_url);
      res.json({ message: 'Webhook registered. You will receive POST requests for status updates.' });
    } else {
      res.status(400).json({ detail: 'Invalid channel. Use email, sms, or webhook.' });
    }
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else if (err.name === 'ZodError') {
      res.status(400).json({ detail: err.errors?.[0]?.message || 'Invalid input' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

// GET /api/v1/public/status-pages/:slug/rss — RSS feed
router.get('/:slug/rss', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const feed = await statusPageService.generateRssFeed(slug, req);
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(feed);
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

// GET /api/v1/public/status-pages/:slug/confirm/:token — confirm subscription
router.get('/:slug/confirm/:token', async (req: Request, res: Response) => {
  try {
    const confirmed = await statusPageService.confirmSubscription(
      req.params.slug as string,
      req.params.token as string
    );
    if (confirmed) {
      res.json({ message: 'Subscription confirmed! You will now receive status updates.' });
    } else {
      res.status(404).json({ detail: 'Invalid or expired confirmation link.' });
    }
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

// GET /api/v1/public/status-pages/:slug/unsubscribe/:token — unsubscribe
router.get('/:slug/unsubscribe/:token', async (req: Request, res: Response) => {
  try {
    const removed = await statusPageService.unsubscribe(
      req.params.slug as string,
      req.params.token as string
    );
    if (removed) {
      res.json({ message: 'You have been unsubscribed from status updates.' });
    } else {
      res.status(404).json({ detail: 'Invalid unsubscribe link or already unsubscribed.' });
    }
  } catch (err: any) {
    if (err.status === 404) {
      res.status(404).json({ detail: 'Status page not found' });
    } else {
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
});

export default router;
