import { Types } from 'mongoose';
import { IPaymentProvider, CheckoutParams, PaymentEvent } from './payment-provider.interface';
import { AppError } from '../../middleware/errorHandler.middleware';

const NOT_CONFIGURED_MSG =
  'No payment provider configured. Contact your administrator to change your plan.';

class NullPaymentProvider implements IPaymentProvider {
  isConfigured(): boolean { return false; }

  async createCheckoutSession(_p: CheckoutParams): Promise<{ url: string; session_id: string }> {
    throw AppError.badRequest(NOT_CONFIGURED_MSG);
  }

  async createPortalSession(_t: Types.ObjectId): Promise<{ url: string }> {
    throw AppError.badRequest(NOT_CONFIGURED_MSG);
  }

  async changePlan(_t: Types.ObjectId, _p: string): Promise<void> {
    throw AppError.badRequest(NOT_CONFIGURED_MSG);
  }

  async cancelSubscription(_t: Types.ObjectId): Promise<void> {
    throw AppError.badRequest(NOT_CONFIGURED_MSG);
  }

  async reactivateSubscription(_t: Types.ObjectId): Promise<void> {
    throw AppError.badRequest(NOT_CONFIGURED_MSG);
  }

  async parseWebhookEvent(_b: Buffer, _s: string): Promise<PaymentEvent> {
    throw AppError.badRequest(NOT_CONFIGURED_MSG);
  }
}

export const nullProvider = new NullPaymentProvider();
