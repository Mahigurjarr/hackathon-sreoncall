import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ScimToken } from '../models/scim-token.model';
import { Tenant } from '../models/tenant.model';
import { logger } from '../utils/logger';

/**
 * SCIM bearer token authentication middleware.
 * Validates the token, resolves the tenant, and sets req.tenantId / req.tenant.
 */
export async function scimAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Missing or invalid Authorization header.',
    });
    return;
  }

  const token = authHeader.slice(7);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const scimToken = await ScimToken.findOne({
    token_hash: tokenHash,
    revoked_at: null,
  });

  if (!scimToken) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'Invalid or revoked SCIM token.',
    });
    return;
  }

  if (scimToken.expires_at && scimToken.expires_at < new Date()) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'SCIM token has expired.',
    });
    return;
  }

  const tenant = await Tenant.findById(scimToken.tenant_id);
  if (!tenant || tenant.status === 'deleted' || tenant.status === 'suspended') {
    res.status(403).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '403',
      detail: 'Tenant not found or inactive.',
    });
    return;
  }

  // Update last_used_at (fire-and-forget)
  ScimToken.updateOne({ _id: scimToken._id }, { last_used_at: new Date() }).catch((err) => {
    logger.warn('Failed to update SCIM token last_used_at', { error: err.message });
  });

  req.tenant = tenant;
  req.tenantId = tenant._id;
  next();
}
