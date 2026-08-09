import { IPaymentProvider } from './payment-provider.interface';
import { stripeProvider } from './stripe.provider';
import { nullProvider } from './null.provider';

export function getPaymentProvider(): IPaymentProvider {
  if (process.env.STRIPE_SECRET_KEY) return stripeProvider;
  // Future: if (process.env.RAZORPAY_KEY_ID) return razorpayProvider;
  return nullProvider;
}

export type { IPaymentProvider, CheckoutParams, PaymentEvent } from './payment-provider.interface';
