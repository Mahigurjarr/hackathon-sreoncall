import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type DealStage = 'pending_approval' | 'prospect' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' | 'rejected';
export type ProductTier = 'startup' | 'growth' | 'enterprise' | 'self_hosted' | 'services';

export type CommissionTrack = 'referral' | 'reseller' | 'msp';

export interface ICommissionYear {
  year: 1 | 2 | 3;
  ratePct: number;
  annualAmount: number;
}

export interface ICommissionBreakdown {
  track: CommissionTrack;
  basis: 'flat' | 'tapered' | 'custom';
  years: ICommissionYear[];
  totalThreeYear: number;
  notes?: string;
}

export interface IDeal {
  partnerId: Types.ObjectId;        // required, ref to Partner
  referredCompany: string;          // required
  contactName: string;              // required
  contactEmail: string;             // required
  estimatedARR: number;             // USD, required, min 0
  productTier: ProductTier;         // required
  currentTools: string[];           // e.g. ['Datadog', 'PagerDuty']
  expectedCloseDate: Date;          // required
  stage: DealStage;                 // default: 'prospect'
  commissionRate: number;           // Y1 headline rate — kept for backward compat
  commissionEarned: number;         // calculated field, default 0
  commissionBreakdown?: ICommissionBreakdown; // per-year expected payout
  commissionOverride: boolean;      // true when admin has manually edited breakdown
  notes: string;                    // partner-visible notes, max 4000 chars
  adminNotes: string;               // internal only, max 4000 chars
}

export interface DealDocument extends IDeal, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const commissionYearSchema = new Schema<ICommissionYear>(
  {
    year: { type: Number, enum: [1, 2, 3], required: true },
    ratePct: { type: Number, required: true, min: 0, max: 100 },
    annualAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const commissionBreakdownSchema = new Schema<ICommissionBreakdown>(
  {
    track: { type: String, enum: ['referral', 'reseller', 'msp'], required: true },
    basis: { type: String, enum: ['flat', 'tapered', 'custom'], required: true },
    years: { type: [commissionYearSchema], default: [] },
    totalThreeYear: { type: Number, required: true, min: 0 },
    notes: { type: String, maxlength: 500 },
  },
  { _id: false }
);

const dealSchema = new Schema<DealDocument>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    referredCompany: { type: String, required: true, trim: true, maxlength: 200 },
    contactName: { type: String, required: true, trim: true, maxlength: 200 },
    contactEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    estimatedARR: { type: Number, required: true, min: 0 },
    productTier: {
      type: String,
      required: true,
      enum: ['startup', 'growth', 'enterprise', 'self_hosted', 'services'],
    },
    currentTools: { type: [String], default: [] },
    expectedCloseDate: { type: Date, required: true },
    stage: {
      type: String,
      enum: ['pending_approval', 'prospect', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost', 'rejected'],
      default: 'pending_approval',
    },
    commissionRate: { type: Number, required: true, min: 0, max: 100 },
    commissionEarned: { type: Number, default: 0, min: 0 },
    commissionBreakdown: { type: commissionBreakdownSchema, default: undefined },
    commissionOverride: { type: Boolean, default: false },
    notes: { type: String, default: '', maxlength: 4000 },
    adminNotes: { type: String, default: '', maxlength: 4000 },
  },
  {
    timestamps: true,
    collection: 'deals',
  }
);

dealSchema.index({ partnerId: 1 });
dealSchema.index({ stage: 1 });
dealSchema.index({ createdAt: -1 });

export const Deal: Model<DealDocument> = mongoose.model<DealDocument>('Deal', dealSchema);
