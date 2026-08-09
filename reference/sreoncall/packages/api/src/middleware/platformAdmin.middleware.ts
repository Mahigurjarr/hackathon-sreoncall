import { Request, Response, NextFunction } from 'express';

export function platformAdminGuard(req: Request, res: Response, next: NextFunction): void {
  if (!req.roles || !req.roles.includes('platform_admin')) {
    res.status(403).json({
      type: 'https://sreoncall.io/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Platform admin access required.',
    });
    return;
  }
  next();
}
