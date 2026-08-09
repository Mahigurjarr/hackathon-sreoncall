import mongoose, { Schema, Document, Types } from 'mongoose';

export type PartnerAuditAction =
  | 'team.invite.created'
  | 'team.invite.revoked'
  | 'team.member.role_changed'
  | 'team.member.removed'
  | 'team.member.joined';

export interface PartnerAuditLogDocument extends Document {
  partnerId: Types.ObjectId;
  actorUserId?: Types.ObjectId;
  actorEmail?: string;
  action: PartnerAuditAction;
  targetEmail?: string;
  targetUserId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const schema = new Schema<PartnerAuditLogDocument>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'PartnerUser' },
    actorEmail: { type: String },
    action: { type: String, required: true },
    targetEmail: { type: String },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'PartnerUser' },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ partnerId: 1, createdAt: -1 });

// 180-day TTL — partner audit data isn't tenant-plan-scoped
schema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const PartnerAuditLog =
  (mongoose.models.PartnerAuditLog as mongoose.Model<PartnerAuditLogDocument>) ||
  mongoose.model<PartnerAuditLogDocument>('PartnerAuditLog', schema);
