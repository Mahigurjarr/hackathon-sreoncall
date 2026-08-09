declare namespace Express {
  interface Request {
    requestId: string;
    tenantId: import('mongoose').Types.ObjectId;
    tenant: import('../models/tenant.model').TenantDocument;
    userId: import('mongoose').Types.ObjectId;
    user: import('../models/user.model').UserDocument;
    roles: string[];
    isImpersonating: boolean;
    impersonatedBy?: string;
    partnerUser?: {
      partnerUserId: string;
      partnerId: string;
      email: string;
      role: 'owner' | 'admin' | 'member';
    };
    /** Set by apiKeyAuth.middleware.ts for API-key-authenticated requests (e.g. MCP) — no user session exists, so authorization checks against these directly instead of req.roles. */
    apiKeyId?: import('mongoose').Types.ObjectId;
    apiKeyPermissions?: string[];
  }
}
