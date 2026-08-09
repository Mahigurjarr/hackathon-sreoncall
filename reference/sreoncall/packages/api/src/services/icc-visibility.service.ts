import { IccVisibilityConfig, ICCPersona, ICCVisibilityLevel } from '../models/icc-visibility-config.model';
import { AppError } from '../middleware/errorHandler.middleware';

// Platform default visibility matrix from FRD Section 17.2
const DEFAULT_VISIBILITY: Record<ICCPersona, Record<string, ICCVisibilityLevel>> = {
  sre_engineer: {
    topology_map: 'full',
    node_hover: 'full',
    context_brief: 'full',
    change_correlation: 'full',
    telemetry_metrics: 'full',
    telemetry_traces: 'full',
    telemetry_logs: 'full',
    resolve_panel: 'full',
    validation_results: 'full',
    business_impact: 'hidden',
    sla_at_risk: 'summary',
    correlated_incidents: 'full',
    stakeholder_comms: 'own',
    compliance_clock: 'view',
    emerging_risks: 'own',
    alert_quality: 'own',
    toil_measurement: 'own',
    recurrence_detection: 'view',
    postmortem_draft: 'full',
    timeline: 'full',
    mascot: 'full',
  },
  sre_manager: {
    topology_map: 'view',
    node_hover: 'summary',
    context_brief: 'summary',
    change_correlation: 'summary',
    telemetry_metrics: 'view',
    telemetry_traces: 'hidden',
    telemetry_logs: 'hidden',
    resolve_panel: 'view',
    validation_results: 'summary',
    business_impact: 'full',
    sla_at_risk: 'full',
    correlated_incidents: 'full',
    stakeholder_comms: 'full',
    compliance_clock: 'full',
    emerging_risks: 'full',
    alert_quality: 'full',
    toil_measurement: 'full',
    recurrence_detection: 'full',
    postmortem_draft: 'full',
    timeline: 'view',
    mascot: 'hidden',
  },
  platform_engineer: {
    topology_map: 'full',
    node_hover: 'full',
    context_brief: 'full',
    change_correlation: 'full',
    telemetry_metrics: 'full',
    telemetry_traces: 'full',
    telemetry_logs: 'full',
    resolve_panel: 'full',
    validation_results: 'full',
    business_impact: 'hidden',
    sla_at_risk: 'summary',
    correlated_incidents: 'full',
    stakeholder_comms: 'hidden',
    compliance_clock: 'view',
    emerging_risks: 'full',
    alert_quality: 'full',
    toil_measurement: 'full',
    recurrence_detection: 'full',
    postmortem_draft: 'full',
    timeline: 'full',
    mascot: 'full',
  },
  tenant_admin: {
    topology_map: 'view',
    node_hover: 'hidden',
    context_brief: 'summary',
    change_correlation: 'summary',
    telemetry_metrics: 'hidden',
    telemetry_traces: 'hidden',
    telemetry_logs: 'hidden',
    resolve_panel: 'hidden',
    validation_results: 'summary',
    business_impact: 'full',
    sla_at_risk: 'full',
    correlated_incidents: 'summary',
    stakeholder_comms: 'own',
    compliance_clock: 'full',
    emerging_risks: 'hidden',
    alert_quality: 'hidden',
    toil_measurement: 'hidden',
    recurrence_detection: 'summary',
    postmortem_draft: 'view',
    timeline: 'summary',
    mascot: 'full',
  },
  msp_provider: {
    topology_map: 'full',
    node_hover: 'summary',
    context_brief: 'summary',
    change_correlation: 'summary',
    telemetry_metrics: 'view',
    telemetry_traces: 'hidden',
    telemetry_logs: 'hidden',
    resolve_panel: 'view',
    validation_results: 'summary',
    business_impact: 'full',
    sla_at_risk: 'full',
    correlated_incidents: 'full',
    stakeholder_comms: 'full',
    compliance_clock: 'full',
    emerging_risks: 'full',
    alert_quality: 'full',
    toil_measurement: 'full',
    recurrence_detection: 'full',
    postmortem_draft: 'view',
    timeline: 'summary',
    mascot: 'hidden',
  },
  consumer: {
    topology_map: 'own',
    node_hover: 'summary',
    context_brief: 'own',
    change_correlation: 'own',
    telemetry_metrics: 'view',
    telemetry_traces: 'hidden',
    telemetry_logs: 'hidden',
    resolve_panel: 'hidden',
    validation_results: 'summary',
    business_impact: 'own',
    sla_at_risk: 'own',
    correlated_incidents: 'own',
    stakeholder_comms: 'hidden',
    compliance_clock: 'hidden',
    emerging_risks: 'own',
    alert_quality: 'hidden',
    toil_measurement: 'hidden',
    recurrence_detection: 'hidden',
    postmortem_draft: 'view',
    timeline: 'summary',
    mascot: 'full',
  },
  platform_admin: {
    topology_map: 'full',
    node_hover: 'full',
    context_brief: 'full',
    change_correlation: 'full',
    telemetry_metrics: 'full',
    telemetry_traces: 'full',
    telemetry_logs: 'full',
    resolve_panel: 'full',
    validation_results: 'full',
    business_impact: 'full',
    sla_at_risk: 'full',
    correlated_incidents: 'full',
    stakeholder_comms: 'full',
    compliance_clock: 'full',
    emerging_risks: 'full',
    alert_quality: 'full',
    toil_measurement: 'full',
    recurrence_detection: 'full',
    postmortem_draft: 'full',
    timeline: 'full',
    mascot: 'hidden',
  },
};

const VALID_PERSONAS: ICCPersona[] = [
  'sre_engineer', 'sre_manager', 'platform_engineer',
  'tenant_admin', 'msp_provider', 'consumer', 'platform_admin',
];

export async function list(tenantId: string) {
  const overrides = await IccVisibilityConfig.find({ tenant_id: tenantId }).lean();

  // Build merged config for each persona
  return VALID_PERSONAS.map((persona) => {
    const override = overrides.find((o: any) => o.persona === persona);
    const defaults = DEFAULT_VISIBILITY[persona];
    const merged = { ...defaults };

    if (override?.overrides) {
      const overrideMap = override.overrides instanceof Map
        ? Object.fromEntries(override.overrides)
        : override.overrides as Record<string, ICCVisibilityLevel>;
      Object.assign(merged, overrideMap);
    }

    return {
      persona,
      visibility: merged,
      has_overrides: !!override,
      override_count: override?.overrides
        ? (override.overrides instanceof Map ? override.overrides.size : Object.keys(override.overrides).length)
        : 0,
      updated_at: override ? (override as any).updated_at : null,
    };
  });
}

export async function getByPersona(tenantId: string, persona: string) {
  if (!VALID_PERSONAS.includes(persona as ICCPersona)) {
    throw AppError.badRequest(`Invalid persona: ${persona}. Valid personas: ${VALID_PERSONAS.join(', ')}`);
  }

  const defaults = DEFAULT_VISIBILITY[persona as ICCPersona];
  const override = await IccVisibilityConfig.findOne({
    tenant_id: tenantId,
    persona,
  }).lean();

  const merged = { ...defaults };
  let overrideEntries: Record<string, ICCVisibilityLevel> = {};

  if (override?.overrides) {
    overrideEntries = override.overrides instanceof Map
      ? Object.fromEntries(override.overrides)
      : override.overrides as Record<string, ICCVisibilityLevel>;
    Object.assign(merged, overrideEntries);
  }

  return {
    persona,
    defaults,
    overrides: overrideEntries,
    visibility: merged,
    updated_at: override ? (override as any).updated_at : null,
  };
}

export async function updateOverrides(
  tenantId: string,
  persona: string,
  overrides: Record<string, ICCVisibilityLevel>,
  userId: string,
) {
  if (!VALID_PERSONAS.includes(persona as ICCPersona)) {
    throw AppError.badRequest(`Invalid persona: ${persona}. Valid personas: ${VALID_PERSONAS.join(', ')}`);
  }

  // Validate override keys against known component names
  const validComponents = Object.keys(DEFAULT_VISIBILITY[persona as ICCPersona]);
  for (const key of Object.keys(overrides)) {
    if (!validComponents.includes(key)) {
      throw AppError.badRequest(`Unknown component: ${key}. Valid components: ${validComponents.join(', ')}`);
    }
  }

  const doc = await IccVisibilityConfig.findOneAndUpdate(
    { tenant_id: tenantId, persona },
    {
      $set: {
        overrides,
        updated_by: userId,
      },
    },
    { upsert: true, new: true, lean: true },
  );

  return getByPersona(tenantId, persona);
}

export async function resetToDefaults(tenantId: string, persona: string) {
  if (!VALID_PERSONAS.includes(persona as ICCPersona)) {
    throw AppError.badRequest(`Invalid persona: ${persona}. Valid personas: ${VALID_PERSONAS.join(', ')}`);
  }

  const doc = await IccVisibilityConfig.findOneAndDelete({
    tenant_id: tenantId,
    persona,
  });

  if (!doc) throw AppError.notFound(`No overrides found for persona: ${persona}`);

  return {
    persona,
    visibility: DEFAULT_VISIBILITY[persona as ICCPersona],
    has_overrides: false,
    message: 'Reset to platform defaults',
  };
}
