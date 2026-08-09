import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';
import { Tenant } from '../models/tenant.model';
import { Types } from 'mongoose';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'email-smtp.ap-south-1.amazonaws.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM = process.env.EMAIL_FROM || 'no-reply@sreoncall.com';
const APP_URL = process.env.APP_URL || 'http://10.10.1.30';

const tenantUrlCache = new Map<string, { url: string; expiresAt: number }>();
const TENANT_URL_TTL_MS = 5 * 60_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBodyHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px; font-size:14px; color:#334155; line-height:1.7;">${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

async function resolveTenantUrl(tenantRef?: string): Promise<string> {
  if (!tenantRef) return APP_URL;
  const cached = tenantUrlCache.get(tenantRef);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let url = APP_URL;
  try {
    const isOid = Types.ObjectId.isValid(tenantRef) && /^[a-f0-9]{24}$/i.test(tenantRef);
    const tenant = await Tenant.findOne(isOid ? { _id: tenantRef } : { slug: tenantRef })
      .select('custom_domains slug')
      .lean();
    const customDomain = (tenant as any)?.custom_domains?.[0];
    if (customDomain) {
      url = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
    } else if ((tenant as any)?.slug && process.env.TENANT_URL_TEMPLATE) {
      url = process.env.TENANT_URL_TEMPLATE.replace('{slug}', (tenant as any).slug);
    }
  } catch {
    // fall through
  }
  tenantUrlCache.set(tenantRef, { url, expiresAt: Date.now() + TENANT_URL_TTL_MS });
  return url;
}

export async function sendNotificationEmail(
  to: string,
  title: string,
  body: string,
  resourceUrl?: string,
  tenantRef?: string,
  htmlBodyOverride?: string,
): Promise<void> {
  const baseUrl = await resolveTenantUrl(tenantRef);
  const actionUrl = resourceUrl ? `${baseUrl}${resourceUrl}` : baseUrl;
  const safeTitle = escapeHtml(title);
  const bodyHtml = htmlBodyOverride || renderBodyHtml(body);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#F1F5F9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;">
    <tr><td style="padding:40px 20px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" align="center" style="max-width:520px; width:100%; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0D1117 0%,#161B22 100%); padding:20px 32px;">
            <a href="${baseUrl}" style="text-decoration:none;">
              <img src="${APP_URL}/logo/sreoncall-logo.png" alt="SREonCall" width="120" height="38" style="display:inline-block; vertical-align:middle; border:0;" />
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <h2 style="margin:0 0 12px; font-size:18px; font-weight:700; color:#0F172A;">${safeTitle}</h2>
            ${bodyHtml}
            <a href="${actionUrl}" style="display:inline-block; padding:10px 24px; background:#FF6B2B; color:#FFFFFF; text-decoration:none; font-size:14px; font-weight:600; border-radius:8px;">View Details</a>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #E2E8F0; padding:16px 32px; background:#F8FAFC;">
            <p style="margin:0; font-size:11px; color:#94A3B8;">
              <a href="${baseUrl}/settings" style="color:#64748B; text-decoration:underline;">Manage notification preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${title}\n\n${body}\n\nView: ${actionUrl}\n\nManage preferences: ${baseUrl}/settings`;

  try {
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@sreoncall.com>`;
    await transporter.sendMail({
      from: `SREonCall Alerts <${FROM}>`,
      to,
      subject: title,
      html,
      text,
      messageId,
      headers: {
        'List-Unsubscribe': `<mailto:unsubscribe@sreoncall.com?subject=unsubscribe>, <${baseUrl}/settings>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'Feedback-ID': `alert:sreoncall:${to.split('@')[1]}`,
        'X-Priority': '1',
        'X-Mailer': 'SREonCall Platform',
      },
    });
    logger.debug('Notification email sent', { to, title });
  } catch (err: any) {
    logger.error('Failed to send notification email', { to, error: err.message });
    throw err;
  }
}
