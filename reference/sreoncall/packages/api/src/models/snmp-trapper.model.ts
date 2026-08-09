import mongoose, { Document, Schema } from 'mongoose';

export interface ISnmpTrapper extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  hostname: string;
  version: string;
  status: 'online' | 'offline' | 'degraded';
  last_heartbeat_at: Date | null;
  uptime_seconds: number;
  trap_rate: number;
  active_correlations: number;
  ip_address: string;
  config_hash: string;
  ingestion_token_id: Schema.Types.ObjectId | null;
  created_by: Schema.Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<ISnmpTrapper>(
  {
    tenant_id:           { type: Schema.Types.ObjectId, required: true, index: true },
    name:                { type: String, required: true },
    hostname:            { type: String, required: true },
    version:             { type: String, default: '' },
    status:              { type: String, enum: ['online', 'offline', 'degraded'], default: 'offline' },
    last_heartbeat_at:   { type: Date, default: null },
    uptime_seconds:      { type: Number, default: 0 },
    trap_rate:           { type: Number, default: 0 },
    active_correlations: { type: Number, default: 0 },
    ip_address:          { type: String, default: '' },
    config_hash:         { type: String, default: '' },
    ingestion_token_id:  { type: Schema.Types.ObjectId, default: null },
    created_by:          { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, hostname: 1 }, { unique: true });

export const SnmpTrapper = mongoose.model<ISnmpTrapper>('SnmpTrapper', S, 'snmp_trappers');
