// packages/web/lib/types/partner.ts
export interface PartnerData {
  partnerUser: {
    _id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    role: 'owner' | 'admin' | 'member';
    lastLoginAt: string | null;
  };
  partner: {
    _id: string;
    company: string;
    partnerType: string;
    status: string;
    commissionRate: number;
    onboardingCompleted: boolean;
  };
}
