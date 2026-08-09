import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * AI Notetaker — a single capture session for an online call (via a Recall.ai
 * meeting bot) or an offline uploaded recording. The audio is transcribed,
 * summarized, and mined for suggested tickets / runbooks / incident-timeline
 * entries that a human reviews and approves (suggest-then-approve).
 */

export type NotetakerSource = 'recall_bot' | 'upload';
export type NotetakerPlatform = 'zoom' | 'meet' | 'teams' | 'slack_huddle' | 'upload';

export type NotetakerStatus =
  | 'scheduled' // bot created, not yet joined
  | 'joining' // bot dialing into the meeting
  | 'recording' // live capture in progress
  | 'processing' // call ended / upload received, pre-transcription
  | 'transcribing' // STT running
  | 'summarizing' // AI extraction running
  | 'completed'
  | 'failed';

export type SuggestionType = 'ticket' | 'runbook' | 'incident_timeline';
export type SuggestionStatus = 'suggested' | 'accepted' | 'dismissed';

export interface INotetakerSuggestion {
  _id: Types.ObjectId;
  type: SuggestionType;
  status: SuggestionStatus;
  /** Proposed fields for the resource (shape depends on `type`). */
  payload: Record<string, unknown>;
  created_resource_type?: string | null;
  created_resource_id?: Types.ObjectId | null;
  decided_by?: Types.ObjectId | null;
  decided_at?: Date | null;
}

export interface INotetakerSession {
  tenant_id: Types.ObjectId;
  title: string;
  created_by: Types.ObjectId;

  source: NotetakerSource;
  platform: NotetakerPlatform;

  /** Optional links into the rest of the platform. */
  channel_id?: Types.ObjectId | null; // war room (Channel)
  incident_id?: Types.ObjectId | null;

  meeting_url?: string | null; // for recall_bot
  recall_bot_id?: string | null; // Recall.ai bot id
  // Set when auto-created from a calendar event (dedupe + traceability).
  recall_calendar_id?: string | null;
  calendar_event_id?: string | null;

  status: NotetakerStatus;
  error?: string | null;

  stt_provider: string; // which TranscriptionProvider produced the transcript
  audio_file_id?: Types.ObjectId | null; // FileAttachment for the recording
  transcript_text?: string | null; // full plain-text transcript
  duration_seconds: number;

  // AI extraction output
  summary?: string | null;
  key_points: string[];
  decisions: string[];
  participants: string[];

  suggestions: INotetakerSuggestion[];

  /** True once minutes have been metered into UsageRecord (idempotency guard). */
  metered: boolean;

  /** Slack message the summary was relayed to (so we can update it on Accept/Dismiss). */
  slack_message_ts?: string | null;
  slack_channel_id?: string | null;

  started_at?: Date | null;
  ended_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotetakerSessionDocument extends INotetakerSession, Document {
  _id: Types.ObjectId;
}

const suggestionSchema = new Schema<INotetakerSuggestion>(
  {
    type: { type: String, enum: ['ticket', 'runbook', 'incident_timeline'], required: true },
    status: { type: String, enum: ['suggested', 'accepted', 'dismissed'], default: 'suggested' },
    payload: { type: Schema.Types.Mixed, default: {} },
    created_resource_type: { type: String, default: null },
    created_resource_id: { type: Schema.Types.ObjectId, default: null },
    decided_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decided_at: { type: Date, default: null },
  },
  { _id: true }
);

const notetakerSessionSchema = new Schema<NotetakerSessionDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    source: { type: String, enum: ['recall_bot', 'upload'], required: true },
    platform: {
      type: String,
      enum: ['zoom', 'meet', 'teams', 'slack_huddle', 'upload'],
      required: true,
    },

    channel_id: { type: Schema.Types.ObjectId, ref: 'Channel', default: null },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },

    meeting_url: { type: String, default: null, maxlength: 2048 },
    recall_bot_id: { type: String, default: null },
    recall_calendar_id: { type: String, default: null },
    calendar_event_id: { type: String, default: null },

    status: {
      type: String,
      enum: ['scheduled', 'joining', 'recording', 'processing', 'transcribing', 'summarizing', 'completed', 'failed'],
      default: 'processing',
    },
    error: { type: String, default: null },

    stt_provider: { type: String, default: '' },
    audio_file_id: { type: Schema.Types.ObjectId, ref: 'FileAttachment', default: null },
    transcript_text: { type: String, default: null },
    duration_seconds: { type: Number, default: 0 },

    summary: { type: String, default: null },
    key_points: { type: [String], default: [] },
    decisions: { type: [String], default: [] },
    participants: { type: [String], default: [] },

    suggestions: { type: [suggestionSchema], default: [] },

    metered: { type: Boolean, default: false },

    slack_message_ts: { type: String, default: null },
    slack_channel_id: { type: String, default: null },

    started_at: { type: Date, default: null },
    ended_at: { type: Date, default: null },
  },
  {
    collection: 'notetaker_sessions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

notetakerSessionSchema.index({ tenant_id: 1, created_at: -1 });
notetakerSessionSchema.index({ tenant_id: 1, channel_id: 1 });
notetakerSessionSchema.index({ recall_bot_id: 1 });
notetakerSessionSchema.index({ tenant_id: 1, calendar_event_id: 1 });

export const NotetakerSession: Model<NotetakerSessionDocument> =
  mongoose.model<NotetakerSessionDocument>('NotetakerSession', notetakerSessionSchema);
