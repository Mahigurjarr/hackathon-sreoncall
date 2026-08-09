import { PlanDefinition, PlanDefinitionDocument } from '../../models/plan-definition.model';
import { AppError } from '../../middleware/errorHandler.middleware';
import { Tenant } from '../../models/tenant.model';
import { getPlanLimitsFromDB } from '../billing.service';

export async function listPlanDefinitions(): Promise<PlanDefinitionDocument[]> {
  return PlanDefinition.find().sort({ sort_order: 1, name: 1 });
}

export async function getPlanDefinitionById(id: string): Promise<PlanDefinitionDocument> {
  const plan = await PlanDefinition.findById(id);
  if (!plan) throw AppError.notFound('Plan definition');
  return plan;
}

export async function createPlanDefinition(input: {
  name: string;
  display_name: string;
  description?: string;
  limits?: Record<string, any>;
  features?: string[];
  price_monthly_cents?: number;
  price_yearly_cents?: number;
  stripe_price_id?: string;
  is_active?: boolean;
  sort_order?: number;
}): Promise<PlanDefinitionDocument> {
  return PlanDefinition.create({
    name: input.name,
    display_name: input.display_name,
    description: input.description || '',
    limits: input.limits || {},
    features: input.features || [],
    price_monthly_cents: input.price_monthly_cents || 0,
    price_yearly_cents: input.price_yearly_cents || 0,
    stripe_price_id: input.stripe_price_id,
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? 0,
  });
}

export async function updatePlanDefinition(
  id: string,
  update: Partial<{
    display_name: string;
    description: string;
    limits: Record<string, any>;
    features: string[];
    price_monthly_cents: number;
    price_yearly_cents: number;
    stripe_price_id: string;
    is_active: boolean;
    sort_order: number;
  }>,
): Promise<PlanDefinitionDocument> {
  const plan = await PlanDefinition.findById(id);
  if (!plan) throw AppError.notFound('Plan definition');

  if (update.display_name !== undefined) plan.display_name = update.display_name;
  if (update.description !== undefined) plan.description = update.description;
  if (update.limits !== undefined) {
    Object.assign(plan.limits, update.limits);
    plan.markModified('limits');
  }
  if (update.features !== undefined) plan.features = update.features;
  if (update.price_monthly_cents !== undefined) plan.price_monthly_cents = update.price_monthly_cents;
  if (update.price_yearly_cents !== undefined) plan.price_yearly_cents = update.price_yearly_cents;
  if (update.stripe_price_id !== undefined) plan.stripe_price_id = update.stripe_price_id;
  if (update.is_active !== undefined) plan.is_active = update.is_active;
  if (update.sort_order !== undefined) plan.sort_order = update.sort_order;

  await plan.save();

  // Propagate updated limits to all tenants currently on this plan (including legacy aliases)
  const ALIASES: Record<string, string[]> = {
    startup: ['startup', 'starter', 'pro'],
    enterprise: ['enterprise', 'business'],
  };
  const planNames = ALIASES[plan.name] ?? [plan.name];
  const mergedLimits = await getPlanLimitsFromDB(plan.name);
  await Tenant.updateMany({ plan: { $in: planNames } }, { $set: { plan_limits: mergedLimits } });

  return plan;
}

export async function deletePlanDefinition(id: string): Promise<void> {
  const result = await PlanDefinition.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw AppError.notFound('Plan definition');
}
