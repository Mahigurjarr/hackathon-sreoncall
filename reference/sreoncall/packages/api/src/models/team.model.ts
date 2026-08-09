import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ITeam {
  tenant_id: Types.ObjectId;
  name: string;
  description: string;
  members: Types.ObjectId[];
  team_lead: Types.ObjectId | null;
  manager: Types.ObjectId | null;
  created_by: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface TeamDocument extends ITeam, Document {
  _id: Types.ObjectId;
}

const teamSchema = new Schema<TeamDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    team_lead: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    manager: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'teams',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

teamSchema.index({ tenant_id: 1 });
teamSchema.index({ tenant_id: 1, name: 1 }, { unique: true });

export const Team: Model<TeamDocument> = mongoose.model<TeamDocument>('Team', teamSchema);
