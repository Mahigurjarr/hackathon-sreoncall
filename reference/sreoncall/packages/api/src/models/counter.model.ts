import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ICounter {
  tenant_id: Types.ObjectId;
  entity: string;
  seq: number;
}

export interface CounterDocument extends ICounter, Document {
  _id: Types.ObjectId;
}

const counterSchema = new Schema<CounterDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    entity: { type: String, required: true },
    seq: { type: Number, default: 1000 },
  },
  {
    collection: 'counters',
  }
);

counterSchema.index({ tenant_id: 1, entity: 1 }, { unique: true });

export const Counter: Model<CounterDocument> = mongoose.model<CounterDocument>('Counter', counterSchema);

/**
 * Atomically increment and return the next sequence number for a given entity.
 */
export async function getNextSequence(tenantId: Types.ObjectId, entity: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { tenant_id: tenantId, entity },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return counter.seq;
}
