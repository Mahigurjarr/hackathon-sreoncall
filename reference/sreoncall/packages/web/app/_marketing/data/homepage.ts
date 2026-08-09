// packages/web/app/_marketing/data/homepage.ts

export const STATS = [
  { value: '∞', label: 'Hosts monitored\nacross all plans' },
  { value: '5', label: 'Tools replaced\nby one platform' },
  { value: '< 60s', label: 'Avg. time\nto AI RCA' },
  { value: '14 days', label: 'Free trial\nno credit card' },
  { value: '99.9%', label: 'Uptime SLA\nall paid plans' },
] as const;

export const LOGOS = [
  'Alyssum',
  'Binoloop',
  'Acum',
  'Dwize',
  'Reflik',
  'CloudShapers',
  'Packengers',
] as const;

export const PROBLEMS = [
  {
    icon: 'layers',
    title: 'Tool sprawl',
    description:
      'Datadog for metrics, PagerDuty for on-call, Confluence for runbooks. $5,000/month and five browser tabs.',
  },
  {
    icon: 'bell-off',
    title: 'Alert fatigue',
    description:
      'Hundreds of alerts, no context. Your team is triaging noise, not fixing problems.',
  },
  {
    icon: 'file-x',
    title: 'Stale runbooks',
    description:
      'Your AI agent is only as good as your documentation. Most runbooks are outdated by the time an incident hits.',
  },
] as const;

export const FEATURES = [
  {
    id: 'incidents',
    tab: 'Incidents & RCA',
    title: 'From alert to resolution. In 60 seconds.',
    description:
      'Automated incident timelines, AI-powered root cause analysis, and resolution suggestions. Stop triaging noise — start fixing the actual problem.',
    stat: '60s avg. time to RCA',
    screenshotLabel: 'Incident Dashboard',
  },
  {
    id: 'oncall',
    tab: 'On-Call',
    title: 'Nobody gets paged at 3am by accident.',
    description:
      'Visual rotation builder, escalation policies, and SMS / voice / WhatsApp notifications. Never miss a page, never burn out your team.',
    stat: '500 SMS alerts/mo on Growth',
    screenshotLabel: 'On-Call Calendar',
  },
  {
    id: 'observability',
    tab: 'Observability',
    title: 'Unlimited hosts. Zero instrumentation.',
    description:
      'eBPF-based infrastructure monitoring with no per-host fees. Metrics, logs, distributed traces — all in one place, all included.',
    stat: '∞ hosts on every plan',
    screenshotLabel: 'Metrics Dashboard',
  },
  {
    id: 'agents',
    tab: 'AI Agents',
    title: 'Your SRE team. Multiplied.',
    description:
      'Autonomous on-call agents that acknowledge alerts, run diagnostic playbooks, and escalate with full context. Available on Growth and above.',
    stat: 'Available on Growth+',
    screenshotLabel: 'AI Agent Console',
  },
  {
    id: 'runbooks',
    tab: 'Runbooks',
    title: 'Runbooks that stay up to date.',
    description:
      'Version-controlled, AI-assisted runbooks that attach to alerts and execute automatically during incidents. No more stale docs.',
    stat: 'Automated on every paid plan',
    screenshotLabel: 'Runbook Editor',
  },
] as const;

export const DEMO_TABS = [
  { id: 'incident', label: 'Incident Timeline', screenshotLabel: 'Incident List + AI RCA Panel' },
  { id: 'oncall', label: 'On-Call Calendar', screenshotLabel: 'Rotation Schedule + Escalation Tree' },
  { id: 'agent', label: 'AI Agent Console', screenshotLabel: 'Agent Activity Log + Runbook Steps' },
] as const;

export const COMPETITOR_COMPARISON = [
  { stack: 'Datadog + PagerDuty', cost: '~$5,000', tools: '3+', unlimitedHosts: false, aiRca: false, flatFee: false },
  { stack: 'Groundcover + PagerDuty', cost: '~$2,900', tools: '2', unlimitedHosts: true, aiRca: false, flatFee: false },
  { stack: 'Grafana Cloud + PagerDuty', cost: '~$1,800', tools: '2', unlimitedHosts: true, aiRca: false, flatFee: true },
  { stack: 'SREonCall', cost: 'Cheapest among all', tools: '1', unlimitedHosts: true, aiRca: true, flatFee: true, highlight: true },
] as const;

export const TESTIMONIALS = [
  {
    quote: 'We replaced Datadog and PagerDuty in a weekend. The eBPF agent just works.',
    name: 'Head of Platform Engineering',
    company: 'Alyssum',
  },
  {
    quote: 'AI RCA used to be a dream. Now it\'s the first thing our team checks during an incident.',
    name: 'SRE Lead',
    company: 'Binoloop',
  },
  {
    quote: 'The flat pricing model was the deciding factor. No more per-host anxiety.',
    name: 'CTO',
    company: 'Reflik',
  },
] as const;

export const PARTNER_TRACKS = [
  {
    badge: 'Referral',
    badgeColor: '#16A34A',
    title: 'Earn commissions, zero obligations.',
    description: 'Refer a customer and earn 10% of their ARR for the first 12 months. No sales quotas, no certification required.',
    earnings: '10% of ARR for 12 months',
    cta: 'Learn more',
    ctaHref: '/contact?track=referral',
    primary: false,
  },
  {
    badge: 'Reseller',
    badgeColor: '#2563EB',
    title: 'You sell. We deliver.',
    description: 'Resell SREonCall to your clients at up to 35% margin. Full white-label support, co-marketing, and deal registration.',
    earnings: 'Up to 35% reseller margin',
    cta: 'Apply now',
    ctaHref: '/contact?track=reseller',
    primary: false,
  },
  {
    badge: 'MSP',
    badgeColor: '#FF6B2B',
    title: 'Build your SRE practice on SREonCall.',
    description: 'Deploy, manage, and support SREonCall for your clients. Best-in-class economics for MSPs who bring their own SRE engineers.',
    earnings: '40% of platform + 80% of managed services',
    cta: 'Become an MSP',
    ctaHref: '/contact?track=msp',
    primary: true,
  },
] as const;
