import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IRotationHistoryEntry {
  rotated_at: Date;
  rotated_by: string;
  status: 'success' | 'failed';
  error: string | null;
}

export interface ICredentialRegistry {
  name: string;
  key: string;
  category: 'internal' | 'external';
  rotation_mode: 'auto' | 'manual';
  rotation_interval_days: number;
  last_rotated_at: Date | null;
  next_rotation_at: Date | null;
  rotated_by: string | null;
  status: 'healthy' | 'due' | 'overdue' | 'rotating' | 'failed';
  current_value_hint: string | null;
  rotation_instructions: string | null;
  env_var_keys: string[];
  history: IRotationHistoryEntry[];
  notify_before_days: number;
}

export interface CredentialRegistryDocument extends ICredentialRegistry, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const rotationHistoryEntrySchema = new Schema<IRotationHistoryEntry>(
  {
    rotated_at: { type: Date, required: true },
    rotated_by: { type: String, required: true },
    status: { type: String, enum: ['success', 'failed'], required: true },
    error: { type: String, default: null },
  },
  { _id: false }
);

const credentialRegistrySchema = new Schema<CredentialRegistryDocument>(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true },
    category: { type: String, enum: ['internal', 'external'], required: true },
    rotation_mode: { type: String, enum: ['auto', 'manual'], required: true },
    rotation_interval_days: { type: Number, required: true },
    last_rotated_at: { type: Date, default: null },
    next_rotation_at: { type: Date, default: null },
    rotated_by: { type: String, default: null },
    status: {
      type: String,
      enum: ['healthy', 'due', 'overdue', 'rotating', 'failed'],
      required: true,
      default: 'healthy',
    },
    current_value_hint: { type: String, default: null },
    rotation_instructions: { type: String, default: null },
    env_var_keys: { type: [String], default: [] },
    history: {
      type: [rotationHistoryEntrySchema],
      default: [],
      validate: {
        validator: (arr: IRotationHistoryEntry[]) => arr.length <= 10,
        message: 'history array is capped at 10 entries',
      },
    },
    notify_before_days: { type: Number, default: 7 },
  },
  {
    timestamps: true,
    collection: 'credential-registry',
  }
);

credentialRegistrySchema.index({ key: 1 }, { unique: true });
credentialRegistrySchema.index({ status: 1 });
credentialRegistrySchema.index({ next_rotation_at: 1 });

export const CredentialRegistry: Model<CredentialRegistryDocument> =
  mongoose.model<CredentialRegistryDocument>('CredentialRegistry', credentialRegistrySchema);
