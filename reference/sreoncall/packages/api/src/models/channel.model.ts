import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ChannelType = 'general' | 'incident_war_room' | 'dm' | 'customer' | 'topic' | 'broadcast' | 'internal_escalation';

export interface IChannelMember {
  user_id: Types.ObjectId;
  role: 'owner' | 'admin' | 'member';
  joined_at: Date;
}

export interface SlackIntegration {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
}

export interface TeamsIntegration {
  team_id: string;
  channel_id: string;
}

export interface IChannel {
  tenant_id: Types.ObjectId;
  name: string;
  type: ChannelType;
  description: string;
  incident_id?: Types.ObjectId;
  members: IChannelMember[];
  slack_integration?: SlackIntegration;
  teams_integration?: TeamsIntegration;
  is_archived: boolean;
  last_message_at?: Date;
  created_by: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface ChannelDocument extends IChannel, Document {
  _id: Types.ObjectId;
}

const channelMemberSchema = new Schema<IChannelMember>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    joined_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const slackIntegrationSchema = new Schema(
  {
    workspace_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    channel_name: { type: String, required: true },
  },
  { _id: false }
);

const teamsIntegrationSchema = new Schema(
  {
    team_id: { type: String, required: true },
    channel_id: { type: String, required: true },
  },
  { _id: false }
);

const channelSchema = new Schema<ChannelDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: ['general', 'incident_war_room', 'dm', 'customer', 'topic', 'broadcast', 'internal_escalation'],
      default: 'general',
    },
    description: { type: String, default: '', maxlength: 1000 },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    members: [channelMemberSchema],
    slack_integration: { type: slackIntegrationSchema, default: undefined },
    teams_integration: { type: teamsIntegrationSchema, default: undefined },
    is_archived: { type: Boolean, default: false },
    last_message_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'channels',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

channelSchema.index({ tenant_id: 1 });
channelSchema.index({ tenant_id: 1, type: 1 });

export const Channel: Model<ChannelDocument> = mongoose.model<ChannelDocument>('Channel', channelSchema);

// --- Message sub-model ---

export type SenderType = 'user' | 'bot' | 'system';

export interface IMessage {
  tenant_id: Types.ObjectId;
  channel_id: Types.ObjectId;
  body: string;
  author_id: Types.ObjectId;
  sender_type: SenderType;
  thread_parent_id?: Types.ObjectId;
  slack_message_id?: string;
  teams_message_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface MessageDocument extends IMessage, Document {
  _id: Types.ObjectId;
}

const messageSchema = new Schema<MessageDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    channel_id: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    body: { type: String, required: true, maxlength: 10000 },
    author_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sender_type: { type: String, enum: ['user', 'bot', 'system'], default: 'user' },
    thread_parent_id: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    slack_message_id: { type: String, default: null },
    teams_message_id: { type: String, default: null },
  },
  {
    collection: 'messages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

messageSchema.index({ channel_id: 1, created_at: 1 });

export const Message: Model<MessageDocument> = mongoose.model<MessageDocument>('Message', messageSchema);
