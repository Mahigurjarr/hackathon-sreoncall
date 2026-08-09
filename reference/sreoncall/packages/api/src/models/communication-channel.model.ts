import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ICommunicationChannel {
  consumer_tenant_id: Types.ObjectId;
  platform: 'slack' | 'teams';
  external_channel_id: string;
  display_name: string;
  channel_role: 'bidirectional' | 'ingest_only' | 'notify_only';
  installation_id?: Types.ObjectId;
  /**
   * Teams channels use an app-only Microsoft Graph client-credentials grant
   * (POST https://login.microsoftonline.com/{aad_tenant_id}/oauth2/v2.0/token,
   * scope https://graph.microsoft.com/.default) — the consumer org registers
   * its own Azure AD app and grants it ChannelMessage.Send with admin consent.
   * `app_id`/`aad_tenant_id` are public identifiers (not secret); the app
   * password is stored (encrypted) in the existing `access_token_encrypted`
   * field, and `external_channel_id` holds the Teams Channel ID — `team_id`
   * is the parent Team ID that Graph's `postMessage` also requires.
   */
  app_id?: string;
  aad_tenant_id?: string;
  team_id?: string;
  access_token_encrypted?: string;
  token_prefix?: string;
  signing_secret_hash?: string;
  webhook_token_hash?: string;
  webhook_token_prefix?: string;
  is_active: boolean;
  deleted_at?: Date;
}

export interface CommunicationChannelDocument extends ICommunicationChannel, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const communicationChannelSchema = new Schema<CommunicationChannelDocument>(
  {
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    platform: {
      type: String,
      enum: ['slack', 'teams'],
      required: true,
    },
    external_channel_id: { type: String, required: true },
    display_name: { type: String, required: true, maxlength: 200 },
    channel_role: {
      type: String,
      enum: ['bidirectional', 'ingest_only', 'notify_only'],
      default: 'bidirectional',
    },
    installation_id: { type: Schema.Types.ObjectId, ref: 'SlackInstallation', default: null },
    app_id: { type: String, default: null },
    aad_tenant_id: { type: String, default: null },
    team_id: { type: String, default: null },
    access_token_encrypted: { type: String, default: null },
    token_prefix: { type: String, maxlength: 20, default: null },
    signing_secret_hash: { type: String, default: null },
    webhook_token_hash: { type: String, default: null },
    webhook_token_prefix: { type: String, maxlength: 20, default: null },
    is_active: { type: Boolean, default: true },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'communication-channels',
  }
);

communicationChannelSchema.index(
  { consumer_tenant_id: 1, platform: 1, external_channel_id: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } }
);
communicationChannelSchema.index({ consumer_tenant_id: 1, is_active: 1 });
communicationChannelSchema.index({ webhook_token_hash: 1 }, { sparse: true });

export const CommunicationChannel: Model<CommunicationChannelDocument> = mongoose.model<CommunicationChannelDocument>(
  'CommunicationChannel',
  communicationChannelSchema
);
