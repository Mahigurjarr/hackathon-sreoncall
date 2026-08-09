import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
  StringCodec,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { StatusPage } from '../models/status-page.model';
import { StatusUpdate } from '../models/status-update.model';
import {
  StatusPageSubscriber,
} from '../models/status-page-subscriber.model';
import { WebhookDelivery } from '../models/webhook-delivery.model';
import { sendStatusUpdateEmail } from '../services/email.service';
import { sendSms } from '../services/plivo.service';
import { deliverWebhook } from '../services/webhook-delivery.service';
import { logger } from '../utils/logger';

const sc = StringCodec();
const CONSUMER_NAME = 'status-page-notify';
const INCIDENT_CONSUMER_NAME = 'status-page-incident-sync';
const STREAM_NAME = 'STATUS_PAGES';
const BATCH_SIZE = 10;

let consumer: ConsumerMessages | null = null;
let incidentConsumer: ConsumerMessages | null = null;
let running = false;

async function ensureConsumer(): Promise<void> {
  const jsm = getJetStreamManager();

  try {
    await jsm.consumers.info(STREAM_NAME, CONSUMER_NAME);
  } catch {
    await jsm.consumers.add(STREAM_NAME, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      filter_subject: 'status-pages.notify-subscribers',
      max_deliver: 3,
      ack_wait: 60_000_000_000, // 60s — notifications can take time
    });
    logger.info('Status page notification consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { status_page_id, status_update_id } = data;

    if (!status_page_id || !status_update_id) {
      logger.warn('Status page notification missing required fields', data);
      msg.ack();
      return;
    }

    const page = await StatusPage.findById(status_page_id);
    const update = await StatusUpdate.findById(status_update_id);

    if (!page || !update) {
      logger.warn('Status page or update not found for notification', {
        status_page_id,
        status_update_id,
      });
      msg.ack();
      return;
    }

    if (update.visibility !== 'public') {
      msg.ack();
      return;
    }

    const subscribers = await StatusPageSubscriber.find({
      status_page_id: page._id,
      confirmed: true,
    });

    if (subscribers.length === 0) {
      msg.ack();
      return;
    }

    const emailSubs = subscribers.filter((s) => s.channel === 'email' && s.email);
    const smsSubs = subscribers.filter((s) => s.channel === 'sms' && s.phone);
    const webhookSubs = subscribers.filter((s) => s.channel === 'webhook' && s.webhook_url);

    const affectedComponents = update.affected_components.map((c) => ({
      name: c.name,
      status_after: c.status_after,
    }));

    // Email notifications
    for (let i = 0; i < emailSubs.length; i += BATCH_SIZE) {
      const batch = emailSubs.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((sub) =>
          sendStatusUpdateEmail({
            to: sub.email,
            pageName: page.name,
            slug: page.slug,
            updateTitle: update.title,
            updateBody: update.body,
            updateStatus: update.status,
            affectedComponents,
            unsubscribeToken: sub.unsubscribe_token,
          })
        )
      );
    }

    // SMS notifications
    if (smsSubs.length > 0) {
      const smsBody = `[${page.name}] ${update.title} — Status: ${update.status}${
        update.body ? `\n${update.body.slice(0, 300)}` : ''
      }`;
      for (let i = 0; i < smsSubs.length; i += BATCH_SIZE) {
        const batch = smsSubs.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((sub) => sendSms(sub.phone!, smsBody))
        );
      }
    }

    // Webhook notifications
    if (webhookSubs.length > 0) {
      const webhookPayload = {
        event: 'status_update.created',
        status_page: { slug: page.slug, name: page.name },
        update: {
          id: update._id.toString(),
          title: update.title,
          body: update.body,
          status: update.status,
          affected_components: affectedComponents,
          created_at: update.created_at,
        },
      };

      for (let i = 0; i < webhookSubs.length; i += BATCH_SIZE) {
        const batch = webhookSubs.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (sub) => {
            const delivery = await WebhookDelivery.create({
              tenant_id: page.tenant_id,
              webhook_id: sub._id,
              event_type: 'status_update.created',
              payload: webhookPayload,
            });
            await deliverWebhook(delivery, sub.webhook_url!, sub.unsubscribe_token);
          })
        );
      }
    }

    logger.info('Status page subscribers notified', {
      pageSlug: page.slug,
      updateId: update._id.toString(),
      email: emailSubs.length,
      sms: smsSubs.length,
      webhook: webhookSubs.length,
    });

    msg.ack();
  } catch (err: any) {
    logger.error('Status page notification worker failed', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(5000);
  }
}

// ─── Incident → Status Page Auto-Sync ────────────────────────────────────────

const SEVERITY_STATUS_MAP: Record<number, string> = {
  1: 'major_outage',
  2: 'major_outage',
  3: 'partial_outage',
  4: 'degraded',
  5: 'degraded',
};

const INCIDENT_STATUS_MAP: Record<string, string> = {
  created: 'investigating',
  ack: 'identified',
  resolved: 'resolved',
};

async function processIncidentMessage(msg: JsMsg): Promise<void> {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { tenant_id, incident_id, title, severity, status, affected_service_ids } = data;

    if (!tenant_id || !incident_id || !affected_service_ids?.length) {
      msg.ack();
      return;
    }

    const serviceOids = affected_service_ids.map((id: string) => new Types.ObjectId(id));

    // Find status pages that reference any of the affected services
    const pages = await StatusPage.find({
      tenant_id: new Types.ObjectId(tenant_id),
      'settings.display_options.selected_service_ids': { $in: serviceOids },
      is_public: true,
    });

    if (pages.length === 0) {
      msg.ack();
      return;
    }

    const eventType = msg.subject.split('.').slice(1).join('.'); // e.g. "created", "resolved"
    const updateStatus = INCIDENT_STATUS_MAP[eventType] || 'investigating';
    const componentStatus = eventType === 'resolved' ? 'operational' : (SEVERITY_STATUS_MAP[severity] || 'degraded');

    for (const page of pages) {
      // Build affected components list from service IDs that match this page
      const pageServiceIds = (page.settings?.display_options?.selected_service_ids || [])
        .map((id: Types.ObjectId) => id.toString());
      const matchedServiceIds = affected_service_ids.filter(
        (id: string) => pageServiceIds.includes(id)
      );

      if (matchedServiceIds.length === 0) continue;

      // Look up service names
      const Service = (await import('mongoose')).default.model('Service');
      const services = await Service.find({ _id: { $in: matchedServiceIds } }).select('name').lean();

      const affectedComponents = services.map((svc: any) => ({
        component_id: svc._id,
        name: svc.name,
        status_before: '',
        status_after: componentStatus,
      }));

      const updateTitle = eventType === 'resolved'
        ? `Resolved: ${title}`
        : `Incident: ${title}`;

      const update = await StatusUpdate.create({
        tenant_id: new Types.ObjectId(tenant_id),
        status_page_id: page._id,
        title: updateTitle,
        body: `Auto-generated from incident. Severity: ${severity || 'N/A'}`,
        status: updateStatus,
        visibility: 'public',
        affected_components: affectedComponents,
        created_by: data.created_by ? new Types.ObjectId(data.created_by) : undefined,
        notify_subscribers: true,
      });

      // Trigger subscriber notification
      try {
        const js = getJetStream();
        await js.publish(
          'status-pages.notify-subscribers',
          sc.encode(
            JSON.stringify({
              status_page_id: page._id.toString(),
              status_update_id: update._id.toString(),
              timestamp: new Date().toISOString(),
            })
          )
        );
      } catch (pubErr: any) {
        logger.error('Failed to publish status page notification for incident sync', {
          error: pubErr.message,
        });
      }

      logger.info('Auto-synced incident to status page', {
        incidentId: incident_id,
        pageSlug: page.slug,
        updateId: update._id.toString(),
        event: eventType,
      });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Incident sync to status page failed', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(5000);
  }
}

// ─── Worker lifecycle ────────────────────────────────────────────────────────

export async function startStatusPageNotificationWorker(): Promise<void> {
  if (running) return;

  await ensureConsumer();

  // Also ensure incident sync consumer
  const jsm = getJetStreamManager();
  try {
    await jsm.consumers.info('INCIDENTS', INCIDENT_CONSUMER_NAME);
  } catch {
    await jsm.consumers.add('INCIDENTS', {
      durable_name: INCIDENT_CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      filter_subject: 'incidents.>',
      max_deliver: 3,
      ack_wait: 30_000_000_000,
    });
    logger.info('Status page incident sync consumer created');
  }

  const js = getJetStream();
  running = true;

  // Notification consumer
  const c = await js.consumers.get(STREAM_NAME, CONSUMER_NAME);
  consumer = await c.consume();
  (async () => {
    for await (const msg of consumer!) {
      if (!running) break;
      await processMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Status page notification consumer error', { error: err.message });
    }
  });

  // Incident sync consumer
  const ic = await js.consumers.get('INCIDENTS', INCIDENT_CONSUMER_NAME);
  incidentConsumer = await ic.consume();
  (async () => {
    for await (const msg of incidentConsumer!) {
      if (!running) break;
      await processIncidentMessage(msg);
    }
  })().catch((err) => {
    if (running) {
      logger.error('Status page incident sync consumer error', { error: err.message });
    }
  });

  logger.info('Status page notification worker started');
}

export async function stopStatusPageNotificationWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  if (incidentConsumer) {
    incidentConsumer.stop();
    incidentConsumer = null;
  }
  logger.info('Status page notification worker stopped');
}
