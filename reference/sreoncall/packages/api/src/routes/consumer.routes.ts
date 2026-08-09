import { Router, Request, Response } from 'express';
import { rbac } from '../middleware/rbac.middleware';
import { requireTenantType } from '../middleware/tenantType.middleware';
import * as consumerService from '../services/consumer.service';
import { Runbook } from '../models/runbook.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';

const router = Router();

// All consumer routes require tenant to be type 'consumer'
router.use(requireTenantType('consumer'));

// GET /consumer/provider
router.get('/provider', rbac('tenants:read'), async (req: Request, res: Response) => {
  const result = await consumerService.getMyProvider(req.tenantId);

  res.json({
    _id: result.link._id.toString(),
    provider: result.provider && (result.provider as any)._id ? {
      _id: (result.provider as any)._id.toString(),
      slug: (result.provider as any).slug,
      name: (result.provider as any).name,
      type: (result.provider as any).type,
      status: (result.provider as any).status,
    } : null,
    scope: result.scope,
    status: result.status,
  });
});

// GET /consumer/provider/runbooks — get provider's shared runbooks
router.get('/provider/runbooks', rbac('runbooks:read'), async (req: Request, res: Response) => {
  const link = await ProviderConsumerLink.findOne({
    consumer_tenant_id: req.tenantId,
    status: 'active',
  });

  if (!link || !link.scope.includes('runbooks')) {
    res.json({ data: [] });
    return;
  }

  const runbooks = await Runbook.find({
    tenant_id: link.provider_tenant_id,
    visibility: 'provider_shared',
    status: 'published',
  })
    .populate('created_by', 'name email')
    .sort({ created_at: -1 });

  res.json({
    data: runbooks.map((r: any) => ({
      id: r._id.toString(),
      title: r.title,
      description: r.description || '',
      category: r.category || 'general',
      status: r.status,
      visibility: r.visibility,
      source: 'provider',
      tags: r.tags || [],
      version: r.version ?? 1,
      created_at: r.created_at,
    })),
  });
});

export default router;
