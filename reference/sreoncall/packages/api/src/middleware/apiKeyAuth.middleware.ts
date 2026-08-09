import { Request, Response, NextFunction } from 'express';
import { Tenant } from '../models/tenant.model';
import { verifyApiKey } from '../services/api-key.service';
import { logger } from '../utils/logger';

/**
 * API-key bearer authentication for machine/integration clients that have no
 * user session (e.g. the MCP server). Resolves the tenant from the key —
 * there is no Host/subdomain to fall back on for these requests — and sets
 * req.tenantId/req.tenant plus req.apiKeyId/req.apiKeyPermissions in place of
 * the session fields (req.userId/req.roles) that authMiddleware would set.
 */
export async function apiKeyAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid Authorization header.',
    });
    return;
  }

  const rawKey = authHeader.slice(7);
  const apiKey = await verifyApiKey(rawKey);
  if (!apiKey) {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid, revoked, or expired API key.',
    });
    return;
  }

  const tenant = await Tenant.findById(apiKey.tenant_id);
  if (!tenant || tenant.status === 'deleted' || tenant.status === 'suspended') {
    res.status(403).json({
      type: 'https://sreoncall.io/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Tenant not found or inactive.',
    });
    return;
  }

  req.tenant = tenant;
  req.tenantId = tenant._id;
  req.apiKeyId = apiKey._id;
  req.apiKeyPermissions = apiKey.permissions;

  logger.debug('API key authenticated', { tenantId: tenant._id.toString(), apiKeyId: apiKey._id.toString() });

  next();
}
