import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ConsentType =
  | 'privacy_policy'
  | 'terms_of_service'
  | 'data_processing'
  | 'marketing'
  | 'status_page_subscription';

export interface IConsent {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  consent_type: ConsentType;
  version: string;
  granted: boolean;
  granted_at: Date;
  revoked_at?: Date;
  ip_address: string;
  user_agent: string;
}

export interface ConsentDocument extends IConsent, Document {
  _id: Types.ObjectId;
}

const consentSchema = new Schema<ConsentDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    consent_type: {
      type: String,
      enum: ['privacy_policy', 'terms_of_service', 'data_processing', 'marketing', 'status_page_subscription'],
      required: true,
    },
    version: { type: String, required: true, default: '1.0' },
    granted: { type: Boolean, required: true, default: true },
    granted_at: { type: Date, required: true, default: Date.now },
    revoked_at: { type: Date },
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true },
  },
  {
    collection: 'consents',
    timestamps: false,
  }
);

consentSchema.index({ tenant_id: 1, user_id: 1, consent_type: 1 }, { unique: true });
consentSchema.index({ user_id: 1 });

export const Consent: Model<ConsentDocument> = mongoose.model<ConsentDocument>('Consent', consentSchema);
