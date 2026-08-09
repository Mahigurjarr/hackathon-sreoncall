import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface WorkflowState {
  name: string;
  label: string;
  category: 'todo' | 'in_progress' | 'done';
  color: string;
  is_initial: boolean;
  is_terminal: boolean;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  allowed_roles: string[];
  requires_comment: boolean;
}

export interface ITicketWorkflow {
  tenant_id: Types.ObjectId;
  ticket_type: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

export interface TicketWorkflowDocument extends ITicketWorkflow, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const workflowStateSchema = new Schema<WorkflowState>(
  {
    name: { type: String, required: true },
    label: { type: String, required: true },
    category: { type: String, enum: ['todo', 'in_progress', 'done'], required: true },
    color: { type: String, required: true, default: '#6B7280' },
    is_initial: { type: Boolean, default: false },
    is_terminal: { type: Boolean, default: false },
  },
  { _id: false }
);

const workflowTransitionSchema = new Schema<WorkflowTransition>(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    allowed_roles: [{ type: String }],
    requires_comment: { type: Boolean, default: false },
  },
  { _id: false }
);

const ticketWorkflowSchema = new Schema<TicketWorkflowDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    ticket_type: { type: String, required: true },
    states: [workflowStateSchema],
    transitions: [workflowTransitionSchema],
  },
  {
    timestamps: true,
    collection: 'ticket_workflows',
  }
);

ticketWorkflowSchema.index({ tenant_id: 1, ticket_type: 1 }, { unique: true });

export const TicketWorkflow: Model<TicketWorkflowDocument> = mongoose.model<TicketWorkflowDocument>(
  'TicketWorkflow',
  ticketWorkflowSchema
);
