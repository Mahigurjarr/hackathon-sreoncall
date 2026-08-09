import mongoose, { Document, Schema } from 'mongoose';

export interface ISyntheticCheck extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  type: 'http' | 'tcp' | 'dns';
  status: 'active' | 'paused';
  service_id: Schema.Types.ObjectId | null;
  interval_seconds: number;
  timeout_seconds: number;
  // HTTP
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  http_headers: Record<string, string>;
  expected_status_code: number;
  allowed_status_codes: number[];
  keyword_check: string;
  // When true (default for new checks), the synthetic HTTP probe enforces
  // TLS certificate validation on HTTPS targets. When false, the probe
  // tolerates broken / expired / self-signed certs — cert validity is
  // still reported as a separate dimension on each result.
  verify_tls: boolean;
  // TCP
  host: string;
  port: number | null;
  // DNS
  hostname: string;
  record_type: 'A' | 'CNAME' | 'MX' | 'TXT';
  expected_value: string;
  // Geo (resolved from endpoint)
  geo_lat: number | null;
  geo_lon: number | null;
  geo_city: string;
  geo_country: string;
  geo_ip: string;
  // State
  last_check_at: Date | null;
  next_check_at: Date | null;
  last_status: 'up' | 'down' | 'degraded' | null;
  last_response_time_ms: number | null;
  uptime_1h: number;
  uptime_24h: number;
  uptime_7d: number;
  uptime_30d: number;
  uptime_90d: number;
  consecutive_failures: number;
  steps: Array<{
    name: string;
    url: string;
    method: 'GET' | 'POST' | 'HEAD';
    expected_status_code: number;
  }>;
  created_by: Schema.Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<ISyntheticCheck>(
  {
    tenant_id:              { type: Schema.Types.ObjectId, required: true, index: true },
    name:                   { type: String, required: true },
    type:                   { type: String, enum: ['http', 'tcp', 'dns'], required: true },
    status:                 { type: String, enum: ['active', 'paused'], default: 'active' },
    service_id:             { type: Schema.Types.ObjectId, default: null },
    interval_seconds:       { type: Number, default: 60 },
    timeout_seconds:        { type: Number, default: 10 },
    // HTTP
    url:                    { type: String, default: '' },
    method:                 { type: String, enum: ['GET', 'POST', 'HEAD'], default: 'GET' },
    http_headers:           { type: Map, of: String, default: {} },
    expected_status_code:   { type: Number, default: 200 },
    allowed_status_codes:   { type: [Number], default: [] },
    keyword_check:          { type: String, default: '' },
    verify_tls:             { type: Boolean, default: true },
    // TCP
    host:                   { type: String, default: '' },
    port:                   { type: Number, default: null },
    // DNS
    hostname:               { type: String, default: '' },
    record_type:            { type: String, enum: ['A', 'CNAME', 'MX', 'TXT'], default: 'A' },
    expected_value:         { type: String, default: '' },
    // Geo (resolved from endpoint)
    geo_lat:                { type: Number, default: null },
    geo_lon:                { type: Number, default: null },
    geo_city:               { type: String, default: '' },
    geo_country:            { type: String, default: '' },
    geo_ip:                 { type: String, default: '' },
    // State
    last_check_at:          { type: Date, default: null },
    next_check_at:          { type: Date, default: null, index: true },
    last_status:            { type: String, enum: ['up', 'down', 'degraded', null], default: null },
    last_response_time_ms:  { type: Number, default: null },
    uptime_1h:              { type: Number, default: 100 },
    uptime_24h:             { type: Number, default: 100 },
    uptime_7d:              { type: Number, default: 100 },
    uptime_30d:             { type: Number, default: 100 },
    uptime_90d:             { type: Number, default: 100 },
    consecutive_failures:   { type: Number, default: 0 },
    steps:                  [{
      name:                 { type: String, required: true },
      url:                  { type: String, required: true },
      method:               { type: String, enum: ['GET', 'POST', 'HEAD'], default: 'GET' },
      expected_status_code: { type: Number, default: 200 },
    }],
    created_by:             { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, status: 1 });
S.index({ tenant_id: 1, last_check_at: 1 });

export const SyntheticCheck = mongoose.model<ISyntheticCheck>('SyntheticCheck', S);
