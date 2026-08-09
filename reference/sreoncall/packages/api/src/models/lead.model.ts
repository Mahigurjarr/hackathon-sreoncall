import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type LeadTrack = 'hero' | 'demo' | 'referral' | 'reseller' | 'msp' | 'partner' | 'general';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed_won' | 'closed_lost';
export type CompanySize = '1-10' | '11-50' | '51-200' | '201-1000' | '1000+';

export interface ILeadNote {
  _id: Types.ObjectId;
  body: string;
  author: string;
  created_at: Date;
}

export interface ILead {
  name: string;
  email: string;
  company: string;
  role?: string;
  company_size?: CompanySize;
  message?: string;
  track: LeadTrack;
  status: LeadStatus;
  assigned_to?: string;
  notes: ILeadNote[];
  follow_up_at?: Date;
  source_ip?: string;
  partnerId?: Types.ObjectId;
}

export interface LeadDocument extends ILead, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<ILeadNote>(
  {
    body: { type: String, required: true, maxlength: 4000 },
    author: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const leadSchema = new Schema<LeadDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    company: { type: String, required: true, trim: true, maxlength: 200 },
    role: { type: String, trim: true, maxlength: 200 },
    company_size: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
    },
    message: { type: String, maxlength: 2000 },
    track: {
      type: String,
      required: true,
      enum: ['hero', 'demo', 'referral', 'reseller', 'msp', 'partner', 'general'],
      default: 'general',
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'closed_won', 'closed_lost'],
      default: 'new',
    },
    assigned_to: { type: String, trim: true },
    notes: { type: [noteSchema], default: [] },
    follow_up_at: { type: Date },
    source_ip: { type: String },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner' },
  },
  {
    timestamps: true,
    collection: 'leads',
  }
);

leadSchema.index({ email: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ track: 1 });
leadSchema.index({ createdAt: -1 });

export const Lead: Model<LeadDocument> = mongoose.model<LeadDocument>('Lead', leadSchema);
