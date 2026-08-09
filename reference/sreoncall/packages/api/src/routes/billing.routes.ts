import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as billingService from '../services/billing.service';
import * as acService from '../services/activation-code.service';
import { rbac } from '../middleware/rbac.middleware';
import { requireFeatureFlag } from '../middleware/featureFlag.middleware';
import { logger } from '../utils/logger';
import { Tenant } from '../models/tenant.model';

// ─── Authenticated routes (tenant + auth middleware applied upstream) ──────────

export function createBillingAuthRouter(): Router {
  const router = Router();

  // GET /billing/plans — active plan definitions for plan comparison
  router.get('/plans', rbac('billing:read'), async (_req: Request, res: Response) => {
    const plans = await billingService.listActivePlans();
    res.json({ data: plans });
  });

  // GET /billing/subscription
  router.get('/subscription', rbac('billing:read'), async (req: Request, res: Response) => {
    const sub = await billingService.getSubscription(req.tenantId);
    // Always load the tenant to get its actual plan_limits (may be customised per-tenant by platform admin)
    const tenant = await Tenant.findById(req.tenantId).lean();
    if (!sub) {
      // No Stripe subscription — use the plan set on the tenant document
      res.json({
        plan: tenant?.plan || 'free',
        plan_limits: tenant?.plan_limits ?? null,
        status: 'active',
        stripe_configured: billingService.isStripeConfigured(),
      });
      return;
    }
    // tenant.plan is the authoritative source — the platform admin sets it directly
    // and the plan enforcement middleware reads it from the tenant document.
    // sub.plan reflects the last Stripe event and may be stale after a manual admin override.
    res.json({
      id: sub._id.toString(),
      plan: tenant?.plan || sub.plan,
      plan_limits: tenant?.plan_limits ?? null,
      status: sub.status,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      cancel_at_period_end: sub.cancel_at_period_end,
      seat_quantity: sub.seat_quantity,
      monthly_amount_cents: sub.monthly_amount_cents,
      stripe_configured: billingService.isStripeConfigured(),
    });
  });

  // POST /billing/checkout — create payment checkout session
  const checkoutSchema = z.object({
    plan: z.enum(['startup', 'growth', 'enterprise', 'starter', 'business', 'pro']),
    billing_cycle: z.enum(['monthly', 'annual']).optional().default('annual'),
  });

  router.post('/checkout', requireFeatureFlag('billing_enabled'), rbac('billing:manage'), async (req: Request, res: Response) => {
    const { plan, billing_cycle } = checkoutSchema.parse(req.body);
    const provider = billingService.getPaymentProvider();
    const result = await provider.createCheckoutSession({
      tenantId: req.tenantId,
      plan,
      userId: req.userId,
      billingCycle: billing_cycle,
    });
    res.json(result);
  });

  // POST /billing/portal — create billing portal session
  router.post('/portal', requireFeatureFlag('billing_enabled'), rbac('billing:manage'), async (req: Request, res: Response) => {
    const provider = billingService.getPaymentProvider();
    const result = await provider.createPortalSession(req.tenantId);
    res.json(result);
  });

  // PATCH /billing/subscription/plan — change plan
  const changePlanSchema = z.object({
    plan: z.enum(['startup', 'growth', 'enterprise', 'starter', 'business', 'pro']),
  });

  router.patch('/subscription/plan', requireFeatureFlag('billing_enabled'), rbac('billing:manage'), async (req: Request, res: Response) => {
    const { plan } = changePlanSchema.parse(req.body);
    const provider = billingService.getPaymentProvider();
    await provider.changePlan(req.tenantId, plan);
    const sub = await billingService.getSubscription(req.tenantId);
    res.json({
      id: sub?._id.toString(),
      plan: sub?.plan,
      status: sub?.status,
      monthly_amount_cents: sub?.monthly_amount_cents,
    });
  });

  // POST /billing/subscription/cancel
  router.post('/subscription/cancel', requireFeatureFlag('billing_enabled'), rbac('billing:manage'), async (req: Request, res: Response) => {
    const provider = billingService.getPaymentProvider();
    await provider.cancelSubscription(req.tenantId);
    const sub = await billingService.getSubscription(req.tenantId);
    res.json({
      id: sub?._id.toString(),
      plan: sub?.plan,
      status: sub?.status,
      cancel_at_period_end: sub?.cancel_at_period_end,
      current_period_end: sub?.current_period_end,
    });
  });

  // POST /billing/subscription/reactivate
  router.post('/subscription/reactivate', requireFeatureFlag('billing_enabled'), rbac('billing:manage'), async (req: Request, res: Response) => {
    const provider = billingService.getPaymentProvider();
    await provider.reactivateSubscription(req.tenantId);
    const sub = await billingService.getSubscription(req.tenantId);
    res.json({
      id: sub?._id.toString(),
      plan: sub?.plan,
      status: sub?.status,
      cancel_at_period_end: sub?.cancel_at_period_end,
    });
  });

  // GET /billing/invoices
  router.get('/invoices', rbac('billing:read'), async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await billingService.listInvoices(req.tenantId, page, limit);
    res.json(result);
  });

  // GET /billing/usage
  router.get('/usage', rbac('billing:read'), async (req: Request, res: Response) => {
    const usage = await billingService.getCurrentUsage(req.tenantId);
    res.json(usage);
  });

  // GET /billing/plan-change — check for pending plan change
  router.get('/plan-change', async (req: Request, res: Response) => {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant || !tenant.pending_plan_change || tenant.pending_plan_change.acknowledged) {
      res.json({ pending: false });
      return;
    }
    res.json({
      pending: true,
      previous_plan: tenant.pending_plan_change.previous_plan,
      new_plan: tenant.pending_plan_change.new_plan,
      changed_at: tenant.pending_plan_change.changed_at.toISOString(),
      changed_by: tenant.pending_plan_change.changed_by,
    });
  });

  // POST /billing/plan-change/acknowledge — acknowledge plan change
  router.post('/plan-change/acknowledge', async (req: Request, res: Response) => {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant || !tenant.pending_plan_change) {
      res.json({ acknowledged: true });
      return;
    }

    tenant.pending_plan_change.acknowledged = true;
    tenant.pending_plan_change.acknowledged_at = new Date();
    tenant.pending_plan_change.acknowledged_by = req.userId.toString();
    await tenant.save();

    res.json({ acknowledged: true });
  });

  // POST /billing/redeem — redeem a manual activation code
  const redeemSchema = z.object({
    code: z.string().min(1).max(30),
  });

  router.post('/redeem', rbac('billing:manage'), async (req: Request, res: Response) => {
    const { code } = redeemSchema.parse(req.body);
    const sub = await acService.redeemCode({
      code,
      tenantId: req.tenantId,
      userId: req.userId,
    });
    res.json(sub);
  });

  return router;
}

// ─── Webhook route (public, raw body for signature verification) ──────────────

export function createBillingWebhookHandler() {
  return async (req: Request, res: Response) => {
    const provider = billingService.getPaymentProvider();
    if (!provider.isConfigured()) {
      res.status(404).json({ error: 'No payment provider configured' });
      return;
    }

    const signature = req.headers['stripe-signature'] as string;

    try {
      const event = await provider.parseWebhookEvent(req.body, signature);
      await billingService.handleBillingEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      logger.warn('Billing webhook processing error', { error: err.message });
      if (err.statusCode === 400 || err.message?.includes('signature')) {
        res.status(400).json({ error: `Webhook error: ${err.message}` });
      } else {
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    }
  };
}
