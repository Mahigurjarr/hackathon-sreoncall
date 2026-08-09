import Stripe from 'stripe';
import { Types } from 'mongoose';
import { IPaymentProvider, CheckoutParams, PaymentEvent } from './payment-provider.interface';
import { AppError } from '../../middleware/errorHandler.middleware';
import { Tenant } from '../../models/tenant.model';
import { Subscription } from '../../models/billing.model';
import { User } from '../../models/user.model';
import { getPlanLimitsFromDB } from '../billing.service';
import { notifyPlanChange } from '../plan-change-notification.service';
import { logger } from '../../utils/logger';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw AppError.badRequest('Stripe is not configured. Set STRIPE_SECRET_KEY.');
  _stripe = new Stripe(key, { apiVersion: '2025-01-27.acacia' as any });
  return _stripe;
}

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  startup: process.env.STRIPE_PRICE_STARTUP || process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_PRO,
  growth: process.env.STRIPE_PRICE_GROWTH,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || process.env.STRIPE_PRICE_BUSINESS,
  starter: process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_PRO,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS || process.env.STRIPE_PRICE_ENTERPRISE,
};

function getPriceId(plan: string): string {
  const id = PLAN_PRICE_MAP[plan] || process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
  if (!id) throw AppError.badRequest(`No Stripe price configured for plan: ${plan}`);
  return id;
}

export async function getOrCreateStripeCustomer(tenantId: Types.ObjectId): Promise<string> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant');
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: tenant.name,
    metadata: { tenant_id: tenantId.toString(), tenant_slug: tenant.slug },
  });
  tenant.stripe_customer_id = customer.id;
  await tenant.save();
  return customer.id;
}

class StripePaymentProvider implements IPaymentProvider {
  isConfigured(): boolean { return !!process.env.STRIPE_SECRET_KEY; }

  async createCheckoutSession(params: CheckoutParams): Promise<{ url: string; session_id: string }> {
    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(params.tenantId);
    const priceId = getPriceId(params.plan);
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const seatCount = await User.countDocuments({
      tenant_id: params.tenantId, status: { $in: ['active', 'invited'] },
    });
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: Math.max(seatCount, 1) }],
      success_url: `${appUrl}/settings/billing?checkout=success`,
      cancel_url: `${appUrl}/settings/billing?checkout=canceled`,
      metadata: {
        tenant_id: params.tenantId.toString(),
        plan: params.plan,
        user_id: params.userId.toString(),
      },
      subscription_data: {
        metadata: { tenant_id: params.tenantId.toString(), plan: params.plan },
      },
    });
    return { url: session.url!, session_id: session.id };
  }

  async createPortalSession(tenantId: Types.ObjectId): Promise<{ url: string }> {
    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(tenantId);
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings/billing`,
    });
    return { url: session.url };
  }

  async changePlan(tenantId: Types.ObjectId, newPlan: string): Promise<void> {
    const stripe = getStripe();
    const sub = await Subscription.findOne({ tenant_id: tenantId });
    if (!sub) throw AppError.notFound('Subscription');
    const previousPlan = sub.plan;
    const priceId = getPriceId(newPlan);
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) throw AppError.badRequest('No subscription item found');
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: { plan: newPlan, tenant_id: tenantId.toString() },
    });
    sub.plan = newPlan as any;
    sub.monthly_amount_cents = (updated.items.data[0]?.price?.unit_amount || 0) * sub.seat_quantity;
    await sub.save();
    const planLimits = await getPlanLimitsFromDB(newPlan);
    await Tenant.findByIdAndUpdate(tenantId, {
      plan: newPlan,
      plan_limits: planLimits,
      pending_plan_change: {
        previous_plan: previousPlan,
        new_plan: newPlan,
        changed_at: new Date(),
        changed_by: 'self',
        acknowledged: false,
      },
    });
    if (previousPlan !== newPlan) {
      notifyPlanChange(tenantId, previousPlan, newPlan, 'self').catch(() => {});
    }
  }

  async cancelSubscription(tenantId: Types.ObjectId): Promise<void> {
    const stripe = getStripe();
    const sub = await Subscription.findOne({ tenant_id: tenantId });
    if (!sub) throw AppError.notFound('Subscription');
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    sub.cancel_at_period_end = true;
    await sub.save();
  }

  async reactivateSubscription(tenantId: Types.ObjectId): Promise<void> {
    const stripe = getStripe();
    const sub = await Subscription.findOne({ tenant_id: tenantId });
    if (!sub) throw AppError.notFound('Subscription');
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
    sub.cancel_at_period_end = false;
    await sub.save();
  }

  async parseWebhookEvent(rawBody: Buffer, signature: string): Promise<PaymentEvent> {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw AppError.badRequest('STRIPE_WEBHOOK_SECRET not configured');
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return this._mapStripeEvent(event);
  }

  private _mapStripeEvent(event: Stripe.Event): PaymentEvent {
    const obj = event.data.object as any;
    const tenantId = obj.metadata?.tenant_id || '';
    const plan = obj.metadata?.plan;
    switch (event.type) {
      case 'checkout.session.completed':
        return { type: 'subscription.created', tenantId, plan, subscriptionId: obj.subscription, customerId: obj.customer, raw: event };
      case 'customer.subscription.updated':
        return { type: 'subscription.updated', tenantId, plan, subscriptionId: obj.id, customerId: obj.customer, raw: event };
      case 'customer.subscription.deleted':
        return { type: 'subscription.canceled', tenantId, subscriptionId: obj.id, customerId: obj.customer, raw: event };
      case 'invoice.paid':
        return { type: 'invoice.paid', tenantId, customerId: obj.customer, raw: event };
      case 'invoice.payment_failed':
        return { type: 'invoice.payment_failed', tenantId, subscriptionId: obj.subscription, raw: event };
      default:
        logger.debug('Unhandled Stripe event type', { type: event.type });
        return { type: 'subscription.updated', tenantId, raw: event };
    }
  }
}

export const stripeProvider = new StripePaymentProvider();
