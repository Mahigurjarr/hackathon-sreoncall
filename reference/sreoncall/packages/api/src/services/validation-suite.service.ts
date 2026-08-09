import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { ValidationSuite, IValidationSuite, IValidationSuiteCheck } from '../models/validation-suite.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { getJetStream } from '../config/nats';

const sc = StringCodec();

// ─── Public service functions ─────────────────────────────────────────────────

export async function list(
  tenantId: string,
  opts: { service_id?: string; trigger?: string; limit?: number },
) {
  const filter: Record<string, unknown> = { tenant_id: new Types.ObjectId(tenantId) };
  if (opts.service_id) filter['service_ids'] = new Types.ObjectId(opts.service_id);
  if (opts.trigger)    filter['trigger']     = opts.trigger;

  return ValidationSuite.find(filter)
    .sort({ created_at: -1 })
    .limit(opts.limit ?? 50)
    .lean();
}

export async function getById(tenantId: string, id: string) {
  const suite = await ValidationSuite.findOne({
    _id:       new Types.ObjectId(id),
    tenant_id: new Types.ObjectId(tenantId),
  });
  if (!suite) throw AppError.notFound('Validation suite not found');
  return suite;
}

export async function create(
  tenantId: string,
  userId: string,
  input: {
    name: string;
    description?: string;
    service_ids?: string[];
    checks?: Array<{
      name: string;
      type: 'http' | 'tcp' | 'custom_script';
      config: Partial<IValidationSuiteCheck['config']>;
      order?: number;
    }>;
    trigger?: 'manual' | 'on_resolution' | 'both';
  },
): Promise<IValidationSuite> {
  const suite = await ValidationSuite.create({
    tenant_id:   new Types.ObjectId(tenantId),
    name:        input.name,
    description: input.description || null,
    service_ids: (input.service_ids || []).map((id) => new Types.ObjectId(id)),
    checks:      (input.checks || []).map((c, idx) => ({
      name:   c.name,
      type:   c.type,
      config: c.config || {},
      order:  c.order ?? idx,
    })),
    trigger:    input.trigger || 'manual',
    created_by: new Types.ObjectId(userId),
  });

  logger.info('Validation suite created', { suiteId: suite._id.toString(), tenantId });
  return suite;
}

export async function update(
  tenantId: string,
  id: string,
  data: {
    name?: string;
    description?: string;
    service_ids?: string[];
    checks?: Array<{
      name: string;
      type: 'http' | 'tcp' | 'custom_script';
      config: Partial<IValidationSuiteCheck['config']>;
      order?: number;
    }>;
    trigger?: 'manual' | 'on_resolution' | 'both';
  },
): Promise<IValidationSuite> {
  const suite = await getById(tenantId, id);

  if (data.name !== undefined)        suite.name        = data.name;
  if (data.description !== undefined) suite.description  = data.description || null;
  if (data.trigger !== undefined)     suite.trigger      = data.trigger;

  if (data.service_ids !== undefined) {
    suite.service_ids = data.service_ids.map((sid) => new Types.ObjectId(sid)) as any;
  }

  if (data.checks !== undefined) {
    suite.checks = data.checks.map((c, idx) => ({
      name:   c.name,
      type:   c.type,
      config: c.config as IValidationSuiteCheck['config'],
      order:  c.order ?? idx,
    })) as any;
  }

  await suite.save();
  logger.info('Validation suite updated', { suiteId: id, tenantId });
  return suite;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const result = await ValidationSuite.deleteOne({
    _id:       new Types.ObjectId(id),
    tenant_id: new Types.ObjectId(tenantId),
  });
  if (result.deletedCount === 0) throw AppError.notFound('Validation suite not found');
  logger.info('Validation suite deleted', { suiteId: id, tenantId });
}

/**
 * Run a validation suite manually — publishes checks to NATS for async execution.
 */
export async function run(
  tenantId: string,
  id: string,
): Promise<{ suite_id: string; checks_count: number; status: string }> {
  const suite = await getById(tenantId, id);

  const checks = (suite.checks || []).map((c: any) => ({
    name:   c.name,
    type:   c.type,
    config: c.config,
    order:  c.order,
  }));

  try {
    const js = getJetStream();
    await js.publish(
      'icc.validation-suite.run',
      sc.encode(JSON.stringify({
        tenant_id: tenantId,
        suite_id:  suite._id.toString(),
        suite_name: suite.name,
        checks,
      })),
    );
  } catch (err: any) {
    logger.warn('Failed to publish validation suite run to NATS', { error: err.message });
  }

  logger.info('Validation suite run triggered', { suiteId: id, checksCount: checks.length });
  return {
    suite_id:     suite._id.toString(),
    checks_count: checks.length,
    status:       'running',
  };
}
