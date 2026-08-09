import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface MfaSettings {
  totp_secret?: string;
  totp_enabled: boolean;
  webauthn_credentials: Array<{
    credential_id: string;
    public_key: string;
    counter: number;
    name: string;
  }>;
  backup_codes: string[];
  mfa_enabled: boolean;
}

export interface NotificationChannels {
  incident: boolean;
  ticket: boolean;
  oncall: boolean;
  system: boolean;
  comms: boolean;
}

export interface QuietHours {
  enabled: boolean;
  start: string; // 'HH:mm'
  end: string;   // 'HH:mm'
  timezone: string;
}

export interface NotificationPreferences {
  email: boolean;
  in_app: boolean;
  sms: boolean;
  slack: boolean;
  voice: boolean;
  whatsapp: boolean;
  ticket_assigned: boolean;
  ticket_updated: boolean;
  ticket_commented: boolean;
  mention: boolean;
  sla_breach: boolean;
  channels: NotificationChannels;
  quiet_hours: QuietHours;
  comms_sound: boolean;
  comms_browser_notifications: boolean;
}

export interface UserNominee {
  name: string;
  email: string;
  relationship: string;
}

export interface IUser {
  tenant_id: Types.ObjectId;
  email: string;
  email_verified: boolean;
  name: string;
  avatar_url?: string;
  roles: string[];
  status: 'active' | 'invited' | 'disabled' | 'deleted';
  source: 'local' | 'sso' | 'scim';
  external_id?: string;
  password_hash?: string;
  password_history: string[];
  force_password_change: boolean;
  mfa: MfaSettings;
  failed_login_attempts: number;
  locked_until?: Date;
  last_login_at?: Date;
  invite_token?: string;
  phone_number?: string;
  slack_user_id?: string;
  timezone: string;
  notification_preferences: NotificationPreferences;
  nominee?: UserNominee;
  deleted_at?: Date;
}

export interface UserDocument extends IUser, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const mfaSchema = new Schema<MfaSettings>(
  {
    totp_secret: String,
    totp_enabled: { type: Boolean, default: false },
    webauthn_credentials: [
      {
        credential_id: String,
        public_key: String,
        counter: Number,
        name: String,
      },
    ],
    backup_codes: [String],
    mfa_enabled: { type: Boolean, default: false },
  },
  { _id: false }
);

const notificationChannelsSchema = new Schema<NotificationChannels>(
  {
    incident: { type: Boolean, default: true },
    ticket: { type: Boolean, default: true },
    oncall: { type: Boolean, default: true },
    system: { type: Boolean, default: true },
    comms: { type: Boolean, default: true },
  },
  { _id: false }
);

const quietHoursSchema = new Schema<QuietHours>(
  {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: '22:00' },
    end: { type: String, default: '08:00' },
    timezone: { type: String, default: 'UTC' },
  },
  { _id: false }
);

const notificationPreferencesSchema = new Schema<NotificationPreferences>(
  {
    email: { type: Boolean, default: true },
    in_app: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    slack: { type: Boolean, default: false },
    voice: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    ticket_assigned: { type: Boolean, default: true },
    ticket_updated: { type: Boolean, default: true },
    ticket_commented: { type: Boolean, default: true },
    mention: { type: Boolean, default: true },
    sla_breach: { type: Boolean, default: true },
    channels: { type: notificationChannelsSchema, default: () => ({}) },
    quiet_hours: { type: quietHoursSchema, default: () => ({}) },
    comms_sound: { type: Boolean, default: true },
    comms_browser_notifications: { type: Boolean, default: true },
  },
  { _id: false }
);

const userSchema = new Schema<UserDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    email_verified: { type: Boolean, default: false },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    avatar_url: String,
    roles: {
      type: [String],
      default: ['agent'],
      validate: {
        validator: (v: string[]) => v.length > 0,
        message: 'User must have at least one role',
      },
    },
    status: {
      type: String,
      enum: ['active', 'invited', 'disabled', 'deleted'],
      default: 'active',
    },
    source: {
      type: String,
      enum: ['local', 'sso', 'scim'],
      default: 'local',
    },
    external_id: { type: String, sparse: true },
    password_hash: { type: String, select: false },
    password_history: { type: [String], default: [], select: false },
    force_password_change: { type: Boolean, default: false },
    mfa: { type: mfaSchema, default: () => ({}) },
    failed_login_attempts: { type: Number, default: 0 },
    locked_until: Date,
    last_login_at: Date,
    invite_token: { type: String, index: true, sparse: true },
    phone_number: { type: String, maxlength: 20 },
    slack_user_id: { type: String },
    timezone: { type: String, default: 'UTC', maxlength: 100 },
    notification_preferences: { type: notificationPreferencesSchema, default: () => ({}) },
    nominee: {
      type: new Schema<UserNominee>(
        {
          name: { type: String, required: true, maxlength: 200 },
          email: { type: String, required: true, maxlength: 255 },
          relationship: { type: String, required: true, maxlength: 100 },
        },
        { _id: false }
      ),
    },
    deleted_at: Date,
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

userSchema.index({ tenant_id: 1, email: 1 }, { unique: true });
userSchema.index({ tenant_id: 1, status: 1 });
userSchema.index({ tenant_id: 1, external_id: 1 }, { sparse: true });

// Exclude password fields by default
userSchema.set('toJSON', {
  transform: (_doc: any, ret: any) => {
    delete ret.password_hash;
    delete ret.password_history;
    if (ret.mfa) {
      delete ret.mfa.totp_secret;
      delete ret.mfa.backup_codes;
    }
    return ret;
  },
});

export const User: Model<UserDocument> = mongoose.model<UserDocument>('User', userSchema);
