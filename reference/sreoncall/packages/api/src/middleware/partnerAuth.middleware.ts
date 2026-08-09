import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import type { PartnerUserRole } from '../models/partner-user.model';

interface PartnerTokenPayload {
  sub: string;
  partnerId: string;
  email: string;
  role?: PartnerUserRole;
  type: 'partner';
  iat: number;
  exp: number;
}

function readCookie(req: Request, name: string): string | undefined {
  // Prefer cookie-parser if present, otherwise parse the raw Cookie header.
  // The API does not currently mount cookie-parser, so req.cookies is undefined.
  const parsed = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (parsed && parsed[name]) return parsed[name];

  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function partnerAuthGuard(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = readCookie(req, 'partner_token');

  if (!token) {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid partner token.',
    });
    return;
  }

  try {
    const payload = jwt.verify(token, getConfig().JWT_SECRET, {
      algorithms: ['HS256'] as jwt.Algorithm[],
    }) as PartnerTokenPayload;

    if (payload.type !== 'partner') {
      res.status(401).json({
        type: 'https://sreoncall.io/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid token type.',
      });
      return;
    }

    req.partnerUser = {
      partnerUserId: payload.sub,
      partnerId: payload.partnerId,
      email: payload.email,
      // Tokens issued before the team feature don't carry a role — treat as member.
      role: payload.role ?? 'member',
    };

    next();
  } catch {
    res.status(401).json({
      type: 'https://sreoncall.io/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid token.',
    });
  }
}

/** Restrict a route to callers whose partner role is in the allowed set. */
export function requirePartnerRole(...allowed: PartnerUserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.partnerUser?.role;
    if (!role || !allowed.includes(role)) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'Insufficient partner role for this action.',
      });
      return;
    }
    next();
  };
}
