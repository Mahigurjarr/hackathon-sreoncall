import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as commandCenterService from '../services/command-center.service';
import { rbac } from '../middleware/rbac.middleware';
import * as lgtm from '../services/lgtm-query.service';
import { AppError } from '../middleware/errorHandler.middleware';
import type { ICCPersona, VisibilityLevel } from '../services/command-center.service';

const router = Router({ mergeParams: true });

// Mirrors frontend PersonaSwitcher.tsx PERSONAS — defines which roles/tenant types
// may use each persona. tenantTypes: [] means the persona is available for all tenant types.
const PERSONA_ELIGIBILITY: Array<{
  key: ICCPersona;
  roles: string[];
  tenantTypes: string[];
}> = [
  { key: 'sre_engineer',      roles: ['agent', 'manager', 'tenant_admin'], tenantTypes: ['standalone', 'provider'] },
  { key: 'sre_manager',       roles: ['manager', 'tenant_admin'],           tenantTypes: ['standalone', 'provider'] },
  { key: 'platform_engineer', roles: ['agent', 'manager', 'tenant_admin'], tenantTypes: ['standalone', 'provider'] },
  { key: 'tenant_admin',      roles: ['tenant_admin'],                      tenantTypes: ['standalone', 'provider', 'consumer'] },
  { key: 'msp_provider',      roles: ['tenant_admin', 'manager'],           tenantTypes: ['provider'] },
  { key: 'consumer',          roles: ['agent', 'manager', 'tenant_admin'], tenantTypes: ['consumer'] },
  { key: 'platform_admin',    roles: ['platform_admin'],                    tenantTypes: [] },
];

function getAllowedPersonas(roles: string[], tenantType: string): ICCPersona[] {
  return PERSONA_ELIGIBILITY
    .filter((p) => {
      const roleMatch = p.roles.some((r) => roles.includes(r));
      const tenantMatch = p.tenantTypes.length === 0 || p.tenantTypes.includes(tenantType);
      return roleMatch && tenantMatch;
    })
    .map((p) => p.key);
}

// Validates the requested persona against the user's actual roles + tenant type.
// If the requested persona is not permitted, clamps to the user's first allowed persona.
function resolvePersona(requested: unknown, roles: string[], tenantType: string): ICCPersona {
  const allowed = getAllowedPersonas(roles, tenantType);
  const candidate = typeof requested === 'string' ? requested as ICCPersona : undefined;
  if (candidate && allowed.includes(candidate)) {
    return candidate;
  }
  return allowed[0] ?? 'sre_engineer';
}

// Resolves and stashes the effective persona for every route in this router —
// sub-feature endpoints below (telemetry query, standalone correlations) use
// it to enforce the same ICC_VISIBILITY_MATRIX rules the aggregated payload
// applies, so visibility is enforced by the backend, not just the frontend
// hiding tabs (FRD §17.1).
router.use((req: Request, _res: Response, next) => {
  (req as any).iccPersona = resolvePersona(req.query.persona, req.roles, req.tenant.type);
  next();
});

// GET /api/v1/incidents/:id/command-center
router.get('/', rbac('incidents:read'), async (req: Request, res: Response) => {
  const persona = (req as any).iccPersona as ICCPersona;

  // Only accepted for msp_provider — service layer validates the link exists.
  const consumerTenantId = persona === 'msp_provider' && typeof req.query.consumer_tenant_id === 'string'
    ? req.query.consumer_tenant_id
    : undefined;

  const data = await commandCenterService.getCommandCenterData(
    req.tenantId,
    req.params['id'] as string,
    persona,
    consumerTenantId,
  );
  res.json(data);
});

// GET /api/v1/incidents/:id/command-center/topology
router.get('/topology', rbac('incidents:read'), async (req: Request, res: Response) => {
  const data = await commandCenterService.getTopology(
    req.tenantId,
    req.params['id'] as string
  );
  res.json(data);
});

// GET /api/v1/incidents/:id/command-center/changes
router.get('/changes', rbac('incidents:read'), async (req: Request, res: Response) => {
  const data = await commandCenterService.getChanges(
    req.tenantId,
    req.params['id'] as string
  );
  res.json(data);
});

// GET /api/v1/incidents/:id/command-center/blast-radius
router.get('/blast-radius', rbac('incidents:read'), async (req: Request, res: Response) => {
  const data = await commandCenterService.getBlastRadius(
    req.tenantId,
    req.params['id'] as string
  );
  res.json(data);
});

// GET /api/v1/incidents/:id/command-center/business-impact
router.get('/business-impact', rbac('incidents:read'), async (req: Request, res: Response) => {
  const data = await commandCenterService.getBusinessImpact(
    req.tenantId,
    req.params['id'] as string
  );
  res.json(data);
});

// GET /api/v1/incidents/:id/command-center/consumer-impacts
// Only meaningful for msp_provider persona — returns per-consumer business impact.
router.get('/consumer-impacts', rbac('incidents:read'), async (req: Request, res: Response) => {
  if (req.tenant.type !== 'provider') {
    return res.status(403).json({ detail: 'Only provider tenants can access consumer impacts' });
  }
  const data = await commandCenterService.getConsumerImpacts(
    req.tenantId,
    req.params['id'] as string,
  );
  res.json({ data });
});

// GET /api/v1/incidents/:id/command-center/correlations
router.get('/correlations', rbac('incidents:read'), async (req: Request, res: Response) => {
  const visibility = await commandCenterService.getEffectiveVisibility(req.tenantId, (req as any).iccPersona as ICCPersona);
  if (visibility.correlated_incidents === 'hidden') {
    return res.json({ data: [] });
  }
  const data = await commandCenterService.getCorrelations(
    req.tenantId,
    req.params['id'] as string
  );
  if (visibility.correlated_incidents === 'summary') {
    return res.json({ data: { count: data.length } });
  }
  res.json({ data });
});

// POST /api/v1/incidents/:id/command-center/telemetry/query
const telemetryQuerySchema = z.object({
  type: z.enum(['metrics', 'logs', 'traces']),
  query: z.string().min(1),
  time_range: z.object({ from: z.number(), to: z.number() }).optional(),
});

const TELEMETRY_VISIBILITY_KEY = {
  metrics: 'telemetry_metrics',
  logs: 'telemetry_logs',
  traces: 'telemetry_traces',
} as const satisfies Record<string, keyof commandCenterService.PersonaVisibility>;

router.post('/telemetry/query', rbac('incidents:read'), async (req: Request, res: Response) => {
  const { type, query, time_range } = telemetryQuerySchema.parse(req.body);
  const visibility = await commandCenterService.getEffectiveVisibility(req.tenantId, (req as any).iccPersona as ICCPersona);
  const visibilityLevel: VisibilityLevel = visibility[TELEMETRY_VISIBILITY_KEY[type]];
  if (visibilityLevel === 'hidden') {
    throw AppError.forbidden(`Your persona does not have access to ${type} telemetry`);
  }
  const tenantId = req.tenantId.toString();
  const from = time_range?.from ?? Math.floor(Date.now() / 1000) - 3600;
  const to   = time_range?.to   ?? Math.floor(Date.now() / 1000);

  if (type === 'metrics') {
    const data = await lgtm.queryMetrics(tenantId, query, from, to, '60s');
    return res.json({ data });
  }
  if (type === 'logs') {
    const data = await lgtm.queryLogs(tenantId, query, from, to, 500);
    return res.json({ data });
  }
  if (type === 'traces') {
    const data = await lgtm.queryTraces(tenantId, {
      serviceName: query,
      startTime: from,
      endTime: to,
      limit: 100,
    });
    return res.json({ data });
  }
  throw AppError.badRequest('Invalid telemetry type');
});

// GET /api/v1/incidents/:id/command-center/compliance/report
router.get('/compliance/report', rbac('incidents:read'), async (req: Request, res: Response) => {
  const report = await commandCenterService.getComplianceReport(
    req.tenantId,
    req.params['id'] as string
  );
  res.json(report);
});

// PATCH /api/v1/incidents/:id/command-center/compliance/:actionKey
router.patch('/compliance/:actionKey', rbac('incidents:update'), async (req: Request, res: Response) => {
  await commandCenterService.markComplianceAction(
    req.tenantId,
    req.params['id'] as string,
    req.params['actionKey'] as string,
    req.userId,
  );
  res.json({ success: true });
});

export default router;
