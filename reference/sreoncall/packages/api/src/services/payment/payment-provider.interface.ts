import { Types } from 'mongoose';

export interface CheckoutParams {
  tenantId: Types.ObjectId;
  plan: string;
  userId: Types.ObjectId;
  billingCycle: 'monthly' | 'annual';
}

export interface PaymentEvent {
  type:
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.canceled'
    | 'invoice.paid'
    | 'invoice.payment_failed';
  tenantId: string;
  plan?: string;
  subscriptionId?: string;
  customerId?: string;
  raw: unknown;
}

export interface IPaymentProvider {
  isConfigured(): boolean;
  createCheckoutSession(params: CheckoutParams): Promise<{ url: string; session_id: string }>;
  createPortalSession(tenantId: Types.ObjectId): Promise<{ url: string }>;
  changePlan(tenantId: Types.ObjectId, newPlan: string): Promise<void>;
  cancelSubscription(tenantId: Types.ObjectId): Promise<void>;
  reactivateSubscription(tenantId: Types.ObjectId): Promise<void>;
  parseWebhookEvent(rawBody: Buffer, signature: string): Promise<PaymentEvent>;
}
