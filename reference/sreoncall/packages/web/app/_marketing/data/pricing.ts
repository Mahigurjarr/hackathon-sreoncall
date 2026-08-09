// packages/web/app/_marketing/data/pricing.ts

export type BillingCycle = 'annual' | 'monthly';

export interface PricingTier {
  id: string;
  name: string;
  annualPrice: number | null; // null = custom
  monthlyPrice: number | null;
  priceLabel?: string;
  users: string;
  highlights: string[];
  cta: string;
  ctaHref: string;
  ctaVariant: 'primary' | 'secondary' | 'ghost';
  popular?: boolean;
}

export const TIERS: PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    annualPrice: 0,
    monthlyPrice: 0,
    priceLabel: 'Contact sales',
    users: '3 users',
    highlights: ['3 users · ∞ services', '∞ hosts monitored', 'Email alerts only', '10K metrics · 3-day retention'],
    cta: 'Contact sales',
    ctaHref: '/contact?plan=free',
    ctaVariant: 'ghost',
  },
  {
    id: 'startup',
    name: 'Startup',
    annualPrice: 999,
    monthlyPrice: 1149,
    priceLabel: 'Contact sales',
    users: '10 users',
    highlights: ['10 users · ∞ services', '∞ hosts · eBPF included', 'SMS + Slack/Teams alerts', '50K metrics · 7-day retention', '100 SMS · 50 voice calls/mo'],
    cta: 'Contact sales',
    ctaHref: '/contact?plan=startup',
    ctaVariant: 'secondary',
  },
  {
    id: 'growth',
    name: 'Growth',
    annualPrice: 1999,
    monthlyPrice: 2299,
    priceLabel: 'Contact sales',
    users: '50 users',
    highlights: ['50 users · ∞ services', 'AI-powered RCA + AI agents', 'Full observability (200K metrics)', '15-day retention · 50 traces/K/day', '99.9% SLA'],
    cta: 'Contact sales',
    ctaHref: '/contact?plan=growth',
    ctaVariant: 'primary',
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    annualPrice: 5999,
    monthlyPrice: 6899,
    priceLabel: 'Contact sales',
    users: '200 users',
    highlights: ['200 users · ∞ services', 'SSO/SAML + SCIM provisioning', 'MSP-ready · 10 managed tenants', '1M metrics · 30-day retention', 'Named CSM · IP allowlisting'],
    cta: 'Contact sales',
    ctaHref: '/contact?plan=enterprise',
    ctaVariant: 'secondary',
  },
  {
    id: 'dedicated',
    name: 'Dedicated',
    annualPrice: null,
    monthlyPrice: null,
    users: '∞ users',
    highlights: ['Unlimited users & services', 'On-premises or air-gapped', 'White-label branding', '99.99% SLA · Custom retention'],
    cta: 'Contact sales',
    ctaHref: '/contact?plan=dedicated',
    ctaVariant: 'ghost',
  },
];

export interface FeatureGroup {
  group: string;
  rows: FeatureRow[];
}

export interface FeatureRow {
  feature: string;
  free: string;
  startup: string;
  growth: string;
  enterprise: string;
  dedicated: string;
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    group: 'Core Platform',
    rows: [
      { feature: 'Users', free: '3', startup: '10', growth: '50', enterprise: '200', dedicated: 'Unlimited' },
      { feature: 'Services', free: 'Unlimited', startup: 'Unlimited', growth: 'Unlimited', enterprise: 'Unlimited', dedicated: 'Unlimited' },
      { feature: 'Incidents / month', free: '100', startup: '1,000', growth: '5,000', enterprise: '10,000', dedicated: 'Unlimited' },
      { feature: 'Tickets / month', free: '100', startup: '1,000', growth: '5,000', enterprise: '10,000', dedicated: 'Unlimited' },
      { feature: 'File storage', free: '100 MB', startup: '500 MB', growth: '1 GB', enterprise: '5 GB', dedicated: 'Unlimited' },
    ],
  },
  {
    group: 'Incident Management & On-Call',
    rows: [
      { feature: 'Incident management', free: '✓', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'On-call scheduling', free: '✓', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Escalation policies', free: '1', startup: '10', growth: '20', enterprise: '50', dedicated: 'Unlimited' },
      { feature: 'Notification: Email', free: '✓', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Notification: Slack / Teams', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Notification: SMS / mo', free: '—', startup: '100', growth: '500', enterprise: '2,000', dedicated: 'Unlimited' },
      { feature: 'Notification: Voice calls / mo', free: '—', startup: '50', growth: '200', enterprise: '1,000', dedicated: 'Unlimited' },
      { feature: 'Notification: WhatsApp / mo', free: '—', startup: '—', growth: '200', enterprise: '1,000', dedicated: 'Unlimited' },
      { feature: 'War Rooms (Slack)', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Postmortems & RCA', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'AI-powered RCA', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
    ],
  },
  {
    group: 'Observability',
    rows: [
      { feature: 'Hosts monitored', free: 'Unlimited', startup: 'Unlimited', growth: 'Unlimited', enterprise: 'Unlimited', dedicated: 'Unlimited' },
      { feature: 'Metrics series', free: '10K', startup: '50K', growth: '200K', enterprise: '1M', dedicated: 'Unlimited' },
      { feature: 'Metrics retention', free: '3 days', startup: '7 days', growth: '15 days', enterprise: '30 days', dedicated: '90 days' },
      { feature: 'Log ingestion rate', free: '1 MB/s', startup: '2 MB/s', growth: '4 MB/s', enterprise: '10 MB/s', dedicated: 'Unlimited' },
      { feature: 'Log retention', free: '3 days', startup: '7 days', growth: '15 days', enterprise: '30 days', dedicated: '90 days' },
      { feature: 'Traces / day', free: '5,000', startup: '20,000', growth: '50,000', enterprise: '200,000', dedicated: 'Unlimited' },
      { feature: 'Trace retention', free: '3 days', startup: '7 days', growth: '15 days', enterprise: '30 days', dedicated: '90 days' },
      { feature: 'eBPF auto-instrumentation', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Deep traces (Odigos)', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Continuous profiling', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Browser monitoring (RUM)', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'LLM observability', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Cross-signal correlation', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'BYOS (Bring Your Own Stack)', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: '3rd-party integrations', free: '—', startup: '—', growth: '1 provider', enterprise: '3 providers', dedicated: 'Unlimited' },
      { feature: 'Log pipelines', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
    ],
  },
  {
    group: 'Dashboards, Alerts & SLOs',
    rows: [
      { feature: 'Dashboards', free: '3', startup: '10', growth: '50', enterprise: '100', dedicated: 'Unlimited' },
      { feature: 'Dashboard templates', free: '5 basic', startup: 'All 41+', growth: 'All 41+', enterprise: 'All 41+', dedicated: 'All 41+' },
      { feature: 'Alert rules', free: '5', startup: '20', growth: '50', enterprise: '100', dedicated: 'Unlimited' },
      { feature: 'Alert quality scoring', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'SLOs', free: '—', startup: '3', growth: '10', enterprise: '50', dedicated: 'Unlimited' },
      { feature: 'Burn rate forecasting', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Synthetic checks', free: '—', startup: '5', growth: '20', enterprise: '50', dedicated: 'Unlimited' },
      { feature: 'Status pages', free: '—', startup: '1', growth: '10', enterprise: '100', dedicated: 'Unlimited' },
    ],
  },
  {
    group: 'AI & Automation',
    rows: [
      { feature: 'AI observability queries', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'AI agent definitions', free: '—', startup: '—', growth: '1', enterprise: '5', dedicated: 'Unlimited' },
      { feature: 'AI agent executions / mo', free: '—', startup: '—', growth: '100', enterprise: '1,000', dedicated: 'Unlimited' },
      { feature: 'AI-generated postmortems', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'AI runbook suggestions', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Runbook feature', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Runbook types', free: '—', startup: 'Manual only', growth: 'Manual + Bash + API', enterprise: 'All types', dedicated: 'All types' },
      { feature: 'AI token budget / mo', free: '—', startup: '—', growth: '500K tokens', enterprise: '5M tokens', dedicated: 'Unlimited' },
    ],
  },
  {
    group: 'Security & Compliance',
    rows: [
      { feature: 'RBAC', free: '✓', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'MFA (TOTP)', free: '✓', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'SSO / SAML', free: '—', startup: '—', growth: '—', enterprise: '✓', dedicated: '✓' },
      { feature: 'SCIM provisioning', free: '—', startup: '—', growth: '—', enterprise: '✓', dedicated: '✓' },
      { feature: 'Audit log retention', free: '7 days', startup: '30 days', growth: '60 days', enterprise: '90 days', dedicated: 'Custom' },
      { feature: 'GDPR / DPDP compliance', free: 'Basic', startup: 'Basic', growth: 'Full', enterprise: 'Full', dedicated: 'Full' },
      { feature: 'DSAR support', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Data export', free: '—', startup: '✓', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'IP allowlisting', free: '—', startup: '—', growth: '—', enterprise: '✓', dedicated: '✓' },
      { feature: 'Custom domain (Status Page)', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
      { feature: 'Data residency', free: '—', startup: '—', growth: '—', enterprise: '—', dedicated: '✓' },
      { feature: 'White labeling', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
    ],
  },
  {
    group: 'MSP & Multi-Tenant',
    rows: [
      { feature: 'Provider / consumer model', free: '—', startup: '—', growth: '—', enterprise: '✓', dedicated: '✓' },
      { feature: 'Cross-tenant bridges', free: '—', startup: '—', growth: '—', enterprise: '✓', dedicated: '✓' },
      { feature: 'Managed tenants', free: '—', startup: '—', growth: '—', enterprise: '10', dedicated: 'Unlimited' },
      { feature: 'White-label branding', free: '—', startup: '—', growth: '✓', enterprise: '✓', dedicated: '✓' },
    ],
  },
  {
    group: 'Support',
    rows: [
      { feature: 'SLA guarantee', free: '—', startup: '—', growth: '99.9%', enterprise: '99.9%', dedicated: '99.99%' },
      { feature: 'Support channel', free: 'Community', startup: 'Email', growth: 'Priority', enterprise: 'Named CSM', dedicated: 'Named CSM' },
      { feature: 'Free trial', free: '—', startup: '14 days', growth: '14 days', enterprise: '14 days', dedicated: 'POC available' },
    ],
  },
];

export const FAQ_ITEMS = [
  {
    q: 'Is there a free trial?',
    a: 'Yes — all paid plans include a 14-day free trial. No credit card required. You can upgrade, downgrade, or cancel at any time during or after the trial.',
  },
  {
    q: 'What counts as a "host"?',
    a: 'Any server, VM, container node, or Kubernetes node running the SREonCall eBPF agent. All plans include unlimited hosts at no extra charge — no per-host fees, ever.',
  },
  {
    q: 'What happens if I exceed my metrics or log limits?',
    a: 'We notify you at 80% and again at 100% of your plan limits. There are no automatic overage charges. You choose to upgrade your plan or we pause new ingestion until your next billing cycle resets.',
  },
  {
    q: 'Is on-premises deployment available?',
    a: 'Yes — the Dedicated tier supports fully air-gapped, on-premises deployment with no external dependencies. Contact sales for a scoping call and pricing.',
  },
  {
    q: 'Can I cancel anytime?',
    a: "Yes. Monthly plans cancel at end of the current billing month. Annual plans can be cancelled at renewal — we don't offer refunds for unused portions of an annual term.",
  },
  {
    q: 'Where is my data stored?',
    a: 'Data is stored in the EU (Frankfurt) by default. Custom data residency — US, APAC, or your own cloud account — is available on the Dedicated tier.',
  },
  {
    q: 'Do you have a partner or reseller programme?',
    a: 'Yes — we offer Referral, Reseller, and MSP tracks. Referrals earn 10% ARR for 12 months. Resellers get up to 35% margin. MSPs get 40% of platform revenue plus 80% of managed services revenue. Email partners@sreoncall.com to get started.',
  },
  {
    q: "What's the difference between Enterprise and Dedicated?",
    a: 'Enterprise is a managed cloud plan with 200 users, SSO/SCIM, and a named CSM. Dedicated is a single-tenant or on-premises deployment with unlimited users, white-label, air-gap support, and a 99.99% SLA.',
  },
] as const;

export const PERKS = [
  { icon: 'infinity', label: 'Unlimited hosts' },
  { icon: 'shield-check', label: 'GDPR & DPDP compliant' },
  { icon: 'lock', label: 'MFA on every plan' },
  { icon: 'circle-dollar-sign', label: 'No overage billing' },
  { icon: 'activity', label: '99.9% SLA' },
  { icon: 'x-circle', label: 'Cancel anytime' },
] as const;

export const PRICING_COMPETITOR_COMPARISON = [
  { stack: 'Datadog (infra + APM + logs)', cost: '~$5,000 / mo', highlight: false },
  { stack: 'Groundcover + PagerDuty', cost: '~$2,900 / mo', highlight: false },
  { stack: 'Grafana Cloud + PagerDuty', cost: '~$1,800 / mo', highlight: false },
  { stack: 'SREonCall', cost: 'Cheapest among all', highlight: true },
] as const;
