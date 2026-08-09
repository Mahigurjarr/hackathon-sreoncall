import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface IAIConversation {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  incident_id: Types.ObjectId | null;
  title: string;
  messages: AIMessage[];
  ai_model: string;
  total_tokens: number;
}

export interface AIConversationDocument extends IAIConversation, Document {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const messageSchema = new Schema<AIMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 100000 },
    timestamp: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const conversationSchema = new Schema<AIConversationDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    title: { type: String, default: 'New conversation', trim: true, maxlength: 500 },
    messages: [messageSchema],
    ai_model: { type: String, default: 'gpt-4o' },
    total_tokens: { type: Number, default: 0 },
  },
  {
    collection: 'ai_conversations',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

conversationSchema.index({ tenant_id: 1, user_id: 1, updated_at: -1 });
conversationSchema.index({ tenant_id: 1, incident_id: 1 });
// TTL: auto-delete conversations after 7 days of inactivity
conversationSchema.index({ updated_at: 1 }, { expireAfterSeconds: 604800 });

export const AIConversation: Model<AIConversationDocument> =
  mongoose.model<AIConversationDocument>('AIConversation', conversationSchema);
