import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { IncidentBridge } from '../models/incident-bridge.model';
import { TicketBridge } from '../models/ticket-bridge.model';
import { ChangeRequestBridge } from '../models/change-request-bridge.model';
import { Incident } from '../models/incident.model';
import { Ticket } from '../models/ticket.model';
import { ChangeRequest } from '../models/change-request.model';
import { logger } from '../utils/logger';

const CONSUMER_NAME = 'bridge-sync';
const STREAM_NAME = 'BRIDGES';
let consumer: ConsumerMessages | null = null;
let running = false;

// Track processed event IDs for dedup
const processedEvents = new Set<string>();
const MAX_DEDUP_SIZE = 10_000;

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();
  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      max_deliver: 5,
      ack_wait: 30_000_000_000,
    });
    logger.info('Bridge worker consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { bridge_id, bridge_type, action, event_id, data: eventData } = data;

    // Dedup by event_id
    if (event_id && processedEvents.has(event_id)) {
      msg.ack();
      return;
    }

    const subject = msg.subject;

    if (bridge_type === 'ticket') {
      await processTicketBridge(bridge_id, subject, action, eventData);
    } else if (bridge_type === 'change') {
      await processChangeBridge(bridge_id, subject, action, eventData);
    } else {
      // Default: incident bridge (backwards compatible)
      await processIncidentBridge(bridge_id, subject, action, eventData);
    }

    // Track processed event
    if (event_id) {
      processedEvents.add(event_id);
      if (processedEvents.size > MAX_DEDUP_SIZE) {
        const entries = [...processedEvents];
        for (let i = 0; i < MAX_DEDUP_SIZE / 2; i++) {
          processedEvents.delete(entries[i]);
        }
      }
    }

    msg.ack();
  } catch (err) {
    logger.error('Bridge worker error', { error: (err as Error).message, subject: msg.subject });
    msg.nak();
  }
}

// ─── Incident bridge processing (existing logic) ─────────────────────────────

async function processIncidentBridge(bridgeId: string, subject: string, action: string, eventData: any): Promise<void> {
  const bridge = await IncidentBridge.findById(bridgeId);
  if (!bridge || bridge.status !== 'active') return;

  if (subject === 'bridges.sync.to_provider') {
    await handleIncidentSyncToProvider(bridge, action, eventData);
  } else if (subject === 'bridges.sync.to_consumer') {
    await handleIncidentSyncToConsumer(bridge, action, eventData);
  }
}

async function handleIncidentSyncToProvider(bridge: any, action: string, data: any): Promise<void> {
  const providerIncident = await Incident.findOne({
    _id: bridge.provider_incident_id,
    tenant_id: bridge.provider_tenant_id,
  });
  if (!providerIncident) return;

  providerIncident.timeline.push({
    _id: new Types.ObjectId(),
    timestamp: new Date(),
    type: 'bridge_sync',
    actor_id: null,
    message: `Synced from consumer: ${action}`,
    metadata: {
      bridge_id: bridge._id.toString(),
      action,
      source: 'consumer',
      ...data,
    },
  } as any);

  if (action === 'resolve' && providerIncident.status !== 'resolved') {
    providerIncident.status = 'resolved';
    providerIncident.resolved_at = new Date();
    await providerIncident.save();
    const { notifyIncidentSlack } = await import('../services/incident-slack.service');
    notifyIncidentSlack(bridge.provider_tenant_id, providerIncident, 'resolved').catch((err) =>
      logger.error('Failed to notify provider Slack on bridge resolve', { error: (err as Error).message }),
    );
  } else {
    await providerIncident.save();
  }
}

async function handleIncidentSyncToConsumer(bridge: any, action: string, data: any): Promise<void> {
  const consumerIncident = await Incident.findOne({
    _id: bridge.consumer_incident_id,
    tenant_id: bridge.consumer_tenant_id,
  });
  if (!consumerIncident) return;

  consumerIncident.timeline.push({
    _id: new Types.ObjectId(),
    timestamp: new Date(),
    type: 'bridge_sync',
    actor_id: null,
    message: `Synced from provider: ${action}`,
    metadata: {
      bridge_id: bridge._id.toString(),
      action,
      source: 'provider',
      ...data,
    },
  } as any);

  if (action === 'resolve' && consumerIncident.status !== 'resolved') {
    consumerIncident.status = 'resolved';
    consumerIncident.resolved_at = new Date();
    bridge.status = 'resolved';
    bridge.resolved_at = new Date();
    await bridge.save();
    await consumerIncident.save();
    const { notifyIncidentSlack } = await import('../services/incident-slack.service');
    notifyIncidentSlack(bridge.consumer_tenant_id, consumerIncident, 'resolved').catch((err) =>
      logger.error('Failed to notify consumer Slack on bridge resolve', { error: (err as Error).message }),
    );
  } else if (action === 'acknowledge' && consumerIncident.status === 'open') {
    // Provider acknowledged → mark consumer incident acknowledged too
    const now = new Date();
    consumerIncident.status = 'acknowledged';
    consumerIncident.metrics = {
      ...consumerIncident.metrics,
      ack_at: now,
      mtta_seconds: Math.floor((now.getTime() - (consumerIncident as any).createdAt.getTime()) / 1000),
    };
    await consumerIncident.save();
    const { notifyIncidentSlack } = await import('../services/incident-slack.service');
    notifyIncidentSlack(bridge.consumer_tenant_id, consumerIncident, 'acknowledged').catch((err) =>
      logger.error('Failed to notify consumer Slack on bridge acknowledge', { error: (err as Error).message }),
    );
  } else {
    await consumerIncident.save();
  }
}

// ─── Ticket bridge processing ─────────────────────────────────────────────────

async function processTicketBridge(bridgeId: string, subject: string, action: string, eventData: any): Promise<void> {
  const bridge = await TicketBridge.findById(bridgeId);
  if (!bridge || bridge.status === 'closed') return;

  if (subject === 'bridges.sync.to_provider') {
    await handleTicketSyncToProvider(bridge, action, eventData);
  } else if (subject === 'bridges.sync.to_consumer') {
    await handleTicketSyncToConsumer(bridge, action, eventData);
  }
}

async function handleTicketSyncToProvider(bridge: any, action: string, data: any): Promise<void> {
  if (action === 'work_log_created' && data) {
    const { WorkLog } = await import('../models/work-log.model');
    const existing = await WorkLog.findOne({
      tenant_id: bridge.provider_tenant_id,
      source_work_log_id: new Types.ObjectId(data.work_log_id),
    });
    if (!existing) {
      const loggedAt = data.logged_at ? new Date(data.logged_at) : new Date();
      const log = await WorkLog.create({
        tenant_id: bridge.provider_tenant_id,
        entity_type: 'ticket',
        entity_id: bridge.provider_ticket_id,
        user_id: new Types.ObjectId('000000000000000000000000'),
        duration_minutes: data.duration_minutes,
        description: data.description || '',
        logged_at: loggedAt,
        status: data.status || 'pending',
        source: 'provider',
        source_tenant_id: bridge.consumer_tenant_id,
        source_work_log_id: new Types.ObjectId(data.work_log_id),
        source_user_name: data.user_name || 'Consumer User',
        billable: true,
      });
      // Keep embedded ticket.work_logs in sync
      await Ticket.findOneAndUpdate(
        { _id: bridge.provider_ticket_id, tenant_id: bridge.provider_tenant_id },
        {
          $push: { work_logs: { _id: log._id, user_id: log.user_id, minutes: data.duration_minutes, description: data.description || '', logged_at: loggedAt } },
          $inc: { time_spent_minutes: data.duration_minutes },
        }
      );
    }
    return;
  }

  const providerTicket = await Ticket.findOne({
    _id: bridge.provider_ticket_id,
    tenant_id: bridge.provider_tenant_id,
  });
  if (!providerTicket) return;

  if (action === 'status_change' && data?.status) {
    providerTicket.status = data.status;
  }

  if (action === 'resolve') {
    providerTicket.status = 'done';
    providerTicket.resolved_at = new Date();
    bridge.status = 'resolved';
    bridge.resolved_at = new Date();
    await bridge.save();
  }

  await providerTicket.save();
}

async function handleTicketSyncToConsumer(bridge: any, action: string, data: any): Promise<void> {
  if (action === 'work_log_created' && data) {
    const { WorkLog } = await import('../models/work-log.model');
    const existing = await WorkLog.findOne({
      tenant_id: bridge.consumer_tenant_id,
      source_work_log_id: new Types.ObjectId(data.work_log_id),
    });
    if (!existing) {
      const loggedAt = data.logged_at ? new Date(data.logged_at) : new Date();
      const log = await WorkLog.create({
        tenant_id: bridge.consumer_tenant_id,
        entity_type: 'ticket',
        entity_id: bridge.consumer_ticket_id,
        user_id: new Types.ObjectId('000000000000000000000000'),
        duration_minutes: data.duration_minutes,
        description: data.description || '',
        logged_at: loggedAt,
        status: data.status || 'pending',
        source: 'provider',
        source_tenant_id: bridge.provider_tenant_id,
        source_work_log_id: new Types.ObjectId(data.work_log_id),
        source_user_name: data.user_name || 'Provider User',
        billable: true,
      });
      // Keep embedded ticket.work_logs in sync
      await Ticket.findOneAndUpdate(
        { _id: bridge.consumer_ticket_id, tenant_id: bridge.consumer_tenant_id },
        {
          $push: { work_logs: { _id: log._id, user_id: log.user_id, minutes: data.duration_minutes, description: data.description || '', logged_at: loggedAt } },
          $inc: { time_spent_minutes: data.duration_minutes },
        }
      );
    }
    return;
  }

  if (action === 'work_log_approved' && data?.work_log_id) {
    const { WorkLog } = await import('../models/work-log.model');
    await WorkLog.findOneAndUpdate(
      {
        tenant_id: bridge.consumer_tenant_id,
        source_work_log_id: new Types.ObjectId(data.work_log_id),
      },
      { $set: { status: 'approved', approved_at: new Date() } },
    );
    return;
  }

  const consumerTicket = await Ticket.findOne({
    _id: bridge.consumer_ticket_id,
    tenant_id: bridge.consumer_tenant_id,
  });
  if (!consumerTicket) return;

  if (action === 'status_change' && data?.status) {
    consumerTicket.status = data.status;
  }

  if (action === 'resolve') {
    consumerTicket.status = 'done';
    consumerTicket.resolved_at = new Date();
    bridge.status = 'resolved';
    bridge.resolved_at = new Date();
    await bridge.save();
  }

  await consumerTicket.save();
}

// ─── Change request bridge processing ─────────────────────────────────────────

async function processChangeBridge(bridgeId: string, subject: string, action: string, eventData: any): Promise<void> {
  const bridge = await ChangeRequestBridge.findById(bridgeId);
  if (!bridge || bridge.status === 'closed') return;

  if (subject === 'bridges.sync.to_provider') {
    await handleChangeSyncToProvider(bridge, action, eventData);
  } else if (subject === 'bridges.sync.to_consumer') {
    await handleChangeSyncToConsumer(bridge, action, eventData);
  }
}

async function handleChangeSyncToProvider(bridge: any, action: string, data: any): Promise<void> {
  const providerChange = await ChangeRequest.findOne({
    _id: bridge.provider_change_id,
    tenant_id: bridge.provider_tenant_id,
  });
  if (!providerChange) return;

  if (action === 'status_change' && data?.status) {
    providerChange.status = data.status;
  }

  if (action === 'complete') {
    providerChange.status = 'completed';
    providerChange.completed_at = new Date();
    bridge.status = 'resolved';
    bridge.resolved_at = new Date();
    await bridge.save();
  }

  await providerChange.save();
}

async function handleChangeSyncToConsumer(bridge: any, action: string, data: any): Promise<void> {
  const consumerChange = await ChangeRequest.findOne({
    _id: bridge.consumer_change_id,
    tenant_id: bridge.consumer_tenant_id,
  });
  if (!consumerChange) return;

  if (action === 'status_change' && data?.status) {
    consumerChange.status = data.status;
  }

  if (action === 'complete') {
    consumerChange.status = 'completed';
    consumerChange.completed_at = new Date();
    bridge.status = 'resolved';
    bridge.resolved_at = new Date();
    await bridge.save();
  }

  await consumerChange.save();
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

export async function startBridgeWorker(): Promise<void> {
  if (running) return;

  await ensureConsumer();
  const js = getJetStream();

  consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME) as any;
  running = true;

  (async () => {
    const messages = await (consumer as any).consume();
    for await (const msg of messages) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    logger.error('Bridge worker loop error', { error: err.message });
    running = false;
  });

  logger.info('Bridge worker started');
}

export async function stopBridgeWorker(): Promise<void> {
  running = false;
  consumer = null;
  logger.info('Bridge worker stopped');
}
