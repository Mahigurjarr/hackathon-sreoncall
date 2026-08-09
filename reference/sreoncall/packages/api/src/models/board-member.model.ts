import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type BoardMemberRole = 'admin' | 'member' | 'viewer';
export const BOARD_MEMBER_ROLES: readonly BoardMemberRole[] = ['admin', 'member', 'viewer'] as const;

export interface IBoardMember {
  tenant_id: Types.ObjectId;
  board_id: Types.ObjectId;
  user_id: Types.ObjectId;
  role: BoardMemberRole;
  invited_by: Types.ObjectId;
  joined_at: Date;
}

export interface BoardMemberDocument extends IBoardMember, Document {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const boardMemberSchema = new Schema<BoardMemberDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true },
    board_id: { type: Schema.Types.ObjectId, required: true, ref: 'Project' },
    user_id: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    role: { type: String, enum: BOARD_MEMBER_ROLES, required: true },
    invited_by: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    joined_at: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'board_members',
  }
);

boardMemberSchema.index({ board_id: 1, user_id: 1 }, { unique: true });
boardMemberSchema.index({ tenant_id: 1, board_id: 1 });
boardMemberSchema.index({ user_id: 1 });

export const BoardMember = mongoose.model<BoardMemberDocument>('BoardMember', boardMemberSchema);
