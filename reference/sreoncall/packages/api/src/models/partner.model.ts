import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type PartnerType = 'referral' | 'reseller' | 'msp';
export type PartnerStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type LegalStructure = 'sole_proprietor' | 'llp' | 'pvt_ltd' | 'ltd' | 'partnership' | 'other';

export interface IPartnerOnboarding {
  legalEntityName?: string;
  legalStructure?: LegalStructure;
  businessAddress?: string;
  taxId?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankRoutingCode?: string;
  agreementAccepted: boolean;
  completedAt?: Date;
}

export interface IPartnerNote {
  _id: Types.ObjectId;
  body: string;
  author: string;      // platform admin email
  created_at: Date;
}

export interface IPartner {
  leadId?: Types.ObjectId;          // ref to Lead (if converted from lead)
  name: string;                     // required
  email: string;                    // required, lowercase, unique
  company: string;                  // required
  partnerType: PartnerType;         // required
  status: PartnerStatus;            // default: 'pending'
  commissionRate: number;           // percentage, e.g. 15 — default: 0
  assignedTo?: string;              // platform admin email
  notes: IPartnerNote[];
  inviteToken?: string;             // UUID, set when invite sent
  inviteTokenExpiresAt?: Date;      // 48hr TTL
  inviteSentAt?: Date;
  activatedAt?: Date;               // set when PartnerUser created
  source_ip?: string;               // anonymised IP from application submission
  onboarding: IPartnerOnboarding;
}

export interface PartnerDocument extends IPartner, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const onboardingSchema = new Schema<IPartnerOnboarding>(
  {
    legalEntityName: { type: String, trim: true, maxlength: 300 },
    legalStructure: { type: String, enum: ['sole_proprietor', 'llp', 'pvt_ltd', 'ltd', 'partnership', 'other'] },
    businessAddress: { type: String, trim: true, maxlength: 500 },
    taxId: { type: String, trim: true, maxlength: 100 },
    bankAccountName: { type: String, trim: true, maxlength: 200 },
    bankAccountNumber: { type: String, trim: true, maxlength: 50 },
    bankRoutingCode: { type: String, trim: true, maxlength: 50 },
    agreementAccepted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { _id: false }
);

const noteSchema = new Schema<IPartnerNote>(
  {
    body: { type: String, required: true, maxlength: 4000 },
    author: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const partnerSchema = new Schema<PartnerDocument>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    company: { type: String, required: true, trim: true, maxlength: 200 },
    partnerType: {
      type: String,
      required: true,
      enum: ['referral', 'reseller', 'msp'],
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'inactive', 'rejected'],
      default: 'pending',
    },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    assignedTo: { type: String, trim: true },
    notes: { type: [noteSchema], default: [] },
    inviteToken: { type: String },
    inviteTokenExpiresAt: { type: Date },
    inviteSentAt: { type: Date },
    activatedAt: { type: Date },
    source_ip: { type: String },
    onboarding: { type: onboardingSchema, default: () => ({ agreementAccepted: false }) },
  },
  {
    timestamps: true,
    collection: 'partners',
  }
);

partnerSchema.index({ email: 1 }, { unique: true });
partnerSchema.index({ status: 1 });
partnerSchema.index({ partnerType: 1 });
partnerSchema.index({ createdAt: -1 });

export const Partner: Model<PartnerDocument> = mongoose.model<PartnerDocument>('Partner', partnerSchema);
