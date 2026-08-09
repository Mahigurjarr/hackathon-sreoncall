import { Types } from 'mongoose';
import { WorkLogSettings, WorkLogSettingsDocument, IWorkLogApprover } from '../models/work-log-settings.model';

export async function getSettings(tenantId: Types.ObjectId): Promise<WorkLogSettingsDocument> {
  let settings = await WorkLogSettings.findOne({ tenant_id: tenantId });
  if (!settings) {
    settings = await WorkLogSettings.create({ tenant_id: tenantId });
  }
  return settings;
}

export async function updateSettings(
  tenantId: Types.ObjectId,
  input: {
    approvers?: IWorkLogApprover[];
    digest_interval_days?: number;
    auto_approve_threshold_minutes?: number;
    approval_sla_days?: number;
    approval_sla_action?: 'escalate' | 'auto_approve' | 'notify_admin';
  },
): Promise<WorkLogSettingsDocument> {
  const settings = await getSettings(tenantId);
  if (input.approvers !== undefined) settings.approvers = input.approvers;
  if (input.digest_interval_days !== undefined) settings.digest_interval_days = input.digest_interval_days;
  if (input.auto_approve_threshold_minutes !== undefined) settings.auto_approve_threshold_minutes = input.auto_approve_threshold_minutes;
  if (input.approval_sla_days !== undefined) settings.approval_sla_days = input.approval_sla_days;
  if (input.approval_sla_action !== undefined) settings.approval_sla_action = input.approval_sla_action;
  await settings.save();
  return settings;
}

export async function getApproversForTicket(
  tenantId: Types.ObjectId,
  projectId?: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  const settings = await getSettings(tenantId);
  const approverUserIds: Types.ObjectId[] = [];

  for (const a of settings.approvers) {
    if (a.scope === 'tenant') {
      approverUserIds.push(a.user_id);
    } else if (a.scope === 'project' && projectId && a.project_id?.equals(projectId)) {
      approverUserIds.push(a.user_id);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return approverUserIds.filter((id) => {
    const key = id.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getTenantsNeedingDigest(): Promise<WorkLogSettingsDocument[]> {
  return WorkLogSettings.find({
    approvers: { $ne: [] },
    $or: [
      { last_digest_sent_at: null },
      {
        $expr: {
          $lte: [
            '$last_digest_sent_at',
            { $subtract: ['$$NOW', { $multiply: ['$digest_interval_days', 24 * 60 * 60 * 1000] }] },
          ],
        },
      },
    ],
  });
}

export async function markDigestSent(tenantId: Types.ObjectId): Promise<void> {
  await WorkLogSettings.updateOne(
    { tenant_id: tenantId },
    { $set: { last_digest_sent_at: new Date() } },
  );
}
