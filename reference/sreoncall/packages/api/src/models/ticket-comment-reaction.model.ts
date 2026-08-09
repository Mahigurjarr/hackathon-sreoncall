import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ReactionEmoji = '👍' | '❤️' | '✅' | '😄' | '🚀' | '👀';

export const ALLOWED_REACTIONS: ReactionEmoji[] = ['👍', '❤️', '✅', '😄', '🚀', '👀'];

export interface ITicketCommentReaction {
  tenant_id: Types.ObjectId;
  comment_id: Types.ObjectId;
  user_id: Types.ObjectId;
  emoji: ReactionEmoji;
}

export interface TicketCommentReactionDocument extends ITicketCommentReaction, Document {
  _id: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<TicketCommentReactionDocument>(
  {
    tenant_id:  { type: Schema.Types.ObjectId, required: true, index: true },
    comment_id: { type: Schema.Types.ObjectId, ref: 'TicketComment', required: true, index: true },
    user_id:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    emoji:      { type: String, enum: ALLOWED_REACTIONS, required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, collection: 'ticket_comment_reactions' }
);

// One reaction per user per emoji per comment
schema.index({ comment_id: 1, user_id: 1, emoji: 1 }, { unique: true });

export const TicketCommentReaction: Model<TicketCommentReactionDocument> =
  mongoose.model<TicketCommentReactionDocument>('TicketCommentReaction', schema);
