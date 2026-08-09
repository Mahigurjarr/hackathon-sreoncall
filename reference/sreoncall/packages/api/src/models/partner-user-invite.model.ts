import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { PARTNER_USER_ROLES, type PartnerUserRole } from './partner-user.model';

export type PartnerUserInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export const PARTNER_USER_INVITE_STATUSES: readonly PartnerUserInviteStatus[] = [
  'pending',
  'accepted',
  'revoked',
  'expired',
] as const;

export interface IPartnerUserInvite {
  partnerId: Types.ObjectId;
  email: string;               // lowercased
  role: PartnerUserRole;
  token: string;               // random 32-byte hex, unique
  expiresAt: Date;
  invitedBy: Types.ObjectId;   // ref PartnerUser
  status: PartnerUserInviteStatus;
  acceptedAt?: Date;
  revokedAt?: Date;
}

export interface PartnerUserInviteDocument extends IPartnerUserInvite, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const partnerUserInviteSchema = new Schema<PartnerUserInviteDocument>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    role: { type: String, enum: PARTNER_USER_ROLES, required: true },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'PartnerUser', required: true },
    status: {
      type: String,
      enum: PARTNER_USER_INVITE_STATUSES,
      default: 'pending',
      required: true,
    },
    acceptedAt: { type: Date },
    revokedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'partner_user_invites',
  }
);

partnerUserInviteSchema.index({ token: 1 }, { unique: true });
// Only one pending invite per (partnerId, email)
partnerUserInviteSchema.index(
  { partnerId: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
partnerUserInviteSchema.index({ partnerId: 1, status: 1, createdAt: -1 });

export const PartnerUserInvite: Model<PartnerUserInviteDocument> =
  mongoose.model<PartnerUserInviteDocument>('PartnerUserInvite', partnerUserInviteSchema);
