import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as assetService from '../services/asset.service';

const router = Router();

function serialize(a: any) {
  return {
    id:                   a._id?.toString() ?? a.id,
    name:                 a.name,
    provider:             a.provider,
    category:             a.category,
    resource_type:        a.resource_type,
    region:               a.region ?? '',
    cloud_id:             a.cloud_id,
    cloud_account_id:     a.cloud_account_id ?? '',
    metadata:             a.metadata ?? {},
    parent_asset_id:      a.parent_asset_id?.toString() ?? null,
    k8s_namespace:        a.k8s_namespace ?? null,
    k8s_kind:             a.k8s_kind ?? null,
    k8s_replicas_desired: a.k8s_replicas_desired ?? null,
    k8s_replicas_ready:   a.k8s_replicas_ready ?? null,
    k8s_pod_issues:       a.k8s_pod_issues ?? [],
    status:               a.status ?? 'unknown',
    status_reason:        a.status_reason ?? null,
    last_seen_at:         a.last_seen_at,
    service_id:           a.service_id?.toString() ?? null,
    connection_id:        a.connection_id?.toString() ?? null,
    is_aggregate:         a.is_aggregate ?? false,
    aggregate_count:      a.aggregate_count ?? null,
    created_at:           a.created_at,
    updated_at:           a.updated_at,
  };
}

// GET /api/v1/assets/summary — aggregated counts
router.get('/summary', rbac('services:read'), async (req: Request, res: Response) => {
  const summary = await assetService.getAssetsSummary(req.tenantId.toString());
  res.json(summary);
});

// GET /api/v1/assets — list assets
router.get('/', rbac('services:read'), async (req: Request, res: Response) => {
  const result = await assetService.listAssets(req.tenantId.toString(), {
    provider:      req.query.provider as string | undefined,
    category:      req.query.category as string | undefined,
    status:        req.query.status as string | undefined,
    parent_id:     req.query.parent_id as string | undefined,
    connection_id: req.query.connection_id as string | undefined,
    resource_type: req.query.resource_type as string | undefined,
    cluster_id:    req.query.cluster_id as string | undefined,
    tree:          req.query.tree === 'true',
    limit:         req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    cursor:        req.query.cursor as string | undefined,
  });
  res.json({
    data: result.data.map(serialize),
    pagination: result.pagination,
  });
});

// GET /api/v1/assets/:id — single asset
router.get('/:id', rbac('services:read'), async (req: Request, res: Response) => {
  const doc = await assetService.getAssetById(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// GET /api/v1/assets/:id/tree — K8s cluster tree
router.get('/:id/tree', rbac('services:read'), async (req: Request, res: Response) => {
  const result = await assetService.getAssetTree(req.tenantId.toString(), req.params['id'] as string);
  res.json({
    cluster: serialize(result.cluster),
    children: result.children.map(serialize),
  });
});

const linkSchema = z.object({
  service_id: z.string().min(1),
});

// POST /api/v1/assets/:id/link — link asset to service
router.post('/:id/link', rbac('services:update'), async (req: Request, res: Response) => {
  const { service_id } = linkSchema.parse(req.body);
  const doc = await assetService.linkAssetToService(req.tenantId.toString(), req.params['id'] as string, service_id);
  res.json(serialize(doc));
});

// DELETE /api/v1/assets/:id/link — unlink asset from service
router.delete('/:id/link', rbac('services:update'), async (req: Request, res: Response) => {
  const doc = await assetService.unlinkAssetFromService(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

export default router;
