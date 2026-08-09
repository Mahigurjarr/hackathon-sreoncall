import { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../models/audit-log.model';
import { logger } from '../utils/logger';

interface AuditOptions {
  action: string;
  resourceType: string;
  getResourceId?: (req: Request) => string;
}

export function auditMiddleware(options: AuditOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Capture original end to hook into response completion
    const originalEnd = res.end;
    const startTime = Date.now();

    // Override res.end to capture after response
    (res as any).end = function (...args: any[]) {
      // Call original end first
      (originalEnd as Function).apply(res, args);

      // Fire-and-forget audit log creation
      const resourceId = options.getResourceId
        ? options.getResourceId(req)
        : (req.params.id as string) || (req.params.ticketId as string) || undefined;

      const auditEntry = {
        tenant_id: req.tenantId,
        timestamp: new Date(),
        actor: {
          type: req.isImpersonating ? 'impersonated' as const : 'user' as const,
          id: req.userId,
          email: req.user?.email,
          ip: req.ip || req.socket.remoteAddress || 'unknown',
          user_agent: req.headers['user-agent'] || 'unknown',
          impersonated_by: req.impersonatedBy,
        },
        action: options.action,
        resource_type: options.resourceType,
        resource_id: resourceId,
        changes: (req as any)._auditChanges || [],
        result: res.statusCode >= 200 && res.statusCode < 400 ? 'success' as const : 'failure' as const,
        request_id: req.requestId,
      };

      AuditLog.create(auditEntry).catch((err) => {
        logger.error('Failed to create audit log', {
          error: err.message,
          action: options.action,
          resourceType: options.resourceType,
          duration: Date.now() - startTime,
        });
      });
    };

    next();
  };
}

/**
 * Helper to attach changes to the request for audit logging.
 */
export function setAuditChanges(
  req: Request,
  changes: Array<{ field: string; old_value: any; new_value: any }>
): void {
  (req as any)._auditChanges = changes;
}
