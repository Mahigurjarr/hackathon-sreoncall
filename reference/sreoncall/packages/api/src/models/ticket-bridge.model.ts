import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ITicketBridge {
  consumer_tenant_id: Types.ObjectId;
  consumer_ticket_id: Types.ObjectId;
  provider_tenant_id: Types.ObjectId;
  provider_ticket_id: Types.ObjectId;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  escalated_at: Date;
  resolved_at: Date | null;
}

export interface TicketBridgeDocument extends ITicketBridge, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ticketBridgeSchema = new Schema<TicketBridgeDocument>(
  {
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_ticket_id: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    provider_ticket_id: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    status:             { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
    escalated_at:       { type: Date, default: () => new Date() },
    resolved_at:        { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'ticket_bridges',
  }
);

ticketBridgeSchema.index({ consumer_tenant_id: 1, consumer_ticket_id: 1 });
ticketBridgeSchema.index({ provider_tenant_id: 1, provider_ticket_id: 1 });

export const TicketBridge: Model<TicketBridgeDocument> = mongoose.model<TicketBridgeDocument>(
  'TicketBridge',
  ticketBridgeSchema
);
