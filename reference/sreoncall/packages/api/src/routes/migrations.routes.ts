import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { AppError } from '../middleware/errorHandler.middleware';
import { Dashboard } from '../models/dashboard.model';
import { AlertRule } from '../models/alert-rule.model';
import * as migration from '../services/migration';
import type { Provider } from '../services/migration';

const OPERATOR_ALIASES: Record<string, 'gt' | 'lt' | 'gte' | 'lte' | 'eq'> = {
  '>': 'gt', 'gt': 'gt', 'above': 'gt', 'greater': 'gt',
  '<': 'lt', 'lt': 'lt', 'below': 'lt', 'less': 'lt',
  '>=': 'gte', 'gte': 'gte',
  '<=': 'lte', 'lte': 'lte',
  '=': 'eq', '==': 'eq', 'eq': 'eq', 'equal': 'eq',
};

function parseCondition(raw: string): {
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
} {
  if (!raw) return { operator: 'gt', threshold: 0, severity: 'medium' };

  const match = raw.match(/^\s*(>=|<=|>|<|==|=|gt|lt|gte|lte|eq|above|below|greater|less|equal)\s+(-?[\d.]+)/i);
  if (match) {
    const op = OPERATOR_ALIASES[match[1].toLowerCase()] ?? 'gt';
    const threshold = parseFloat(match[2]);
    return { operator: op, threshold: isNaN(threshold) ? 0 : threshold, severity: 'medium' };
  }

  const numMatch = raw.match(/(-?[\d.]+)/);
  if (numMatch) {
    return { operator: 'gt', threshold: parseFloat(numMatch[1]), severity: 'medium' };
  }

  return { operator: 'gt', threshold: 0, severity: 'medium' };
}

const router = Router();

const providerEnum = z.enum(['grafana', 'datadog', 'newrelic', 'groundcover']);

const credentialsSchema = z.object({
  provider: providerEnum,
  apiKey: z.string().min(1, 'API key is required'),
  endpoint: z.string().url().optional(),
  appKey: z.string().optional(),
});

const importSchema = z.object({
  provider: providerEnum,
  apiKey: z.string().min(1),
  endpoint: z.string().url().optional(),
  appKey: z.string().optional(),
  resources: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['dashboard', 'alert']),
  })).min(1).max(100),
});

// POST /api/v1/migrations/connect — validate credentials and return resource counts
router.post('/connect', rbac('dashboards:create'), async (req: Request, res: Response) => {
  const body = credentialsSchema.parse(req.body);
  const result = await migration.connect(body.provider, {
    apiKey: body.apiKey,
    endpoint: body.endpoint,
    appKey: body.appKey,
  });

  if (!result.connected) {
    throw AppError.badRequest('Failed to connect. Check your credentials and endpoint.');
  }

  res.json({
    connected: true,
    provider: body.provider,
    dashboards: result.dashboards,
    alerts: result.alerts,
  });
});

// GET /api/v1/migrations/dashboards — list available dashboards from provider
router.get('/dashboards', rbac('dashboards:create'), async (req: Request, res: Response) => {
  const provider = providerEnum.parse(req.query.provider);
  const apiKey = z.string().min(1).parse(req.query.apiKey);
  const endpoint = req.query.endpoint ? z.string().url().parse(req.query.endpoint) : undefined;
  const appKey = req.query.appKey ? String(req.query.appKey) : undefined;

  const dashboards = await migration.fetchDashboards(provider, { apiKey, endpoint, appKey });
  res.json({ data: dashboards });
});

// GET /api/v1/migrations/alerts — list available alerts from provider
router.get('/alerts', rbac('dashboards:create'), async (req: Request, res: Response) => {
  const provider = providerEnum.parse(req.query.provider);
  const apiKey = z.string().min(1).parse(req.query.apiKey);
  const endpoint = req.query.endpoint ? z.string().url().parse(req.query.endpoint) : undefined;
  const appKey = req.query.appKey ? String(req.query.appKey) : undefined;

  const alerts = await migration.fetchAlerts(provider, { apiKey, endpoint, appKey });
  res.json({ data: alerts });
});

// POST /api/v1/migrations/import — import selected resources, create SREonCall dashboards/alerts
router.post('/import', rbac('dashboards:create'), async (req: Request, res: Response) => {
  const body = importSchema.parse(req.body);
  const creds = { apiKey: body.apiKey, endpoint: body.endpoint, appKey: body.appKey };
  const provider = body.provider;

  const results: Array<{
    resourceId: string;
    type: string;
    status: 'success' | 'error';
    createdId?: string;
    name?: string;
    warnings?: string[];
    error?: string;
  }> = [];

  for (const resource of body.resources) {
    try {
      if (resource.type === 'dashboard') {
        const imported = await migration.importDashboard(provider, creds, resource.id);

        const doc = await Dashboard.create({
          tenant_id: req.tenantId,
          created_by: req.userId,
          name: imported.name,
          description: imported.description,
          panels: imported.panels.map(p => ({
            id: p.id,
            title: p.title,
            type: p.type,
            grid: p.grid,
            data_source: { type: 'managed', provider: null, service_id: null },
            query: p.query,
            options: {},
            thresholds: [],
          })),
          tags: imported.tags,
        });

        results.push({
          resourceId: resource.id,
          type: 'dashboard',
          status: 'success',
          createdId: doc._id.toString(),
          name: imported.name,
          warnings: imported.warnings,
        });
      } else if (resource.type === 'alert') {
        const imported = await migration.importAlert(provider, creds, resource.id);
        const query = imported.query || null;

        const parsed = parseCondition(imported.condition);
        const alertWarnings = [...(imported.warnings || [])];
        if (!query) alertWarnings.push('No query found — alert created as webhook placeholder');

        let alertName = imported.name;
        let doc;
        try {
          doc = await AlertRule.create({
            tenant_id: req.tenantId,
            created_by: req.userId,
            name: alertName,
            description: `Imported from ${provider}`,
            status: 'inactive',
            severity: parsed.severity,
            source_type: query ? 'managed_promql' : 'byos_webhook',
            query,
            condition: {
              metric: query || imported.name,
              operator: parsed.operator,
              threshold: parsed.threshold,
              window_minutes: 5,
            },
            labels: { imported_from: provider, original_id: resource.id },
            auto_create_incident: false,
            incident_severity: 'sev3',
            category: 'imported',
          });
        } catch (dupErr: any) {
          if (dupErr.code === 11000) {
            alertName = `${imported.name} (imported ${Date.now()})`;
            doc = await AlertRule.create({
              tenant_id: req.tenantId,
              created_by: req.userId,
              name: alertName,
              description: `Imported from ${provider}`,
              status: 'inactive',
              severity: parsed.severity,
              source_type: query ? 'managed_promql' : 'byos_webhook',
              query,
              condition: {
                metric: query || alertName,
                operator: parsed.operator,
                threshold: parsed.threshold,
                window_minutes: 5,
              },
              labels: { imported_from: provider, original_id: resource.id },
              auto_create_incident: false,
              incident_severity: 'sev3',
              category: 'imported',
            });
          } else {
            throw dupErr;
          }
        }

        results.push({
          resourceId: resource.id,
          type: 'alert',
          status: 'success',
          createdId: doc._id.toString(),
          name: alertName,
          warnings: alertWarnings,
        });
      }
    } catch (err: any) {
      results.push({
        resourceId: resource.id,
        type: resource.type,
        status: 'error',
        error: err.message || 'Import failed',
      });
    }
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  res.status(successCount > 0 ? 201 : 400).json({
    summary: {
      total: body.resources.length,
      success: successCount,
      errors: errorCount,
    },
    results,
  });
});

export default router;
