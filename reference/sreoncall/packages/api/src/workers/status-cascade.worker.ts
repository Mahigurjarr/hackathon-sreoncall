/**
 * Status Cascade Worker
 *
 * Reacts to `icc.status.changed` events (published by service.service.ts's
 * updateServiceStatus) and propagates a service's health to whatever depends
 * on it critically.
 *
 * Architecture: single-hop reactive, not an internal multi-hop graph walk.
 * Each message only evaluates the IMMEDIATE critical upstream dependents of
 * the changed service. If a dependent's status needs to change, the write
 * goes through updateServiceStatus, which re-publishes icc.status.changed for
 * that dependent — carrying the cascade one hop further on a later message.
 * Doing an in-process BFS here instead would race the worker's own traversal
 * against the events it triggers and double-process nodes.
 *
 * Debounced per (tenant, service) to coalesce a flapping service's repeated
 * status changes into a single evaluation.
 */

import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { logger } from '../utils/logger';
import { Service, IService } from '../models/service.model';
import { ServiceDependency } from '../models/service-dependency.model';
import { Incident } from '../models/incident.model';
import { updateServiceStatus } from '../services/service.service';
import { getSettings } from '../services/service-topology-settings.service';
import { Types } from 'mongoose';

const STREAM_NAME = 'ICC_STATUS_CASCADE';
const CONSUMER_NAME = 'icc-status-cascade-processor';
const DEBOUNCE_MS = Math.max(parseInt(process.env.STATUS_CASCADE_DEBOUNCE_MS || '', 10) || 500, 100);

const DEGRADED_STATUSES: IService['current_status'][] = ['degraded', 'partial_outage', 'major_outage'];

let consumer: ConsumerMessages | null = null;
let running = false;

// Debounce timers keyed by `${tenant_id}:${service_id}` — coalesces flapping
// status changes on the same service into one evaluation.
const pendingCascade = new Map<string, ReturnType<typeof setTimeout>>();

async function ensureStream(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: ['icc.status.>'],
      retention: 'workqueue' as any,
      max_msgs: 50_000,
      max_age: 24 * 60 * 60 * 1_000_000_000, // 1 day in nanoseconds
    });
    logger.info('ICC_STATUS_CASCADE stream created');
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
      ack_wait: 30_000_000_000, // 30 seconds
    });
    logger.info('Status cascade worker consumer created');
  }
}

interface StatusChangedEvent {
  tenant_id: string;
  service_id: string;
  new_status: IService['current_status'];
  status_source: 'manual' | 'cascaded' | 'alert';
  incident_id?: string | null;
}

/**
 * Evaluates the immediate critical upstream dependents of the changed service
 * and, for any that need updating, writes a new status — which itself
 * publishes a fresh icc.status.changed event to carry the cascade one hop
 * further. This function never recurses or loops; it only ever looks one hop
 * upstream of the service named in the event it was given.
 */
async function handleSingleHop(event: StatusChangedEvent): Promise<void> {
  const isDegrading = DEGRADED_STATUSES.includes(event.new_status);
  const isRecovering = event.new_status === 'operational';
  if (!isDegrading && !isRecovering) return;

  const settings = await getSettings(new Types.ObjectId(event.tenant_id));
  if (!settings.cascade_enabled) return;

  const upstreamEdges = await ServiceDependency.find(
    {
      tenant_id: event.tenant_id,
      target_service_id: event.service_id,
      status: 'approved',
      criticality: 'critical',
    },
    { source_service_id: 1 },
  ).lean();

  if (upstreamEdges.length === 0) return;

  for (const edge of upstreamEdges) {
    const dependentId = edge.source_service_id.toString();
    const dependent = await Service.findOne({
      _id: dependentId,
      tenant_id: event.tenant_id,
      deleted_at: null,
    }).lean();
    if (!dependent) continue;

    // undefined = legacy doc that predates this field entirely (not yet
    // backfilled) — treat as 'manual', same as the backfill script does.
    // null = a fresh service that has never had its status explicitly set by
    // a human or the cascade engine — eligible for cascading, NOT the same
    // as 'manual'.
    const statusSource = dependent.status_source === undefined ? 'manual' : dependent.status_source;

    if (isDegrading) {
      // 'alert' is a trust boundary exactly like 'manual' — an alert rule set
      // this status directly, so the cascade must propagate past it (if
      // criticality allows) but never silently overwrite it.
      if (statusSource === 'manual' || statusSource === 'alert') continue;
      if (dependent.current_status === 'degraded') continue; // already there — no-op, chain stops here
      await updateServiceStatus(event.tenant_id, dependentId, 'degraded', 'cascaded', event.incident_id ?? undefined);

      // Append-only blast radius: once a service is touched by this incident's
      // cascade, it stays on the record for the incident's lifetime even if it
      // later recovers — this is a historical record, not a live snapshot.
      if (event.incident_id) {
        await Incident.updateOne(
          { _id: event.incident_id, tenant_id: event.tenant_id },
          { $addToSet: { affected_service_ids: dependentId } },
        );
      }
    } else {
      if (statusSource !== 'cascaded') continue; // never clear a manual or alert-sourced override
      if (dependent.current_status === 'operational') continue; // already clear

      const otherCriticalDeps = await ServiceDependency.find(
        {
          tenant_id: event.tenant_id,
          source_service_id: dependentId,
          status: 'approved',
          criticality: 'critical',
        },
        { target_service_id: 1 },
      ).lean();

      const depServices = await Service.find(
        { _id: { $in: otherCriticalDeps.map((d) => d.target_service_id) }, tenant_id: event.tenant_id, deleted_at: null },
        { current_status: 1 },
      ).lean();

      const stillUnhealthy = depServices.some((s) => s.current_status !== 'operational');
      if (stillUnhealthy) continue; // another critical dependency is still down — leave degraded

      await updateServiceStatus(event.tenant_id, dependentId, 'operational', 'cascaded', event.incident_id ?? undefined);
    }
  }
}

function scheduleHop(event: StatusChangedEvent): void {
  const key = `${event.tenant_id}:${event.service_id}`;
  const existing = pendingCascade.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingCascade.delete(key);
    handleSingleHop(event).catch((err: any) => {
      logger.error('Status cascade hop failed', { error: err.message, key });
    });
  }, DEBOUNCE_MS);

  pendingCascade.set(key, timer);
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data)) as StatusChangedEvent;

    if (msg.subject === 'icc.status.changed') {
      scheduleHop(data);
    } else {
      logger.debug('Status cascade worker: unhandled subject', { subject: msg.subject });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Status cascade worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(10_000);
  }
}

export async function startStatusCascadeWorker(): Promise<void> {
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
      logger.error('Status cascade worker loop error', { error: err.message });
    }
  });

  logger.info('Status cascade worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopStatusCascadeWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  for (const timer of pendingCascade.values()) clearTimeout(timer);
  pendingCascade.clear();
  logger.info('Status cascade worker stopped');
}
