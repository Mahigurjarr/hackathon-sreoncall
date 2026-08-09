import mongoose, { Schema, Document, Types } from 'mongoose';

export interface LogPipelineRule {
  _id?: Types.ObjectId;
  name: string;
  order: number;
  enabled: boolean;
  type: 'json_parse' | 'regex_extract' | 'label_set' | 'line_filter' | 'drop' | 'redact';
  config: Record<string, any>;
}

export interface ILogPipeline extends Document {
  tenant_id: Types.ObjectId;
  rules: LogPipelineRule[];
  created_at: Date;
  updated_at: Date;
}

const logPipelineRuleSchema = new Schema({
  name: { type: String, required: true },
  order: { type: Number, required: true },
  enabled: { type: Boolean, default: true },
  type: { type: String, required: true, enum: ['json_parse', 'regex_extract', 'label_set', 'line_filter', 'drop', 'redact'] },
  config: { type: Schema.Types.Mixed, default: {} },
}, { _id: true });

const logPipelineSchema = new Schema({
  tenant_id: { type: Schema.Types.ObjectId, required: true, index: true },
  rules: [logPipelineRuleSchema],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

logPipelineSchema.index({ tenant_id: 1 }, { unique: true });

export const LogPipeline = mongoose.model<ILogPipeline>('LogPipeline', logPipelineSchema);
