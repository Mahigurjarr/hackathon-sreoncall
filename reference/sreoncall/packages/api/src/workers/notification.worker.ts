import {
  AckPolicy,
  DeliverPolicy,
  JsMsg,
  ConsumerMessages,
} from 'nats';
import { Types } from 'mongoose';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { Notification } from '../models/notification.model';
import { Ticket } from '../models/ticket.model';
import { User, UserDocument, NotificationPreferences } from '../models/user.model';
import { logger } from '../utils/logger';
import { withMsgTraceContext } from '../utils/nats-trace';
import { sendNotificationEmail } from '../services/email-notification.service';
import { sendSms } from '../services/sms.service';
import { makeVoiceCall, sendWhatsApp } from '../services/plivo.service';
import * as slackService from '../services/slack.service';
import { checkAndIncrementNotificationCount, checkAndIncrementMonthlyCounter } from '../services/notification.service';
import { TenantIntegration } from '../models/tenant-integration.model';
import { Tenant } from '../models/tenant.model';
import { decryptToken } from '../utils/encryption';

const CONSUMER_NAME = 'notification-delivery';
const STREAM_NAME = 'NOTIFICATIONS';
let consumer: ConsumerMessages | null = null;
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
      max_deliver: 3,
      ack_wait: 30_000_000_000, // 30s in nanoseconds
    });
    logger.info('Notification worker consumer created');
  }
}

async function processMessage(msg: JsMsg): Promise<void> {
  await withMsgTraceContext(msg, async () => {
  try {
    const data = JSON.parse(new TextDecoder().decode(msg.data));
    const { event, tenant_id, ticket_id, user_ids, notification_type, title, body } = data;

    if (notification_type === 'direct') {
      // Direct notification to specified users
      const docs = (user_ids || []).map((uid: string) => ({
        tenant_id: new Types.ObjectId(tenant_id),
        user_id: new Types.ObjectId(uid),
        type: event || 'general',
        title: title || 'Notification',
        body: body || '',
        resource_type: ticket_id ? 'ticket' : undefined,
        resource_id: ticket_id,
        read: false,
        created_at: new Date(),
      }));

      if (docs.length > 0) {
        await Notification.insertMany(docs);
      }
    } else if (event?.startsWith('tickets.')) {
      // Ticket event - notify watchers
      await handleTicketEvent(data);
    } else {
      logger.debug('Unhandled notification event', { event });
    }

    msg.ack();
  } catch (err: any) {
    logger.error('Notification worker failed to process message', {
      error: err.message,
      subject: msg.subject,
    });
    msg.nak(5000);
  }
  });
}

function isInQuietHours(prefs: NotificationPreferences): boolean {
  const qh = prefs.quiet_hours;
  if (!qh?.enabled) return false;

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: qh.timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const nowMinutes = hour * 60 + minute;

    const [startH, startM] = (qh.start || '22:00').split(':').map(Number);
    const [endH, endM] = (qh.end || '08:00').split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
    // Wraps midnight
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  } catch {
    return false;
  }
}

function shouldNotifyUser(prefs: NotificationPreferences, eventType: string, channel: string): boolean {
  // Check channel toggle (ticket, incident, oncall, system)
  const channelKey = eventType.startsWith('ticket') ? 'ticket'
    : eventType.startsWith('incident') ? 'incident'
    : eventType.startsWith('oncall') ? 'oncall'
    : 'system';
  if (!prefs.channels[channelKey as keyof typeof prefs.channels]) return false;

  // Check event-specific toggles
  if (eventType.includes('assigned') && !prefs.ticket_assigned) return false;
  if (eventType.includes('updated') && !prefs.ticket_updated) return false;
  if (eventType.includes('commented') && !prefs.ticket_commented) return false;
  if (eventType.includes('mention') && !prefs.mention) return false;
  if (eventType.includes('sla') && !prefs.sla_breach) return false;

  // Check channel type
  if (channel === 'in_app' && !prefs.in_app) return false;
  if (channel === 'email' && !prefs.email) return false;

  return true;
}

function formatTicketTimestamp(date?: Date | null): string {
  if (!date) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function formatTicketField(label: string, value?: string | null): string {
  return `${label}: ${value && value.trim() ? value.trim() : 'Not set'}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChangeValue(value?: string | null): string {
  return value && value.trim() ? value.trim() : 'Not set';
}

function renderTicketNotificationHtml(lines: string[], changes: Array<{ label: string; oldValue: string; newValue: string }>): string {
  const summaryHtml = lines
    .map((line) => `<p style="margin:0 0 14px; font-size:14px; color:#334155; line-height:1.7;">${escapeHtml(line)}</p>`)
    .join('');

  if (changes.length === 0) {
    return summaryHtml;
  }

  const changesHtml = changes
    .map((change) => `
      <tr>
        <td style="padding:10px 0; border-top:1px solid #E2E8F0;">
          <div style="font-size:12px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">${escapeHtml(change.label)}</div>
          <div style="font-size:14px; line-height:1.7; color:#0F172A;">
            <span style="color:#94A3B8; text-decoration:line-through;">${escapeHtml(formatChangeValue(change.oldValue))}</span>
            <span style="display:inline-block; margin:0 8px; color:#94A3B8;">&rarr;</span>
            <span>${escapeHtml(formatChangeValue(change.newValue))}</span>
          </div>
        </td>
      </tr>
    `)
    .join('');

  return `${summaryHtml}
    <div style="margin:18px 0 10px; font-size:14px; font-weight:700; color:#0F172A;">What changed</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${changesHtml}
    </table>`;
}

function getRefId(ref: unknown): string | null {
  if (!ref) return null;
  if (ref instanceof Types.ObjectId) return ref.toString();
  if (typeof ref === 'object' && ref !== null && '_id' in ref) {
    const value = (ref as { _id?: unknown })._id;
    if (value instanceof Types.ObjectId) return value.toString();
    if (typeof value === 'string' && value.trim()) return value;
  }
  if (typeof ref === 'string' && ref.trim()) return ref;
  return null;
}

function buildTicketNotificationContent(
  event: string,
  ticket: any,
  changes: Array<{ label: string; oldValue: string; newValue: string }> = [],
): { title: string; body: string; htmlBody?: string } {
  const eventTitleMap: Record<string, string> = {
    'tickets.created': 'New ticket created',
    'tickets.updated': 'Ticket updated',
    'tickets.deleted': 'Ticket deleted',
    'tickets.assigned': 'Ticket assigned',
    'tickets.commented': 'Ticket updated',
  };

  const subject = eventTitleMap[event] || 'Ticket updated';
  const projectName = ticket.project_id?.name || 'Unknown project';
  const projectKey = ticket.project_id?.key ? ` (${ticket.project_id.key})` : '';
  const reporterName = ticket.reporter_id?.name || 'Unknown reporter';
  const assigneeName = ticket.assignee_id?.name || 'Unassigned';
  const description = ticket.description?.trim() || 'No description provided.';
  const labels = Array.isArray(ticket.labels) && ticket.labels.length > 0 ? ticket.labels.join(', ') : 'None';

  const title = `${subject}: Ticket #${ticket.number}`;
  const summaryLines = [
    `A ticket event requires your attention.`,
    '',
    formatTicketField('Ticket', `#${ticket.number} - ${ticket.title}`),
    formatTicketField('Project', `${projectName}${projectKey}`),
    formatTicketField('Type', ticket.type?.replace(/_/g, ' ')),
    formatTicketField('Priority', ticket.priority),
    formatTicketField('Status', ticket.status?.replace(/_/g, ' ')),
    formatTicketField('Reporter', reporterName),
    formatTicketField('Assignee', assigneeName),
    formatTicketField('Created', formatTicketTimestamp(ticket.createdAt)),
    formatTicketField('Last updated', formatTicketTimestamp(ticket.updatedAt)),
    formatTicketField('Description', description),
    formatTicketField('Labels', labels),
  ];

  const lines = [...summaryLines];

  if (changes.length > 0) {
    lines.push('', 'What changed');
    for (const change of changes) {
      lines.push(`${change.label}: ${formatChangeValue(change.oldValue)} -> ${formatChangeValue(change.newValue)}`);
    }
  }

  const body = lines.join('\n');

  return { title, body, htmlBody: renderTicketNotificationHtml(summaryLines.filter((line) => line !== ''), changes) };
}

async function handleTicketEvent(data: any): Promise<void> {
  const { event, tenant_id, ticket_id, ticket_number, changes = [] } = data;

  if (!ticket_id) return;

  const ticket = await Ticket.findById(ticket_id)
    .populate('project_id', 'name key')
    .populate('reporter_id', 'name email')
    .populate('assignee_id', 'name email');
  if (!ticket) return;

  const watcherIds = ticket.watcher_ids || [];

  // Always collect assignee + reporter for mandatory email (regardless of prefs)
  const mandatoryEmailIds = new Set<string>();
  const assigneeId = getRefId(ticket.assignee_id);
  const reporterId = getRefId((ticket as any).reporter_id);
  if (assigneeId) mandatoryEmailIds.add(assigneeId);
  if (reporterId) mandatoryEmailIds.add(reporterId);

  if (watcherIds.length === 0 && mandatoryEmailIds.size === 0) return;

  const eventLabel = event === 'tickets.commented' ? 'commented on' : (event?.split('.').pop() || 'updated');
  const notificationTitle = `Ticket #${ticket_number || ticket.number} ${eventLabel}`;
  const notificationBody = `Ticket "${ticket.title}" has been ${eventLabel}.`;
  const eventType = `ticket.${eventLabel.replace(/\s+/g, '_')}`;
  const ticketEmail = buildTicketNotificationContent(event, ticket, changes);

  // Fetch all relevant users: watchers + assignee + reporter
  const allUserIds = [...new Set([...watcherIds.map((id: any) => id.toString()), ...mandatoryEmailIds])];
  const users = await User.find({ _id: { $in: allUserIds } });
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const inAppDocs: any[] = [];
  const emailRecipients: Array<{ user: UserDocument; title: string; body: string; htmlBody?: string; resourceUrl: string }> = [];
  const emailedUserIds = new Set<string>();

  for (const uid of watcherIds) {
    const user = userMap.get(uid.toString());
    if (!user) continue;

    const prefs = user.notification_preferences;

    // In-app: always allowed unless channel/event disabled
    if (shouldNotifyUser(prefs, eventType, 'in_app')) {
      inAppDocs.push({
        tenant_id: new Types.ObjectId(tenant_id),
        user_id: uid,
        type: eventType,
        title: notificationTitle,
        body: notificationBody,
        resource_type: 'ticket',
        resource_id: ticket_id,
        read: false,
        created_at: new Date(),
      });
    }

    // Email: only if preference enabled AND not in quiet hours
    if (shouldNotifyUser(prefs, eventType, 'email') && !isInQuietHours(prefs)) {
      emailRecipients.push({
        user,
        title: ticketEmail.title,
        body: ticketEmail.body,
        htmlBody: ticketEmail.htmlBody,
        resourceUrl: `/tickets/${ticket_id}`,
      });
      emailedUserIds.add(uid.toString());
    }
  }

  // Always email assignee + reporter regardless of their preferences
  for (const uid of mandatoryEmailIds) {
    if (emailedUserIds.has(uid)) continue; // already queued via watcher loop
    const user = userMap.get(uid);
    if (!user) continue;
    emailRecipients.push({
      user,
      title: ticketEmail.title,
      body: ticketEmail.body,
      htmlBody: ticketEmail.htmlBody,
      resourceUrl: `/tickets/${ticket_id}`,
    });
    emailedUserIds.add(uid);
  }

  if (inAppDocs.length > 0) {
    await Notification.insertMany(inAppDocs);
    logger.debug('Created ticket notifications', {
      ticketId: ticket_id,
      watcherCount: inAppDocs.length,
      event,
    });
  }

  // Check daily notification cap before sending outbound notifications
  const tenantObjectId = new Types.ObjectId(tenant_id);
  const notifAllowed = await checkAndIncrementNotificationCount(tenantObjectId).catch(() => true);
  if (!notifAllowed) {
    logger.warn('Outbound notifications suppressed: daily cap reached', { tenantId: tenant_id });
    return;
  }

  // Tenant-level overrides — when set, voice/SMS dispatch ignores per-user
  // notification_preferences and pages anyone with a phone_number.
  const tenantDoc = await Tenant.findById(tenantObjectId).select('notification_overrides').lean();
  const overrides = (tenantDoc as any)?.notification_overrides || {};
  const forceVoice: boolean = !!overrides.force_voice;
  const forceSms: boolean = !!overrides.force_sms;

  // Send emails (best-effort, don't block)
  for (const recipient of emailRecipients) {
    sendNotificationEmail(recipient.user.email, recipient.title, recipient.body, recipient.resourceUrl, tenant_id, recipient.htmlBody)
      .catch((err) => logger.error('Failed to send notification email', { error: err.message, email: recipient.user.email }));
  }

  // Ticket events are email-only — no voice/SMS/WhatsApp for tickets
  const isEmailOnlyEvent = event?.startsWith('tickets.');

  // Send SMS notifications (best-effort)
  for (const uid of watcherIds) {
    const user = userMap.get(uid.toString());
    if (!user) continue;
    const prefs = user.notification_preferences;
    if (!isEmailOnlyEvent && (prefs.sms || forceSms) && (user as any).phone_number && !isInQuietHours(prefs)) {
      const tenantOid = new Types.ObjectId(tenant_id);
      checkAndIncrementMonthlyCounter(tenantOid, 'sms_sent', 'max_sms_per_month').then(({ allowed }) => {
        if (!allowed) {
          logger.warn('SMS monthly limit reached — dropping notification', { tenantId: tenant_id });
          return;
        }
        sendSms((user as any).phone_number, `${notificationTitle}\n${notificationBody}`)
          .catch((err) => logger.error('Failed to send notification SMS', { error: err.message }));
      }).catch((err) => logger.error('SMS counter check failed', { error: err.message }));
    }
  }

  // Send voice call notifications (best-effort)
  for (const uid of watcherIds) {
    const user = userMap.get(uid.toString());
    if (!user) continue;
    const prefs = user.notification_preferences;
    if (!isEmailOnlyEvent && (prefs.voice || forceVoice) && (user as any).phone_number && !isInQuietHours(prefs)) {
      const tenantOid = new Types.ObjectId(tenant_id);
      checkAndIncrementMonthlyCounter(tenantOid, 'voice_calls', 'max_voice_per_month').then(({ allowed }) => {
        if (!allowed) {
          logger.warn('Voice monthly limit reached — dropping call', { tenantId: tenant_id });
          return;
        }
        makeVoiceCall(
          (user as any).phone_number,
          `${notificationTitle}. ${notificationBody}`,
          { incidentId: ticket_id || '', tenantId: tenant_id, userId: uid.toString() }
        ).catch((err) => logger.error('Failed to send notification voice call', { error: err.message }));
      }).catch((err) => logger.error('Voice counter check failed', { error: err.message }));
    }
  }

  // Send WhatsApp notifications (best-effort)
  for (const uid of watcherIds) {
    const user = userMap.get(uid.toString());
    if (!user) continue;
    const prefs = user.notification_preferences;
    if (!isEmailOnlyEvent && prefs.whatsapp && (user as any).phone_number && !isInQuietHours(prefs)) {
      const tenantOid = new Types.ObjectId(tenant_id);
      checkAndIncrementMonthlyCounter(tenantOid, 'whatsapp_sent', 'max_whatsapp_per_month').then(({ allowed }) => {
        if (!allowed) {
          logger.warn('WhatsApp monthly limit reached — dropping message', { tenantId: tenant_id });
          return;
        }
        sendWhatsApp((user as any).phone_number, `${notificationTitle}\n${notificationBody}`)
          .catch((err) => logger.error('Failed to send notification WhatsApp', { error: err.message }));
      }).catch((err) => logger.error('WhatsApp counter check failed', { error: err.message }));
    }
  }

  // Send Slack DM notifications (best-effort)
  const slackRecipients = Array.from(userMap.values()).filter((u) => {
    const prefs = u.notification_preferences;
    return (prefs as any).slack && shouldNotifyUser(prefs, eventType, 'in_app') && !isInQuietHours(prefs);
  });
  if (slackRecipients.length > 0) {
    try {
      // Get tenant Slack integration — use first user's tenant_id
      const integration = await TenantIntegration.findOne({
        tenant_id: ticket.tenant_id,
        platform: 'slack',
        is_active: true,
      });
      if (integration) {
        const token = decryptToken(integration.bot_token_encrypted);
        for (const user of slackRecipients) {
          slackService.sendDirectMessage(token, user.email, `${notificationTitle}\n${notificationBody}`)
            .catch((err) => logger.error('Failed to send Slack DM notification', { error: err.message, email: user.email }));
        }
      }
    } catch (err: any) {
      logger.error('Failed to load Slack integration for notifications', { error: err.message });
    }
  }
}

export async function startNotificationWorker(): Promise<void> {
  if (running) return;

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
      logger.error('Notification worker loop error', { error: err.message });
    }
  });

  logger.info('Notification worker started', { consumer: CONSUMER_NAME, stream: STREAM_NAME });
}

export async function stopNotificationWorker(): Promise<void> {
  running = false;
  if (consumer) {
    consumer.stop();
    consumer = null;
  }
  logger.info('Notification worker stopped');
}
