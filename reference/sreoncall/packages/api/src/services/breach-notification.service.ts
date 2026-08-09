import { Types } from 'mongoose';
import { BreachReport, BreachReportDocument, BreachSeverity } from '../models/breach-report.model';
import { User } from '../models/user.model';
import { Tenant } from '../models/tenant.model';
import { logger } from '../utils/logger';
import nodemailer from 'nodemailer';

// Matches the transporter config in email.service.ts — this file previously
// pointed at an unconfigured SendGrid host, which meant breach notifications
// silently never sent since no SENDGRID_API_KEY exists in this SES-based deployment.
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

export async function createBreachReport(input: {
  title: string;
  description: string;
  severity: BreachSeverity;
  affected_tenants: string[];
  affected_user_count: number;
  data_categories_affected: string[];
  reported_by: Types.ObjectId;
}): Promise<BreachReportDocument> {
  const detected_at = new Date();
  // GDPR Art 33: 72-hour deadline from detection
  const authority_report_deadline = new Date(detected_at.getTime() + 72 * 60 * 60 * 1000);

  return BreachReport.create({
    title: input.title,
    description: input.description,
    severity: input.severity,
    status: 'detected',
    detected_at,
    affected_tenants: input.affected_tenants.map((id) => new Types.ObjectId(id)),
    affected_user_count: input.affected_user_count,
    data_categories_affected: input.data_categories_affected,
    reported_by: input.reported_by,
    authority_report_deadline,
  });
}

export async function notifyAffectedUsers(breachId: string): Promise<number> {
  const breach = await BreachReport.findById(breachId);
  if (!breach) throw new Error('Breach report not found');

  let notified = 0;

  for (const tenantId of breach.affected_tenants) {
    const users = await User.find({
      tenant_id: tenantId,
      status: 'active',
    }).select('email name');

    for (const user of users) {
      try {
        await sendBreachNotificationEmail({
          to: user.email,
          name: user.name,
          breachTitle: breach.title,
          breachDescription: breach.description,
          detectedAt: breach.detected_at,
          dataCategories: breach.data_categories_affected,
        });
        notified++;
      } catch (err: any) {
        logger.error('Failed to send breach notification', {
          userId: user._id.toString(),
          error: err.message,
        });
      }
    }
  }

  breach.notifications_sent = true;
  await breach.save();

  return notified;
}

export async function generateAuthorityReport(breachId: string): Promise<Record<string, any>> {
  const breach = await BreachReport.findById(breachId);
  if (!breach) throw new Error('Breach report not found');

  const affectedTenants = await Tenant.find({
    _id: { $in: breach.affected_tenants },
  }).select('name slug');

  return {
    report_type: 'GDPR Article 33 / DPDP Section 8 — Data Breach Notification',
    generated_at: new Date().toISOString(),
    breach: {
      title: breach.title,
      description: breach.description,
      severity: breach.severity,
      status: breach.status,
      detected_at: breach.detected_at.toISOString(),
      contained_at: breach.contained_at?.toISOString() || null,
      authority_report_deadline: breach.authority_report_deadline.toISOString(),
      time_remaining_hours: Math.max(
        0,
        (breach.authority_report_deadline.getTime() - Date.now()) / (1000 * 60 * 60)
      ).toFixed(1),
    },
    impact: {
      affected_tenants: affectedTenants.map((t) => ({ name: t.name, slug: t.slug })),
      affected_user_count: breach.affected_user_count,
      data_categories_affected: breach.data_categories_affected,
    },
    response: {
      root_cause: breach.root_cause || 'Under investigation',
      remediation_steps: breach.remediation_steps,
      notifications_sent: breach.notifications_sent,
    },
    data_controller: {
      name: 'SREonCall',
      dpo_contact: 'dpo@sreoncall.com',
      address: 'India',
    },
  };
}

async function sendBreachNotificationEmail(opts: {
  to: string;
  name: string;
  breachTitle: string;
  breachDescription: string;
  detectedAt: Date;
  dataCategories: string[];
}): Promise<void> {
  const { to, name, breachTitle, breachDescription, detectedAt, dataCategories } = opts;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#F1F5F9; font-family:'Inter',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;">
    <tr><td style="padding:40px 20px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" align="center" style="max-width:520px; width:100%; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#DC2626 0%,#991B1B 100%); padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><img src="${process.env.APP_URL || 'https://app.sreoncall.com'}/logo/sreoncall-logo.png" alt="SREonCall" width="100" height="32" style="display:inline-block;vertical-align:middle;border:0;" /></td>
            <td align="right"><p style="margin:0; font-size:13px; font-weight:700; color:#FFFFFF; opacity:0.9;">Security Notice</p></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:36px 32px 32px;">
          <h2 style="margin:0 0 12px; font-size:20px; font-weight:700; color:#0F172A;">Data Security Incident</h2>
          <p style="margin:0 0 16px; font-size:14px; color:#334155; line-height:1.6;">
            Hi <strong>${name || 'there'}</strong>, we are writing to inform you about a data security incident
            that may affect your account.
          </p>
          <div style="background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; padding:16px; margin:0 0 16px;">
            <p style="margin:0 0 4px; font-size:14px; font-weight:600; color:#DC2626;">${breachTitle}</p>
            <p style="margin:0; font-size:13px; color:#991B1B;">${breachDescription}</p>
          </div>
          <p style="margin:0 0 8px; font-size:13px; color:#64748B;">
            <strong>Detected:</strong> ${detectedAt.toISOString().split('T')[0]}
          </p>
          <p style="margin:0 0 16px; font-size:13px; color:#64748B;">
            <strong>Data categories potentially affected:</strong> ${dataCategories.join(', ')}
          </p>
          <p style="margin:0 0 16px; font-size:14px; color:#334155; line-height:1.6;">
            We recommend changing your password and enabling MFA if not already active.
            Contact <a href="mailto:dpo@sreoncall.com" style="color:#DC2626;">dpo@sreoncall.com</a> for questions.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: `SREonCall Security <${FROM}>`,
    to,
    subject: `[Security Notice] ${breachTitle} — SREonCall`,
    html,
    text: `Security Notice: ${breachTitle}\n\n${breachDescription}\n\nDetected: ${detectedAt.toISOString()}\nData categories: ${dataCategories.join(', ')}\n\nWe recommend changing your password and enabling MFA.\n\nContact: dpo@sreoncall.com`,
    headers: { 'List-Unsubscribe': `<mailto:dpo@sreoncall.com>` },
  });
}
