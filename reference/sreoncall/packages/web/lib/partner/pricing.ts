// Source of truth for partner-facing pricing mirrors pricing-proposal.md.
// Keep in sync with /Users/swapnilg/projects/internal/sreoncall/pricing-proposal.md

export interface PlanTier {
  id: 'startup' | 'growth' | 'enterprise';
  name: string;
  target: string;
  annualMonthly: number; // USD/mo billed annually
  monthly: number; // USD/mo billed monthly (annual +15%)
  highlights: string[];
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'startup',
    name: 'Startup',
    target: 'Small teams (5–10)',
    annualMonthly: 999,
    monthly: 1149,
    highlights: [
      '∞ services · 10 users · 1,000 incidents/mo',
      'Unlimited hosts · 50K metrics series · 7-day retention',
      'eBPF auto-instrumentation · cross-signal correlation',
      'Slack/Teams + SMS/Voice (limited)',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    target: 'Growing teams (10–50)',
    annualMonthly: 1999,
    monthly: 2299,
    highlights: [
      '∞ services · 50 users · 5,000 incidents/mo',
      '200K series · 15-day retention · deep traces (Odigos)',
      'AI observability, AI agents, AI-generated postmortems',
      'Custom status-page domain · BYOS · log pipelines',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    target: 'Large orgs (50–200+)',
    annualMonthly: 5999,
    monthly: 6899,
    highlights: [
      '∞ services · 200 users · 10,000 incidents/mo',
      '1M series · 30-day retention · 5M AI tokens/mo',
      'SSO (SAML/OIDC) · SCIM · IP allowlisting · audit log 90d',
      'Provider/Consumer model · cross-tenant bridges · 10 managed tenants',
    ],
  },
];

export const RESELLER_MARGIN = [
  { year: 'Year 1', margin: 35, partnerPays: 65 },
  { year: 'Year 2', margin: 30, partnerPays: 70 },
  { year: 'Year 3+', margin: 25, partnerPays: 75 },
];

export const REFERRAL_RATES = {
  year1: 15,
  year2Plus: 7.5,
};

export const MSP_RATES = {
  platformMarginPct: 40, // flat, no taper
  managedServicesMarginPct: 80,
};

export const MANAGED_SERVICES = [
  { service: 'Shared L1 SRE (8x5)', startup: 500, growth: 1000, enterprise: 2000 },
  { service: 'Shared L1 SRE (24x7)', startup: 1000, growth: 2000, enterprise: 4000 },
  { service: 'Dedicated SRE', startup: 8000, growth: 8000, enterprise: 8000 },
  { service: 'Onboarding Package (one-time)', startup: 2500, growth: 2500, enterprise: 2500 },
  { service: 'Migration Service (one-time)', startup: 1500, growth: 1500, enterprise: 1500 },
];

export function fmtUSD(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/** Reseller net price table: what the partner pays SREonCall per month. */
export function resellerNetPrice(listAnnualMonthly: number, partnerPaysPct: number): number {
  return Math.round(listAnnualMonthly * (partnerPaysPct / 100));
}

/** Reseller margin earned per month on a single sub. */
export function resellerMargin(listAnnualMonthly: number, marginPct: number): number {
  return Math.round(listAnnualMonthly * (marginPct / 100));
}
