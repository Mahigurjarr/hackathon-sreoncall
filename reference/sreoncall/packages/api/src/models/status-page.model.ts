import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IStatusPageComponent {
  name: string;
  description: string;
  service_id?: Types.ObjectId;
  status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
}

export interface IComponentOverride {
  status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
  reason?: string;
  set_by?: Types.ObjectId;
  set_at?: Date;
}

export interface IStatusPageSettings {
  show_on_login: boolean;
  access_control: {
    visibility: 'public' | 'private';
    allowed_viewer_emails: string[];
    allowed_viewer_domains: string[];
  };
  display_options: {
    show_incidents: boolean;
    show_weekly_summary: boolean;
    show_rca_followups: boolean;
    selected_service_ids: Types.ObjectId[];
    selected_synthetic_check_ids: Types.ObjectId[];
  };
  component_overrides?: Record<string, IComponentOverride>;
  localization: {
    additional_locales_enabled: boolean;
    default_language: string;
    timezone: string;
  };
  branding?: {
    primary_color: string;
    custom_domain: string;
  };
}

export interface ICustomAnnouncement {
  enabled: boolean;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'critical';
}

export interface IScheduledMaintenance {
  _id?: Types.ObjectId;
  title: string;
  description: string;
  status: 'scheduled' | 'in_progress' | 'completed';
  scheduled_start: Date;
  scheduled_end: Date;
  affected_components: string[];
  notify_subscribers: boolean;
  auto_update_status: boolean;
  created_by?: Types.ObjectId;
  created_at?: Date;
}

export interface ICustomDomain {
  domain: string;
  verification_token: string;
  verified: boolean;
  verified_at?: Date;
}

export interface IStatusPage {
  tenant_id: Types.ObjectId;
  slug: string;
  name: string;
  description: string;
  components: IStatusPageComponent[];
  custom_domain?: string;
  custom_domain_config?: ICustomDomain;
  is_public: boolean;
  settings: IStatusPageSettings;
  custom_announcement: ICustomAnnouncement;
  scheduled_maintenances: IScheduledMaintenance[];
  created_at: Date;
  updated_at: Date;
}

export interface StatusPageDocument extends IStatusPage, Document {
  _id: Types.ObjectId;
}

const statusPageSchema = new Schema<StatusPageDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 500 },
    components: [
      {
        name: { type: String, required: true },
        description: { type: String, default: '' },
        service_id: { type: Schema.Types.ObjectId, ref: 'Service' },
        status: {
          type: String,
          enum: ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'],
          default: 'operational',
        },
      },
    ],
    custom_domain: String,
    custom_domain_config: {
      domain: { type: String, default: '' },
      verification_token: { type: String, default: '' },
      verified: { type: Boolean, default: false },
      verified_at: { type: Date },
    },
    is_public: { type: Boolean, default: true },
    settings: {
      show_on_login: { type: Boolean, default: false },
      access_control: {
        visibility: { type: String, enum: ['public', 'private'], default: 'public' },
        allowed_viewer_emails: { type: [String], default: [] },
        allowed_viewer_domains: { type: [String], default: [] },
      },
      display_options: {
        show_incidents: { type: Boolean, default: true },
        show_weekly_summary: { type: Boolean, default: false },
        show_rca_followups: { type: Boolean, default: false },
        selected_service_ids: { type: [Schema.Types.ObjectId], default: [] },
        selected_synthetic_check_ids: { type: [Schema.Types.ObjectId], default: [] },
      },
      localization: {
        additional_locales_enabled: { type: Boolean, default: false },
        default_language: { type: String, default: 'en' },
        timezone: { type: String, default: 'UTC' },
      },
      branding: {
        primary_color: { type: String, default: '#E8521A' },
        custom_domain: { type: String, default: '' },
      },
      component_overrides: { type: Schema.Types.Mixed, default: {} },
    },
    custom_announcement: {
      enabled: { type: Boolean, default: false },
      title: { type: String, default: '' },
      body: { type: String, default: '' },
      type: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    },
    scheduled_maintenances: [
      {
        title: { type: String, required: true, maxlength: 200 },
        description: { type: String, default: '', maxlength: 2000 },
        status: {
          type: String,
          enum: ['scheduled', 'in_progress', 'completed'],
          default: 'scheduled',
        },
        scheduled_start: { type: Date, required: true },
        scheduled_end: { type: Date, required: true },
        affected_components: { type: [String], default: [] },
        notify_subscribers: { type: Boolean, default: true },
        auto_update_status: { type: Boolean, default: true },
        created_by: { type: Schema.Types.ObjectId, ref: 'User' },
        created_at: { type: Date, default: Date.now },
      },
    ],
  },
  {
    collection: 'status_pages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Sync is_public ↔ settings.access_control.visibility
statusPageSchema.pre('save', function () {
  if (this.isModified('settings.access_control.visibility')) {
    // Settings visibility was explicitly changed — sync to is_public
    this.is_public = this.settings!.access_control.visibility === 'public';
  } else if (this.isModified('is_public')) {
    // is_public was explicitly changed — sync to settings visibility
    if (this.settings?.access_control) {
      this.settings.access_control.visibility = this.is_public ? 'public' : 'private';
    }
  }
});

statusPageSchema.index({ tenant_id: 1 });
statusPageSchema.index({ slug: 1 }, { unique: true });

export const StatusPage: Model<StatusPageDocument> = mongoose.model<StatusPageDocument>(
  'StatusPage',
  statusPageSchema
);
