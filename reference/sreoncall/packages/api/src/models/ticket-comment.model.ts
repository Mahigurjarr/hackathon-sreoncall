import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ITicketComment {
  ticket_id: Types.ObjectId;
  tenant_id: Types.ObjectId;
  author_id: Types.ObjectId;
  body: string;
  attachments: Array<{
    file_id: Types.ObjectId;
    filename: string;
    mime_type: string;
    size_bytes: number;
    url: string;
  }>;
  is_internal: boolean;
  edited_at?: Date;
  deleted_at?: Date;
}

export interface TicketCommentDocument extends ITicketComment, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const attachmentRefSchema = new Schema(
  {
    file_id: { type: Schema.Types.ObjectId, ref: 'FileAttachment' },
    filename: { type: String, required: true },
    mime_type: { type: String, required: true },
    size_bytes: { type: Number, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const ticketCommentSchema = new Schema<TicketCommentDocument>(
  {
    ticket_id: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    author_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 50000 },
    attachments: [attachmentRefSchema],
    is_internal: { type: Boolean, default: false },
    edited_at: Date,
    deleted_at: Date,
  },
  {
    timestamps: true,
    collection: 'ticket_comments',
  }
);

ticketCommentSchema.index({ ticket_id: 1, createdAt: 1 });

ticketCommentSchema.pre('find', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

ticketCommentSchema.pre('findOne', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

export const TicketComment: Model<TicketCommentDocument> = mongoose.model<TicketCommentDocument>(
  'TicketComment',
  ticketCommentSchema
);
