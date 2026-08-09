import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IPayout {
  dealId: Types.ObjectId;           // required, ref to Deal
  partnerId: Types.ObjectId;        // required, ref to Partner (denormalised)
  amount: number;                   // USD, required, min 0
  currency: string;                 // default: 'USD'
  paidAt: Date;                     // required
  reference: string;                // invoice number / bank reference, max 200 chars
  notes?: string;                   // max 1000 chars
}

export interface PayoutDocument extends IPayout, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSchema = new Schema<PayoutDocument>(
  {
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal', required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD', trim: true, maxlength: 3 }, // ISO 4217 currency codes are exactly 3 chars
    paidAt: { type: Date, required: true },
    reference: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, maxlength: 1000 },
  },
  {
    timestamps: true,
    collection: 'payouts',
  }
);

payoutSchema.index({ partnerId: 1 });
payoutSchema.index({ dealId: 1 });
payoutSchema.index({ paidAt: -1 });

export const Payout: Model<PayoutDocument> = mongoose.model<PayoutDocument>('Payout', payoutSchema);
