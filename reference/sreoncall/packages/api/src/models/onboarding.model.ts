import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type OnboardingStatus = 'pending_submission' | 'submitted' | 'approved' | 'rejected';

export interface IOnboarding {
  tenant_name: string;
  tenant_slug: string;
  contact_email: string;
  assignee_email: string;
  token: string;
  token_expires_at: Date;
  status: OnboardingStatus;
  form_data?: Record<string, any>;
  submitted_at?: Date;
  reviewed_by?: Types.ObjectId;
  reviewed_at?: Date;
  review_notes?: string;
  tenant_id?: Types.ObjectId;
  created_by: Types.ObjectId;
}

export interface OnboardingDocument extends IOnboarding, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const onboardingSchema = new Schema<OnboardingDocument>(
  {
    tenant_name: { type: String, required: true, maxlength: 200 },
    tenant_slug: { type: String, required: true, maxlength: 63 },
    contact_email: { type: String, required: true, maxlength: 255 },
    assignee_email: { type: String, required: true, maxlength: 255 },
    token: { type: String },
    token_expires_at: { type: Date },
    status: {
      type: String,
      enum: ['pending_submission', 'submitted', 'approved', 'rejected'],
      default: 'pending_submission',
      required: true,
    },
    form_data: { type: Schema.Types.Mixed },
    submitted_at: { type: Date },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewed_at: { type: Date },
    review_notes: { type: String, maxlength: 2000 },
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'onboardings',
    timestamps: true,
  }
);

onboardingSchema.index({ token: 1 }, { unique: true, sparse: true });
onboardingSchema.index({ tenant_slug: 1 }, { unique: true });
onboardingSchema.index({ status: 1 });

export const Onboarding: Model<OnboardingDocument> = mongoose.model<OnboardingDocument>('Onboarding', onboardingSchema);
