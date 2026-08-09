'use client';

import { useState, useMemo } from 'react';
import {
  CreditCard,
  Check,
  Loader2,
  Zap,
  Users,
  TicketCheck,
  HardDrive,
  Activity,
  ArrowRight,
  ExternalLink,
  Download,
  AlertTriangle,
  Crown,
  XCircle,
  RotateCcw,
  Bell,
  Calendar,
  Shield,
  MonitorCheck,
  Globe,
  Bot,
  Star,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import {
  useBillingPlans,
  useSubscription,
  useUsage,
  useInvoices,
  useCreateCheckout,
  useCreatePortalSession,
  useChangePlan,
  useCancelSubscription,
  useReactivateSubscription,
  type BillingPlan,
} from '@/lib/hooks/useBilling';
import { useRedeemCode } from '@/lib/hooks/useActivationCodes';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPriceLabel(plan: BillingPlan): string {
  if (plan.price_monthly_cents === 0) return '$0';
  if (plan.id === 'enterprise' && plan.price_monthly_cents <= 0) return 'Custom';
  return `$${(plan.price_monthly_cents / 100).toFixed(0)}`;
}

function formatPricePeriod(plan: BillingPlan): string {
  if (plan.price_monthly_cents === 0) return 'forever';
  if (plan.id === 'enterprise' && plan.price_monthly_cents <= 0) return '';
  return 'per user/month';
}

function isEnterprisePlan(plan: BillingPlan): boolean {
  return plan.id === 'enterprise';
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    active: 'success',
    trialing: 'info',
    past_due: 'warning',
    canceled: 'error',
    incomplete: 'warning',
  };
  return (
    <Badge variant={(variants[status] || 'default') as any} className="text-xs capitalize">
      {status.replace('_', ' ')}
    </Badge>
  );
}

// ─── Usage meter ──────────────────────────────────────────────────────────────

function UsageMeter({
  label,
  current,
  max,
  icon: Icon,
  format,
}: {
  label: string;
  current: number;
  max: number;
  icon: React.ElementType;
  format?: (v: number) => string;
}) {
  const isUnlimited = max === -1 || max >= 9999 || max === Infinity;
  const percentage = max <= 0 || isUnlimited ? 0 : Math.min((current / max) * 100, 100);
  const fmt = format || ((v: number) => v.toLocaleString());

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </span>
        <span className="text-sm text-muted-foreground">
          {fmt(current)} / {isUnlimited ? 'Unlimited' : fmt(max)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={cn(
            'h-2 rounded-full transition-all',
            percentage > 95
              ? 'bg-red-500'
              : percentage > 80
                ? 'bg-orange-500'
                : 'bg-primary',
          )}
          style={{ width: `${Math.max(percentage, 2)}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatAmount(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

// ─── Redeem Modal ─────────────────────────────────────────────────────────────

function RedeemModal({ onClose }: { onClose: () => void }) {
  const { mutate: redeem, isPending, error, reset } = useRedeemCode();
  const [step, setStep] = useState<'input' | 'success'>('input');
  const [code, setCode] = useState('');

  const formatCode = (value: string) => {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length <= 5) return clean;
    const parts: string[] = [];
    parts.push(clean.slice(0, 5)); // SREOC
    if (clean.length > 5) parts.push(clean.slice(5, 9));
    if (clean.length > 9) parts.push(clean.slice(9, 13));
    if (clean.length > 13) parts.push(clean.slice(13, 17));
    return parts.join('-');
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(formatCode(e.target.value));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    redeem(
      { code },
      {
        onSuccess: () => setStep('success'),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#1E293B] bg-[#0D1117] p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>

        {step === 'input' && (
          <>
            <div className="mb-5">
              <h2 className="text-[17px] font-bold text-white">Enter Activation Code</h2>
              <p className="mt-1 text-[13px] text-slate-400">Enter the code you received from SREonCall to activate your subscription.</p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                autoFocus
                value={code}
                onChange={handleCodeChange}
                placeholder="SREOC-XXXX-XXXX-XXXX"
                maxLength={19}
                className="w-full rounded-xl border border-[#1E293B] bg-[#161B22] px-4 py-3 text-center font-mono text-[16px] font-bold tracking-widest text-white placeholder-slate-600 focus:border-[#FF6B2B] focus:outline-none"
              />
              {error && (
                <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
                  {(error as any).message || 'Invalid code. Please check and try again.'}
                </p>
              )}
              <button
                type="submit"
                disabled={isPending || code.replace(/-/g, '').length < 17}
                className="rounded-xl bg-[#FF6B2B] py-3 text-[14px] font-semibold text-white hover:bg-[#E85D1C] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? 'Activating…' : 'Activate Subscription'}
              </button>
            </form>
          </>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-7 w-7 text-green-400" />
            </div>
            <div className="text-center">
              <h2 className="text-[17px] font-bold text-white">Subscription Activated!</h2>
              <p className="mt-1 text-[13px] text-slate-400">Your plan has been upgraded successfully. Enjoy your new subscription.</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-[#FF6B2B] px-8 py-2.5 text-[13px] font-semibold text-white hover:bg-[#E85D1C] transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: plansData, isLoading: plansLoading } = useBillingPlans();
  const { data: subscription } = useSubscription();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: invoicesData, isLoading: invoicesLoading } = useInvoices();

  const createCheckout = useCreateCheckout();
  const createPortal = useCreatePortalSession();
  const changePlan = useChangePlan();
  const cancelSub = useCancelSubscription();
  const reactivateSub = useReactivateSubscription();

  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const FALLBACK_PLANS: BillingPlan[] = [
    {
      id: 'free', name: 'Free', description: 'For solo SREs and evaluation.',
      price_monthly_cents: 0, price_yearly_cents: 0, is_popular: false, sort_order: 0,
      features: ['∞ services', '3 users', 'Email notifications', 'Basic observability (3-day retention)'],
      limits: {} as any,
    },
    {
      id: 'startup', name: 'Startup', description: 'For small teams up to 10 people.',
      price_monthly_cents: 114900, price_yearly_cents: 99900, is_popular: false, sort_order: 1,
      features: ['∞ services', '10 users', 'SMS & voice notifications', 'eBPF auto-instrumentation', '7-day observability retention'],
      limits: {} as any,
    },
    {
      id: 'growth', name: 'Growth', description: 'For growing teams up to 50 people.',
      price_monthly_cents: 229900, price_yearly_cents: 199900, is_popular: true, sort_order: 2,
      features: ['∞ services', '50 users', 'AI-powered RCA', 'AI agent (1)', 'WhatsApp notifications', 'BYOS integrations', '15-day observability retention'],
      limits: {} as any,
    },
    {
      id: 'enterprise', name: 'Enterprise', description: 'For large organisations up to 200+ people.',
      price_monthly_cents: 689900, price_yearly_cents: 599900, is_popular: false, sort_order: 3,
      features: ['∞ services', '200 users', 'SSO & SCIM', '5 AI agents', 'MSP multi-tenant', '30-day observability retention'],
      limits: {} as any,
    },
  ];

  const plans = (plansData?.data?.length ? plansData.data : FALLBACK_PLANS);

  // Plan resolution priority:
  // 1. currentUser.tenant.plan — always authoritative (set by platform admin, used for enforcement)
  // 2. subscription.plan — Stripe-synced mirror, may be stale after an admin override
  // 3. 'free' — safe default
  const currentPlan = currentUser?.tenant?.plan || subscription?.plan || 'free';
  const hasSubscription = !!subscription?.id;
  const isCanceling = subscription?.cancel_at_period_end;
  const stripeConfigured = subscription?.stripe_configured ?? false;

  // Find matching plan definition for display (name, price, features)
  const planDef = useMemo(
    () => plans.find((p) => p.id === currentPlan),
    [plans, currentPlan],
  );

  // Limit resolution priority:
  // 1. currentUser.tenant.plan_limits — the tenant's actual limits set/overridden by platform admin
  // 2. subscription.plan_limits — returned by billing endpoint, also sourced from tenant doc
  // 3. planDef.limits — the global plan template from the admin console Plans page
  const planLimits: Record<string, number | boolean | string[]> = useMemo(() => {
    if (currentUser?.tenant?.plan_limits) return currentUser.tenant.plan_limits as any;
    if ((subscription as any)?.plan_limits) return (subscription as any).plan_limits;
    return (planDef?.limits as any) ?? {};
  }, [currentUser, subscription, planDef]);

  // Plan ordering derived from sort_order
  const planOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    plans.forEach((p) => map.set(p.id, p.sort_order));
    return map;
  }, [plans]);

  function getPlanIndex(planId: string): number {
    return planOrderMap.get(planId) ?? -1;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────

  async function handleUpgrade(plan: string) {
    if (!stripeConfigured) {
      toast.error('Billing is not configured. Contact your administrator.');
      return;
    }

    const currentIdx = getPlanIndex(currentPlan);
    const targetIdx = getPlanIndex(plan);

    if (isEnterprisePlan(plans.find((p) => p.id === plan)!)) {
      toast.info('Contact sales for Enterprise pricing: sales@sreoncall.io');
      return;
    }

    // New subscription or upgrade from free → Stripe Checkout
    if (!hasSubscription || currentPlan === 'free') {
      try {
        const result = await createCheckout.mutateAsync({ plan });
        if (result.url) {
          window.open(result.url, '_blank');
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to create checkout session');
      }
      return;
    }

    // Downgrade confirmation
    if (targetIdx < currentIdx) {
      setSelectedPlan(plan);
      setChangePlanOpen(true);
      return;
    }

    // Upgrade with existing subscription → also use checkout for simplicity
    try {
      const result = await createCheckout.mutateAsync({ plan });
      if (result.url) {
        window.open(result.url, '_blank');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create checkout session');
    }
  }

  async function handleConfirmChangePlan() {
    if (!selectedPlan) return;
    try {
      await changePlan.mutateAsync({ plan: selectedPlan });
      toast.success(`Plan changed to ${selectedPlan}`);
      setChangePlanOpen(false);
      setSelectedPlan(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to change plan');
    }
  }

  async function handleCancel() {
    try {
      await cancelSub.mutateAsync();
      toast.success('Subscription will cancel at period end');
      setCancelOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel subscription');
    }
  }

  async function handleReactivate() {
    try {
      await reactivateSub.mutateAsync();
      toast.success('Subscription reactivated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to reactivate subscription');
    }
  }

  async function handleManagePayment() {
    try {
      const result = await createPortal.mutateAsync();
      if (result.url) {
        window.open(result.url, '_blank');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing portal');
    }
  }

  // Only block on plansLoading — currentUser is the primary source for plan/limits,
  // so a slow or failed subscription response won't prevent the page from rendering.
  if (plansLoading && !currentUser) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Current Plan Card ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                {currentPlan === 'enterprise' ? (
                  <Crown className="h-6 w-6 text-primary" />
                ) : (
                  <Zap className="h-6 w-6 text-primary" />
                )}
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {planDef?.name || currentPlan} Plan
                </p>
                <p className="text-sm text-muted-foreground">
                  {subscription?.monthly_amount_cents
                    ? `${formatAmount(subscription.monthly_amount_cents)}/month`
                    : planDef
                      ? planDef.price_monthly_cents === 0
                        ? 'Free forever'
                        : `${formatPriceLabel(planDef)}/user/month`
                      : 'Free forever'}
                  {subscription?.seat_quantity && subscription.seat_quantity > 1
                    ? ` · ${subscription.seat_quantity} seats`
                    : ''}
                  {subscription?.current_period_end
                    ? ` · Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={subscription?.status || 'active'} />
              {isCanceling && (
                <Badge variant="warning" className="text-xs">
                  Cancels at period end
                </Badge>
              )}
            </div>
          </div>

          {/* Action buttons */}
          {hasSubscription && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangePlanOpen(true)}
              >
                Change Plan
              </Button>
              {stripeConfigured && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManagePayment}
                  disabled={createPortal.isPending}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Manage Payment
                </Button>
              )}
              {isCanceling ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReactivate}
                  disabled={reactivateSub.isPending}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Reactivate
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel Subscription
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Usage This Month ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Usage This Month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {usageLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Platform */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Platform</h4>
                <UsageMeter label="Users" current={usage?.users || 0} max={(planLimits.max_users as number) ?? 5} icon={Users} />
                <UsageMeter label="Services" current={usage?.services || 0} max={(planLimits.max_services as number) ?? 3} icon={Activity} />
                <UsageMeter label="Storage" current={usage?.storage_bytes || 0} max={((planLimits.max_storage_gb as number) ?? 0.1) * 1024 * 1024 * 1024} icon={HardDrive} format={formatBytes} />
                <UsageMeter label="AI Agents" current={usage?.agents || 0} max={(planLimits.max_agents as number) ?? 0} icon={Bot} />
              </div>

              {/* Operations (monthly) */}
              <div className="pt-4 border-t border-border space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Operations <span className="text-muted-foreground font-normal text-xs">(this month)</span></h4>
                <UsageMeter label="Incidents" current={usage?.incidents || 0} max={(planLimits.max_incidents_per_month as number) ?? 50} icon={Activity} />
                <UsageMeter label="Tickets" current={usage?.tickets || 0} max={(planLimits.max_tickets_per_month as number) ?? 100} icon={TicketCheck} />
              </div>

              {/* Communications (monthly) */}
              <div className="pt-4 border-t border-border space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Communications <span className="text-muted-foreground font-normal text-xs">(this month)</span></h4>
                <UsageMeter label="Notifications today" current={usage?.notifications_sent || 0} max={(planLimits.max_notifications_per_day as number) ?? 50} icon={Bell} />
                <UsageMeter label="SMS" current={(usage as any)?.sms_sent || 0} max={(planLimits.max_sms_per_month as number) ?? 0} icon={Bell} />
                <UsageMeter label="Voice calls" current={(usage as any)?.voice_calls || 0} max={(planLimits.max_voice_per_month as number) ?? 0} icon={Bell} />
                <UsageMeter label="WhatsApp" current={(usage as any)?.whatsapp_sent || 0} max={(planLimits.max_whatsapp_per_month as number) ?? 0} icon={Bell} />
              </div>

              {/* Platform Config */}
              <div className="pt-4 border-t border-border space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Platform Config</h4>
                <UsageMeter label="Dashboards" current={(usage as any)?.dashboards || 0} max={(planLimits.max_dashboards as number) ?? 3} icon={MonitorCheck} />
                <UsageMeter label="Alert rules" current={(usage as any)?.alert_rules || 0} max={(planLimits.max_alert_rules as number) ?? 5} icon={Shield} />
                <UsageMeter label="SLOs" current={(usage as any)?.slos || 0} max={(planLimits.max_slos as number) ?? 0} icon={Activity} />
                <UsageMeter label="On-call schedules" current={usage?.on_call_schedules || 0} max={(planLimits.max_on_call_schedules as number) ?? 1} icon={Calendar} />
                <UsageMeter label="Escalation policies" current={usage?.escalation_policies || 0} max={(planLimits.max_escalation_policies as number) ?? 1} icon={Shield} />
                <UsageMeter label="Synthetic checks" current={usage?.synthetic_checks || 0} max={(planLimits.max_synthetic_checks as number) ?? 0} icon={MonitorCheck} />
                <UsageMeter label="Status pages" current={usage?.status_pages || 0} max={(planLimits.max_status_pages as number) ?? 1} icon={Globe} />
              </div>

              {/* AI (monthly) */}
              {(planLimits.agents_enabled as boolean) && (
                <div className="pt-4 border-t border-border space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">AI <span className="text-muted-foreground font-normal text-xs">(this month)</span></h4>
                  <UsageMeter label="AI tokens used" current={(usage as any)?.ai_tokens_used || 0} max={(planLimits.max_ai_tokens_per_month as number) ?? 0} icon={Bot} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Upgrade banner — shown when any dimension is ≥80% ─────────── */}
      {usage && planLimits && (() => {
        const dims = [
          { current: usage.users || 0, limit: (planLimits.max_users as number), label: 'users' },
          { current: usage.incidents || 0, limit: (planLimits.max_incidents_per_month as number), label: 'incidents' },
          { current: (usage as any).sms_sent || 0, limit: (planLimits.max_sms_per_month as number), label: 'SMS' },
          { current: (usage as any).ai_tokens_used || 0, limit: (planLimits.max_ai_tokens_per_month as number), label: 'AI tokens' },
        ];
        const nearLimit = dims.find(d => d.limit > 0 && d.limit !== -1 && d.current / d.limit >= 0.8);
        if (!nearLimit) return null;
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3">
            <p className="text-sm text-amber-800">
              <span className="font-semibold">Heads up:</span> You&apos;re approaching your {nearLimit.label} limit ({Math.round(nearLimit.current / nearLimit.limit * 100)}% used).
            </p>
            <button
              onClick={() => document.getElementById('plan-comparison')?.scrollIntoView({ behavior: 'smooth' })}
              className="shrink-0 text-sm font-medium text-amber-700 underline underline-offset-2"
            >
              View plans
            </button>
          </div>
        );
      })()}

      {/* ── Plan Comparison Grid ───────────────────────────────────────── */}
      <div id="plan-comparison" className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Available Plans</h2>
        <div className={cn(
          'grid grid-cols-1 gap-4 md:grid-cols-2',
          plans.length >= 4 && 'lg:grid-cols-4',
          plans.length === 3 && 'lg:grid-cols-3',
        )}>
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const currentIdx = getPlanIndex(currentPlan);
            const planIdx = getPlanIndex(plan.id);
            const isUpgrade = planIdx > currentIdx;
            const isDowngrade = planIdx < currentIdx;
            const isPopular = plan.is_popular ?? false;
            const priceLabel = formatPriceLabel(plan);
            const period = formatPricePeriod(plan);

            return (
              <Card
                key={plan.id}
                className={cn(
                  'relative',
                  isPopular && 'border-primary shadow-md',
                  isCurrent && 'ring-2 ring-primary/50',
                )}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="text-xs">Most Popular</Badge>
                  </div>
                )}
                <CardContent className="p-4">
                  <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-foreground">
                      {priceLabel}
                    </span>
                    {period && (
                      <span className="text-sm text-muted-foreground"> {period}</span>
                    )}
                  </div>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Current Plan
                      </Button>
                    ) : isEnterprisePlan(plan) ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          toast.info('Contact sales: sales@sreoncall.io')
                        }
                      >
                        Contact Sales
                      </Button>
                    ) : isUpgrade ? (
                      <Button
                        className="w-full"
                        onClick={() => handleUpgrade(plan.id)}
                        disabled={createCheckout.isPending}
                      >
                        {createCheckout.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Upgrade
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : isDowngrade ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => handleUpgrade(plan.id)}
                      >
                        Downgrade
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Activation code redemption */}
        <div className="mt-3 text-center">
          <button
            onClick={() => setRedeemOpen(true)}
            className="text-[12px] text-slate-500 hover:text-[#FF6B2B] transition-colors"
          >
            Have an activation code?
          </button>
        </div>
      </div>

      {redeemOpen && <RedeemModal onClose={() => setRedeemOpen(false)} />}

      {/* ── Recent Invoices ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !invoicesData?.data?.length ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Invoice</th>
                    <th className="pb-2 font-medium">Period</th>
                    <th className="pb-2 font-medium">Amount</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {invoicesData.data.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-3 font-medium text-foreground">{inv.number}</td>
                      <td className="py-3 text-muted-foreground">
                        {new Date(inv.period_start).toLocaleDateString()} –{' '}
                        {new Date(inv.period_end).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-foreground">
                        {formatAmount(inv.amount_cents, inv.currency)}
                      </td>
                      <td className="py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="py-3 text-right">
                        {inv.pdf_url && (
                          <a
                            href={inv.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            PDF
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Change Plan Dialog ─────────────────────────────────────────── */}
      <Dialog open={changePlanOpen} onClose={() => setChangePlanOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Plan</DialogTitle>
            <DialogClose onClose={() => setChangePlanOpen(false)} />
          </DialogHeader>
          <div className="p-6 space-y-4">
            {selectedPlan ? (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <p>
                    Downgrading to <strong className="capitalize">{selectedPlan}</strong> will
                    reduce your plan limits. Features exceeding the new limits may become
                    unavailable. This change will be prorated.
                  </p>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedPlan(null);
                      setChangePlanOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmChangePlan}
                    disabled={changePlan.isPending}
                  >
                    {changePlan.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Confirm Downgrade
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                {plans
                  .filter((p) => p.id !== currentPlan && !isEnterprisePlan(p))
                  .map((plan) => {
                    const isUp = getPlanIndex(plan.id) > getPlanIndex(currentPlan);
                    const priceLabel = formatPriceLabel(plan);
                    const period = formatPricePeriod(plan);
                    return (
                      <button
                        key={plan.id}
                        className="flex w-full items-center justify-between rounded-lg border p-4 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => {
                          if (isUp) {
                            handleUpgrade(plan.id);
                            setChangePlanOpen(false);
                          } else {
                            setSelectedPlan(plan.id);
                          }
                        }}
                      >
                        <div>
                          <p className="font-medium text-foreground">{plan.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {priceLabel}
                            {period ? ` ${period}` : ''}
                          </p>
                        </div>
                        <Badge variant={isUp ? 'default' : 'outline'}>
                          {isUp ? 'Upgrade' : 'Downgrade'}
                        </Badge>
                      </button>
                    );
                  })}
                <button
                  className="flex w-full items-center justify-between rounded-lg border p-4 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    toast.info('Contact sales: sales@sreoncall.io');
                    setChangePlanOpen(false);
                  }}
                >
                  <div>
                    <p className="font-medium text-foreground">Enterprise</p>
                    <p className="text-sm text-muted-foreground">Custom pricing</p>
                  </div>
                  <Badge variant="outline">Contact Sales</Badge>
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Dialog ──────────────────────────────────────────────── */}
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Cancel Subscription
            </DialogTitle>
            <DialogClose onClose={() => setCancelOpen(false)} />
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Are you sure you want to cancel?</p>
                <ul className="mt-2 list-disc pl-4 space-y-1">
                  <li>Your subscription will remain active until the end of the current billing period</li>
                  <li>After that, your account will be downgraded to the Free plan</li>
                  <li>You may lose access to features beyond Free plan limits</li>
                </ul>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCancelOpen(false)}>
                Keep Subscription
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelSub.isPending}
              >
                {cancelSub.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Cancel Subscription
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
