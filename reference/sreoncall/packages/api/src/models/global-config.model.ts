import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IGlobalConfig {
  key: string;
  value: any;
  description: string;
  category: string;
}

export interface GlobalConfigDocument extends IGlobalConfig, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const globalConfigSchema = new Schema<GlobalConfigDocument>(
  {
    key: { type: String, required: true, trim: true, maxlength: 100 },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String, default: '', maxlength: 500 },
    category: { type: String, default: 'general', trim: true, maxlength: 50 },
  },
  {
    timestamps: true,
    collection: 'global-configs',
  }
);

globalConfigSchema.index({ key: 1 }, { unique: true });
globalConfigSchema.index({ category: 1 });

export const GlobalConfig: Model<GlobalConfigDocument> = mongoose.model<GlobalConfigDocument>(
  'GlobalConfig',
  globalConfigSchema
);
