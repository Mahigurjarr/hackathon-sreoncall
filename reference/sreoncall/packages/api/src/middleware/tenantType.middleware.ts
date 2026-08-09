import { Request, Response, NextFunction } from 'express';
import { TenantType } from '../models/tenant.model';

export function requireTenantType(...types: TenantType[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantType = (req.tenant as any)?.type;
    if (!tenantType || !types.includes(tenantType)) {
      res.status(403).json({
        type: 'https://sreoncall.io/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: `This action requires tenant type: ${types.join(' or ')}`,
      });
      return;
    }
    next();
  };
}
