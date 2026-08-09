import { Router, Request, Response } from 'express';
import { rbac } from '../middleware/rbac.middleware';
import { listConnections, disconnectConnection, providersConfigured } from '../services/calendar.service';

/**
 * Authenticated calendar-connection management for the AI Notetaker settings
 * page. The OAuth connect/callback themselves live in the public
 * oauth-calendar.routes.ts; this exposes list + disconnect + which providers
 * are usable for the tenant.
 */
const router = Router();

// GET /calendar/connections — list the tenant's connected calendars + available providers
router.get('/connections', rbac('notetaker:read'), async (req: Request, res: Response) => {
  const [conns, providers] = await Promise.all([
    listConnections(req.tenantId),
    providersConfigured(req.tenantId),
  ]);
  res.json({
    data: conns.map((c) => ({
      id: c._id.toString(),
      platform: c.platform,
      email: c.email,
      status: c.status,
      created_at: c.created_at,
    })),
    providers,
  });
});

// DELETE /calendar/connections/:id — disconnect a calendar
router.delete('/connections/:id', rbac('notetaker:manage'), async (req: Request, res: Response) => {
  await disconnectConnection(req.tenantId, req.params['id'] as string);
  res.status(204).send();
});

export default router;
