import { Types } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { Project } from '../models/project.model';
import { Service } from '../models/service.model';
import { SyntheticCheck } from '../models/synthetic-check.model';
import { EscalationPolicy } from '../models/escalation-policy.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { logger } from '../utils/logger';

const DEFAULT_PROJECT_NAME = 'Default';
const DEFAULT_PROJECT_DESCRIPTION = 'Default project for general use';

const DEFAULT_SERVICE_NAME = 'Default';
const DEFAULT_SERVICE_DESCRIPTION = 'Default service for general use';

const DEFAULT_EP_NAME = 'Default EP';
const DEFAULT_SCHEDULE_NAME = 'Default - 24x7 Schedule';

/**
 * Initialize a newly created tenant with default resources.
 * Idempotent — safe to call multiple times for the same tenant.
 *
 * @param tenantId  The tenant's ObjectId (string or ObjectId)
 * @param createdBy Optional user ObjectId to set as created_by
 */
export async function initializeTenant(
  tenantId: string | Types.ObjectId,
  createdBy?: string | Types.ObjectId,
): Promise<void> {
  const tid = tenantId.toString();
  const creator = createdBy || new Types.ObjectId('000000000000000000000000');

  // Seed default project (skip if one already exists)
  let defaultProject = await Project.findOne({ tenant_id: tid, name: DEFAULT_PROJECT_NAME, deleted_at: null });
  if (!defaultProject) {
    defaultProject = await Project.create({
      tenant_id: tid,
      name: DEFAULT_PROJECT_NAME,
      description: DEFAULT_PROJECT_DESCRIPTION,
      created_by: creator,
    });
    logger.info('Default project created for tenant', { tenant_id: tid });
  }

  // Seed default service (skip if one already exists)
  let defaultService = await Service.findOne({ tenant_id: tid, name: DEFAULT_SERVICE_NAME, deleted_at: null });
  if (!defaultService) {
    defaultService = await Service.create({
      tenant_id: tid,
      project_id: defaultProject._id,
      name: DEFAULT_SERVICE_NAME,
      description: DEFAULT_SERVICE_DESCRIPTION,
      type: 'web',
      current_status: 'operational',
      created_by: creator,
    });
    logger.info('Default service created for tenant', { tenant_id: tid });
  }

  // Seed default escalation policy (skip if one already exists)
  let defaultEP = await EscalationPolicy.findOne({ tenant_id: tid, name: DEFAULT_EP_NAME });
  if (!defaultEP) {
    defaultEP = await EscalationPolicy.create({
      tenant_id: tid,
      name: DEFAULT_EP_NAME,
      description: 'Default escalation policy seeded on tenant creation',
      status: 'active',
      steps: [
        {
          delay_minutes: 5,
          targets: [],
          target_type: 'schedule',
          notify_channels: ['email'],
        },
        {
          delay_minutes: 10,
          targets: [],
          target_type: 'schedule',
          notify_channels: ['email'],
        },
      ],
      repeat_count: 2,
      repeat_interval_minutes: 30,
      created_by: creator,
    });
    logger.info('Default escalation policy created for tenant', { tenant_id: tid });
  }

  // Seed default 24x7 on-call schedule (skip if one already exists)
  let defaultSchedule = await OnCallSchedule.findOne({ tenant_id: tid, name: DEFAULT_SCHEDULE_NAME });
  if (!defaultSchedule) {
    defaultSchedule = await OnCallSchedule.create({
      tenant_id: tid,
      name: DEFAULT_SCHEDULE_NAME,
      description: '24x7 follow-the-sun schedule with APAC, EMEA, and AMER layers',
      timezone: 'Asia/Kolkata',
      enabled: true,
      layers: [
        {
          id: uuid(),
          name: 'APAC',
          rotation_type: 'custom_hours',
          users: [],
          start_time: '06:00',
          end_time: '14:00',
          timezone: 'Asia/Kolkata',
          handoff_day: null,
          rotation_length_seconds: 28800,
          restrictions: [],
        },
        {
          id: uuid(),
          name: 'EMEA',
          rotation_type: 'custom_hours',
          users: [],
          start_time: '14:00',
          end_time: '22:00',
          timezone: 'Asia/Kolkata',
          handoff_day: null,
          rotation_length_seconds: 28800,
          restrictions: [],
        },
        {
          id: uuid(),
          name: 'AMER',
          rotation_type: 'custom_hours',
          users: [],
          start_time: '22:00',
          end_time: '06:00',
          timezone: 'Asia/Kolkata',
          handoff_day: null,
          rotation_length_seconds: 28800,
          restrictions: [],
        },
      ],
      overrides: [],
      service_ids: [defaultService._id],
      escalation_policy_id: defaultEP._id,
      created_by: creator,
    });
    logger.info('Default 24x7 schedule created for tenant', { tenant_id: tid });
  }

  // Link Default Service to Default EP and Default Schedule (if not already linked)
  const needsUpdate =
    (!defaultService.escalation_policy_id || defaultService.escalation_policy_id.toString() !== defaultEP._id.toString()) ||
    (!defaultService.oncall_schedule_id || defaultService.oncall_schedule_id.toString() !== defaultSchedule._id.toString());

  if (needsUpdate) {
    defaultService.escalation_policy_id = defaultEP._id as any;
    defaultService.oncall_schedule_id = defaultSchedule._id as any;
    await defaultService.save();
    logger.info('Default service linked to Default EP and Schedule', { tenant_id: tid });
  }
}

/**
 * Create an HTTP synthetic check for a tenant's website URL.
 * Idempotent — skips if a check with the same tenant + URL + type already exists.
 */
export async function createWebsiteSyntheticCheck(
  tenantId: string | Types.ObjectId,
  userId: string | Types.ObjectId,
  websiteUrl: string,
): Promise<void> {
  const tid = tenantId.toString();

  // Idempotency: skip if check already exists for this URL
  const existing = await SyntheticCheck.findOne({
    tenant_id: tid,
    url: websiteUrl,
    type: 'http',
  });
  if (existing) return;

  // Find the Default Service to link the check
  const defaultService = await Service.findOne({
    tenant_id: tid,
    name: DEFAULT_SERVICE_NAME,
    deleted_at: null,
  });

  let hostname: string;
  try {
    hostname = new URL(websiteUrl).hostname;
  } catch {
    hostname = websiteUrl;
  }

  await SyntheticCheck.create({
    tenant_id: tid,
    name: `Website - ${hostname}`,
    type: 'http',
    status: 'active',
    url: websiteUrl,
    method: 'GET',
    interval_seconds: 60,
    timeout_seconds: 10,
    expected_status_code: 200,
    service_id: defaultService?._id || null,
    created_by: userId,
  });

  logger.info('Website synthetic check created for tenant', { tenant_id: tid, url: websiteUrl });
}
