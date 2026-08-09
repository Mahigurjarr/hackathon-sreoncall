import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ComplianceActionKey = 'notify_authority' | 'document_breach' | 'assess_risk';

export interface IComplianceAction {
  key: ComplianceActionKey;
  status: 'pending' | 'completed';
  completed_at: Date | null;
  completed_by: Types.ObjectId | null;
}

export interface IIncidentComplianceState {
  tenant_id: Types.ObjectId;
  incident_id: Types.ObjectId;
  actions: IComplianceAction[];
  /** Linked BreachReport (scoped to this tenant) created on first compliance detection. */
  breach_report_id: Types.ObjectId | null;
  /** Compact snapshot of audit logs + incident timeline captured once, at first detection. */
  evidence_snapshot: Record<string, unknown> | null;
  evidence_captured_at: Date | null;
  /** Set once compliance-specific resolution-plan steps have been injected, so re-diagnosis doesn't duplicate them. */
  resolution_steps_injected: boolean;
}

export interface IncidentComplianceStateDocument extends IIncidentComplianceState, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const complianceActionSchema = new Schema<IComplianceAction>(
  {
    key: {
      type: String,
      required: true,
      enum: ['notify_authority', 'document_breach', 'assess_risk'],
    },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    completed_at: { type: Date, default: null },
    completed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const incidentComplianceStateSchema = new Schema<IncidentComplianceStateDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true, ref: 'Tenant' },
    incident_id: { type: Schema.Types.ObjectId, required: true, ref: 'Incident' },
    actions: [complianceActionSchema],
    breach_report_id: { type: Schema.Types.ObjectId, ref: 'BreachReport', default: null },
    evidence_snapshot: { type: Schema.Types.Mixed, default: null },
    evidence_captured_at: { type: Date, default: null },
    resolution_steps_injected: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'incident_compliance_states',
  },
);

incidentComplianceStateSchema.index({ tenant_id: 1, incident_id: 1 }, { unique: true });

export const IncidentComplianceState: Model<IncidentComplianceStateDocument> =
  mongoose.model<IncidentComplianceStateDocument>(
    'IncidentComplianceState',
    incidentComplianceStateSchema,
  );
