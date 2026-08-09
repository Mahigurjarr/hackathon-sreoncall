import { Router, Request, Response } from 'express';
import { rbac } from '../middleware/rbac.middleware';
import { generateTenantObservabilityVerificationReport } from '../services/tenant-observability-verification.service';

const router = Router();

router.get('/', rbac('metrics:read'), async (req: Request, res: Response) => {
  const report = await generateTenantObservabilityVerificationReport(String((req as any).tenantId));
  res.json(report);
});

export default router;
