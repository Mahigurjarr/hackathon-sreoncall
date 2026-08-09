import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IFileAttachment {
  tenant_id: Types.ObjectId;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  bucket: string;
  object_key: string;
  uploaded_by: Types.ObjectId;
  resource_type?: string;
  resource_id?: string;
  created_at: Date;
}

export interface FileAttachmentDocument extends IFileAttachment, Document {
  _id: Types.ObjectId;
}

const fileAttachmentSchema = new Schema<FileAttachmentDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    filename: { type: String, required: true },
    original_name: { type: String, required: true },
    mime_type: { type: String, required: true },
    size_bytes: { type: Number, required: true, min: 0 },
    bucket: { type: String, required: true },
    object_key: { type: String, required: true },
    uploaded_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resource_type: String,
    resource_id: String,
    created_at: { type: Date, default: Date.now },
  },
  {
    collection: 'file_attachments',
    timestamps: false,
  }
);

fileAttachmentSchema.index({ tenant_id: 1, resource_type: 1, resource_id: 1 });

export const FileAttachment: Model<FileAttachmentDocument> = mongoose.model<FileAttachmentDocument>(
  'FileAttachment',
  fileAttachmentSchema
);
