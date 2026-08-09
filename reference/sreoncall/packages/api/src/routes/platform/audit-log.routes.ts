import { Router, Request, Response } from 'express';
import * as auditService from '../../services/audit.service';
import { parsePaginationParams } from '../../utils/pagination';

const router = Router();

// GET /platform/audit-log — cross-tenant audit log
router.get('/', async (req: Request, res: Response) => {
  const pagination = parsePaginationParams(req.query);
  const filter = {
    // No tenant_id filter — cross-tenant view for platform admins
    tenant_id: req.query.tenant_id as string | undefined,
    resource_type: req.query.resource_type as string | undefined,
    action: req.query.action as string | undefined,
    actor_id: req.query.actor_id as string | undefined,
    from_date: req.query.from_date ? new Date(req.query.from_date as string) : undefined,
    to_date: req.query.to_date ? new Date(req.query.to_date as string) : undefined,
  };

  const result = await auditService.queryAuditLogs(filter as any, pagination);

  res.json({
    data: result.data.map((log: any) => ({
      id: log._id.toString(),
      timestamp: log.timestamp,
      actor: log.actor,
      action: log.action,
      resource_type: log.resource_type,
      resource_id: log.resource_id,
      tenant_id: log.tenant_id?.toString?.() || null,
      changes: log.changes,
      result: log.result,
      request_id: log.request_id,
    })),
    pagination: result.pagination,
  });
});

export default router;
