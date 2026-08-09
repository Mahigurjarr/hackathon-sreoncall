import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ActivationCodeStatus = 'pending' | 'redeemed' | 'expired' | 'revoked';

export interface IActivationCode {
  code: string;
  tenant_id: Types.ObjectId;
  plan: 'free' | 'starter' | 'startup' | 'growth' | 'business' | 'pro' | 'enterprise';
  duration_months: number;
  status: ActivationCodeStatus;
  expires_at: Date;
  redeemed_at?: Date;
  redeemed_by?: Types.ObjectId;
  generated_by: string;
  email_sent: boolean;
  email_sent_at?: Date;
  notes?: string;
}

export interface ActivationCodeDocument extends IActivationCode, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const activationCodeSchema = new Schema<ActivationCodeDocument>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    plan: { type: String, required: true, enum: ['free', 'starter', 'startup', 'growth', 'business', 'pro', 'enterprise'] },
    duration_months: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'redeemed', 'expired', 'revoked'],
      default: 'pending',
    },
    expires_at: { type: Date, required: true },
    redeemed_at: { type: Date },
    redeemed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    generated_by: { type: String, required: true },
    email_sent: { type: Boolean, default: false },
    email_sent_at: { type: Date },
    notes: { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
    collection: 'activation_codes',
  }
);

activationCodeSchema.index({ tenant_id: 1, status: 1 });
// expires_at: query index for daily cron that marks pending codes as expired.
// Not a TTL index — expired codes are retained for audit history.
activationCodeSchema.index({ expires_at: 1 });

export const ActivationCode: Model<ActivationCodeDocument> = mongoose.model<ActivationCodeDocument>(
  'ActivationCode',
  activationCodeSchema
);
