/**
 * Migration: Create LogQL alert rules for Packengers tenant
 *
 * Creates SREonCall alert rules that mirror Rollbar's alerting rules,
 * using LogQL queries against the managed LGTM stack.
 *
 * Target tenant: ThePackengers (tenant_id: 69b92d4b2dce58d4d4a27358)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-rollbar-rules.ts
 */

import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database';
import { AlertRule } from '../models/alert-rule.model';
import { logger } from '../utils/logger';

const PACKENGERS_TENANT_ID = '69b92d4b2dce58d4d4a27358';

interface RuleDef {
  name: string;
  description: string;
  source_type: 'managed_logql';
  query: string;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
    threshold: number;
    window_minutes: number;
  };
  severity: 'critical' | 'high' | 'medium' | 'low';
  for_duration_seconds: number;
  auto_create_incident: boolean;
  incident_severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
}

const RULES: RuleDef[] = [
  // (a) Error Rate Spike (Production)
  {
    name: 'Error Rate Spike (Production)',
    description: 'Mirrors Rollbar occurrence_rate rule: fires when >10 errors occur in a 5-minute window across all production services.',
    source_type: 'managed_logql',
    query: 'sum(count_over_time({service_name=~".*"} |= "error" | __error__="" [5m]))',
    condition: { metric: 'error_count', operator: 'gt', threshold: 10, window_minutes: 5 },
    severity: 'high',
    for_duration_seconds: 0,
    auto_create_incident: true,
    incident_severity: 'sev2',
  },

  // (b) New Error Pattern (Production)
  {
    name: 'New Error Pattern (Production)',
    description: 'Mirrors Rollbar new_item rule: detects new unique error patterns (exception, error, fatal, panic, crash) in production logs.',
    source_type: 'managed_logql',
    query: 'sum(count_over_time({service_name=~".*"} |~ "(?i)(exception|error|fatal|panic|crash)" | __error__="" [5m]))',
    condition: { metric: 'error_count', operator: 'gt', threshold: 5, window_minutes: 5 },
    severity: 'high',
    for_duration_seconds: 0,
    auto_create_incident: true,
    incident_severity: 'sev2',
  },

  // (c) Rate Limit Errors
  {
    name: 'Rate Limit Errors',
    description: 'Mirrors Rollbar "rate limit reached" rule: fires on any rate-limit related log entry.',
    source_type: 'managed_logql',
    query: 'sum(count_over_time({service_name=~".*"} |~ "(?i)rate.?limit" [5m]))',
    condition: { metric: 'rate_limit_count', operator: 'gt', threshold: 0, window_minutes: 5 },
    severity: 'critical',
    for_duration_seconds: 0,
    auto_create_incident: true,
    incident_severity: 'sev1',
  },

  // (d) Critical Errors (Production)
  {
    name: 'Critical Errors (Production)',
    description: 'Mirrors Rollbar level >= critical rule: fires on fatal, panic, crash, critical, segfault, or OOM log entries.',
    source_type: 'managed_logql',
    query: 'sum(count_over_time({service_name=~".*"} |~ "(?i)(fatal|panic|crash|critical|segfault|oom)" [5m]))',
    condition: { metric: 'critical_count', operator: 'gt', threshold: 0, window_minutes: 5 },
    severity: 'critical',
    for_duration_seconds: 0,
    auto_create_incident: true,
    incident_severity: 'sev1',
  },

  // (e) Error Rate Spike (Staging)
  {
    name: 'Error Rate Spike (Staging)',
    description: 'Same as production error rate spike but filtered to staging environment.',
    source_type: 'managed_logql',
    query: 'sum(count_over_time({service_name=~".*", environment="staging"} |= "error" | __error__="" [5m]))',
    condition: { metric: 'error_count', operator: 'gt', threshold: 10, window_minutes: 5 },
    severity: 'medium',
    for_duration_seconds: 0,
    auto_create_incident: false,
    incident_severity: 'sev3',
  },
];

async function run() {
  await connectDatabase();
  logger.info('migrate-rollbar-rules: connected to database');

  const tenantId = new Types.ObjectId(PACKENGERS_TENANT_ID);
  let created = 0;
  let skipped = 0;

  for (const rule of RULES) {
    // Check if a rule with the same name already exists on this tenant
    const existing = await AlertRule.findOne({
      tenant_id: tenantId,
      name: rule.name,
    }).lean();

    if (existing) {
      logger.info(`SKIP (already exists): "${rule.name}"`);
      skipped++;
      continue;
    }

    const labelsMap = new Map<string, string>();
    labelsMap.set('migration', 'rollbar-migration');
    labelsMap.set('tenant', 'thepackengers');

    const doc = await AlertRule.create({
      tenant_id: tenantId,
      name: rule.name,
      description: rule.description,
      status: 'active',
      severity: rule.severity,
      source_type: rule.source_type,
      query: rule.query,
      condition: rule.condition,
      for_duration_seconds: rule.for_duration_seconds,
      labels: labelsMap,
      auto_create_incident: rule.auto_create_incident,
      incident_severity: rule.incident_severity,
      routing: {
        escalation_policy_id: null,
        oncall_schedule_id: null,
        additional_channels: [],
      },
      is_predefined: false,
      category: 'rollbar-migration',
      created_by: null,
    });

    logger.info(`CREATED: "${rule.name}" (id=${doc._id}, severity=${rule.severity})`);
    created++;
  }

  logger.info(`migrate-rollbar-rules: done — created=${created}, skipped=${skipped}`);
  console.log(`\n=== Migration Summary ===`);
  console.log(`Tenant: ${PACKENGERS_TENANT_ID} (ThePackengers)`);
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped} (already existed)`);
  console.log(`Total rules defined: ${RULES.length}\n`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
