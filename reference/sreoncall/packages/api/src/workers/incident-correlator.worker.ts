import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { Incident } from '../models/incident.model';
import { IncidentCorrelation } from '../models/incident-correlation.model';
import { ChangeRequest } from '../models/change-request.model';
import { ServiceDependency } from '../models/service-dependency.model';
import { Service } from '../models/service.model';
import * as lgtm from '../services/lgtm-query.service';

const STREAM_NAME = 'ICC_CORRELATION';
const CONSUMER_NAME = 'icc-correlation-processor';
const TEMPORAL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes default

// Correlation signal weights (from FRD §6.2)
const WEIGHTS = {
  dependency_graph: 0.35,
  temporal_proximity: 0.15,
  shared_deployment: 0.25,
  common_error_pattern: 0.15,
  historical_pattern: 0.10,
};

const CONFIDENCE_THRESHOLD = 60; // minimum weighted score to create correlation

let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.correlation.>'],
      retention: 'workqueue' as any,
      max_msgs: 100_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_CORRELATION stream created');
  }
}

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_deliver: 3,
      ack_wait: 60_000_000_000, // 60 seconds
    });
    logger.info('Incident correlator worker consumer created');
  }
}

async function evaluateCorrelation(data: any): Promise<void> {
  const { tenant_id, incident_id } = data;
  const tenantId = new Types.ObjectId(tenant_id);
  const incidentId = new Types.ObjectId(incident_id);

  logger.info('Correlator worker: evaluating incident for correlations', { tenant_id, incident_id });

  // Fetch the new incident
  const newIncident = await Incident.findOne({ _id: incidentId, tenant_id: tenantId });
  if (!newIncident) {
    logger.warn('Correlator worker: incident not found', { incident_id });
    return;
  }

  // Find all open incidents in the same tenant (excluding this one)
  const openIncidents = await Incident.find({
    tenant_id: tenantId,
    _id: { $ne: incidentId },
    status: { $in: ['triggered', 'acknowledged', 'investigating'] },
  });

  if (openIncidents.length === 0) {
    logger.debug('Correlator worker: no other open incidents to correlate with', { incident_id });
    return;
  }

  // Load approved dependency graph for the tenant
  const dependencies = await ServiceDependency.find({
    tenant_id: tenantId,
    status: 'approved',
  });

  // Build adjacency map for dependency lookups
  const adjacencyMap = new Map<string, Set<string>>();
  for (const dep of dependencies) {
    const sourceId = dep.source_service_id.toString();
    const targetId = dep.target_service_id.toString();
    if (!adjacencyMap.has(sourceId)) adjacencyMap.set(sourceId, new Set());
    if (!adjacencyMap.has(targetId)) adjacencyMap.set(targetId, new Set());
    adjacencyMap.get(sourceId)!.add(targetId);
    adjacencyMap.get(targetId)!.add(sourceId);
  }

  const newServiceId = newIncident.affected_service_ids?.[0]?.toString();

  for (const openIncident of openIncidents) {
    const evidence: Array<{ type: string; description: string; weight: number }> = [];
    let totalScore = 0;

    const openServiceId = openIncident.affected_service_ids?.[0]?.toString();

    // Signal 1: Dependency graph proximity
    if (newServiceId && openServiceId) {
      const newNeighbors = adjacencyMap.get(newServiceId);
      if (newNeighbors?.has(openServiceId)) {
        // Directly connected in dependency graph
        const weight = WEIGHTS.dependency_graph;
        totalScore += weight * 100;
        evidence.push({
          type: 'dependency_graph',
          description: `Services are directly connected in the dependency graph`,
          weight,
        });
      } else {
        // Check 2-hop proximity
        const newNeighborSet = adjacencyMap.get(newServiceId) || new Set();
        const openNeighborSet = adjacencyMap.get(openServiceId) || new Set();
        const sharedNeighbors = [...newNeighborSet].filter((n) => openNeighborSet.has(n));
        if (sharedNeighbors.length > 0) {
          const weight = WEIGHTS.dependency_graph * 0.5; // half weight for 2-hop
          totalScore += weight * 100;
          evidence.push({
            type: 'dependency_graph',
            description: `Services share ${sharedNeighbors.length} common dependency neighbor(s)`,
            weight,
          });
        }
      }
    }

    // Signal 2: Temporal proximity
    const newCreatedAt = new Date(newIncident.createdAt).getTime();
    const openCreatedAt = new Date(openIncident.createdAt).getTime();
    const timeDiffMs = Math.abs(newCreatedAt - openCreatedAt);
    if (timeDiffMs <= TEMPORAL_WINDOW_MS) {
      const proximityFactor = 1 - (timeDiffMs / TEMPORAL_WINDOW_MS); // closer = higher score
      const weight = WEIGHTS.temporal_proximity;
      totalScore += weight * proximityFactor * 100;
      evidence.push({
        type: 'temporal_proximity',
        description: `Incidents occurred ${Math.round(timeDiffMs / 1000)}s apart (within ${TEMPORAL_WINDOW_MS / 60000}min window)`,
        weight,
      });
    }

    // Signal 3: Shared recent deployment
    if (newServiceId && openServiceId) {
      try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const recentDeploys = await ChangeRequest.find({
          tenant_id: tenantId,
          affected_service_ids: { $all: [newServiceId, openServiceId] },
          $or: [
            { implemented_at: { $gte: twoHoursAgo } },
            { completed_at: { $gte: twoHoursAgo } },
          ],
          status: { $in: ['implemented', 'completed', 'in_progress'] },
        }).lean();
        if (recentDeploys.length > 0) {
          const weight = WEIGHTS.shared_deployment;
          totalScore += weight * 100;
          evidence.push({
            type: 'shared_deployment',
            description: `${recentDeploys.length} shared deployment(s) in the last 2h: ${recentDeploys.map((d) => `CR-${d.number} "${d.title}"`).join(', ')}`,
            weight,
          });
        }
      } catch {
        // ChangeRequest query failed — skip deployment signal gracefully
      }
    }

    // Signal 4: Common error pattern — compare log error signatures between incidents
    if (newIncident.labels && openIncident.labels) {
      const newLabels = new Set(newIncident.labels);
      const openLabels = new Set(openIncident.labels);
      const commonLabels = [...newLabels].filter((l) => openLabels.has(l));
      if (commonLabels.length > 0) {
        const weight = WEIGHTS.common_error_pattern;
        totalScore += weight * 100 * Math.min(commonLabels.length / 3, 1);
        evidence.push({
          type: 'common_error_pattern',
          description: `Incidents share ${commonLabels.length} common label(s): ${commonLabels.join(', ')}`,
          weight,
        });
      }
    }

    // Also compare error log signatures from LGTM if both incidents have affected services
    if (newServiceId && openServiceId) {
      try {
        const logWindow = Math.floor(TEMPORAL_WINDOW_MS / 1000); // seconds
        const newSvc = await Service.findById(newServiceId).lean();
        const openSvc = await Service.findById(openServiceId).lean();
        if (newSvc && openSvc) {
          const logStart = Math.floor(Math.min(newCreatedAt, openCreatedAt) / 1000) - logWindow;
          const logEnd = Math.floor(Math.max(newCreatedAt, openCreatedAt) / 1000) + logWindow;
          const [newLogs, openLogs] = await Promise.all([
            lgtm.queryLogs(tenant_id, `{service="${(newSvc as any).name}"} |= "error" or "ERROR"`, logStart, logEnd, 30),
            lgtm.queryLogs(tenant_id, `{service="${(openSvc as any).name}"} |= "error" or "ERROR"`, logStart, logEnd, 30),
          ]);
          // Compare error signatures — look for common exception patterns
          if (newLogs.length > 0 && openLogs.length > 0) {
            const extractSig = (line: string) => line.replace(/\d+/g, 'N').replace(/0x[0-9a-fA-F]+/g, 'ADDR').slice(0, 100);
            const newSigs = new Set(newLogs.map((l) => extractSig(l.line)));
            const openSigs = new Set(openLogs.map((l) => extractSig(l.line)));
            const commonSigs = [...newSigs].filter((s) => openSigs.has(s));
            if (commonSigs.length > 0) {
              const weight = WEIGHTS.common_error_pattern * 0.8;
              totalScore += weight * 100;
              evidence.push({
                type: 'common_error_pattern',
                description: `${commonSigs.length} common error signature(s) found in logs across both services`,
                weight,
              });
            }
          }
        }
      } catch {
        // LGTM unreachable — skip log-based correlation gracefully
      }
    }

    // Signal 5: Historical pattern — check if these services have co-failed in past confirmed correlations
    if (newServiceId && openServiceId) {
      try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        // Find past incidents affecting each service within the last 90 days
        const [newSvcIncidents, openSvcIncidents] = await Promise.all([
          Incident.find({
            tenant_id: tenantId,
            affected_service_ids: newServiceId,
            createdAt: { $gte: ninetyDaysAgo },
          }).select('_id').lean(),
          Incident.find({
            tenant_id: tenantId,
            affected_service_ids: openServiceId,
            createdAt: { $gte: ninetyDaysAgo },
          }).select('_id').lean(),
        ]);
        const newSvcIncidentIds = newSvcIncidents.map((i) => i._id);
        const openSvcIncidentIds = openSvcIncidents.map((i) => i._id);

        if (newSvcIncidentIds.length > 0 && openSvcIncidentIds.length > 0) {
          // Look for confirmed correlations that include incidents from both service groups
          const historicalCorrelations = await IncidentCorrelation.find({
            tenant_id: tenantId,
            status: 'confirmed',
            correlated_incident_ids: {
              $elemMatch: { $in: newSvcIncidentIds },
            },
            createdAt: { $gte: ninetyDaysAgo },
          }).lean();

          const matchingCorrelations = historicalCorrelations.filter((c) => {
            const ids = c.correlated_incident_ids.map((id) => id.toString());
            const hasNewSvc = ids.some((id) => newSvcIncidentIds.some((nid) => nid.toString() === id));
            const hasOpenSvc = ids.some((id) => openSvcIncidentIds.some((oid) => oid.toString() === id));
            return hasNewSvc && hasOpenSvc;
          });

          if (matchingCorrelations.length > 0) {
            const weight = WEIGHTS.historical_pattern;
            totalScore += weight * 100;
            evidence.push({
              type: 'historical_pattern',
              description: `${matchingCorrelations.length} confirmed correlation(s) involving both services in the last 90 days`,
              weight,
            });
          }
        }
      } catch {
        // Historical pattern query failed — skip gracefully
      }
    }

    // Create correlation if score exceeds threshold
    if (totalScore >= CONFIDENCE_THRESHOLD) {
      // Check if correlation already exists for this pair
      const existingCorrelation = await IncidentCorrelation.findOne({
        tenant_id: tenantId,
        correlated_incident_ids: { $all: [incidentId, openIncident._id] },
        status: { $ne: 'rejected' },
      });

      if (!existingCorrelation) {
        // Determine correlation type based on strongest signal
        const strongestSignal = evidence.reduce((a, b) => (a.weight > b.weight ? a : b), evidence[0]);
        let correlationType: string;
        switch (strongestSignal?.type) {
          case 'dependency_graph':
            correlationType = 'dependency_chain';
            break;
          case 'shared_deployment':
            correlationType = 'common_change';
            break;
          case 'common_error_pattern':
            correlationType = 'shared_root_cause';
            break;
          case 'temporal_proximity':
            correlationType = 'cascading_failure';
            break;
          default:
            correlationType = 'temporal';
        }

        await IncidentCorrelation.create({
          tenant_id: tenantId,
          parent_incident_id: null, // set by admin when confirming
          correlated_incident_ids: [incidentId, openIncident._id],
          status: 'proposed',
          correlation_type: correlationType,
          confidence_percent: Math.round(totalScore),
          evidence,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        logger.info('Correlator worker: correlation created', {
          incident_id,
          correlated_with: openIncident._id.toString(),
          confidence: Math.round(totalScore),
          correlation_type: correlationType,
        });
      }
    }
  }

  logger.info('Correlator worker: evaluation complete', {
    incident_id,
    open_incidents_checked: openIncidents.length,
  });
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.correlation.evaluate') {
      await evaluateCorrelation(data);
    } else {
      logger.debug('Correlator worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Correlator worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startIncidentCorrelatorWorker(): Promise<void> {
  if (running) return;

  await ensureStream();
  await ensureConsumer();
  const js = getJetStream();
  consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME).then((c) => c.consume());
  running = true;

  (async () => {
    if (!consumer) return;
    for await (const msg of consumer) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Incident correlator worker loop error', { error: err.message });
    }
  });

  logger.info('Incident correlator worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopIncidentCorrelatorWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Incident correlator worker stopped');
}
