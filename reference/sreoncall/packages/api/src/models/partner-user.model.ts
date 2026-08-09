import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type PartnerUserRole = 'owner' | 'admin' | 'member';
export const PARTNER_USER_ROLES: readonly PartnerUserRole[] = ['owner', 'admin', 'member'] as const;

export interface IPartnerUser {
  partnerId: Types.ObjectId;        // required, ref to Partner (no longer unique — multiple users per org)
  name: string;                     // required
  email: string;                    // required, lowercase, unique
  passwordHash?: string;            // bcrypt, nullable for OAuth-only users
  googleId?: string;                // unique if set
  githubId?: string;                // unique if set
  emailVerified: boolean;           // default: false
  role: PartnerUserRole;            // default: 'member'; first user per org becomes 'owner'
  invitedBy?: Types.ObjectId;       // ref to PartnerUser who invited this user (undefined for the founding owner)
  lastLoginAt?: Date;
}

export interface PartnerUserDocument extends IPartnerUser, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const partnerUserSchema = new Schema<PartnerUserDocument>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    passwordHash: { type: String },
    googleId: { type: String },
    githubId: { type: String },
    emailVerified: { type: Boolean, default: false },
    role: { type: String, enum: PARTNER_USER_ROLES, default: 'member', required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'PartnerUser' },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'partner_users',
  }
);

partnerUserSchema.index({ email: 1 }, { unique: true });
partnerUserSchema.index({ googleId: 1 }, { unique: true, sparse: true });
partnerUserSchema.index({ githubId: 1 }, { unique: true, sparse: true });
// partnerId is no longer unique — multiple users can share a partner org
partnerUserSchema.index({ partnerId: 1 });

export const PartnerUser: Model<PartnerUserDocument> = mongoose.model<PartnerUserDocument>('PartnerUser', partnerUserSchema);
