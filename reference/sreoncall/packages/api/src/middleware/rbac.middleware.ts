import { Request, Response, NextFunction } from 'express';

// Role hierarchy: platform_admin > tenant_admin > manager > agent > viewer
const ROLE_PERMISSIONS: Record<string, string[]> = {
  platform_admin: ['*'],
  tenant_admin: [
    'tenants:read', 'tenants:update',
    'users:read', 'users:create', 'users:update', 'users:delete', 'users:invite',
    'incidents:read', 'incidents:create', 'incidents:update', 'incidents:delete',
    'tickets:read', 'tickets:create', 'tickets:update', 'tickets:delete', 'tickets:assign', 'tickets:bulk',
    'comments:read', 'comments:create', 'comments:update', 'comments:delete',
    'workflows:read', 'workflows:create', 'workflows:update', 'workflows:delete',
    'sla:read', 'sla:create', 'sla:update', 'sla:delete',
    'audit:read',
    'api_keys:read', 'api_keys:create', 'api_keys:revoke',
    'mcp:read', 'mcp:manage',
    'search:read',
    'files:upload', 'files:read',
    'notifications:read', 'notifications:update', 'notifications:create',
    'settings:read', 'settings:update',
    'teams:read', 'teams:create', 'teams:update', 'teams:delete',
    'channels:read', 'channels:create', 'channels:update', 'channels:delete',
    'notetaker:read', 'notetaker:create', 'notetaker:manage',
    'escalation:read', 'escalation:create', 'escalation:update', 'escalation:delete',
    'runbooks:read', 'runbooks:create', 'runbooks:update', 'runbooks:delete',
    'postmortems:read', 'postmortems:create', 'postmortems:update', 'postmortems:delete',
    'webhooks:read', 'webhooks:create', 'webhooks:update', 'webhooks:delete',
    'status-pages:read', 'status-pages:create', 'status-pages:update', 'status-pages:delete',
    'changes:read', 'changes:create', 'changes:update', 'changes:delete', 'changes:approve',
    'oncall:read', 'oncall:create', 'oncall:update', 'oncall:delete',
    'services:read', 'services:create', 'services:update', 'services:delete',
    'alert-rules:read', 'alert-rules:create', 'alert-rules:update', 'alert-rules:delete',
    'synthetic-checks:read', 'synthetic-checks:create', 'synthetic-checks:update', 'synthetic-checks:delete',
    'monitoring-integrations:read', 'monitoring-integrations:create', 'monitoring-integrations:update', 'monitoring-integrations:delete',
    'external-alert-sources:read', 'external-alert-sources:create', 'external-alert-sources:delete',
    'ingestion-tokens:read', 'ingestion-tokens:create', 'ingestion-tokens:revoke', 'ingestion-tokens:delete',
    'observability-connections:read', 'observability-connections:create', 'observability-connections:update', 'observability-connections:delete',
    'metrics:read',
    'ai:chat',
    'billing:read', 'billing:manage',
    'projects:read', 'projects:create', 'projects:update', 'projects:delete',
    'communications:read', 'communications:create',
    'agents:read', 'agents:install', 'agents:configure', 'agents:approve', 'agents:trigger',
    'dashboards:read', 'dashboards:create', 'dashboards:update', 'dashboards:delete',
    'reports:read', 'reports:export',
    'milestones:read', 'milestones:create', 'milestones:update', 'milestones:delete',
    'consent:read', 'consent:manage',
    'dsar:read', 'dsar:create', 'dsar:admin',
    'work_log_settings:read', 'work_log_settings:update', 'work_logs:approve',
    'external-alert-sources:read', 'external-alert-sources:create', 'external-alert-sources:delete',
    'service-dependencies:configure',
  ],
  manager: [
    'tenants:read',
    'users:read', 'users:invite',
    'incidents:read', 'incidents:create', 'incidents:update',
    'tickets:read', 'tickets:create', 'tickets:update', 'tickets:assign', 'tickets:bulk',
    'comments:read', 'comments:create', 'comments:update',
    'workflows:read',
    'sla:read',
    'audit:read',
    'mcp:read', 'mcp:manage',
    'search:read',
    'files:upload', 'files:read',
    'notifications:read', 'notifications:update', 'notifications:create',
    'teams:read', 'teams:create', 'teams:update',
    'channels:read', 'channels:create',
    'notetaker:read', 'notetaker:create', 'notetaker:manage',
    'escalation:read', 'escalation:create', 'escalation:update',
    'runbooks:read', 'runbooks:create', 'runbooks:update',
    'postmortems:read', 'postmortems:create', 'postmortems:update',
    'webhooks:read',
    'status-pages:read',
    'changes:read', 'changes:create', 'changes:update', 'changes:approve',
    'oncall:read', 'oncall:create', 'oncall:update',
    'services:read', 'services:create', 'services:update',
    'alert-rules:read', 'alert-rules:create', 'alert-rules:update',
    'synthetic-checks:read', 'synthetic-checks:create', 'synthetic-checks:update',
    'monitoring-integrations:read', 'monitoring-integrations:create', 'monitoring-integrations:update',
    'ingestion-tokens:read', 'ingestion-tokens:create', 'ingestion-tokens:revoke',
    'observability-connections:read', 'observability-connections:create', 'observability-connections:update',
    'metrics:read',
    'ai:chat',
    'billing:read',
    'projects:read', 'projects:create', 'projects:update',
    'communications:read', 'communications:create',
    'agents:read', 'agents:approve', 'agents:trigger',
    'dashboards:read', 'dashboards:create', 'dashboards:update',
    'reports:read', 'reports:export',
    'milestones:read', 'milestones:create', 'milestones:update',
    'consent:read', 'consent:manage',
    'dsar:read', 'dsar:create',
    'work_log_settings:read', 'work_log_settings:update', 'work_logs:approve',
    'service-dependencies:configure',
  ],
  agent: [
    'tenants:read',
    'users:read',
    'incidents:read', 'incidents:create', 'incidents:update',
    'tickets:read', 'tickets:create', 'tickets:update', 'tickets:assign',
    'comments:read', 'comments:create', 'comments:update',
    'workflows:read',
    'sla:read',
    'search:read',
    'files:upload', 'files:read',
    'notifications:read', 'notifications:update',
    'teams:read',
    'channels:read', 'channels:create',
    'notetaker:read', 'notetaker:create',
    'escalation:read',
    'runbooks:read', 'runbooks:update',
    'postmortems:read',
    'webhooks:read',
    'status-pages:read',
    'changes:read', 'changes:create', 'changes:update',
    'oncall:read',
    'services:read',
    'alert-rules:read',
    'synthetic-checks:read', 'synthetic-checks:update',
    'monitoring-integrations:read',
    'ingestion-tokens:read',
    'observability-connections:read',
    'metrics:read',
    'ai:chat',
    'projects:read',
    'communications:read', 'communications:create',
    'agents:read',
    'dashboards:read', 'dashboards:create', 'dashboards:update',
    'milestones:read',
    'consent:read',
    'dsar:read', 'dsar:create',
  ],
  viewer: [
    'tenants:read',
    'users:read',
    'incidents:read',
    'tickets:read',
    'comments:read',
    'workflows:read',
    'sla:read',
    'search:read',
    'files:read',
    'notifications:read', 'notifications:update',
    'teams:read',
    'channels:read',
    'notetaker:read',
    'escalation:read',
    'runbooks:read',
    'postmortems:read',
    'status-pages:read',
    'changes:read',
    'oncall:read',
    'services:read',
    'alert-rules:read',
    'synthetic-checks:read',
    'monitoring-integrations:read',
    'ingestion-tokens:read',
    'observability-connections:read',
    'metrics:read',
    'projects:read',
    'agents:read',
    'dashboards:read',
    'reports:read',
    'milestones:read',
    'consent:read',
    'dsar:read', 'dsar:create',
  ],
};

export function hasPermission(roles: string[], requiredPermission: string): boolean {
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) continue;
    if (perms.includes('*') || perms.includes(requiredPermission)) {
      return true;
    }
  }
  return false;
}

/** Same wildcard/exact-match semantics as hasPermission, for a flat permission list (e.g. an API key's `permissions` field) rather than roles resolved through ROLE_PERMISSIONS. */
export function hasFlatPermission(permissions: string[], requiredPermission: string): boolean {
  return permissions.includes('*') || permissions.includes(requiredPermission);
}

export function rbac(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.roles || req.roles.length === 0) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'No roles assigned to user.',
      });
      return;
    }

    if (!hasPermission(req.roles, permission)) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: `Missing required permission: ${permission}`,
      });
      return;
    }

    next();
  };
}
