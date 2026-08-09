import { Types } from 'mongoose';
import { CommunicationChannel } from '../models/communication-channel.model';
import { Incident } from '../models/incident.model';
import { SlackInstallation } from '../models/slack-installation.model';
import { User } from '../models/user.model';
import * as incidentService from './incident.service';
import { logger } from '../utils/logger';

type SlackEventPayload = {
  team_id?: string;
  event?: any;
};

const ALERT_KEYWORDS = /\b(alert|firing|triggered|critical|warning|resolved|severity|sev[- ]?\d|monitor|alarm|degraded|unhealthy|outage)\b|labels:/i;
const ALERT_STATUS_PREFIX = /^\s*(resolved|firing)\s*:\s*/i;

function splitSlackLines(input: string | undefined): string[] {
  if (typeof input !== 'string') return [];
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractBlockTexts(blocks: any[] | undefined): string[] {
  if (!Array.isArray(blocks)) return [];
  const texts: string[] = [];

  for (const block of blocks) {
    if (block?.text?.text && typeof block.text.text === 'string') {
      texts.push(...splitSlackLines(block.text.text));
    }
    if (Array.isArray(block?.fields)) {
      for (const field of block.fields) {
        if (field?.text && typeof field.text === 'string') {
          texts.push(...splitSlackLines(field.text));
        }
      }
    }
    if (Array.isArray(block?.elements)) {
      for (const el of block.elements) {
        if (el?.text && typeof el.text === 'string') {
          texts.push(...splitSlackLines(el.text));
        }
      }
    }
  }

  return texts;
}

function normalizeText(input: string): string {
  return input
    .replace(/[*_`~]/g, '')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSlackLinks(input: string): Array<{ url: string; label: string }> {
  const links: Array<{ url: string; label: string }> = [];
  const regex = /<([^|>]+)\|([^>]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    links.push({ url: match[1] || '', label: match[2] || '' });
  }
  return links.filter((link) => link.url);
}

function parseSeverity(text: string): number {
  const lower = text.toLowerCase();
  if (/\bsev[- ]?1\b|\bcritical\b|\bp1\b/.test(lower)) return 1;
  if (/\bsev[- ]?2\b|\bhigh\b|\bp2\b/.test(lower)) return 2;
  if (/\bsev[- ]?4\b|\blow\b|\bp4\b/.test(lower)) return 4;
  if (/\bsev[- ]?5\b|\binfo\b|\bp5\b/.test(lower)) return 5;
  return 3;
}

function parseDescription(lines: string[]): string {
  return lines
    .filter(Boolean)
    .slice(0, 20)
    .join('\n')
    .slice(0, 50000);
}

type ParsedSlackAlert = {
  status: 'firing' | 'resolved';
  title: string;
  severity: number;
  severityLabel: string;
  labels: Record<string, string>;
  links: Record<string, string>;
  identityKey: string;
  description: string;
  incidentLabels: string[];
  provider: string;
};

function normalizeProviderName(senderName: string): string {
  return normalizeText(senderName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'slack';
}

function parseAlertStatus(firstLine: string): 'firing' | 'resolved' {
  const match = firstLine.match(ALERT_STATUS_PREFIX);
  if (!match) return 'firing';
  return String(match[1]).toLowerCase() === 'resolved' ? 'resolved' : 'firing';
}

function normalizeAlertName(firstLine: string): string {
  return firstLine.replace(ALERT_STATUS_PREFIX, '').trim();
}

function parseSlackAlert(lines: string[], rawLines: string[], senderName: string): ParsedSlackAlert {
  const firstLine = lines[0] || 'Slack alert';
  const status = parseAlertStatus(firstLine);

  const labels: Record<string, string> = {};
  let inLabelsSection = false;
  for (const line of lines) {
    if (/^labels:?$/i.test(line)) {
      inLabelsSection = true;
      continue;
    }
    if (!inLabelsSection) continue;
    const trimmed = line.replace(/^[\-•]\s*/, '').trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) labels[key] = value;
  }

  const allLinks = rawLines.flatMap((line) => extractSlackLinks(line));
  const links: Record<string, string> = {};
  for (const link of allLinks) {
    const key = normalizeText(link.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (key && !links[key]) links[key] = link.url;
  }

  const normalizedFirstLine = normalizeAlertName(firstLine);
  const alertName = labels.alertname || labels.monitor_name || normalizedFirstLine;
  const severityText = (labels.severity || '').toLowerCase();
  const severity = severityText ? parseSeverity(severityText) : parseSeverity(lines.join('\n'));
  const severityLabel = labels.severity || (severity === 1 ? 'critical' : severity === 2 ? 'high' : severity === 4 ? 'low' : severity === 5 ? 'info' : 'warning');
  const provider = normalizeProviderName(senderName);
  const identityParts = [
    labels.alertname || labels.monitor_name || alertName,
    labels.node || '',
    labels.cluster || '',
    labels.namespace || '',
    labels.instance || '',
    labels.pod || '',
  ].filter(Boolean);
  const identityKey = `${provider}|${identityParts.join('|').toLowerCase() || alertName.toLowerCase()}`;

  const incidentLabels = [
    'source:slack',
    `provider:${provider}`,
    `slack_alert_status:${status}`,
    `slack_alert_severity:${severityLabel.toLowerCase()}`,
    ...(labels.node ? [`slack_alert_node:${labels.node}`] : []),
    ...(labels.monitor_name ? [`slack_alert_monitor:${labels.monitor_name}`] : []),
  ];

  const descriptionSections = [
    firstLine,
    '',
    Object.keys(labels).length > 0
      ? [
          'Alert Labels:',
          ...Object.entries(labels).map(([key, value]) => `- ${key}=${value}`),
        ].join('\n')
      : '',
    Object.keys(links).length > 0
      ? [
          '',
          'Alert Links:',
          ...Object.entries(links).map(([key, value]) => `- ${key}: ${value}`),
        ].join('\n')
      : '',
  ].filter(Boolean);

  return {
    status,
    title: alertName.slice(0, 500),
    severity,
    severityLabel,
    labels,
    links,
    identityKey,
    description: parseDescription(descriptionSections),
    incidentLabels,
    provider,
  };
}

function isAlertMessage(event: any, normalizedLines: string[]): boolean {
  const messageContent = event?.subtype === 'message_changed' ? (event?.message ?? event) : event;
  const combined = normalizedLines.join('\n').toLowerCase();
  const fromBotOrApp = isBotOrAppMessage(event);
  const alertLike = ALERT_KEYWORDS.test(combined) || normalizedLines.some(line => /^labels:?$/i.test(line));
  return fromBotOrApp && alertLike;
}

function isBotOrAppMessage(event: any): boolean {
  const messageContent = event?.subtype === 'message_changed' ? (event?.message ?? event) : event;
  const fromBotOrApp = Boolean(
    messageContent?.bot_id ||
    messageContent?.app_id ||
    messageContent?.bot_profile ||
    event?.subtype === 'bot_message' ||
    event?.subtype === 'message_changed' ||
    messageContent?.username,
  );
  return fromBotOrApp;
}

async function resolveActorId(tenantId: Types.ObjectId, installation: any): Promise<Types.ObjectId> {
  if (installation?.installed_by_user_id) {
    return new Types.ObjectId(installation.installed_by_user_id.toString());
  }

  const fallbackUser = await User.findOne({
    tenant_id: tenantId,
    status: 'active',
    deleted_at: null,
  }).sort({ createdAt: 1 }).select('_id').lean();

  if (fallbackUser?._id) {
    return new Types.ObjectId(fallbackUser._id.toString());
  }

  return new Types.ObjectId('000000000000000000000000');
}

export async function ingestSlackAlertMessage(payload: SlackEventPayload): Promise<void> {
  const teamId = payload.team_id;
  const event = payload.event;

  if (!teamId || !event?.channel || !event?.ts) {
    logger.debug('Slack ingest: missing teamId/channel/ts', { teamId, channel: event?.channel, ts: event?.ts });
    return;
  }

  const installation = await SlackInstallation.findOne({
    team_id: teamId,
    is_active: true,
    deleted_at: null,
  }).lean();
  if (!installation) {
    logger.warn('Slack ingest: no active installation found', { teamId });
    return;
  }

  const tenantId = new Types.ObjectId(installation.consumer_tenant_id.toString());
  const linkedChannel = await CommunicationChannel.findOne({
    consumer_tenant_id: tenantId,
    platform: 'slack',
    external_channel_id: event.channel,
    channel_role: { $ne: 'notify_only' },
    is_active: true,
    deleted_at: null,
  }).lean();
  if (!linkedChannel) {
    logger.warn('Slack ingest: channel not linked', { teamId, channelId: event.channel, tenantId: tenantId.toString() });
    return;
  }
  // For message_changed events, Slack puts the updated content in event.message
  const messageContent = event.subtype === 'message_changed' ? (event.message ?? event) : event;
  const messageTs = messageContent.ts || event.ts;

  const senderName = String(messageContent?.bot_profile?.name || messageContent?.username || event?.bot_profile?.name || event?.username || 'Slack Alert');

  const rawLines = [
    ...splitSlackLines(messageContent.text),
    ...extractBlockTexts(messageContent.blocks),
    ...((messageContent.attachments || []).flatMap((attachment: any) => {
      const lines: string[] = [];
      if (typeof attachment?.text === 'string') lines.push(...splitSlackLines(attachment.text));
      if (typeof attachment?.fallback === 'string') lines.push(...splitSlackLines(attachment.fallback));
      if (Array.isArray(attachment?.blocks)) lines.push(...extractBlockTexts(attachment.blocks));
      return lines;
    })),
  ];

  let normalizedLines = rawLines.map(normalizeText).filter(Boolean);
  const botOrAppMessage = isBotOrAppMessage(event);
  const shouldForceCreateForLinkedWebhook = botOrAppMessage;

  if (!normalizedLines.length && shouldForceCreateForLinkedWebhook) {
    normalizedLines = [`Webhook alert from ${senderName}`];
  }

  if (!normalizedLines.length) {
    logger.warn('Slack ingest: no text extracted from message', { teamId, channelId: event.channel, botId: messageContent.bot_id, subtype: event.subtype, hasBlocks: !!messageContent.blocks, hasAttachments: !!messageContent.attachments?.length });
    return;
  }

  if (!isAlertMessage(event, normalizedLines) && !shouldForceCreateForLinkedWebhook) {
    logger.debug('Slack ingest: message not recognised as alert', { teamId, channelId: event.channel, botId: event.bot_id, preview: normalizedLines[0]?.slice(0, 80) });
    return;
  }

  if (senderName.toLowerCase().includes('sreoncall')) {
    logger.debug('Slack ingest: ignoring message from sreoncall bot', { senderName });
    return;
  }

  const existing = await Incident.findOne({
    tenant_id: tenantId,
    'custom_fields.slack_origin.team_id': teamId,
    'custom_fields.slack_origin.channel_id': event.channel,
    'custom_fields.slack_origin.message_ts': messageTs,
  }).select('_id').lean();
  if (existing) {
    logger.debug('Slack ingest: duplicate message, skipping', { teamId, channelId: event.channel, ts: messageTs });
    return;
  }

  const actorId = await resolveActorId(tenantId, installation);
  const parsed = parseSlackAlert(normalizedLines, rawLines, senderName);

  if (parsed.status === 'resolved') {
    const existingOpen = await Incident.findOne({
      tenant_id: tenantId,
      status: { $nin: ['resolved', 'closed'] },
      $or: [
        { 'custom_fields.slack_alert.identity_key': parsed.identityKey },
        { 'custom_fields.groundcover_alert.identity_key': parsed.identityKey },
      ],
    }).select('_id');

    if (existingOpen) {
      await incidentService.resolveIncident(
        tenantId,
        existingOpen._id.toString(),
        actorId,
        `Resolved automatically from Slack alert: ${parsed.title}`
      );
      await Incident.updateOne(
        { _id: existingOpen._id },
        {
          $set: {
            source_consumer_tenant_id: tenantId,
            custom_fields: {
              slack_alert: {
                status: parsed.status,
                title: parsed.title,
                severity: parsed.severityLabel,
                labels: parsed.labels,
                links: parsed.links,
                identity_key: parsed.identityKey,
                raw_text: normalizedLines.join('\n'),
                provider: parsed.provider,
              },
              slack_origin: {
                team_id: teamId,
                channel_id: event.channel,
                message_ts: messageTs,
                provider: parsed.provider,
                bot_name: senderName,
                event_type: event.subtype || event.type || 'message',
              },
            },
          },
        }
      );
      logger.info('Resolved incident from Slack alert message', {
        incidentId: existingOpen._id.toString(),
        tenantId: tenantId.toString(),
        identityKey: parsed.identityKey,
        provider: parsed.provider,
      });
    }
    return;
  }

  const incident = await incidentService.createIncident({
    tenant_id: tenantId,
    created_by: actorId,
    title: parsed.title,
    description: parsed.description,
    severity: parsed.severity,
    type: 'reliability',
    source: 'webhook',
    labels: parsed.incidentLabels,
    custom_fields: {
      slack_alert: {
        status: parsed.status,
        title: parsed.title,
        severity: parsed.severityLabel,
        labels: parsed.labels,
        links: parsed.links,
        identity_key: parsed.identityKey,
        raw_text: normalizedLines.join('\n'),
        provider: parsed.provider,
      },
      slack_origin: {
        team_id: teamId,
        channel_id: event.channel,
        message_ts: messageTs,
        provider: parsed.provider,
        bot_name: senderName,
        event_type: event.subtype || event.type || 'message',
      },
    },
  });

  await Incident.updateOne({ _id: incident._id }, { $set: { source_consumer_tenant_id: tenantId } });

  logger.info('Auto-created incident from Slack alert message', {
    incidentId: incident._id.toString(),
    tenantId: tenantId.toString(),
    teamId,
    channelId: event.channel,
    messageTs: event.ts,
    identityKey: parsed.identityKey,
    provider: parsed.provider,
  });
}
