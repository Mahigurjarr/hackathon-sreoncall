import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { ServiceDependency } from '../models/service-dependency.model';
import { Service } from '../models/service.model';
import { Project } from '../models/project.model';
import { DependencyDiscoveryJob } from '../models/dependency-discovery-job.model';
import * as aiService from '../services/ai.service';
import * as lgtm from '../services/lgtm-query.service';
import * as notificationService from '../services/notification.service';
import * as ticketService from '../services/ticket.service';
import { tryAutoApprove } from '../services/service-dependency.service';
import { buildServiceNameIndex, resolveServiceByName, registerServiceInIndex } from '../services/service-identity.util';
import { User } from '../models/user.model';

/**
 * Get or create a default project for auto-discovered services.
 */
async function getDefaultProject(tenantId: Types.ObjectId): Promise<Types.ObjectId> {
  let project = await Project.findOne({ tenant_id: tenantId, name: 'Auto-Discovered' });
  if (!project) {
    project = await Project.create({
      tenant_id: tenantId,
      name: 'Auto-Discovered',
      description: 'Services auto-discovered by the dependency discovery engine.',
    });
    logger.info('Created default project for auto-discovered services', { tenantId: tenantId.toString(), projectId: project._id.toString() });
  }
  return project._id as Types.ObjectId;
}


const STREAM_NAME = 'ICC_DISCOVERY';
const CONSUMER_NAME = 'icc-discovery-processor';
let consumer: ConsumerMessages | null = null;
let running = false;

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.discovery.>'],
      retention: 'workqueue' as any,
      max_msgs: 50_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
    });
    logger.info('ICC_DISCOVERY stream created');
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
      ack_wait: 120_000_000_000, // 2 minutes (trace queries + AI parsing can be slow)
    });
    logger.info('Dependency discovery worker consumer created');
  }
}

/**
 * Infer a service type from its name for auto-discovered services.
 */
function inferServiceType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('-gateway') || lower.endsWith('-proxy') || lower === 'gateway' || lower === 'proxy') {
    return 'api';
  }
  if (
    lower.endsWith('-db') || lower.endsWith('-database') ||
    lower.includes('postgres') || lower.includes('mysql') ||
    lower.includes('mongo') || lower.includes('redis') ||
    lower === 'postgresql' || lower === 'mariadb'
  ) {
    return 'database';
  }
  return 'other';
}

interface UpsertDiscoveredEdgeParams {
  tenantId: Types.ObjectId;
  sourceServiceId: Types.ObjectId;
  targetServiceId: Types.ObjectId;
  dependencyType: string;
  criticality?: string;
  discoveryMethod: 'auto_otel' | 'auto_network' | 'ai_parsed' | 'document_upload';
  protocolDetails?: Partial<import('../models/service-dependency.model').ProtocolDetails>;
  trafficMetadata?: Partial<import('../models/service-dependency.model').TrafficMetadata>;
  notes?: string | null;
}

/**
 * Atomically creates or updates a discovered dependency edge, incrementing
 * `observation_count` on every rediscovery. Uses a single `findOneAndUpdate`
 * with `upsert: true` — the existing unique index on
 * {tenant_id, source_service_id, target_service_id} makes this atomic, unlike
 * the previous find-then-create/update pattern which could race two
 * concurrent discovery runs into a duplicate-key error.
 */
async function upsertDiscoveredEdge(
  params: UpsertDiscoveredEdgeParams,
): Promise<{ doc: any; wasNew: boolean }> {
  const now = new Date();

  const setOnInsert: any = {
    tenant_id: params.tenantId,
    source_service_id: params.sourceServiceId,
    target_service_id: params.targetServiceId,
    dependency_type: params.dependencyType,
    criticality: params.criticality ?? 'medium',
    discovery_method: params.discoveryMethod,
    status: 'proposed',
    first_seen_at: now,
    protocol_details: params.protocolDetails ?? {},
    notes: params.notes ?? null,
    labels: {},
    version: 1,
    // observation_count is NOT set here — $inc below already initializes it
    // to 1 on insert (Mongo treats a missing field as 0 before incrementing).
    // Setting it in $setOnInsert too throws "would create a conflict at
    // 'observation_count'" since Mongo forbids two operators touching the
    // same path in one update.
  };

  const set: any = { last_seen_at: now, updated_at: now };
  if (params.trafficMetadata) {
    for (const [key, value] of Object.entries(params.trafficMetadata)) {
      set[`traffic_metadata.${key}`] = value;
    }
  }

  const doc = await ServiceDependency.findOneAndUpdate(
    {
      tenant_id: params.tenantId,
      source_service_id: params.sourceServiceId,
      target_service_id: params.targetServiceId,
    },
    { $setOnInsert: setOnInsert, $set: set, $inc: { observation_count: 1 } },
    { new: true, upsert: true },
  );

  const wasNew = doc.observation_count === 1;
  return { doc, wasNew };
}

/**
 * Metrics-based dependency discovery.  Used as a fallback when trace-based
 * discovery returns zero edges (i.e. the tenant has OTel metrics in Mimir but
 * no distributed tracing / trace-context propagation).
 *
 * Strategy:
 *  1. Discover all services via `http_server_request_duration_seconds_count`
 *  2. Discover database connections via `db_client_connections_usage`
 *  3. Infer gateway→service routing from naming conventions
 *  4. Discover explicit HTTP client edges via `http_client_request_duration_seconds_count`
 */
async function discoverFromMetrics(
  tenantId: string,
): Promise<Array<{
  sourceName: string;
  targetName: string;
  dependencyType: string;
  avgLatencyMs: number;
  requestCount: number;
  errorCount: number;
}>> {
  const edges: Array<{
    sourceName: string;
    targetName: string;
    dependencyType: string;
    avgLatencyMs: number;
    requestCount: number;
    errorCount: number;
  }> = [];

  const edgeKeys = new Set<string>(); // dedup "source→target"

  const addEdge = (source: string, target: string, depType: string) => {
    const key = `${source}→${target}`;
    if (edgeKeys.has(key) || source === target) return;
    edgeKeys.add(key);
    edges.push({
      sourceName: source,
      targetName: target,
      dependencyType: depType,
      avgLatencyMs: 0,
      requestCount: 0,
      errorCount: 0,
    });
  };

  try {
    // Step 1: Discover all services that emit HTTP server metrics
    const httpServerResults = await lgtm.queryInstantVector(
      tenantId,
      'group by (service_name) (http_server_request_duration_seconds_count)',
    );
    const serviceNames = httpServerResults
      .map((r) => r.metric.service_name)
      .filter((n): n is string => !!n);

    // Also try `job` label if `service_name` yielded nothing
    if (serviceNames.length === 0) {
      const jobResults = await lgtm.queryInstantVector(
        tenantId,
        'group by (job) (http_server_request_duration_seconds_count)',
      );
      for (const r of jobResults) {
        const job = r.metric.job;
        if (job) serviceNames.push(job);
      }
    }

    logger.info('Metrics discovery: discovered services', { tenantId, count: serviceNames.length, services: serviceNames });

    if (serviceNames.length === 0) {
      return edges; // no metrics data at all
    }

    // Step 2: Discover database connections
    const dbResults = await lgtm.queryInstantVector(
      tenantId,
      'group by (service_name) (db_client_connections_usage)',
    );
    for (const r of dbResults) {
      const svc = r.metric.service_name;
      if (svc) {
        addEdge(svc, 'PostgreSQL', 'database');
      }
    }

    // Step 3: Infer gateway→service routing from naming conventions
    const gatewayServices = serviceNames.filter(
      (name) => name.endsWith('-gateway') || name.endsWith('-proxy') || name === 'gateway' || name === 'proxy',
    );
    const nonGatewayServices = serviceNames.filter(
      (name) => !gatewayServices.includes(name),
    );
    for (const gw of gatewayServices) {
      for (const svc of nonGatewayServices) {
        addEdge(gw, svc, 'http');
      }
    }

    // Step 4: Discover explicit HTTP client edges (outbound calls)
    const httpClientResults = await lgtm.queryInstantVector(
      tenantId,
      'group by (service_name, server_address) (http_client_request_duration_seconds_count)',
    );
    for (const r of httpClientResults) {
      const source = r.metric.service_name;
      const target = r.metric.server_address;
      if (source && target) {
        addEdge(source, target, 'http');
      }
    }

    logger.info('Metrics discovery: edges found', { tenantId, edgeCount: edges.length });
  } catch (err: any) {
    logger.warn('Metrics-based discovery failed', { tenantId, error: err.message });
  }

  return edges;
}

async function handleTrigger(data: any): Promise<void> {
  const { tenant_id, job_id, scan_window_hours, observability_connection_id } = data;
  const tenantId = new Types.ObjectId(tenant_id);
  const windowHours = scan_window_hours || 72;

  logger.info('Discovery worker: starting OTel trace scan', { tenant_id, job_id, windowHours });

  // Mark job as running
  await DependencyDiscoveryJob.findByIdAndUpdate(job_id, {
    status: 'running',
    started_at: new Date(),
  });

  const startTime = Date.now();

  try {
    // Query Tempo trace data for tenant and extract service-to-service edges
    const trafficEdges = await lgtm.getServiceTrafficEdges(tenant_id, windowHours);

    // Map LGTM traffic edges into the format expected by the edge processing loop
    const discoveredEdges: Array<{
      sourceName: string;
      targetName: string;
      dependencyType: string;
      avgLatencyMs: number;
      requestCount: number;
      errorCount: number;
    }> = trafficEdges.map((edge) => ({
      sourceName: edge.source,
      targetName: edge.target,
      dependencyType: 'http', // inferred from trace spans; could be refined with span attributes
      avgLatencyMs: edge.avg_latency_ms,
      requestCount: edge.request_count,
      errorCount: edge.error_count,
    }));

    // If trace-based discovery found 0 edges, try metrics-based discovery
    if (discoveredEdges.length === 0) {
      logger.info('No trace-based edges found, falling back to metrics-based discovery', { tenant_id, job_id });
      const metricsEdges = await discoverFromMetrics(tenant_id);
      discoveredEdges.push(...metricsEdges);
    }

    let edgesNew = 0;
    let edgesUpdated = 0;
    const servicesDiscovered = new Set<string>();
    const newServicesCreated: string[] = [];

    // Get or create a default project for auto-discovered services
    const defaultProjectId = await getDefaultProject(tenantId);
    const nameIndex = await buildServiceNameIndex(tenantId.toString());

    for (const edge of discoveredEdges) {
      servicesDiscovered.add(edge.sourceName);
      servicesDiscovered.add(edge.targetName);

      // Find or create source service — exact name/alias match, then
      // normalized (generic-suffix-stripped) match, so 'checkout' from a
      // trace and 'checkout-svc' from asset-discovery resolve to one Service.
      let sourceServiceId: Types.ObjectId;
      const sourceMatch = await resolveServiceByName(nameIndex, edge.sourceName);
      if (sourceMatch) {
        sourceServiceId = sourceMatch.serviceId;
      } else {
        const created = await Service.create({
          tenant_id: tenantId,
          project_id: defaultProjectId,
          name: edge.sourceName,
          type: inferServiceType(edge.sourceName),
          current_status: 'unknown',
          classification: 'app',
          auto_discovered: true,
        });
        registerServiceInIndex(nameIndex, { _id: created._id as Types.ObjectId, name: created.name });
        sourceServiceId = created._id as Types.ObjectId;
        newServicesCreated.push(edge.sourceName);
      }

      // Find or create target service
      let targetServiceId: Types.ObjectId;
      const targetMatch = await resolveServiceByName(nameIndex, edge.targetName);
      if (targetMatch) {
        targetServiceId = targetMatch.serviceId;
      } else {
        const created = await Service.create({
          tenant_id: tenantId,
          project_id: defaultProjectId,
          name: edge.targetName,
          type: inferServiceType(edge.targetName),
          current_status: 'unknown',
          classification: 'app',
          auto_discovered: true,
        });
        registerServiceInIndex(nameIndex, { _id: created._id as Types.ObjectId, name: created.name });
        targetServiceId = created._id as Types.ObjectId;
        newServicesCreated.push(edge.targetName);
      }

      // Create or update dependency edge (atomic upsert — increments observation_count)
      const { doc: edgeDoc, wasNew } = await upsertDiscoveredEdge({
        tenantId,
        sourceServiceId,
        targetServiceId,
        dependencyType: edge.dependencyType || 'http',
        discoveryMethod: 'auto_otel',
        trafficMetadata: {
          avg_requests_per_minute: Math.round(edge.requestCount / (windowHours * 60)),
          avg_latency_ms: edge.avgLatencyMs,
          error_rate_percent: edge.requestCount > 0
            ? (edge.errorCount / edge.requestCount) * 100
            : 0,
          last_updated_at: new Date(),
        },
      });
      if (wasNew) edgesNew++; else edgesUpdated++;

      try {
        await tryAutoApprove(tenant_id, edgeDoc._id.toString(), 'worker:dependency-discovery');
      } catch (err: any) {
        logger.warn('Auto-approval attempt failed', { error: err.message, dependencyId: edgeDoc._id.toString() });
      }
    }

    // Flag stale edges — previously approved edges not seen in this scan
    // Build a set of seen source+target pairs from this scan
    const seenPairs = new Set<string>();
    for (const edge of discoveredEdges) {
      const sourceMatch = await resolveServiceByName(nameIndex, edge.sourceName);
      const targetMatch = await resolveServiceByName(nameIndex, edge.targetName);
      if (sourceMatch && targetMatch) {
        seenPairs.add(`${sourceMatch.serviceId.toString()}:${targetMatch.serviceId.toString()}`);
      }
    }

    // Query all approved edges for this tenant and archive unseen stale ones
    const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const approvedEdges = await ServiceDependency.find({
      tenant_id: tenantId,
      status: 'approved',
    }).lean();

    let edgesStale = 0;
    for (const edge of approvedEdges) {
      const pairKey = `${edge.source_service_id.toString()}:${edge.target_service_id.toString()}`;
      if (!seenPairs.has(pairKey) && edge.last_seen_at && new Date(edge.last_seen_at) < staleCutoff) {
        await ServiceDependency.findByIdAndUpdate(edge._id, { status: 'archived', updated_at: new Date() });
        edgesStale++;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    await DependencyDiscoveryJob.findByIdAndUpdate(job_id, {
      status: 'completed',
      completed_at: new Date(),
      results: {
        edges_discovered: discoveredEdges.length,
        edges_new: edgesNew,
        edges_updated: edgesUpdated,
        edges_stale: edgesStale,
        services_discovered: servicesDiscovered.size,
        processing_time_ms: processingTimeMs,
      },
    });

    logger.info('Discovery worker: OTel scan complete', {
      tenant_id,
      job_id,
      edges_discovered: discoveredEdges.length,
      edges_new: edgesNew,
      edges_updated: edgesUpdated,
      new_services: newServicesCreated,
      processing_time_ms: processingTimeMs,
    });

    // ── Notify + create work item for newly discovered services ───────────
    if (newServicesCreated.length > 0) {
      try {
        // Find tenant admins to notify
        const admins = await User.find({
          tenant_id: tenantId,
          roles: { $in: ['tenant_admin', 'manager'] },
          status: 'active',
        }).select('_id').limit(10).lean();

        const serviceList = newServicesCreated.join(', ');
        const serviceCount = newServicesCreated.length;

        // Send notification to each admin
        for (const admin of admins) {
          await notificationService.createNotification({
            tenant_id: tenantId,
            user_id: admin._id as Types.ObjectId,
            type: 'service_discovered',
            priority: 'warning',
            title: `${serviceCount} new service${serviceCount > 1 ? 's' : ''} discovered`,
            body: `Auto-discovery found new services in your infrastructure: ${serviceList}. Review and approve their dependencies in Service Topology.`,
            resource_type: 'service',
          });
        }

        // Create a work ticket for the topology review
        const reporter = admins[0];
        if (reporter) {
          await ticketService.createTicket({
            tenant_id: tenantId,
            project_id: defaultProjectId.toString(),
            type: 'task',
            title: `Review newly discovered services: ${serviceList}`,
            description: [
              `## New Services Detected`,
              ``,
              `The dependency discovery scan found **${serviceCount}** new service${serviceCount > 1 ? 's' : ''}:`,
              ``,
              ...newServicesCreated.map((s) => `- **${s}** (type: ${inferServiceType(s)})`),
              ``,
              `### Action Required`,
              `1. Go to **Services → Topology** to review proposed dependencies`,
              `2. **Approve** or **reject** each dependency edge`,
              `3. Optionally upload an architecture diagram for more accurate mapping`,
              `4. Or manually add any missing dependencies`,
              ``,
              `> These services were auto-discovered from OTel telemetry data.`,
            ].join('\n'),
            priority: 'medium',
            labels: ['auto-discovered', 'topology-review'],
            reporter_id: reporter._id as Types.ObjectId,
          });
        }

        logger.info('Discovery worker: notifications and work item created for new services', {
          tenant_id,
          new_services: newServicesCreated,
          admins_notified: admins.length,
        });
      } catch (err: any) {
        logger.warn('Failed to create notifications/ticket for new services', { error: err.message });
      }
    }
  } catch (err: any) {
    await DependencyDiscoveryJob.findByIdAndUpdate(job_id, {
      status: 'failed',
      completed_at: new Date(),
      error_message: err.message,
    });
    throw err;
  }
}

async function handleDocument(data: any): Promise<void> {
  const { tenant_id, job_id, filename: document_filename, file_content, mime_type } = data;
  const tenantId = new Types.ObjectId(tenant_id);

  logger.info('Discovery worker: parsing uploaded document', { tenant_id, job_id, document_filename, mime_type, contentLength: file_content?.length || 0 });

  // Mark job as running
  await DependencyDiscoveryJob.findByIdAndUpdate(job_id, {
    status: 'running',
    started_at: new Date(),
  });

  const startTime = Date.now();

  try {
    if (!file_content) {
      logger.warn('No file content in NATS message, AI parsing will have limited data', { job_id });
    }

    const systemPrompt = `You are an infrastructure expert. Extract all service-to-service dependencies from this architecture document/diagram. Return a JSON array of objects with:
- source: string (source service name)
- target: string (target service name)
- dependency_type: string (one of: http, grpc, tcp, database, queue, cache, dns, file, custom)
- port: number | null
- path: string | null
- criticality: string (one of: critical, high, medium, low)
- notes: string | null
Return valid JSON array only. No markdown, no explanation.`;

    const isImage = mime_type && /^image\//.test(mime_type);
    let parseResult: aiService.CompletionResult;

    if (isImage && file_content) {
      // Use vision API for image files (architecture diagrams)
      parseResult = await aiService.generateVisionCompletion({
        system: systemPrompt,
        imageBase64: file_content,
        mimeType: mime_type,
        textPrompt: `Analyze this architecture diagram and extract all service-to-service dependencies. The filename is: ${document_filename}`,
        tenantId: tenant_id,
      });
    } else {
      // Use text API for documents
      const documentContent = file_content || `[Document: ${document_filename} — no content available]`;
      parseResult = await aiService.generateCompletion({
        system: systemPrompt,
        userMessage: documentContent,
        tenantId: tenant_id,
      });
    }

    let parsedEdges: any[] = [];
    const rawText = parseResult.text.trim();
    logger.info('Discovery worker: AI parse result', {
      job_id, model: parseResult.model,
      input_tokens: parseResult.input_tokens,
      output_tokens: parseResult.output_tokens,
      rawTextLength: rawText.length,
      rawTextPreview: rawText.slice(0, 500),
    });

    try {
      // Strip markdown code fences if present
      const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      parsedEdges = JSON.parse(jsonText);
      if (!Array.isArray(parsedEdges)) parsedEdges = [];
    } catch (parseErr: any) {
      logger.warn('Discovery worker: failed to parse AI response as JSON', { job_id, error: parseErr.message, rawTextPreview: rawText.slice(0, 200) });
      parsedEdges = [];
    }

    let edgesNew = 0;
    const servicesDiscovered = new Set<string>();

    // Get or create a default project for auto-discovered services
    const defaultProjectId = await getDefaultProject(tenantId);
    const nameIndex = await buildServiceNameIndex(tenantId.toString());

    for (const edge of parsedEdges) {
      if (!edge.source || !edge.target) continue;

      servicesDiscovered.add(edge.source);
      servicesDiscovered.add(edge.target);

      // Find or create source service — exact name/alias match, then
      // normalized (generic-suffix-stripped) match against services already
      // known this run (including ones asset-discovery already created).
      let sourceServiceId: Types.ObjectId;
      const sourceMatch = await resolveServiceByName(nameIndex, edge.source);
      if (sourceMatch) {
        sourceServiceId = sourceMatch.serviceId;
      } else {
        const created = await Service.create({
          tenant_id: tenantId,
          project_id: defaultProjectId,
          name: edge.source,
          type: inferServiceType(edge.source),
          current_status: 'unknown',
          classification: 'app',
          auto_discovered: true,
        });
        registerServiceInIndex(nameIndex, { _id: created._id as Types.ObjectId, name: created.name });
        sourceServiceId = created._id as Types.ObjectId;
      }

      // Find or create target service
      let targetServiceId: Types.ObjectId;
      const targetMatch = await resolveServiceByName(nameIndex, edge.target);
      if (targetMatch) {
        targetServiceId = targetMatch.serviceId;
      } else {
        const created = await Service.create({
          tenant_id: tenantId,
          project_id: defaultProjectId,
          name: edge.target,
          type: inferServiceType(edge.target),
          current_status: 'unknown',
          classification: 'app',
          auto_discovered: true,
        });
        registerServiceInIndex(nameIndex, { _id: created._id as Types.ObjectId, name: created.name });
        targetServiceId = created._id as Types.ObjectId;
      }

      // Create or update dependency edge (atomic upsert — increments observation_count;
      // previously this path silently no-op'd on rediscovery, not even bumping last_seen_at)
      const { doc: edgeDoc, wasNew } = await upsertDiscoveredEdge({
        tenantId,
        sourceServiceId,
        targetServiceId,
        dependencyType: edge.dependency_type || 'http',
        criticality: edge.criticality || 'medium',
        discoveryMethod: 'ai_parsed',
        protocolDetails: {
          port: edge.port || null,
          path: edge.path || null,
        },
        notes: edge.notes || null,
      });
      if (wasNew) edgesNew++;

      try {
        await tryAutoApprove(tenant_id, edgeDoc._id.toString(), 'worker:dependency-discovery');
      } catch (err: any) {
        logger.warn('Auto-approval attempt failed', { error: err.message, dependencyId: edgeDoc._id.toString() });
      }
    }

    const processingTimeMs = Date.now() - startTime;

    await DependencyDiscoveryJob.findByIdAndUpdate(job_id, {
      status: 'completed',
      completed_at: new Date(),
      ai_parse_output: parseResult.text,
      results: {
        edges_discovered: parsedEdges.length,
        edges_new: edgesNew,
        edges_updated: 0,
        edges_stale: 0,
        services_discovered: servicesDiscovered.size,
        processing_time_ms: processingTimeMs,
      },
    });

    logger.info('Discovery worker: document parsing complete', {
      tenant_id,
      job_id,
      edges_discovered: parsedEdges.length,
      edges_new: edgesNew,
      services_discovered: servicesDiscovered.size,
    });
  } catch (err: any) {
    await DependencyDiscoveryJob.findByIdAndUpdate(job_id, {
      status: 'failed',
      completed_at: new Date(),
      error_message: err.message,
    });
    throw err;
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const subject = msg.subject;

    if (subject === 'icc.discovery.trigger') {
      await handleTrigger(data);
    } else if (subject === 'icc.discovery.document') {
      await handleDocument(data);
    } else {
      logger.debug('Discovery worker: unhandled subject', { subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Discovery worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startDependencyDiscoveryWorker(): Promise<void> {
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
      logger.error('Dependency discovery worker loop error', { error: err.message });
    }
  });

  logger.info('Dependency discovery worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopDependencyDiscoveryWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Dependency discovery worker stopped');
}
