import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/index';
import { getRedis } from '../config/redis';
import { User } from '../models/user.model';
import { logger } from '../utils/logger';

interface JwtPayload {
  sub: string;
  tenant_id: string;
  email: string;
  roles: string[];
  jti: string;
  impersonated_by?: string;
  iat: number;
  exp: number;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid Authorization header. Expected: Bearer <token>',
    });
    return;
  }

  const token = authHeader.slice(7);
  const config = getConfig();

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
  } catch (err: any) {
    const detail =
      err.name === 'TokenExpiredError'
        ? 'Token has expired.'
        : 'Invalid token.';
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail,
    });
    return;
  }

  // Check deny-list for revoked tokens
  const redis = getRedis();
  try {
    const revoked = await redis.get(`token:revoked:${payload.jti}`);
    if (revoked) {
      res.status(401).json({
        type: 'https://sreoncall.io/problems/token-revoked',
        title: 'Token Revoked',
        status: 401,
        detail: 'This token has been revoked.',
      });
      return;
    }
  } catch (err: any) {
    logger.warn('Failed to check token deny-list', { jti: payload.jti, error: err.message });
  }

  // Load user
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'User not found or inactive.',
    });
    return;
  }

  // Verify tenant_id matches
  if (req.tenantId && user.tenant_id.toString() !== req.tenantId.toString()) {
    res.status(403).json({
      type: 'https://sreoncall.io/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Token tenant does not match request tenant.',
    });
    return;
  }

  req.userId = user._id;
  req.user = user;
  req.roles = payload.roles || user.roles;
  req.isImpersonating = !!payload.impersonated_by;
  req.impersonatedBy = payload.impersonated_by;

  next();
}
