import { Types } from 'mongoose';
import { StringCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import { StatusPage, StatusPageDocument } from '../models/status-page.model';
import { StatusUpdate, StatusUpdateDocument } from '../models/status-update.model';
import {
  StatusPageSubscriber,
  StatusPageSubscriberDocument,
} from '../models/status-page-subscriber.model';
import { sendSubscriptionConfirmEmail } from './email.service';
import { getJetStream } from '../config/nats';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler.middleware';

const sc = StringCodec();

// ─── Status Pages ───────────────────────────────────────────────────────────

export async function listStatusPages(tenantId: Types.ObjectId): Promise<StatusPageDocument[]> {
  return StatusPage.find({ tenant_id: tenantId }).sort({ created_at: -1 });
}

export async function getStatusPageById(
  tenantId: Types.ObjectId,
  id: string
): Promise<StatusPageDocument> {
  const page = await StatusPage.findOne({ _id: id, tenant_id: tenantId });
  if (!page) throw AppError.notFound('Status page');
  return page;
}

export async function getPublicStatusPage(
  slug: string,
  viewerEmail?: string
): Promise<StatusPageDocument> {
  // Try public page first
  let page = await StatusPage.findOne({ slug, is_public: true });
  if (page) return page;

  // Try private page with allowed viewer email or domain
  if (viewerEmail) {
    page = await StatusPage.findOne({ slug, is_public: false });
    if (page) {
      const emailLower = viewerEmail.toLowerCase();
      const emailDomain = emailLower.split('@')[1];
      const ac = page.settings?.access_control;

      // Check exact email match
      const emailMatch = ac?.allowed_viewer_emails?.some(
        (e: string) => e.toLowerCase() === emailLower
      );

      // Check domain match (e.g., "thepackengers.com" allows all @thepackengers.com)
      const domainMatch = emailDomain && ac?.allowed_viewer_domains?.some(
        (d: string) => d.toLowerCase() === emailDomain
      );

      if (emailMatch || domainMatch) {
        return page;
      }
    }
  }

  throw AppError.notFound('Status page');
}

export async function createStatusPage(input: {
  tenant_id: Types.ObjectId;
  slug: string;
  name: string;
  description?: string;
  is_public?: boolean;
  components?: Array<{ name: string; description?: string; status?: string }>;
  settings?: Record<string, any>;
  custom_announcement?: Record<string, any>;
}): Promise<StatusPageDocument> {
  const doc: Record<string, any> = {
    tenant_id: input.tenant_id,
    slug: input.slug,
    name: input.name,
    description: input.description || '',
    is_public: input.is_public !== false,
    components: (input.components || []).map((c) => ({
      name: c.name,
      description: c.description || '',
      status: c.status || 'operational',
    })),
  };
  if (input.settings) doc.settings = input.settings;
  if (input.custom_announcement) doc.custom_announcement = input.custom_announcement;
  return StatusPage.create(doc);
}

export async function updateStatusPage(
  tenantId: Types.ObjectId,
  id: string,
  update: Record<string, any>
): Promise<StatusPageDocument> {
  const page = await StatusPage.findOne({ _id: id, tenant_id: tenantId });
  if (!page) throw AppError.notFound('Status page');

  // Deep-merge settings so partial updates don't clobber existing fields
  if (update.settings) {
    const raw = (page as any).settings;
    const existing = typeof raw?.toObject === 'function' ? raw.toObject() : raw ?? {};
    const merged: Record<string, any> = { ...existing };
    for (const [key, val] of Object.entries(update.settings)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        merged[key] = { ...(existing[key] || {}), ...val };
      } else {
        merged[key] = val;
      }
    }
    page.set('settings', merged);
    delete update.settings;
  }

  if (update.custom_announcement) {
    const raw = (page as any).custom_announcement;
    const existing = typeof raw?.toObject === 'function' ? raw.toObject() : raw ?? {};
    page.set('custom_announcement', { ...existing, ...update.custom_announcement });
    delete update.custom_announcement;
  }

  // Apply remaining top-level fields
  for (const [key, val] of Object.entries(update)) {
    (page as any)[key] = val;
  }

  await page.save();
  return page;
}

export async function deleteStatusPage(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await StatusPage.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0)
    throw AppError.notFound('Status page');

  // Cascade: remove associated updates and subscribers
  await Promise.all([
    StatusUpdate.deleteMany({ status_page_id: id, tenant_id: tenantId }),
    StatusPageSubscriber.deleteMany({ status_page_id: id, tenant_id: tenantId }),
  ]);
}

// ─── Status Updates ─────────────────────────────────────────────────────────

export async function listStatusUpdates(
  tenantId: Types.ObjectId,
  statusPageId: string,
  opts: { limit?: number; skip?: number } = {}
): Promise<StatusUpdateDocument[]> {
  // Ensure page belongs to tenant
  await getStatusPageById(tenantId, statusPageId);
  return StatusUpdate.find({ status_page_id: statusPageId, tenant_id: tenantId })
    .sort({ created_at: -1 })
    .skip(opts.skip || 0)
    .limit(opts.limit || 50);
}

export async function createStatusUpdate(
  tenantId: Types.ObjectId,
  statusPageId: string,
  userId: Types.ObjectId,
  input: {
    title: string;
    body?: string;
    status: string;
    visibility?: string;
    affected_components?: Array<{
      component_id: string;
      name: string;
      status_before?: string;
      status_after?: string;
    }>;
    notify_subscribers?: boolean;
  }
): Promise<StatusUpdateDocument> {
  const page = await getStatusPageById(tenantId, statusPageId);

  const update = await StatusUpdate.create({
    tenant_id: tenantId,
    status_page_id: statusPageId,
    title: input.title,
    body: input.body || '',
    status: input.status,
    visibility: input.visibility || 'public',
    affected_components: (input.affected_components || []).map((c) => ({
      component_id: new Types.ObjectId(c.component_id),
      name: c.name,
      status_before: c.status_before || '',
      status_after: c.status_after || '',
    })),
    created_by: userId,
    notify_subscribers: input.notify_subscribers || false,
  });

  // Publish notification job to NATS for reliable async delivery
  if (input.notify_subscribers) {
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
    } catch (err: any) {
      logger.error('Failed to publish status page notification to NATS', {
        error: err.message,
        statusPageId: page._id.toString(),
        updateId: update._id.toString(),
      });
    }
  }

  return update;
}

export async function updateStatusUpdate(
  tenantId: Types.ObjectId,
  statusPageId: string,
  updateId: string,
  input: Record<string, any>
): Promise<StatusUpdateDocument> {
  await getStatusPageById(tenantId, statusPageId);
  const update = await StatusUpdate.findOne({
    _id: updateId,
    status_page_id: statusPageId,
    tenant_id: tenantId,
  });
  if (!update) throw AppError.notFound('Status update');
  Object.assign(update, input);
  await update.save();
  return update;
}

export async function deleteStatusUpdate(
  tenantId: Types.ObjectId,
  statusPageId: string,
  updateId: string
): Promise<void> {
  await getStatusPageById(tenantId, statusPageId);
  const result = await StatusUpdate.deleteOne({
    _id: updateId,
    status_page_id: statusPageId,
    tenant_id: tenantId,
  });
  if (result.deletedCount === 0)
    throw AppError.notFound('Status update');
}

// ─── Public Updates ─────────────────────────────────────────────────────────

export async function getPublicUpdates(
  slug: string,
  opts: { limit?: number; skip?: number; viewerEmail?: string; from?: Date; to?: Date } = {}
): Promise<StatusUpdateDocument[]> {
  const page = await getPublicStatusPage(slug, opts.viewerEmail);
  const query: any = {
    status_page_id: page._id,
    visibility: 'public',
  };
  if (opts.from || opts.to) {
    query.created_at = {};
    if (opts.from) query.created_at.$gte = opts.from;
    if (opts.to) query.created_at.$lte = opts.to;
  }
  return StatusUpdate.find(query)
    .sort({ created_at: -1 })
    .skip(opts.skip || 0)
    .limit(opts.limit || 20);
}

// ─── Subscribers ────────────────────────────────────────────────────────────

export async function listSubscribers(
  tenantId: Types.ObjectId,
  statusPageId: string
): Promise<StatusPageSubscriberDocument[]> {
  await getStatusPageById(tenantId, statusPageId);
  return StatusPageSubscriber.find({
    status_page_id: statusPageId,
    tenant_id: tenantId,
  }).sort({ created_at: -1 });
}

export async function addSubscriber(
  tenantId: Types.ObjectId,
  statusPageId: string,
  email: string
): Promise<StatusPageSubscriberDocument> {
  await getStatusPageById(tenantId, statusPageId);

  // Check for existing
  const existing = await StatusPageSubscriber.findOne({
    status_page_id: statusPageId,
    email: email.toLowerCase(),
  });
  if (existing) return existing;

  return StatusPageSubscriber.create({
    tenant_id: tenantId,
    status_page_id: statusPageId,
    email: email.toLowerCase(),
    confirmed: true, // admin-added = auto-confirmed
    confirm_token: uuidv4(),
    unsubscribe_token: uuidv4(),
  });
}

export async function removeSubscriber(
  tenantId: Types.ObjectId,
  statusPageId: string,
  subscriberId: string
): Promise<void> {
  await getStatusPageById(tenantId, statusPageId);
  const result = await StatusPageSubscriber.deleteOne({
    _id: subscriberId,
    status_page_id: statusPageId,
    tenant_id: tenantId,
  });
  if (result.deletedCount === 0)
    throw AppError.notFound('Subscriber');
}

// ─── Public Subscribe / Confirm / Unsubscribe ───────────────────────────────

export async function publicSubscribe(slug: string, email: string): Promise<void> {
  const page = await getPublicStatusPage(slug);

  const existing = await StatusPageSubscriber.findOne({
    status_page_id: page._id,
    email: email.toLowerCase(),
  });

  if (existing) {
    if (existing.confirmed) return; // already subscribed
    // Resend confirmation
    await sendSubscriptionConfirmEmail({
      to: email,
      pageName: page.name,
      slug: page.slug,
      confirmToken: existing.confirm_token,
    });
    return;
  }

  const confirmToken = uuidv4();
  const unsubscribeToken = uuidv4();

  await StatusPageSubscriber.create({
    tenant_id: page.tenant_id,
    status_page_id: page._id,
    email: email.toLowerCase(),
    confirmed: false,
    confirm_token: confirmToken,
    unsubscribe_token: unsubscribeToken,
    consent_given: true,
    consent_given_at: new Date(),
  });

  await sendSubscriptionConfirmEmail({
    to: email,
    pageName: page.name,
    slug: page.slug,
    confirmToken,
  });
}

export async function publicSubscribeSms(slug: string, phone: string): Promise<void> {
  const page = await getPublicStatusPage(slug);

  const existing = await StatusPageSubscriber.findOne({
    status_page_id: page._id,
    channel: 'sms',
    phone,
  });

  if (existing) return; // already subscribed

  await StatusPageSubscriber.create({
    tenant_id: page.tenant_id,
    status_page_id: page._id,
    channel: 'sms',
    email: '',
    phone,
    confirmed: true, // SMS doesn't need email confirmation
    confirm_token: uuidv4(),
    unsubscribe_token: uuidv4(),
    consent_given: true,
    consent_given_at: new Date(),
  });
}

export async function publicSubscribeWebhook(slug: string, webhookUrl: string): Promise<void> {
  const page = await getPublicStatusPage(slug);

  const existing = await StatusPageSubscriber.findOne({
    status_page_id: page._id,
    channel: 'webhook',
    webhook_url: webhookUrl,
  });

  if (existing) return; // already subscribed

  await StatusPageSubscriber.create({
    tenant_id: page.tenant_id,
    status_page_id: page._id,
    channel: 'webhook',
    email: '',
    webhook_url: webhookUrl,
    confirmed: true, // Webhooks don't need email confirmation
    confirm_token: uuidv4(),
    unsubscribe_token: uuidv4(),
    consent_given: true,
    consent_given_at: new Date(),
  });
}

export async function generateRssFeed(slug: string, req: any): Promise<string> {
  const page = await getPublicStatusPage(slug);
  const updates = await StatusUpdate.find({
    status_page_id: page._id,
    visibility: 'public',
  }).sort({ created_at: -1 }).limit(20).lean();

  const proto = req.headers?.['x-forwarded-proto'] || 'https';
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost';
  const baseUrl = `${proto}://${host}`;
  const pageUrl = `${baseUrl}/status/${slug}`;

  const items = updates.map((u: any) => `    <item>
      <title><![CDATA[${u.title}]]></title>
      <description><![CDATA[${u.body || ''}]]></description>
      <pubDate>${new Date(u.created_at).toUTCString()}</pubDate>
      <guid>${baseUrl}/api/v1/public/status-pages/${slug}/updates/${u._id}</guid>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${page.name} - Status Updates</title>
    <link>${pageUrl}</link>
    <description>${page.description || `Status updates for ${page.name}`}</description>
    <atom:link href="${baseUrl}/api/v1/public/status-pages/${slug}/rss" rel="self" type="application/rss+xml"/>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

export async function confirmSubscription(slug: string, token: string): Promise<boolean> {
  const page = await getPublicStatusPage(slug);
  const sub = await StatusPageSubscriber.findOne({
    status_page_id: page._id,
    confirm_token: token,
  });
  if (!sub) return false;
  if (sub.confirmed) return true;
  sub.confirmed = true;
  await sub.save();
  return true;
}

export async function unsubscribe(slug: string, token: string): Promise<boolean> {
  const page = await getPublicStatusPage(slug);
  const result = await StatusPageSubscriber.deleteOne({
    status_page_id: page._id,
    unsubscribe_token: token,
  });
  return result.deletedCount > 0;
}

// ─── Scheduled Maintenance ──────────────────────────────────────────────────

export async function addScheduledMaintenance(
  tenantId: Types.ObjectId,
  statusPageId: string,
  userId: Types.ObjectId,
  input: {
    title: string;
    description?: string;
    scheduled_start: Date;
    scheduled_end: Date;
    affected_components?: string[];
    notify_subscribers?: boolean;
    auto_update_status?: boolean;
  }
): Promise<StatusPageDocument> {
  const page = await getStatusPageById(tenantId, statusPageId);

  page.scheduled_maintenances.push({
    title: input.title,
    description: input.description || '',
    status: 'scheduled',
    scheduled_start: input.scheduled_start,
    scheduled_end: input.scheduled_end,
    affected_components: input.affected_components || [],
    notify_subscribers: input.notify_subscribers !== false,
    auto_update_status: input.auto_update_status !== false,
    created_by: userId,
  } as any);

  await page.save();

  // Notify subscribers about upcoming maintenance
  const maintenance = page.scheduled_maintenances[page.scheduled_maintenances.length - 1];
  if (input.notify_subscribers !== false) {
    try {
      const update = await StatusUpdate.create({
        tenant_id: tenantId,
        status_page_id: statusPageId,
        title: `Scheduled Maintenance: ${input.title}`,
        body: `${input.description || ''}\n\nScheduled: ${input.scheduled_start.toUTCString()} — ${input.scheduled_end.toUTCString()}`,
        status: 'informational',
        visibility: 'public',
        affected_components: (input.affected_components || []).map((name) => ({
          component_id: new Types.ObjectId(),
          name,
          status_before: 'operational',
          status_after: 'maintenance',
        })),
        created_by: userId,
        notify_subscribers: true,
      });

      const js = getJetStream();
      await js.publish(
        'status-pages.notify-subscribers',
        sc.encode(
          JSON.stringify({
            status_page_id: statusPageId,
            status_update_id: update._id.toString(),
            timestamp: new Date().toISOString(),
          })
        )
      );
    } catch (err: any) {
      logger.error('Failed to notify subscribers about maintenance', { error: err.message });
    }
  }

  return page;
}

export async function updateScheduledMaintenance(
  tenantId: Types.ObjectId,
  statusPageId: string,
  maintenanceId: string,
  input: Record<string, any>
): Promise<StatusPageDocument> {
  const page = await getStatusPageById(tenantId, statusPageId);

  const maintenance = page.scheduled_maintenances.find(
    (m: any) => m._id?.toString() === maintenanceId
  );
  if (!maintenance) throw AppError.notFound('Scheduled maintenance');

  Object.assign(maintenance, input);
  await page.save();
  return page;
}

export async function deleteScheduledMaintenance(
  tenantId: Types.ObjectId,
  statusPageId: string,
  maintenanceId: string
): Promise<void> {
  const page = await getStatusPageById(tenantId, statusPageId);

  const idx = page.scheduled_maintenances.findIndex(
    (m: any) => m._id?.toString() === maintenanceId
  );
  if (idx === -1) throw AppError.notFound('Scheduled maintenance');

  page.scheduled_maintenances.splice(idx, 1);
  await page.save();
}

// ─── Custom Domain ──────────────────────────────────────────────────────────

export async function setCustomDomain(
  tenantId: Types.ObjectId,
  statusPageId: string,
  domain: string
): Promise<{ verification_token: string; cname_target: string }> {
  const page = await getStatusPageById(tenantId, statusPageId);
  const verificationToken = `sreoncall-verify-${uuidv4().slice(0, 12)}`;

  page.set('custom_domain_config', {
    domain: domain.toLowerCase(),
    verification_token: verificationToken,
    verified: false,
  });
  page.custom_domain = domain.toLowerCase();
  await page.save();

  return {
    verification_token: verificationToken,
    cname_target: 'status.sreoncall.com',
  };
}

export async function verifyCustomDomain(
  tenantId: Types.ObjectId,
  statusPageId: string
): Promise<{ verified: boolean; error?: string }> {
  const page = await getStatusPageById(tenantId, statusPageId);
  const config = page.custom_domain_config;

  if (!config?.domain) {
    return { verified: false, error: 'No custom domain configured' };
  }

  if (config.verified) {
    return { verified: true };
  }

  // Verify via DNS TXT record lookup
  try {
    const { resolve } = await import('dns/promises');

    // Check CNAME record
    try {
      const cnames = await resolve(config.domain, 'CNAME');
      const hasCname = cnames.some(
        (r: string) => r.toLowerCase().includes('sreoncall.com')
      );
      if (!hasCname) {
        return { verified: false, error: `CNAME record not pointing to status.sreoncall.com` };
      }
    } catch {
      return { verified: false, error: 'CNAME record not found. Add a CNAME record pointing to status.sreoncall.com' };
    }

    // Check TXT record for verification token
    try {
      const txtRecords = await resolve(config.domain, 'TXT');
      const hasTxt = txtRecords.some(
        (r: string[]) => r.some((t) => t === config.verification_token)
      );
      if (!hasTxt) {
        return { verified: false, error: `TXT record with value "${config.verification_token}" not found` };
      }
    } catch {
      return { verified: false, error: `Add a TXT record with value "${config.verification_token}"` };
    }

    // Verification passed
    page.set('custom_domain_config.verified', true);
    page.set('custom_domain_config.verified_at', new Date());
    await page.save();

    return { verified: true };
  } catch (err: any) {
    return { verified: false, error: `DNS lookup failed: ${err.message}` };
  }
}

export async function removeCustomDomain(
  tenantId: Types.ObjectId,
  statusPageId: string
): Promise<void> {
  const page = await getStatusPageById(tenantId, statusPageId);
  page.custom_domain = undefined;
  page.set('custom_domain_config', {
    domain: '',
    verification_token: '',
    verified: false,
  });
  await page.save();
}

