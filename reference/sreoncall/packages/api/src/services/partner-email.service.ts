import nodemailer from 'nodemailer';

function escHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeSubjectField(s: string): string {
  return s.replace(/[\r\n\0]/g, '');
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

export interface PartnerApplicationEmailData {
  name: string;
  email: string;
  company: string;
  partnerType: 'referral' | 'reseller' | 'msp';
  message?: string;
}

export interface PartnerInviteEmailData {
  name: string;
  email: string;
  company: string;
  inviteToken: string;
}

export interface PartnerTeamInviteEmailData {
  email: string;
  partnerName: string;
  inviterName: string;
  role: 'admin' | 'member';
  token: string;
}

export async function sendPartnerTeamInviteEmail(data: PartnerTeamInviteEmailData): Promise<void> {
  const acceptUrl = `${WEB_URL}/partner/team/accept/${encodeURIComponent(data.token)}`;
  const subject = `${sanitizeSubjectField(data.inviterName)} invited you to ${sanitizeSubjectField(data.partnerName)} on SREonCall`;

  const content = `
<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">You've been invited to join ${escHtml(data.partnerName)}</h2>
<p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
  <strong>${escHtml(data.inviterName)}</strong> has invited you to join the <strong>${escHtml(data.partnerName)}</strong> team on the SREonCall Partner Portal as a <strong>${escHtml(data.role)}</strong>.
</p>
<div style="margin-bottom:24px;">
  <a href="${acceptUrl}" style="display:inline-block;padding:14px 28px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Accept invitation →</a>
</div>
<p style="margin:0;font-size:13px;color:#94A3B8;line-height:1.6;">
  This invite link expires in <strong>7 days</strong>. If you did not expect this invitation, you can safely ignore this email.
</p>
<p style="margin:16px 0 0;font-size:13px;color:#94A3B8;">— The SREonCall Partner Team</p>`;

  await transporter.sendMail({
    from: FROM,
    to: data.email,
    subject,
    html: emailWrapper(content),
  });
}

export function getApplicationNotificationSubject(company: string, partnerType: string): string {
  return `New partner application: ${sanitizeSubjectField(company)} (${partnerType})`;
}

export function getInviteSubject(): string {
  return "You're invited to the SREonCall Partner Portal";
}

export async function sendPartnerApplicationNotification(data: PartnerApplicationEmailData): Promise<void> {
  const subject = getApplicationNotificationSubject(data.company, data.partnerType);
  const adminLink = `${ADMIN_URL}/admin/partners`;
  const timestamp = new Date().toISOString();

  const content = `
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0F172A;">New partner application</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155;">
  <tr><td style="padding:6px 0;color:#64748B;width:120px;">Name</td><td style="padding:6px 0;font-weight:600;">${escHtml(data.name)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Email</td><td style="padding:6px 0;"><a href="mailto:${escHtml(data.email)}" style="color:#FF6B2B;">${escHtml(data.email)}</a></td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Company</td><td style="padding:6px 0;">${escHtml(data.company)}</td></tr>
  <tr><td style="padding:6px 0;color:#64748B;">Partner Type</td><td style="padding:6px 0;font-weight:600;text-transform:capitalize;">${escHtml(data.partnerType)}</td></tr>
  ${data.message ? `<tr><td style="padding:6px 0;color:#64748B;vertical-align:top;">Message</td><td style="padding:6px 0;">${escHtml(data.message)}</td></tr>` : ''}
  <tr><td style="padding:6px 0;color:#64748B;">Submitted</td><td style="padding:6px 0;font-size:12px;color:#94A3B8;">${escHtml(timestamp)}</td></tr>
</table>
<div style="margin-top:24px;">
  <a href="${adminLink}" style="display:inline-block;padding:12px 24px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">View in admin →</a>
</div>`;

  await transporter.sendMail({
    from: FROM,
    to: 'partners@sreoncall.com',
    subject,
    html: emailWrapper(content),
  });
}

export async function sendPartnerInviteEmail(data: PartnerInviteEmailData): Promise<void> {
  const subject = getInviteSubject();
  const registerUrl = `${WEB_URL}/partner/register?token=${encodeURIComponent(data.inviteToken)}`;
  const firstName = escHtml(data.name.split(' ')[0]);

  const content = `
<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0F172A;">Welcome to the SREonCall Partner Portal, ${firstName}.</h2>
<p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
  You've been invited to join the <strong>SREonCall Partner Portal</strong> on behalf of <strong>${escHtml(data.company)}</strong>.
</p>
<p style="margin:0 0 8px;font-size:14px;color:#334155;font-weight:600;">What the portal offers:</p>
<ul style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#334155;line-height:1.8;">
  <li>Deal pipeline management — track and manage referrals end-to-end</li>
  <li>Commission tracking — real-time visibility into your earned commissions</li>
  <li>Partner resources — sales materials, technical docs, and enablement content</li>
  <li>Co-selling support — direct access to the SREonCall sales team</li>
</ul>
<div style="margin-bottom:24px;">
  <a href="${registerUrl}" style="display:inline-block;padding:14px 28px;background:#FF6B2B;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Activate your partner account →</a>
</div>
<p style="margin:0;font-size:13px;color:#94A3B8;line-height:1.6;">
  This invite link expires in <strong>48 hours</strong>. If you did not expect this invitation, you can safely ignore this email.
</p>
<p style="margin:16px 0 0;font-size:13px;color:#94A3B8;">— The SREonCall Partner Team</p>`;

  await transporter.sendMail({
    from: FROM,
    to: data.email,
    subject,
    html: emailWrapper(content),
  });
}
