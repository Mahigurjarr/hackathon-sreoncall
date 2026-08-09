import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ISlackInstallation {
  consumer_tenant_id: Types.ObjectId;
  team_id: string;
  team_name: string;
  bot_token_encrypted: string;
  bot_user_id: string;
  scopes: string;
  installed_by_user_id?: Types.ObjectId;
  is_active: boolean;
  deleted_at?: Date;
}

export interface SlackInstallationDocument extends ISlackInstallation, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const slackInstallationSchema = new Schema<SlackInstallationDocument>(
  {
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    team_id: { type: String, required: true },
    team_name: { type: String, required: true, maxlength: 200 },
    bot_token_encrypted: { type: String, required: true },
    bot_user_id: { type: String, required: true },
    scopes: { type: String, required: true },
    installed_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    is_active: { type: Boolean, default: true },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'slack-installations',
  }
);

slackInstallationSchema.index(
  { team_id: 1, consumer_tenant_id: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);
slackInstallationSchema.index({ consumer_tenant_id: 1, is_active: 1 });

export const SlackInstallation: Model<SlackInstallationDocument> = mongoose.model<SlackInstallationDocument>(
  'SlackInstallation',
  slackInstallationSchema
);
