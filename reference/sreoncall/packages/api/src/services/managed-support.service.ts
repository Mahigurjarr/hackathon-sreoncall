import { Types } from 'mongoose';
import { SupportContract, SupportContractDocument } from '../models/support-contract.model';
import { ConsumerManagedTier } from '../models/consumer-managed-tier.model';
import { IncidentSLAState, IncidentSLAStateDocument } from '../models/incident-sla-state.model';
import { Incident } from '../models/incident.model';
import { Tenant } from '../models/tenant.model';
import {
  isWithinBusinessHours,
  computeBusinessHoursDeadline,
} from './sla-calculator.service';
import { coverageToBusinessHours, contractAppliesAt } from './support-contract.service';
import { logger } from '../utils/logger';

/**
 * Returns the active contract for a link *only* if the current time is
 * inside its coverage window. Used to gate the provider-escalation bridge.
 */
export async function resolveActiveContractInCoverage(
  linkId: Types.ObjectId,
  at: Date = new Date(),
): Promise<SupportContractDocument | null> {
  const contract = await SupportContract.findOne({ link_id: linkId, status: 'active' });
  if (!contract) return null;
  if (!contractAppliesAt(contract, at)) return null;

  const bh = coverageToBusinessHours(contract.coverage_window);
  const within = isWithinBusinessHours(at, bh);
  if (!within) {
    logger.info('Managed support coverage not active at this time', {
      contract_id: contract._id.toString(),
      timezone: bh.timezone,
    });
    return null;
  }
  return contract;
}

/**
 * Creates an IncidentSLAState when a managed-support bridge is opened.
 * SLA deadlines are computed inside the coverage window, so an incident
 * opened 5 minutes before the window ends wraps to the next business day.
 */
export async function createSlaStateForBridge(params: {
  contract: SupportContractDocument;
  bridgeId: Types.ObjectId;
  consumerIncidentId: Types.ObjectId;
  providerIncidentId: Types.ObjectId;
  consumerTenantId: Types.ObjectId;
  providerTenantId: Types.ObjectId;
  severity: number;
  startedAt: Date;
}): Promise<IncidentSLAStateDocument> {
  const {
    contract,
    bridgeId,
    consumerIncidentId,
    providerIncidentId,
    consumerTenantId,
    providerTenantId,
    severity,
    startedAt,
  } = params;

  const bh = coverageToBusinessHours(contract.coverage_window);
  const target = contract.sla_targets.find((t) => t.severity === severity)
    ?? contract.sla_targets[contract.sla_targets.length - 1];
  if (!target) {
    throw new Error('Support contract has no SLA targets configured');
  }

  const firstTier = contract.tiers.find((t) => t.level === 1) ?? contract.tiers[0];
  const tierTimeout = firstTier?.escalation_timeout_minutes ?? null;
  const tierDeadline = tierTimeout
    ? computeBusinessHoursDeadline(startedAt, tierTimeout, bh)
    : null;

  const state = await IncidentSLAState.create({
    incident_bridge_id: bridgeId,
    contract_id: contract._id,
    consumer_incident_id: consumerIncidentId,
    provider_incident_id: providerIncidentId,
    consumer_tenant_id: consumerTenantId,
    provider_tenant_id: providerTenantId,
    current_tier: 1,
    tier_started_at: startedAt,
    tier_deadline: tierDeadline,
    response_sla: {
      target_minutes: target.response_minutes,
      deadline_at: computeBusinessHoursDeadline(startedAt, target.response_minutes, bh),
      met_at: null,
      breached: false,
    },
    resolution_sla: {
      target_minutes: target.resolution_minutes,
      deadline_at: computeBusinessHoursDeadline(startedAt, target.resolution_minutes, bh),
      met_at: null,
      breached: false,
    },
    tier_history: [
      {
        level: 1,
        started_at: startedAt,
        ended_at: null,
        reason: 'initial',
      },
    ],
    status: 'active',
  });

  return state;
}

/**
 * Mark the current tier closed and open the next one, updating deadlines.
 * No-op if already at L3 (no further escalation possible).
 */
export async function escalateTier(
  state: IncidentSLAStateDocument,
  reason: 'escalation_timeout' | 'manual_escalation',
  now: Date = new Date(),
): Promise<{
  state: IncidentSLAStateDocument;
  nextTierScheduleId: Types.ObjectId | null;   // primary (first) schedule — kept for back-compat
  nextTierScheduleIds: Types.ObjectId[];        // all schedules — use this for on-call lookup
  nextTierScheduleTenantId: Types.ObjectId;
  nextTierChannels: string[];
  nextTierType: 'provider' | 'consumer';
}> {
  const contract = await SupportContract.findById(state.contract_id);
  if (!contract) throw new Error('Contract no longer exists');

  const nextLevel = state.current_tier + 1;
  const nextProviderTier = contract.tiers.find((t) => t.level === nextLevel);

  // If no provider tier at next level, check consumer-managed tiers
  if (!nextProviderTier) {
    const consumerTier = await ConsumerManagedTier.findOne({
      contract_id: state.contract_id,
      consumer_tenant_id: state.consumer_tenant_id,
      level: nextLevel,
    });
    if (!consumerTier) {
      return { state, nextTierScheduleId: null, nextTierScheduleIds: [], nextTierScheduleTenantId: state.provider_tenant_id, nextTierChannels: [], nextTierType: 'provider' };
    }

    // Close current tier in history
    const current = state.tier_history.find((h) => h.level === state.current_tier && !h.ended_at);
    if (current) current.ended_at = now;
    (state as any).current_tier = nextLevel;
    state.tier_started_at = now;
    const bh = coverageToBusinessHours(contract.coverage_window);
    state.tier_deadline = consumerTier.escalation_timeout_minutes
      ? computeBusinessHoursDeadline(now, consumerTier.escalation_timeout_minutes, bh)
      : null;
    (state.tier_history as any[]).push({ level: nextLevel, started_at: now, ended_at: null, reason });
    await state.save();

    return {
      state,
      nextTierScheduleId: consumerTier.schedule_id ?? null,
      nextTierScheduleIds: consumerTier.schedule_id ? [consumerTier.schedule_id] : [],
      nextTierScheduleTenantId: state.consumer_tenant_id,
      nextTierChannels: consumerTier.notify_channels,
      nextTierType: 'consumer',
    };
  }

  const nextTier = nextProviderTier;

  const current = state.tier_history.find(
    (h) => h.level === state.current_tier && !h.ended_at,
  );
  if (current) current.ended_at = now;

  (state as any).current_tier = nextLevel;
  state.tier_started_at = now;
  const bh = coverageToBusinessHours(contract.coverage_window);
  state.tier_deadline = nextTier.escalation_timeout_minutes
    ? computeBusinessHoursDeadline(now, nextTier.escalation_timeout_minutes, bh)
    : null;
  (state.tier_history as any[]).push({
    level: nextLevel,
    started_at: now,
    ended_at: null,
    reason,
  });
  await state.save();

  const tAny = nextTier as any;
  const allScheduleIds: Types.ObjectId[] = Array.isArray(tAny.schedule_ids) && tAny.schedule_ids.length
    ? tAny.schedule_ids
    : nextTier.schedule_id ? [nextTier.schedule_id] : [];
  const primaryScheduleId = allScheduleIds[0] ?? null;

  return {
    state,
    nextTierScheduleId: primaryScheduleId,
    nextTierScheduleIds: allScheduleIds,
    nextTierScheduleTenantId: state.provider_tenant_id,
    nextTierChannels: nextTier.notify_channels || ['in_app', 'email'],
    nextTierType: 'provider',
  };
}

export async function markResponded(
  state: IncidentSLAStateDocument,
  at: Date = new Date(),
): Promise<void> {
  if (state.response_sla.met_at) return;
  state.response_sla.met_at = at;
  if (at > state.response_sla.deadline_at) state.response_sla.breached = true;
  await state.save();
}

export async function markResolved(
  state: IncidentSLAStateDocument,
  at: Date = new Date(),
): Promise<void> {
  state.status = 'resolved';
  state.resolution_sla.met_at = at;
  if (at > state.resolution_sla.deadline_at) state.resolution_sla.breached = true;
  const open = state.tier_history.find((h) => !h.ended_at);
  if (open) {
    open.ended_at = at;
    open.reason = 'resolved';
  }
  await state.save();
}

// ─── Dashboard aggregation ────────────────────────────────────────────────────

export interface TierCounts {
  L1: number;
  L2: number;
  L3: number;
}

export interface ConsumerRollup {
  consumer_tenant_id: string;
  consumer_name: string | null;
  contract_id: string;
  contract_name: string;
  coverage_type: string;
  active_by_tier: TierCounts;
  open_total: number;
  response_compliance_pct: number;
  resolution_compliance_pct: number;
  total_recent_incidents: number;
}

export interface AtRiskEntry {
  state_id: string;
  bridge_id: string;
  contract_id: string;
  consumer_name: string | null;
  consumer_incident_id: string;
  provider_incident_id: string;
  incident_title: string | null;
  severity: number | null;
  current_tier: 1 | 2 | 3;
  deadline_kind: 'tier' | 'response' | 'resolution';
  deadline_at: string;
  minutes_remaining: number;
}

export interface RecentBreach {
  state_id: string;
  consumer_name: string | null;
  consumer_incident_id: string;
  incident_title: string | null;
  kind: 'response' | 'resolution';
  deadline_at: string;
  breached_at: string;
}

export interface ProviderDashboard {
  totals: {
    active_contracts: number;
    open_incidents: number;
    breaches_last_24h: number;
    active_by_tier: TierCounts;
  };
  consumers: ConsumerRollup[];
  at_risk: AtRiskEntry[];
  recent_breaches: RecentBreach[];
}

/**
 * Filter states whose current_tier deadline is within `tierWindowMin`, OR
 * whose response/resolution deadline is within `slaWindowMin`. Returns the
 * soonest-expiring deadline per state as an AtRiskEntry.
 */
export function buildAtRiskEntries(
  states: IncidentSLAStateDocument[],
  now: Date,
  tierWindowMin = 15,
  slaWindowMin = 30,
): Array<Omit<AtRiskEntry, 'consumer_name' | 'incident_title' | 'severity'>> {
  const out: Array<Omit<AtRiskEntry, 'consumer_name' | 'incident_title' | 'severity'>> = [];
  for (const s of states) {
    if (s.status !== 'active') continue;
    const candidates: Array<{ kind: 'tier' | 'response' | 'resolution'; deadline: Date; windowMin: number }> = [];
    if (s.tier_deadline && !s.response_sla.met_at) {
      candidates.push({ kind: 'tier', deadline: s.tier_deadline, windowMin: tierWindowMin });
    }
    if (!s.response_sla.met_at && !s.response_sla.breached) {
      candidates.push({ kind: 'response', deadline: s.response_sla.deadline_at, windowMin: slaWindowMin });
    }
    if (!s.resolution_sla.met_at && !s.resolution_sla.breached) {
      candidates.push({ kind: 'resolution', deadline: s.resolution_sla.deadline_at, windowMin: slaWindowMin });
    }

    const closest = candidates
      .map((c) => ({ ...c, minsRemaining: (c.deadline.getTime() - now.getTime()) / 60_000 }))
      .filter((c) => c.minsRemaining <= c.windowMin) // within (or past) the window
      .sort((a, b) => a.minsRemaining - b.minsRemaining)[0];

    if (!closest) continue;
    out.push({
      state_id: s._id.toString(),
      bridge_id: s.incident_bridge_id.toString(),
      contract_id: s.contract_id.toString(),
      consumer_incident_id: s.consumer_incident_id.toString(),
      provider_incident_id: s.provider_incident_id.toString(),
      current_tier: s.current_tier,
      deadline_kind: closest.kind,
      deadline_at: closest.deadline.toISOString(),
      minutes_remaining: Math.round(closest.minsRemaining * 10) / 10,
    });
  }
  return out.sort((a, b) => a.minutes_remaining - b.minutes_remaining);
}

export async function buildProviderDashboard(
  providerTenantId: Types.ObjectId,
  now: Date = new Date(),
): Promise<ProviderDashboard> {
  const since24h = new Date(now.getTime() - 24 * 3600_000);
  const since7d = new Date(now.getTime() - 7 * 24 * 3600_000);

  const [activeContracts, activeStates, recentStates] = await Promise.all([
    SupportContract.find({ tenant_id: providerTenantId, status: 'active' }),
    IncidentSLAState.find({ provider_tenant_id: providerTenantId, status: 'active' }),
    IncidentSLAState.find({
      provider_tenant_id: providerTenantId,
      updatedAt: { $gte: since7d },
    }),
  ]);

  // Tier totals (platform-wide for this provider)
  const tierTotals: TierCounts = { L1: 0, L2: 0, L3: 0 };
  for (const s of activeStates) {
    const key = `L${s.current_tier}` as keyof TierCounts;
    tierTotals[key] += 1;
  }

  const breachesLast24h = recentStates.filter(
    (s) =>
      (s.response_sla.breached || s.resolution_sla.breached)
      && s.updatedAt >= since24h,
  ).length;

  // Consumer rollups — one row per contract
  const statesByContract = new Map<string, IncidentSLAStateDocument[]>();
  for (const s of activeStates) {
    const k = s.contract_id.toString();
    if (!statesByContract.has(k)) statesByContract.set(k, []);
    statesByContract.get(k)!.push(s);
  }

  const recentByContract = new Map<string, IncidentSLAStateDocument[]>();
  for (const s of recentStates) {
    const k = s.contract_id.toString();
    if (!recentByContract.has(k)) recentByContract.set(k, []);
    recentByContract.get(k)!.push(s);
  }

  const consumerIdsSet = new Set<string>(activeContracts.map((c) => c.consumer_tenant_id.toString()));
  const consumerTenants = await Tenant.find({ _id: { $in: Array.from(consumerIdsSet) } }, '_id name').lean();
  const consumerNameById = new Map<string, string>(
    consumerTenants.map((t: any) => [t._id.toString(), t.name]),
  );

  const consumers: ConsumerRollup[] = activeContracts.map((c) => {
    const contractKey = c._id.toString();
    const active = statesByContract.get(contractKey) ?? [];
    const byTier: TierCounts = { L1: 0, L2: 0, L3: 0 };
    for (const s of active) {
      const k = `L${s.current_tier}` as keyof TierCounts;
      byTier[k] += 1;
    }
    const recent = recentByContract.get(contractKey) ?? [];
    const respResolved = recent.filter((s) => s.response_sla.met_at || s.response_sla.breached);
    const resolResolved = recent.filter((s) => s.resolution_sla.met_at || s.resolution_sla.breached);
    const respMet = respResolved.filter((s) => !s.response_sla.breached).length;
    const resolMet = resolResolved.filter((s) => !s.resolution_sla.breached).length;

    return {
      consumer_tenant_id: c.consumer_tenant_id.toString(),
      consumer_name: consumerNameById.get(c.consumer_tenant_id.toString()) ?? null,
      contract_id: contractKey,
      contract_name: c.name,
      coverage_type: c.coverage_window.type,
      active_by_tier: byTier,
      open_total: active.length,
      response_compliance_pct: respResolved.length > 0 ? Math.round((respMet / respResolved.length) * 100) : 100,
      resolution_compliance_pct: resolResolved.length > 0 ? Math.round((resolMet / resolResolved.length) * 100) : 100,
      total_recent_incidents: recent.length,
    };
  }).sort((a, b) => b.open_total - a.open_total);

  // At-risk incidents — enrich with severity/title/consumer from Incident + Tenant
  const riskBare = buildAtRiskEntries(activeStates, now);
  const incidentIds = riskBare.map((r) => new Types.ObjectId(r.consumer_incident_id));
  const incidents = incidentIds.length > 0
    ? await Incident.find({ _id: { $in: incidentIds } }, '_id title severity tenant_id').lean()
    : [];
  const incidentById = new Map<string, any>(incidents.map((i: any) => [i._id.toString(), i]));

  const at_risk: AtRiskEntry[] = riskBare.map((r) => {
    const inc = incidentById.get(r.consumer_incident_id);
    const consumerId = inc?.tenant_id?.toString();
    return {
      ...r,
      consumer_name: consumerId ? consumerNameById.get(consumerId) ?? null : null,
      incident_title: inc?.title ?? null,
      severity: inc?.severity ?? null,
    };
  });

  // Recent breaches — latest 10 in the last 24h
  const breachedRaw = recentStates.filter(
    (s) => (s.response_sla.breached || s.resolution_sla.breached) && s.updatedAt >= since24h,
  );
  const breachIncidentIds = breachedRaw.map((s) => s.consumer_incident_id);
  const breachIncidents = breachIncidentIds.length > 0
    ? await Incident.find({ _id: { $in: breachIncidentIds } }, '_id title tenant_id').lean()
    : [];
  const breachIncidentById = new Map<string, any>(breachIncidents.map((i: any) => [i._id.toString(), i]));

  const recent_breaches: RecentBreach[] = [];
  for (const s of breachedRaw) {
    const inc = breachIncidentById.get(s.consumer_incident_id.toString());
    const consumerId = inc?.tenant_id?.toString();
    if (s.response_sla.breached) {
      recent_breaches.push({
        state_id: s._id.toString(),
        consumer_name: consumerId ? consumerNameById.get(consumerId) ?? null : null,
        consumer_incident_id: s.consumer_incident_id.toString(),
        incident_title: inc?.title ?? null,
        kind: 'response',
        deadline_at: s.response_sla.deadline_at.toISOString(),
        breached_at: s.updatedAt.toISOString(),
      });
    }
    if (s.resolution_sla.breached) {
      recent_breaches.push({
        state_id: s._id.toString(),
        consumer_name: consumerId ? consumerNameById.get(consumerId) ?? null : null,
        consumer_incident_id: s.consumer_incident_id.toString(),
        incident_title: inc?.title ?? null,
        kind: 'resolution',
        deadline_at: s.resolution_sla.deadline_at.toISOString(),
        breached_at: s.updatedAt.toISOString(),
      });
    }
  }
  recent_breaches.sort((a, b) => (b.breached_at > a.breached_at ? 1 : -1));

  return {
    totals: {
      active_contracts: activeContracts.length,
      open_incidents: activeStates.length,
      breaches_last_24h: breachesLast24h,
      active_by_tier: tierTotals,
    },
    consumers,
    at_risk,
    recent_breaches: recent_breaches.slice(0, 10),
  };
}
