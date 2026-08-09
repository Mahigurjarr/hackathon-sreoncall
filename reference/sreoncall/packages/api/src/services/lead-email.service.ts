import nodemailer from 'nodemailer';
import type { LeadTrack } from '../models/lead.model';

function escHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'email-smtp.ap-south-1.amazonaws.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM = process.env.EMAIL_FROM || 'no-reply@sreoncall.com';
const WEB_URL = process.env.WEB_URL || 'https://sreoncall.com';
const ADMIN_URL = process.env.APP_URL || 'https://app.sreoncall.com';

const PARTNER_TRACKS: LeadTrack[] = ['referral', 'reseller', 'msp', 'partner'];

export function getNotificationRecipient(track: LeadTrack): string {
  return PARTNER_TRACKS.includes(track) ? 'partners@sreoncall.com' : 'sales@sreoncall.com';
}

export function getAutoReplySubject(track: LeadTrack): string {
  if (track === 'demo') return "Your demo request — we'll be in touch";
  if (PARTNER_TRACKS.includes(track)) return "Your partner programme enquiry — next steps";
  return "Thanks for reaching out to SREonCall";
}

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SREonCall</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;">
    <tr><td style="padding:40px 20px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" align="center"
             style="max-width:520px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0D1117 0%,#161B22 100%);padding:24px 32px;">
            <a href="${WEB_URL}" style="text-decoration:none;">
              <img src="${WEB_URL}/logo/sreoncall-logo.png" alt="SREonCall" width="120" height="38" style="display:inline-block;vertical-align:middle;border:0;" />
            </a>
          </td>
        </tr>
        <tr><td style="padding:36px 32px 32px;">${content}</td></tr>
        <tr>
          <td style="border-top:1px solid #E2E8F0;padding:16px 32px;background:#F8FAFC;">
            <p style="margin:0;font-size:11px;color:#94A3B8;">&copy; ${new Date().getFullYear()} SREonCall · Reliable ops, on call.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

interface LeadEmailData {
  name: string;
  email: string;
  company: string;
  role?: string;
  company_size?: string;
  message?: string;
  track: LeadTrack;
  leadId: string;
}

export async function sendLeadNotificationEmail(data: LeadEmailData): Promise<void> {
  const recipient = getNotificationRecipient(data.track);
  const subject = `New lead: ${data.company} (${data.track})`;
  const adminLink = `${ADMIN_URL}/admin/leads`;

  const content = `
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0F172A;">New inbound lead</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155;">
  <tr><td style="padding:6px 0;color:#64748B;width:120px;">Name</td><td style="padding:6px 0;font-weight:600;">${escHtml(data.name)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Email</td><td style="padding:6px 0;"><a href="mailto:${escHtml(data.email)}" style="color:#FF6B2B;">${escHtml(data.email)}</a></td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Company</td><td style="padding:6px 0;">${escHtml(data.company)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Role</td><td style="padding:6px 0;">${escHtml(data.role) || '—'}</td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Size</td><td style="padding:6px 0;">${escHtml(data.company_size) || '—'}</td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Track</td><td style="padding:6px 0;font-weight:600;text-transform:capitalize;">${escHtml(data.track)}</td></tr>
  ${data.message ? `<tr><td style="padding:6px 0;color:#64748B;vertical-align:top;">Message</td><td style="padding:6px 0;">${escHtml(data.message)}</td></tr>` : ''}
</table>
<div style="margin-top:24px;">
  <a href="${adminLink}" style="display:inline-block;padding:12px 24px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">View in admin →</a>
</div>`;

  await transporter.sendMail({
    from: FROM,
    to: recipient,
    subject,
    html: emailWrapper(content),
  });
}

export async function sendLeadAutoReply(data: LeadEmailData): Promise<void> {
  const subject = getAutoReplySubject(data.track);

  const content = `
<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">Thanks, ${escHtml(data.name.split(' ')[0])}.</h2>
<p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
  We received your message and will get back to you within <strong>one business day</strong>.
</p>
<p style="margin:0 0 20px;font-size:14px;color:#64748B;line-height:1.6;">
  SREonCall replaces Datadog, PagerDuty, and your entire SRE toolchain with one flat-price platform —
  incidents, on-call, observability, AI agents, and runbooks unified.
</p>
<a href="${WEB_URL}/pricing" style="display:inline-block;padding:12px 24px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">View pricing →</a>
<p style="margin:24px 0 0;font-size:13px;color:#94A3B8;">— The SREonCall team</p>`;

  await transporter.sendMail({
    from: FROM,
    to: data.email,
    subject,
    html: emailWrapper(content),
  });
}
