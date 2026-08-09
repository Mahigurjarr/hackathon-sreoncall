import { Types } from 'mongoose';
import { Subscription, Invoice, UsageRecord } from '../models/billing.model';
import { Tenant, PlanLimits } from '../models/tenant.model';
import { User } from '../models/user.model';
import { PlanDefinition } from '../models/plan-definition.model';
import { Ticket } from '../models/ticket.model';
import { Incident } from '../models/incident.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { EscalationPolicy } from '../models/escalation-policy.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { StatusPage } from '../models/status-page.model';
import { AgentInstallation } from '../models/agent-installation.model';
import { Dashboard } from '../models/dashboard.model';
import { AlertRule } from '../models/alert-rule.model';
import { SloDefinition } from '../models/slo-definition.model';
import { Service } from '../models/service.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { notifyPlanChange } from './plan-change-notification.service';
import { getPaymentProvider } from './payment/index';
import type { PaymentEvent } from './payment/payment-provider.interface';

export { getPaymentProvider };
export type { IPaymentProvider, CheckoutParams, PaymentEvent } from './payment/index';

/** @deprecated Use getPaymentProvider().isConfigured() */
export function isStripeConfigured(): boolean {
  return getPaymentProvider().isConfigured();
}

// ─── Plan → Limits mapping ────────────────────────────────────────────────────
// Hardcoded fallback — DB-driven PlanDefinition takes precedence via getPlanLimitsFromDB.
// -1 = unlimited sentinel (replaces magic 9999 values).
// To add a new limit: add it to PlanLimits interface, planLimitsSchema, and the maps below.
// No other code changes needed — getPlanLimitsFromDB uses a spread merge.

const ALL_CHANNELS = ['email', 'sms', 'slack', 'teams', 'in_app', 'voice', 'whatsapp'];
const STARTUP_CHANNELS = ['email', 'sms', 'slack', 'teams', 'in_app', 'voice'];

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    max_users: 3, min_users: 0,
    max_tickets_per_month: 100, max_incidents_per_month: 100,
    max_storage_gb: 0.1, api_rate_limit: 600,
    custom_fields: false, sla_management: false, custom_workflows: false,
    audit_log_retention_days: 7,
    agents_enabled: false, max_agents: 0,
    max_on_call_schedules: 1, max_escalation_policies: 1,
    max_notifications_per_day: 50,
    observability_retention_days: 3, observability_series_limit: 10_000,
    max_synthetic_checks: 0, max_status_pages: 0,
    sso_enabled: false, scim_enabled: false, mcp_enabled: false,
    voice_whatsapp_enabled: false, white_label_enabled: false,
    notification_channels: ['email'],
    icc_enabled: false, service_dependencies_max: 0,
    auto_discovery_enabled: false, document_upload_discovery: false,
    guided_resolution_enabled: false, resolution_ai_monthly_budget_cents: 0,
    alert_quality_reports: false, business_impact_config: false,
    stakeholder_comms: false, predictive_alerts: false,
    toil_tracking: false, validation_suites_max: 0, compliance_aware_response: false,
    // v2 fields
    max_services: -1, max_sms_per_month: 0, max_voice_per_month: 0,
    max_whatsapp_per_month: 0, max_ai_tokens_per_month: 0,
    max_dashboards: 3, max_alert_rules: 5, max_slos: 0,
    max_traces_per_day: 5_000, observability_log_ingestion_mbps: 1,
    max_managed_tenants: 0, ai_rca_enabled: false, byos_enabled: false,
    observability_third_party_providers: 0,
    ai_notetaker_enabled: false, max_notetaker_minutes_per_month: 0,
  },
  startup: {
    max_users: 10, min_users: 1,
    max_tickets_per_month: 1_000, max_incidents_per_month: 1_000,
    max_storage_gb: 0.5, api_rate_limit: 300,
    custom_fields: true, sla_management: true, custom_workflows: false,
    audit_log_retention_days: 30,
    agents_enabled: false, max_agents: 0,
    max_on_call_schedules: -1, max_escalation_policies: 10,
    max_notifications_per_day: 500,
    observability_retention_days: 7, observability_series_limit: 50_000,
    max_synthetic_checks: 5, max_status_pages: 1,
    sso_enabled: false, scim_enabled: false, mcp_enabled: false,
    voice_whatsapp_enabled: true, white_label_enabled: false,
    notification_channels: STARTUP_CHANNELS,
    icc_enabled: false, service_dependencies_max: 50,
    auto_discovery_enabled: true, document_upload_discovery: false,
    guided_resolution_enabled: false, resolution_ai_monthly_budget_cents: 0,
    alert_quality_reports: false, business_impact_config: false,
    stakeholder_comms: false, predictive_alerts: false,
    toil_tracking: false, validation_suites_max: 0, compliance_aware_response: false,
    // v2 fields
    max_services: -1, max_sms_per_month: 100, max_voice_per_month: 50,
    max_whatsapp_per_month: 0, max_ai_tokens_per_month: 0,
    max_dashboards: 10, max_alert_rules: 20, max_slos: 3,
    max_traces_per_day: 20_000, observability_log_ingestion_mbps: 2,
    max_managed_tenants: 0, ai_rca_enabled: false, byos_enabled: false,
    observability_third_party_providers: 0,
    ai_notetaker_enabled: false, max_notetaker_minutes_per_month: 0,
  },
  growth: {
    max_users: 50, min_users: 5,
    max_tickets_per_month: 5_000, max_incidents_per_month: 5_000,
    max_storage_gb: 1, api_rate_limit: 600,
    custom_fields: true, sla_management: true, custom_workflows: true,
    audit_log_retention_days: 60,
    agents_enabled: true, max_agents: 1,
    max_on_call_schedules: -1, max_escalation_policies: 20,
    max_notifications_per_day: 2_000,
    observability_retention_days: 15, observability_series_limit: 200_000,
    max_synthetic_checks: 20, max_status_pages: 10,
    sso_enabled: false, scim_enabled: false, mcp_enabled: true,
    voice_whatsapp_enabled: true, white_label_enabled: false,
    notification_channels: ALL_CHANNELS,
    icc_enabled: true, service_dependencies_max: 200,
    auto_discovery_enabled: true, document_upload_discovery: true,
    guided_resolution_enabled: true, resolution_ai_monthly_budget_cents: 5_000,
    alert_quality_reports: true, business_impact_config: true,
    stakeholder_comms: true, predictive_alerts: true,
    toil_tracking: true, validation_suites_max: 10, compliance_aware_response: false,
    // v2 fields
    max_services: -1, max_sms_per_month: 500, max_voice_per_month: 200,
    max_whatsapp_per_month: 200, max_ai_tokens_per_month: 500_000,
    max_dashboards: 50, max_alert_rules: 50, max_slos: 10,
    max_traces_per_day: 50_000, observability_log_ingestion_mbps: 4,
    max_managed_tenants: 0, ai_rca_enabled: true, byos_enabled: true,
    observability_third_party_providers: 1,
    ai_notetaker_enabled: true, max_notetaker_minutes_per_month: 600,
  },
  enterprise: {
    max_users: 200, min_users: 10,
    max_tickets_per_month: 10_000, max_incidents_per_month: 10_000,
    max_storage_gb: 5, api_rate_limit: 5_000,
    custom_fields: true, sla_management: true, custom_workflows: true,
    audit_log_retention_days: 90,
    agents_enabled: true, max_agents: 5,
    max_on_call_schedules: -1, max_escalation_policies: 50,
    max_notifications_per_day: -1,
    observability_retention_days: 30, observability_series_limit: 1_000_000,
    max_synthetic_checks: 50, max_status_pages: 100,
    sso_enabled: true, scim_enabled: true, mcp_enabled: true,
    voice_whatsapp_enabled: true, white_label_enabled: false,
    notification_channels: ALL_CHANNELS,
    icc_enabled: true, service_dependencies_max: -1,
    auto_discovery_enabled: true, document_upload_discovery: true,
    guided_resolution_enabled: true, resolution_ai_monthly_budget_cents: 50_000,
    alert_quality_reports: true, business_impact_config: true,
    stakeholder_comms: true, predictive_alerts: true,
    toil_tracking: true, validation_suites_max: -1, compliance_aware_response: true,
    // v2 fields
    max_services: -1, max_sms_per_month: 2_000, max_voice_per_month: 1_000,
    max_whatsapp_per_month: 1_000, max_ai_tokens_per_month: 5_000_000,
    max_dashboards: 100, max_alert_rules: 100, max_slos: 50,
    max_traces_per_day: 200_000, observability_log_ingestion_mbps: 10,
    max_managed_tenants: 10, ai_rca_enabled: true, byos_enabled: true,
    observability_third_party_providers: 3,
    ai_notetaker_enabled: true, max_notetaker_minutes_per_month: 3_000,
  },
};

// Legacy aliases — kept so existing tenants with old plan names still resolve correctly
PLAN_LIMITS.starter = PLAN_LIMITS.startup;
PLAN_LIMITS.pro = PLAN_LIMITS.startup;
PLAN_LIMITS.business = PLAN_LIMITS.enterprise;

export async function getPlanLimitsFromDB(plan: string): Promise<PlanLimits> {
  // Resolve legacy aliases before DB lookup
  const aliasMap: Record<string, string> = { starter: 'startup', pro: 'startup', business: 'enterprise' };
  const resolvedPlan = aliasMap[plan] || plan;
  const fallback = PLAN_LIMITS[resolvedPlan] || PLAN_LIMITS.free;
  try {
    const def = await PlanDefinition.findOne({ name: resolvedPlan, is_active: true }).lean();
    if (def?.limits) {
      // Spread merge: fallback provides defaults for any fields not yet set in DB
      return { ...fallback, ...def.limits } as PlanLimits;
    }
  } catch (err) {
    logger.warn('Failed to load plan limits from DB, using hardcoded fallback', { plan, error: (err as Error).message });
  }
  return fallback;
}

/** @deprecated Use getPlanLimitsFromDB for async DB lookup. Sync fallback only. */
export function getPlanLimits(plan: string): PlanLimits {
  const aliasMap: Record<string, string> = { starter: 'startup', pro: 'startup', business: 'enterprise' };
  const resolved = aliasMap[plan] || plan;
  return PLAN_LIMITS[resolved] || PLAN_LIMITS.free;
}

// ─── Plan limit enforcement helper ────────────────────────────────────────────

export interface LimitCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  plan: string;
  limit_key: string;
}

/**
 * Check whether a tenant is within a specific plan limit.
 * Pass the already-loaded tenant.plan_limits to avoid an extra DB round-trip.
 */
export function checkLimit(
  planLimits: PlanLimits,
  plan: string,
  limitKey: keyof PlanLimits,
  currentCount: number
): LimitCheckResult {
  const limit = planLimits[limitKey] as number;
  const isUnlimited = limit === -1 || limit >= 9999;
  return {
    allowed: isUnlimited || currentCount < limit,
    limit,
    current: currentCount,
    plan,
    limit_key: limitKey,
  };
}

// ─── Plan definitions (DB-driven) ────────────────────────────────────────────

export async function listActivePlans() {
  const defs = await PlanDefinition.find({ is_active: true }).sort({ sort_order: 1, name: 1 }).lean();
  return defs.map((p) => ({
    id: p.name,
    name: p.display_name,
    description: p.description,
    price_monthly_cents: p.price_monthly_cents,
    price_yearly_cents: p.price_yearly_cents,
    features: p.features,
    limits: p.limits,
    is_popular: (p as any).is_popular ?? false,
    sort_order: p.sort_order,
  }));
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function getSubscription(tenantId: Types.ObjectId) {
  return Subscription.findOne({ tenant_id: tenantId });
}


export async function listInvoices(
  tenantId: Types.ObjectId,
  page = 1,
  limit = 20
) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Invoice.find({ tenant_id: tenantId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Invoice.countDocuments({ tenant_id: tenantId }),
  ]);

  return {
    data: data.map((inv) => ({
      id: inv._id.toString(),
      number: inv.number,
      status: inv.status,
      amount_cents: inv.amount_cents,
      currency: inv.currency,
      period_start: inv.period_start,
      period_end: inv.period_end,
      pdf_url: inv.pdf_url,
      hosted_invoice_url: inv.hosted_invoice_url,
      created_at: inv.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

export async function getCurrentUsage(tenantId: Types.ObjectId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

  const [
    userCount, ticketCount, incidentCount, usageRecord,
    schedulesCount, policiesCount, checksCount, statusPagesCount, agentsCount,
    dashboardsCount, alertRulesCount, slosCount, servicesCount,
  ] = await Promise.all([
    safe(User.countDocuments({ tenant_id: tenantId, status: { $in: ['active', 'invited'] } }), 0),
    safe(Ticket.countDocuments({ tenant_id: tenantId, createdAt: { $gte: monthStart } }), 0),
    safe(Incident.countDocuments({ tenant_id: tenantId, createdAt: { $gte: monthStart } }), 0),
    UsageRecord.findOne({ tenant_id: tenantId, period }).lean(),
    safe(OnCallSchedule.countDocuments({ tenant_id: tenantId }), 0),
    safe(EscalationPolicy.countDocuments({ tenant_id: tenantId }), 0),
    safe(SyntheticCheck.countDocuments({ tenant_id: tenantId }), 0),
    safe(StatusPage.countDocuments({ tenant_id: tenantId }), 0),
    safe(AgentInstallation.countDocuments({ tenant_id: tenantId }), 0),
    safe(Dashboard.countDocuments({ tenant_id: tenantId }), 0),
    safe(AlertRule.countDocuments({ tenant_id: tenantId }), 0),
    safe(SloDefinition.countDocuments({ tenant_id: tenantId }), 0),
    safe(Service.countDocuments({ tenant_id: tenantId }), 0),
  ]);

  return {
    period,
    // Existing dimensions
    users: userCount,
    tickets: ticketCount,
    incidents: incidentCount,
    storage_bytes: usageRecord?.storage_bytes || 0,
    api_calls: usageRecord?.api_calls || 0,
    agent_executions: usageRecord?.agent_executions || 0,
    notifications_sent: usageRecord?.notifications_sent || 0,
    on_call_schedules: schedulesCount,
    escalation_policies: policiesCount,
    synthetic_checks: checksCount,
    status_pages: statusPagesCount,
    agents: agentsCount,
    // New v2 dimensions
    sms_sent: (usageRecord as any)?.sms_sent || 0,
    voice_calls: (usageRecord as any)?.voice_calls || 0,
    whatsapp_sent: (usageRecord as any)?.whatsapp_sent || 0,
    ai_tokens_used: (usageRecord as any)?.ai_tokens_used || 0,
    dashboards: dashboardsCount,
    alert_rules: alertRulesCount,
    slos: slosCount,
    services: servicesCount,
    traces_ingested: (usageRecord as any)?.traces_ingested || 0,
    notetaker_minutes_used: (usageRecord as any)?.notetaker_minutes_used || 0,
  };
}

/**
 * Lightweight usage snapshot for limit-approach checking.
 * Returns only the fields needed by usage-alert.service.
 */
export async function getCurrentUsageForAlert(
  tenantId: Types.ObjectId
): Promise<Record<string, number>> {
  const usage = await getCurrentUsage(tenantId);
  return usage as unknown as Record<string, number>;
}

// ─── Webhook handler (provider-agnostic) ──────────────────────────────────────

export async function handleBillingEvent(event: PaymentEvent): Promise<void> {
  logger.info('Processing billing event', { type: event.type });

  switch (event.type) {
    case 'subscription.created': {
      const tenantId = event.tenantId;
      const plan = event.plan || 'startup';
      if (!tenantId || !event.subscriptionId) break;

      // For Stripe: retrieve additional subscription details from raw event
      const raw = event.raw as any;
      const stripeSub = raw?.data?.object?.subscription
        ? null  // checkout session — subscription ID is separate
        : raw?.data?.object;

      // Build subscription record from what we know
      const subUpdate: any = {
        tenant_id: new Types.ObjectId(tenantId),
        plan,
      };
      if (event.customerId) subUpdate.stripe_customer_id = event.customerId;
      if (event.subscriptionId) subUpdate.stripe_subscription_id = event.subscriptionId;

      // Try to get period info from raw event
      const rawSub = raw?.data?.object || {};
      if (rawSub.current_period_start) {
        subUpdate.current_period_start = new Date(rawSub.current_period_start * 1000);
        subUpdate.current_period_end = new Date(rawSub.current_period_end * 1000);
        subUpdate.cancel_at_period_end = rawSub.cancel_at_period_end ?? false;
        subUpdate.status = rawSub.status || 'active';
        const item = rawSub.items?.data?.[0];
        if (item) {
          subUpdate.seat_quantity = item.quantity || 1;
          subUpdate.monthly_amount_cents = (item.price?.unit_amount || 0) * (item.quantity || 1);
        }
      } else {
        subUpdate.status = 'active';
        subUpdate.current_period_start = new Date();
        subUpdate.current_period_end = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        subUpdate.cancel_at_period_end = false;
      }

      await Subscription.findOneAndUpdate(
        { tenant_id: new Types.ObjectId(tenantId) },
        subUpdate,
        { upsert: true, new: true }
      );

      const existingTenant = await Tenant.findById(tenantId);
      const prevPlan = existingTenant?.plan || 'free';

      await Tenant.findByIdAndUpdate(tenantId, {
        plan,
        plan_limits: await getPlanLimitsFromDB(plan),
        ...(event.customerId ? { stripe_customer_id: event.customerId } : {}),
        ...(prevPlan !== plan ? {
          pending_plan_change: {
            previous_plan: prevPlan,
            new_plan: plan,
            changed_at: new Date(),
            changed_by: 'stripe',
            acknowledged: false,
          },
        } : {}),
      });

      if (prevPlan !== plan) {
        notifyPlanChange(new Types.ObjectId(tenantId), prevPlan, plan, 'stripe').catch(() => {});
      }
      logger.info('Subscription created via payment event', { tenantId, plan });
      break;
    }

    case 'subscription.updated': {
      const tenantId = event.tenantId;
      const plan = event.plan;
      if (!tenantId) break;

      if (event.subscriptionId) {
        const update: any = {};
        if (plan) update.plan = plan;
        const raw = event.raw as any;
        const rawSub = raw?.data?.object || {};
        if (rawSub.status) update.status = rawSub.status;
        if (rawSub.cancel_at_period_end !== undefined) update.cancel_at_period_end = rawSub.cancel_at_period_end;
        if (Object.keys(update).length > 0) {
          await Subscription.findOneAndUpdate({ stripe_subscription_id: event.subscriptionId }, update);
        }
      }

      if (plan) {
        const existingT = await Tenant.findById(tenantId);
        const prevP = existingT?.plan || 'free';
        await Tenant.findByIdAndUpdate(tenantId, {
          plan,
          plan_limits: await getPlanLimitsFromDB(plan),
          ...(prevP !== plan ? {
            pending_plan_change: {
              previous_plan: prevP, new_plan: plan,
              changed_at: new Date(), changed_by: 'stripe', acknowledged: false,
            },
          } : {}),
        });
        if (prevP !== plan) {
          notifyPlanChange(new Types.ObjectId(tenantId), prevP, plan, 'stripe').catch(() => {});
        }
      }
      break;
    }

    case 'subscription.canceled': {
      if (event.subscriptionId) {
        await Subscription.findOneAndUpdate(
          { stripe_subscription_id: event.subscriptionId },
          { status: 'canceled', cancel_at_period_end: false }
        );
      }
      if (event.tenantId) {
        await Tenant.findByIdAndUpdate(event.tenantId, {
          plan: 'free',
          plan_limits: await getPlanLimitsFromDB('free'),
        });
      }
      logger.info('Subscription canceled', { tenantId: event.tenantId });
      break;
    }

    case 'invoice.paid': {
      const raw = event.raw as any;
      const inv = raw?.data?.object || raw;
      const tenant = event.customerId
        ? await Tenant.findOne({ stripe_customer_id: event.customerId })
        : null;
      if (!tenant || !inv.id) break;
      await Invoice.findOneAndUpdate(
        { stripe_invoice_id: inv.id },
        {
          tenant_id: tenant._id,
          stripe_invoice_id: inv.id,
          number: inv.number || inv.id,
          status: 'paid',
          amount_cents: inv.amount_paid,
          currency: inv.currency,
          period_start: new Date((inv.period_start || 0) * 1000),
          period_end: new Date((inv.period_end || 0) * 1000),
          pdf_url: inv.invoice_pdf || undefined,
          hosted_invoice_url: inv.hosted_invoice_url || undefined,
        },
        { upsert: true, new: true }
      );
      break;
    }

    case 'invoice.payment_failed': {
      if (!event.subscriptionId) break;
      await Subscription.findOneAndUpdate(
        { stripe_subscription_id: event.subscriptionId },
        { status: 'past_due' }
      );
      logger.warn('Invoice payment failed', { subscriptionId: event.subscriptionId });
      break;
    }
  }
}
