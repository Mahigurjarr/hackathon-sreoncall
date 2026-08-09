import nodemailer from 'nodemailer';
import { Tenant } from '../models/tenant.model';

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
const APP_URL = process.env.APP_URL || 'http://10.10.1.30';

// Cache tenant URL lookups so repeated emails (e.g. bulk notifications) don't
// hammer Mongo. Cleared per-process; safe because custom_domains rarely change.
const tenantUrlCache = new Map<string, { url: string; expiresAt: number }>();
const TENANT_URL_TTL_MS = 5 * 60_000;

// Tenant-scoped URL. Resolution order:
//   1. tenant.custom_domains[0] (e.g. "https://monitoring.thepackengers.com")
//   2. TENANT_URL_TEMPLATE env var with {slug} substitution
//   3. APP_URL fallback
async function tenantAppUrl(orgSlug?: string): Promise<string> {
  if (!orgSlug) return APP_URL;

  const cached = tenantUrlCache.get(orgSlug);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let url = APP_URL;
  try {
    const tenant = await Tenant.findOne({ slug: orgSlug }).select('custom_domains').lean();
    const customDomain = (tenant as any)?.custom_domains?.[0];
    if (customDomain) {
      url = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
    } else if (process.env.TENANT_URL_TEMPLATE) {
      url = process.env.TENANT_URL_TEMPLATE.replace('{slug}', orgSlug);
    }
  } catch {
    // fall through to APP_URL
  }

  tenantUrlCache.set(orgSlug, { url, expiresAt: Date.now() + TENANT_URL_TTL_MS });
  return url;
}

// ─── Shared template helpers ────────────────────────────────────────────────

function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>SREonCall</title>
</head>
<body style="margin:0; padding:0; background-color:#F1F5F9; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;">
    <tr><td style="padding:40px 20px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" align="center" style="max-width:520px; width:100%; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0D1117 0%,#161B22 100%); padding:24px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  <a href="${APP_URL}" style="text-decoration:none;">
                    <img src="${APP_URL}/logo/sreoncall-logo.png" alt="SREonCall" width="120" height="38" style="display:inline-block; vertical-align:middle; border:0;" />
                  </a>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="font-size:10px; font-weight:500; color:#475569; letter-spacing:0.5px; text-transform:uppercase;">Incident Management Platform</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px 32px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="border-top:1px solid #E2E8F0; padding:20px 32px; background:#F8FAFC;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0; font-size:11px; color:#94A3B8; line-height:1.5;">
                    &copy; ${new Date().getFullYear()} SREonCall &middot; Reliable ops, on call.
                  </p>
                </td>
                <td align="right">
                  <a href="${APP_URL}" style="font-size:11px; color:#FF6B2B; text-decoration:none; font-weight:500;">Open Dashboard</a>
                  <span style="color:#CBD5E1;"> &middot; </span>
                  <a href="${APP_URL}/privacy" style="font-size:11px; color:#64748B; text-decoration:none;">Privacy</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>

      <!-- Sub-footer -->
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" align="center" style="max-width:520px; width:100%;">
        <tr>
          <td style="padding:16px 0; text-align:center;">
            <p style="margin:0; font-size:10px; color:#94A3B8;">
              You're receiving this because your email is registered with SREonCall.<br>
              <a href="${APP_URL}/settings" style="color:#64748B; text-decoration:underline;">Manage notification preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(text: string, href: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px;">
  <tr>
    <td style="border-radius:10px; background:linear-gradient(135deg,#FF6B2B 0%,#E85D1C 100%); box-shadow:0 2px 8px rgba(255,107,43,0.3);">
      <a href="${href}" target="_blank"
         style="display:inline-block; padding:14px 32px; color:#FFFFFF; text-decoration:none; font-size:15px; font-weight:600; letter-spacing:0.2px;">
        ${text}
      </a>
    </td>
  </tr>
</table>`;
}

function infoBox(text: string): string {
  return `
<div style="background:#F0F9FF; border:1px solid #BAE6FD; border-radius:8px; padding:12px 16px; margin:20px 0 0;">
  <p style="margin:0; font-size:12px; color:#0369A1; line-height:1.5;">${text}</p>
</div>`;
}

function linkFallback(url: string): string {
  return `
<p style="margin:20px 0 0; font-size:12px; color:#94A3B8; line-height:1.6;">
  Or copy and paste this link into your browser:<br>
  <a href="${url}" style="color:#FF6B2B; word-break:break-all; text-decoration:none;">${url}</a>
</p>`;
}

// ─── Invite Email ────────────────────────────────────────────────────────────

export async function sendInviteEmail(opts: {
  to: string;
  name: string;
  inviterName: string;
  orgName: string;
  orgSlug: string;
  inviteToken: string;
  boardInvite?: boolean;
}): Promise<void> {
  const { to, name, inviterName, orgName, orgSlug, inviteToken, boardInvite } = opts;
  const tenantUrl = await tenantAppUrl(orgSlug);
  const acceptUrl = boardInvite
    ? `${tenantUrl}/invites/board/${inviteToken}`
    : `${tenantUrl}/accept-invite?token=${inviteToken}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#128231;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">You're invited</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  <strong style="color:#0F172A;">${inviterName}</strong> has invited you to join
  <strong style="color:#0F172A;">${orgName}</strong> on SREonCall.
</p>

<!-- Org info card -->
<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:16px 20px; margin:0 0 4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="40">
        <div style="width:36px; height:36px; border-radius:8px; background:#0D1117; text-align:center; line-height:36px;">
          <span style="font-size:16px; color:#FF6B2B; font-weight:700;">${orgName.charAt(0).toUpperCase()}</span>
        </div>
      </td>
      <td style="padding-left:12px;">
        <p style="margin:0; font-size:14px; font-weight:600; color:#0F172A;">${orgName}</p>
        <p style="margin:2px 0 0; font-size:12px; color:#64748B;">Workspace: ${orgSlug}</p>
      </td>
    </tr>
  </table>
</div>

${ctaButton('Accept Invitation', acceptUrl)}
${linkFallback(acceptUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  This invitation was sent to <strong style="color:#64748B;">${to}</strong>. If you weren't expecting this, you can safely ignore it.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `${inviterName} invited you to join ${orgName} on SREonCall`,
    html: emailWrapper(content),
    text: `${inviterName} invited you to join ${orgName} on SREonCall.\n\nAccept your invitation: ${acceptUrl}\n\nIf you weren't expecting this, ignore this email.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Board Added Notification Email ─────────────────────────────────────────

export async function sendBoardAddedEmail(opts: {
  to: string;
  inviterName: string;
  orgName: string;
  orgSlug: string;
  boardName: string;
}): Promise<void> {
  const { to, inviterName, orgName, orgSlug, boardName } = opts;
  const tenantUrl = await tenantAppUrl(orgSlug);
  const projectsUrl = `${tenantUrl}/projects`;

  const content = `
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#10003;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">You've been added to a project</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  <strong style="color:#0F172A;">${inviterName}</strong> added you to
  <strong style="color:#0F172A;">${boardName}</strong> in ${orgName}.
</p>

<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:16px 20px; margin:0 0 4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="40">
        <div style="width:36px; height:36px; border-radius:8px; background:#0D1117; text-align:center; line-height:36px;">
          <span style="font-size:16px; color:#FF6B2B; font-weight:700;">${orgName.charAt(0).toUpperCase()}</span>
        </div>
      </td>
      <td style="padding-left:12px;">
        <p style="margin:0; font-size:14px; font-weight:600; color:#0F172A;">${boardName}</p>
        <p style="margin:2px 0 0; font-size:12px; color:#64748B;">${orgName}</p>
      </td>
    </tr>
  </table>
</div>

${ctaButton('Open Project', projectsUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  This notification was sent to <strong style="color:#64748B;">${to}</strong>. If you weren't expecting this, contact your workspace admin.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `${inviterName} added you to ${boardName} on SREonCall`,
    html: emailWrapper(content),
    text: `${inviterName} added you to ${boardName} in ${orgName} on SREonCall.\n\nOpen project: ${projectsUrl}`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Password Reset Email ────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  resetToken: string;
  orgSlug: string;
}): Promise<void> {
  const { to, name, resetToken, orgSlug } = opts;
  const tenantUrl = await tenantAppUrl(orgSlug);
  const resetUrl = `${tenantUrl}/reset-password?token=${resetToken}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#128274;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Reset your password</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  Hi <strong style="color:#0F172A;">${name || 'there'}</strong>, we&rsquo;ve received your request to reset your SREonCall password. Click the button below to set a new one securely.
</p>

${ctaButton('Reset Password', resetUrl)}
${linkFallback(resetUrl)}

${infoBox('&#9200; This link expires in <strong>1 hour</strong>. After that, you\'ll need to request a new one.')}

<p style="margin:24px 0 0; text-align:center;">
  <a href="${tenantUrl}/signin" style="font-size:13px; color:#FF6B2B; text-decoration:none; font-weight:600;">← Back to Sign In Page</a>
</p>

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: 'Reset your SREonCall password',
    html: emailWrapper(content),
    text: `Hi ${name || 'there'},\n\nWe've received your request to reset your SREonCall password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.\n\nBack to Sign In: ${tenantUrl}/signin`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Partner Password Reset Email ───────────────────────────────────────────

export async function sendPartnerPasswordResetEmail(opts: {
  to: string;
  name: string;
  resetToken: string;
}): Promise<void> {
  const { to, name, resetToken } = opts;
  const resetUrl = `${APP_URL}/partner/reset-password?token=${resetToken}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#128274;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Reset your partner portal password</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  Hi <strong style="color:#0F172A;">${name || 'there'}</strong>, we&rsquo;ve received your request to reset your SREonCall Partner Portal password. Click the button below to set a new one securely.
</p>

${ctaButton('Reset Password', resetUrl)}
${linkFallback(resetUrl)}

${infoBox('&#9200; This link expires in <strong>1 hour</strong>. After that, you\'ll need to request a new one.')}

<p style="margin:24px 0 0; text-align:center;">
  <a href="${APP_URL}/partner/login" style="font-size:13px; color:#FF6B2B; text-decoration:none; font-weight:600;">&larr; Back to Sign In Page</a>
</p>

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: 'Reset your SREonCall Partner Portal password',
    html: emailWrapper(content),
    text: `Hi ${name || 'there'},\n\nWe've received your request to reset your Partner Portal password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.\n\nBack to Sign In: ${APP_URL}/partner/login`,
  });
}

// ─── Email Verification Email ────────────────────────────────────────────────

export async function sendVerificationEmail(opts: {
  to: string;
  name: string;
  verifyToken: string;
  orgName: string;
}): Promise<void> {
  const { to, name, verifyToken, orgName } = opts;
  const verifyUrl = `${APP_URL}/verify-email?token=${verifyToken}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(22,163,74,0.12) 0%,rgba(22,163,74,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#9989;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Verify your email</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  Hi <strong style="color:#0F172A;">${name || 'there'}</strong>, welcome to <strong style="color:#0F172A;">${orgName}</strong>! Please verify your email address to get started.
</p>

${ctaButton('Verify Email Address', verifyUrl)}
${linkFallback(verifyUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  If you didn't create an account on SREonCall, you can safely ignore this email.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `Verify your email for ${orgName} on SREonCall`,
    html: emailWrapper(content),
    text: `Hi ${name || 'there'},\n\nWelcome to ${orgName}! Please verify your email: ${verifyUrl}\n\nIf you didn't create this account, ignore this email.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Welcome Credentials Email ───────────────────────────────────────────────

export async function sendWelcomeCredentialsEmail(opts: {
  to: string;
  name: string;
  orgName: string;
  orgSlug: string;
  password: string;
}): Promise<void> {
  const { to, name, orgName, orgSlug, password } = opts;
  const tenantUrl = await tenantAppUrl(orgSlug);
  const loginUrl = `${tenantUrl}/signin?org_slug=${encodeURIComponent(orgSlug)}&email=${encodeURIComponent(to)}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#127881;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Welcome to SREonCall</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  Hi <strong style="color:#0F172A;">${name || 'there'}</strong>, your account has been created for
  <strong style="color:#0F172A;">${orgName}</strong>. Use the credentials below to sign in.
</p>

<!-- Credentials card -->
<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:16px 20px; margin:0 0 4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:6px 0;">
        <p style="margin:0; font-size:12px; font-weight:600; color:#64748B; text-transform:uppercase; letter-spacing:0.5px;">Organization</p>
        <p style="margin:2px 0 0; font-size:14px; color:#0F172A; font-family:monospace;">${orgSlug}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:6px 0;">
        <p style="margin:0; font-size:12px; font-weight:600; color:#64748B; text-transform:uppercase; letter-spacing:0.5px;">Email</p>
        <p style="margin:2px 0 0; font-size:14px; color:#0F172A; font-family:monospace;">${to}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:6px 0;">
        <p style="margin:0; font-size:12px; font-weight:600; color:#64748B; text-transform:uppercase; letter-spacing:0.5px;">Temporary Password</p>
        <p style="margin:2px 0 0; font-size:14px; color:#0F172A; font-family:monospace;">${password}</p>
      </td>
    </tr>
  </table>
</div>

${ctaButton('Sign In to SREonCall', loginUrl)}

${infoBox('&#128274; You will be required to change your password on first sign-in.')}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  This email was sent to <strong style="color:#64748B;">${to}</strong>. If you weren't expecting this, please contact your administrator.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `Your SREonCall account for ${orgName}`,
    html: emailWrapper(content),
    text: `Hi ${name || 'there'},\n\nYour SREonCall account has been created for ${orgName}.\n\nOrganization: ${orgSlug}\nEmail: ${to}\nTemporary Password: ${password}\n\nSign in: ${loginUrl}\n\nYou will be required to change your password on first sign-in.\n\nIf you weren't expecting this, contact your administrator.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Onboarding Invite Email ─────────────────────────────────────────────────

export async function sendOnboardingInviteEmail(opts: {
  to: string;
  tenantName: string;
  token: string;
}): Promise<void> {
  const { to, tenantName, token } = opts;
  const onboardingUrl = `${APP_URL}/onboarding?token=${token}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#128221;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Client Onboarding</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  You've been assigned to complete the onboarding form for
  <strong style="color:#0F172A;">${tenantName}</strong> on SREonCall. Click the button below to get started.
</p>

<!-- Tenant info card -->
<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:16px 20px; margin:0 0 4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="40">
        <div style="width:36px; height:36px; border-radius:8px; background:#0D1117; text-align:center; line-height:36px;">
          <span style="font-size:16px; color:#FF6B2B; font-weight:700;">${tenantName.charAt(0).toUpperCase()}</span>
        </div>
      </td>
      <td style="padding-left:12px;">
        <p style="margin:0; font-size:14px; font-weight:600; color:#0F172A;">${tenantName}</p>
        <p style="margin:2px 0 0; font-size:12px; color:#64748B;">Customer Onboarding Form</p>
      </td>
    </tr>
  </table>
</div>

${ctaButton('Start Onboarding', onboardingUrl)}
${linkFallback(onboardingUrl)}

${infoBox('&#9200; This link expires in <strong>72 hours</strong>. Please complete the form before then.')}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  This email was sent to <strong style="color:#64748B;">${to}</strong>. If you weren't expecting this, please contact your SREonCall administrator.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `Complete onboarding for ${tenantName} on SREonCall`,
    html: emailWrapper(content),
    text: `You've been assigned to complete the onboarding form for ${tenantName} on SREonCall.\n\nStart onboarding: ${onboardingUrl}\n\nThis link expires in 72 hours.\n\nIf you weren't expecting this, contact your SREonCall administrator.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Incident Notification Email ─────────────────────────────────────────────

// ─── Status Update Notification Email ────────────────────────────────────────

export async function sendStatusUpdateEmail(opts: {
  to: string;
  pageName: string;
  slug: string;
  updateTitle: string;
  updateBody: string;
  updateStatus: string;
  affectedComponents: Array<{ name: string; status_after: string }>;
  unsubscribeToken: string;
}): Promise<void> {
  const { to, pageName, slug, updateTitle, updateBody, updateStatus, affectedComponents, unsubscribeToken } = opts;
  const pageUrl = `${APP_URL}/status/${slug}`;
  const unsubUrl = `${APP_URL}/status/${slug}/unsubscribe/${unsubscribeToken}`;

  const statusColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
    investigating: { bg: '#FEF3C7', border: '#FDE68A', text: '#B45309', label: 'Investigating' },
    identified: { bg: '#FFF7ED', border: '#FED7AA', text: '#EA580C', label: 'Identified' },
    monitoring: { bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB', label: 'Monitoring' },
    resolved: { bg: '#F0FDF4', border: '#BBF7D0', text: '#16A34A', label: 'Resolved' },
    informational: { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B', label: 'Informational' },
  };
  const sc = statusColors[updateStatus] || statusColors.informational;

  const componentsHtml = affectedComponents.length > 0
    ? `<div style="margin:16px 0 0;">
        <p style="margin:0 0 8px; font-size:12px; font-weight:600; color:#64748B; text-transform:uppercase; letter-spacing:0.5px;">Affected Components</p>
        ${affectedComponents.map((c) => `<p style="margin:0 0 4px; font-size:13px; color:#334155;">&bull; ${c.name}${c.status_after ? ` &mdash; <strong>${c.status_after}</strong>` : ''}</p>`).join('')}
      </div>`
    : '';

  const content = `
<!-- Status badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; padding:6px 14px; border-radius:20px; background:${sc.bg}; border:1px solid ${sc.border};">
    <span style="font-size:12px; font-weight:700; color:${sc.text}; letter-spacing:0.5px;">${sc.label}</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">${updateTitle}</h2>
<p style="margin:0 0 4px; font-size:13px; color:#64748B;">${pageName}</p>

${updateBody ? `<div style="margin:16px 0; padding:12px 16px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px;"><p style="margin:0; font-size:14px; color:#334155; line-height:1.6; white-space:pre-wrap;">${updateBody}</p></div>` : ''}

${componentsHtml}

${ctaButton('View Status Page', pageUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:11px; color:#94A3B8; line-height:1.5;">
  You're receiving this because you subscribed to status updates for ${pageName}.<br>
  <a href="${unsubUrl}" style="color:#64748B; text-decoration:underline;">Unsubscribe</a>
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `[${sc.label}] ${updateTitle} — ${pageName}`,
    html: emailWrapper(content),
    text: `[${sc.label}] ${updateTitle}\n\n${updateBody}\n\nView: ${pageUrl}\n\nUnsubscribe: ${unsubUrl}`,
    headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
  });
}

// ─── Subscription Confirmation Email ─────────────────────────────────────────

export async function sendSubscriptionConfirmEmail(opts: {
  to: string;
  pageName: string;
  slug: string;
  confirmToken: string;
}): Promise<void> {
  const { to, pageName, slug, confirmToken } = opts;
  const confirmUrl = `${APP_URL}/status/${slug}/confirm/${confirmToken}`;

  const content = `
<!-- Icon badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(34,197,94,0.12) 0%,rgba(34,197,94,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#128276;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Confirm your subscription</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  You requested to receive status updates for <strong style="color:#0F172A;">${pageName}</strong>. Please confirm your email address to start receiving notifications.
</p>

${ctaButton('Confirm Subscription', confirmUrl)}
${linkFallback(confirmUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  If you didn't request this, you can safely ignore this email.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `Confirm your subscription to ${pageName} status updates`,
    html: emailWrapper(content),
    text: `Confirm your subscription to ${pageName} status updates.\n\nConfirm: ${confirmUrl}\n\nIf you didn't request this, ignore this email.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Incident Notification Email ─────────────────────────────────────────────

export async function sendIncidentEmail(opts: {
  to: string;
  name: string;
  incidentNumber: number;
  incidentTitle: string;
  severity: number;
  orgName: string;
}): Promise<void> {
  const { to, name, incidentNumber, incidentTitle, severity, orgName } = opts;
  const incidentUrl = `${APP_URL}/incidents`;
  const incNumber = `INC-${String(incidentNumber).padStart(4, '0')}`;

  const sevColors: Record<number, { bg: string; border: string; text: string; label: string }> = {
    1: { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', label: 'SEV1 - Critical' },
    2: { bg: '#FFF7ED', border: '#FED7AA', text: '#EA580C', label: 'SEV2 - High' },
    3: { bg: '#FEFCE8', border: '#FDE68A', text: '#CA8A04', label: 'SEV3 - Medium' },
    4: { bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB', label: 'SEV4 - Low' },
    5: { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B', label: 'SEV5 - Info' },
  };
  const sev = sevColors[severity] || sevColors[3];

  const content = `
<!-- Severity badge -->
<div style="margin:0 0 20px;">
  <div style="display:inline-block; padding:6px 14px; border-radius:20px; background:${sev.bg}; border:1px solid ${sev.border};">
    <span style="font-size:12px; font-weight:700; color:${sev.text}; letter-spacing:0.5px;">${sev.label}</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">${incNumber}</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  Hi <strong style="color:#0F172A;">${name || 'there'}</strong>, a new incident has been declared in <strong style="color:#0F172A;">${orgName}</strong>:
</p>

<!-- Incident card -->
<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-left:4px solid ${sev.text}; border-radius:0 10px 10px 0; padding:16px 20px; margin:0 0 4px;">
  <p style="margin:0 0 4px; font-size:15px; font-weight:600; color:#0F172A;">${incidentTitle}</p>
  <p style="margin:0; font-size:12px; color:#64748B;">You are on-call and have been assigned as a responder.</p>
</div>

${ctaButton('View Incident', incidentUrl)}

${infoBox('&#128680; You are receiving this because you are currently on-call. Acknowledge the incident in the dashboard to stop further escalation.')}`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `[${sev.label}] ${incNumber}: ${incidentTitle}`,
    html: emailWrapper(content),
    text: `Hi ${name || 'there'},\n\n[${sev.label}] ${incNumber}: ${incidentTitle}\n\nYou are on-call. View the incident: ${incidentUrl}\n\nAcknowledge the incident to stop further escalation.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Weekly Digest Email ──────────────────────────────────────────────────────

export async function sendWeeklyDigestEmail(opts: {
  to: string;
  pageName: string;
  slug: string;
  weekStart: string;
  weekEnd: string;
  totalUpdates: number;
  incidentCount: number;
  resolvedCount: number;
  updates: Array<{ title: string; status: string; created_at: Date }>;
  unsubscribeToken: string;
}): Promise<void> {
  const {
    to, pageName, slug, weekStart, weekEnd,
    totalUpdates, incidentCount, resolvedCount, updates, unsubscribeToken,
  } = opts;
  const pageUrl = `${APP_URL}/status/${slug}`;
  const unsubUrl = `${APP_URL}/status/${slug}/unsubscribe/${unsubscribeToken}`;

  const statusColors: Record<string, string> = {
    investigating: '#B45309',
    identified: '#EA580C',
    monitoring: '#2563EB',
    resolved: '#16A34A',
    informational: '#64748B',
  };

  const updatesHtml = updates.length > 0
    ? updates.map((u) => {
        const color = statusColors[u.status] || '#64748B';
        const date = new Date(u.created_at).toUTCString().slice(0, 16);
        return `<tr>
          <td style="padding:8px 12px; border-bottom:1px solid #F1F5F9; font-size:13px; color:#334155;">${u.title}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #F1F5F9; font-size:12px; color:${color}; font-weight:600; text-transform:capitalize;">${u.status}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #F1F5F9; font-size:12px; color:#94A3B8;">${date}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:16px; text-align:center; color:#94A3B8; font-size:13px;">No updates this week — all systems operational.</td></tr>`;

  const content = `
<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A;">Weekly Status Summary</h2>
<p style="margin:0 0 20px; font-size:14px; color:#64748B;">${pageName} &middot; ${weekStart} — ${weekEnd}</p>

<div style="display:flex; gap:12px; margin:0 0 24px;">
  <div style="flex:1; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:16px; text-align:center;">
    <div style="font-size:28px; font-weight:700; color:#0F172A;">${totalUpdates}</div>
    <div style="font-size:12px; color:#64748B; margin-top:4px;">Total Updates</div>
  </div>
  <div style="flex:1; background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; padding:16px; text-align:center;">
    <div style="font-size:28px; font-weight:700; color:#DC2626;">${incidentCount}</div>
    <div style="font-size:12px; color:#64748B; margin-top:4px;">Incidents</div>
  </div>
  <div style="flex:1; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:16px; text-align:center;">
    <div style="font-size:28px; font-weight:700; color:#16A34A;">${resolvedCount}</div>
    <div style="font-size:12px; color:#64748B; margin-top:4px;">Resolved</div>
  </div>
</div>

<table style="width:100%; border-collapse:collapse; margin:0 0 24px;">
  <thead>
    <tr style="background:#F8FAFC;">
      <th style="padding:8px 12px; text-align:left; font-size:11px; font-weight:600; color:#64748B; text-transform:uppercase;">Update</th>
      <th style="padding:8px 12px; text-align:left; font-size:11px; font-weight:600; color:#64748B; text-transform:uppercase;">Status</th>
      <th style="padding:8px 12px; text-align:left; font-size:11px; font-weight:600; color:#64748B; text-transform:uppercase;">Date</th>
    </tr>
  </thead>
  <tbody>
    ${updatesHtml}
  </tbody>
</table>

${ctaButton('View Status Page', pageUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  You are receiving this weekly summary because you subscribed to ${pageName} status updates.
  <a href="${unsubUrl}" style="color:#64748B;">Unsubscribe</a>
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `Weekly Status Summary — ${pageName} (${weekStart} to ${weekEnd})`,
    html: emailWrapper(content),
    text: `Weekly Status Summary — ${pageName}\n${weekStart} to ${weekEnd}\n\nTotal Updates: ${totalUpdates}\nIncidents: ${incidentCount}\nResolved: ${resolvedCount}\n\nView: ${pageUrl}\nUnsubscribe: ${unsubUrl}`,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

// ─── Work Log Digest ─────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface WorkLogDigestItem {
  ticket_number: string;
  ticket_title: string;
  user_name: string;
  duration_minutes: number;
  logged_at: string;
  ticket_id: string;
}

export async function sendWorkLogDigestEmail(opts: {
  to: string;
  approverName: string;
  tenantName: string;
  pendingCount: number;
  items: WorkLogDigestItem[];
  approvalUrl: string;
}): Promise<void> {
  const rows = opts.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml(item.ticket_number)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml(item.ticket_title)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml(item.user_name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${Math.floor(item.duration_minutes / 60)}h ${item.duration_minutes % 60}m</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${item.logged_at}</td>
        </tr>`,
    )
    .join('');

  const content = `
    <h2 style="color:#0D1117;margin:0 0 8px;">Work Log Approval Digest</h2>
    <p style="color:#555;font-size:14px;">
      Hi ${escapeHtml(opts.approverName)}, you have <strong>${opts.pendingCount}</strong> pending work log${opts.pendingCount === 1 ? '' : 's'} awaiting your approval for <strong>${escapeHtml(opts.tenantName)}</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;">Ticket</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;">Title</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;">User</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;">Duration</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;">Date</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${opts.items.length < opts.pendingCount ? `<p style="color:#888;font-size:13px;">Showing ${opts.items.length} of ${opts.pendingCount} pending entries.</p>` : ''}
    ${ctaButton('Review & Approve', opts.approvalUrl)}
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"SREonCall" <no-reply@sreoncall.com>',
    to: opts.to,
    subject: `[SREonCall] ${opts.pendingCount} work log${opts.pendingCount === 1 ? '' : 's'} pending your approval`,
    html: emailWrapper(content),
  });
}

// ─── Activation Code Email ────────────────────────────────────────────────────

export interface ActivationCodeEmailOptions {
  to: string;
  tenantName: string;
  code: string;
  plan: string;
  durationMonths: number;
  expiresAt: Date;
}

export async function sendActivationCodeEmail(opts: ActivationCodeEmailOptions): Promise<void> {
  const { to, tenantName, code, plan, durationMonths, expiresAt } = opts;
  const billingUrl = `${APP_URL}/settings/billing`;
  const expiryStr = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const planDisplay = plan.charAt(0).toUpperCase() + plan.slice(1);
  const durationLabel = durationMonths === 1 ? '1 month' : `${durationMonths} months`;

  const content = `
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.15) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">&#127381;</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">Your activation code is ready</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">
  Hi <strong style="color:#0F172A;">${tenantName}</strong>, your SREonCall subscription activation code is below. Enter it on your billing page to upgrade to the <strong style="color:#FF6B2B;">${planDisplay}</strong> plan for <strong style="color:#0F172A;">${durationLabel}</strong>.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px; width:100%;">
  <tr>
    <td style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px; padding:20px; text-align:center;">
      <p style="margin:0 0 6px; font-size:11px; font-weight:600; color:#64748B; letter-spacing:1px; text-transform:uppercase;">Activation Code</p>
      <p style="margin:0; font-size:28px; font-weight:800; color:#0F172A; letter-spacing:4px; font-family:'Courier New',Courier,monospace;">${code}</p>
    </td>
  </tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px; width:100%; border-collapse:collapse;">
  <tr>
    <td style="padding:8px 0; border-bottom:1px solid #F1F5F9; font-size:13px; color:#64748B; width:40%;">Plan</td>
    <td style="padding:8px 0; border-bottom:1px solid #F1F5F9; font-size:13px; font-weight:600; color:#0F172A;">${planDisplay}</td>
  </tr>
  <tr>
    <td style="padding:8px 0; border-bottom:1px solid #F1F5F9; font-size:13px; color:#64748B;">Duration</td>
    <td style="padding:8px 0; border-bottom:1px solid #F1F5F9; font-size:13px; font-weight:600; color:#0F172A;">${durationLabel}</td>
  </tr>
  <tr>
    <td style="padding:8px 0; font-size:13px; color:#64748B;">Code valid until</td>
    <td style="padding:8px 0; font-size:13px; font-weight:600; color:#DC2626;">${expiryStr}</td>
  </tr>
</table>

${ctaButton('Redeem Code Now', billingUrl)}

<hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0;">
<p style="margin:0; font-size:12px; color:#94A3B8; line-height:1.5;">
  This code is valid only for your organization and expires on <strong>${expiryStr}</strong>. Do not share it with others.
</p>`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: `Your SREonCall subscription activation code — ${planDisplay} plan`,
    html: emailWrapper(content),
    text: `Your SREonCall Activation Code\n\nCode: ${code}\nPlan: ${planDisplay}\nDuration: ${durationLabel}\nExpires: ${expiryStr}\n\nRedeem at: ${billingUrl}\n\nDo not share this code.`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}

// ─── Credential Rotation Emails (platform ops) ────────────────────────────────

export interface CredentialRotationEmailOptions {
  to: string;
  credentialName: string;
  credentialKey: string;
  kind: 'success' | 'failure' | 'due_soon';
  error?: string | null;
  nextRotationAt?: Date | null;
}

export async function sendCredentialRotationEmail(opts: CredentialRotationEmailOptions): Promise<void> {
  const { to, credentialName, credentialKey, kind, error, nextRotationAt } = opts;
  const registryUrl = `${APP_URL}/admin/config`;

  const copy = {
    success: {
      icon: '&#9989;',
      heading: 'Credential rotated successfully',
      body: `<strong style="color:#0F172A;">${credentialName}</strong> (<code>${credentialKey}</code>) was auto-rotated successfully. No action is needed.`,
      subject: `[SREonCall] Credential rotated: ${credentialName}`,
    },
    failure: {
      icon: '&#10060;',
      heading: 'Credential rotation failed',
      body: `Auto-rotation of <strong style="color:#0F172A;">${credentialName}</strong> (<code>${credentialKey}</code>) failed${error ? `: <strong style="color:#DC2626;">${escapeHtml(error)}</strong>` : '.'} It will be retried on the next scheduled check, but you may need to rotate it manually.`,
      subject: `[SREonCall] Credential rotation FAILED: ${credentialName}`,
    },
    due_soon: {
      icon: '&#9200;',
      heading: 'Credential rotation due soon',
      body: `<strong style="color:#0F172A;">${credentialName}</strong> (<code>${credentialKey}</code>) is due for rotation${nextRotationAt ? ` on <strong style="color:#0F172A;">${nextRotationAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>` : ' soon'}.`,
      subject: `[SREonCall] Credential rotation due soon: ${credentialName}`,
    },
  }[kind];

  const content = `
<div style="margin:0 0 20px;">
  <div style="display:inline-block; width:48px; height:48px; border-radius:12px; background:linear-gradient(135deg,rgba(255,107,43,0.12) 0%,rgba(255,107,43,0.06) 100%); text-align:center; line-height:48px;">
    <span style="font-size:22px;">${copy.icon}</span>
  </div>
</div>

<h2 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#0F172A; letter-spacing:-0.3px;">${copy.heading}</h2>
<p style="margin:0 0 24px; font-size:15px; color:#334155; line-height:1.6;">${copy.body}</p>

${ctaButton('View Credential Registry', registryUrl)}
${linkFallback(registryUrl)}`;

  await transporter.sendMail({
    from: `SREonCall <${FROM}>`,
    to,
    subject: copy.subject,
    html: emailWrapper(content),
    text: `${copy.heading}\n\n${credentialName} (${credentialKey})\n\nView the credential registry: ${registryUrl}`,
    headers: { 'List-Unsubscribe': `<${APP_URL}/settings>` },
  });
}
