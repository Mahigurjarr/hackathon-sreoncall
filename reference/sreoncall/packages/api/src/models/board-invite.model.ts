import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { BOARD_MEMBER_ROLES, type BoardMemberRole } from './board-member.model';

export type BoardInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export const BOARD_INVITE_STATUSES: readonly BoardInviteStatus[] = [
  'pending',
  'accepted',
  'revoked',
  'expired',
] as const;

export interface IBoardInvite {
  tenant_id: Types.ObjectId;
  board_id: Types.ObjectId;
  email: string;
  role: BoardMemberRole;
  token: string;
  expires_at: Date;
  invited_by: Types.ObjectId;
  status: BoardInviteStatus;
  accepted_at?: Date;
  revoked_at?: Date;
}

export interface BoardInviteDocument extends IBoardInvite, Document {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const boardInviteSchema = new Schema<BoardInviteDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true, index: true },
    board_id: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    role: { type: String, enum: BOARD_MEMBER_ROLES, required: true },
    token: { type: String, required: true },
    expires_at: { type: Date, required: true },
    invited_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: BOARD_INVITE_STATUSES,
      default: 'pending',
      required: true,
    },
    accepted_at: { type: Date },
    revoked_at: { type: Date },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'board_invites',
  }
);

boardInviteSchema.index({ token: 1 }, { unique: true });
// Only one pending invite per (board_id, email)
boardInviteSchema.index(
  { board_id: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
boardInviteSchema.index({ board_id: 1, status: 1, created_at: -1 });

export const BoardInvite: Model<BoardInviteDocument> =
  mongoose.model<BoardInviteDocument>('BoardInvite', boardInviteSchema);
