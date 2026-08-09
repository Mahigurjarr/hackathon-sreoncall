import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * A single diarized transcript segment for a NotetakerSession. Stored in its own
 * high-volume collection (a long call produces thousands). Live segments arrive
 * during the call (is_final=false while a speaker is still talking) and the
 * batch path writes finalized segments after transcription.
 */
export interface ITranscriptSegment {
  tenant_id: Types.ObjectId;
  session_id: Types.ObjectId;
  speaker: string; // diarization label / participant name
  text: string;
  start_ms: number;
  end_ms: number;
  is_final: boolean;
  created_at: Date;
}

export interface TranscriptSegmentDocument extends ITranscriptSegment, Document {
  _id: Types.ObjectId;
}

const transcriptSegmentSchema = new Schema<TranscriptSegmentDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    session_id: { type: Schema.Types.ObjectId, ref: 'NotetakerSession', required: true },
    speaker: { type: String, default: 'Unknown', maxlength: 200 },
    text: { type: String, required: true, maxlength: 10000 },
    start_ms: { type: Number, default: 0 },
    end_ms: { type: Number, default: 0 },
    is_final: { type: Boolean, default: true },
  },
  {
    collection: 'transcript_segments',
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

transcriptSegmentSchema.index({ session_id: 1, start_ms: 1 });
// Auto-purge raw segments after 180 days — the consolidated transcript_text and
// summary live on the session itself, so the per-segment detail is transient.
transcriptSegmentSchema.index({ created_at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const TranscriptSegment: Model<TranscriptSegmentDocument> =
  mongoose.model<TranscriptSegmentDocument>('TranscriptSegment', transcriptSegmentSchema);
