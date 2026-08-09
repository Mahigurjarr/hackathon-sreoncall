'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Building2,
  Settings,
  Link2,
  Palette,
  BarChart3,
  Server,
  Bell,
  Activity,
  LayoutDashboard,
  Plug,
  Globe,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

// ─── Step definitions ────────────────────────────────────────────────

const STEPS = [
  { key: 'client_details', label: 'Client Details', icon: Building2 },
  { key: 'tenant_setup', label: 'Tenant Setup', icon: Settings },
  { key: 'provider_links', label: 'Provider Links', icon: Link2 },
  { key: 'branding', label: 'Branding', icon: Palette },
  { key: 'observability', label: 'Observability', icon: BarChart3 },
  { key: 'services_teams', label: 'Services & Teams', icon: Server },
  { key: 'alerting', label: 'Alerting', icon: Bell },
  { key: 'synthetic_monitoring', label: 'Synthetic Monitoring', icon: Activity },
  { key: 'dashboards', label: 'Dashboards', icon: LayoutDashboard },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'status_pages', label: 'Status Pages', icon: Globe },
  { key: 'compliance', label: 'Compliance & Verification', icon: ShieldCheck },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// ─── Form field helpers ──────────────────────────────────────────────

function TextField({ label, value, onChange, placeholder, multiline }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
}) {
  const cls = "w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]";
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">{label}</label>
      {multiline ? (
        <textarea className={`${cls} py-2.5`} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className={`${cls} h-[42px]`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-[#E2E8F0] text-[#FF6B2B] focus:ring-[#FF6B2B]" />
      <span className="text-[13px] text-[#334155] dark:text-[#E2E8F0]">{label}</span>
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">{label}</label>
      <select
        className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Step content components ─────────────────────────────────────────

function useFormField(formData: Record<string, any>, setFormData: (d: Record<string, any>) => void, step: string) {
  const get = (field: string) => formData[step]?.[field] ?? '';
  const getBool = (field: string) => formData[step]?.[field] ?? false;
  const set = (field: string, value: any) => {
    setFormData({
      ...formData,
      [step]: { ...(formData[step] || {}), [field]: value },
    });
  };
  return { get, getBool, set };
}

function StepClientDetails({ formData, setFormData }: StepProps) {
  const { get, set } = useFormField(formData, setFormData, 'client_details');
  return (
    <div className="space-y-4">
      <TextField label="Company Name" value={get('company_name')} onChange={(v) => set('company_name', v)} placeholder="Acme Corp" />
      <TextField label="Company Domain / Website" value={get('domain')} onChange={(v) => set('domain', v)} placeholder="acme.com" />
      <TextField label="Primary Contact Name" value={get('contact_name')} onChange={(v) => set('contact_name', v)} placeholder="Jane Smith" />
      <TextField label="Primary Contact Email" value={get('contact_email')} onChange={(v) => set('contact_email', v)} placeholder="jane@acme.com" />
      <TextField label="Primary Contact Phone" value={get('contact_phone')} onChange={(v) => set('contact_phone', v)} placeholder="+1 555 0100" />
      <SelectField label="Plan" value={get('plan') || 'free'} onChange={(v) => set('plan', v)} options={[
        { value: 'free', label: 'Free' }, { value: 'starter', label: 'Starter' }, { value: 'business', label: 'Business' }, { value: 'enterprise', label: 'Enterprise' },
      ]} />
      <TextField label="Admin Email" value={get('admin_email')} onChange={(v) => set('admin_email', v)} placeholder="admin@acme.com" />
      <TextField label="Admin Name" value={get('admin_name')} onChange={(v) => set('admin_name', v)} placeholder="Admin User" />
      <SelectField label="Infrastructure Type" value={get('infrastructure') || 'vms'} onChange={(v) => set('infrastructure', v)} options={[
        { value: 'vms', label: 'VMs' }, { value: 'kubernetes', label: 'Kubernetes' }, { value: 'aws', label: 'AWS' }, { value: 'hybrid', label: 'Hybrid' },
      ]} />
    </div>
  );
}

function StepTenantSetup({ formData, setFormData }: StepProps) {
  const { get, set } = useFormField(formData, setFormData, 'tenant_setup');
  return (
    <div className="space-y-4">
      <SelectField label="Tenant Type" value={get('tenant_type') || 'standalone'} onChange={(v) => set('tenant_type', v)} options={[
        { value: 'standalone', label: 'Standalone' }, { value: 'consumer', label: 'Consumer (needs provider link)' },
      ]} />
      <TextField label="Timezone" value={get('timezone')} onChange={(v) => set('timezone', v)} placeholder="Asia/Kolkata, America/New_York, etc." />
      <TextField label="Logo Notes" value={get('logo_notes')} onChange={(v) => set('logo_notes', v)} placeholder="Logo will be uploaded later / URL to logo" multiline />
    </div>
  );
}

function StepProviderLinks({ formData, setFormData }: StepProps) {
  const { get, set } = useFormField(formData, setFormData, 'provider_links');
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Skip this section if the tenant is standalone.</p>
      <TextField label="Provider Tenant Slug" value={get('provider_slug')} onChange={(v) => set('provider_slug', v)} placeholder="e.g., alygrp" />
      <TextField label="Scopes" value={get('scopes')} onChange={(v) => set('scopes', v)} placeholder="incidents, tickets, escalations, oncall, runbooks" multiline />
    </div>
  );
}

function StepBranding({ formData, setFormData }: StepProps) {
  const { get, set } = useFormField(formData, setFormData, 'branding');
  return (
    <div className="space-y-4">
      <TextField label="Primary Color" value={get('primary_color')} onChange={(v) => set('primary_color', v)} placeholder="#FF6B2B" />
      <TextField label="Accent Color" value={get('accent_color')} onChange={(v) => set('accent_color', v)} placeholder="#0D1117" />
      <TextField label="Logo URL or Notes" value={get('logo')} onChange={(v) => set('logo', v)} placeholder="URL to logo or instructions" />
      <TextField label="Favicon URL or Notes" value={get('favicon')} onChange={(v) => set('favicon', v)} placeholder="URL to favicon (32x32)" />
      <TextField label="Custom Domain (optional)" value={get('custom_domain')} onChange={(v) => set('custom_domain', v)} placeholder="monitoring.client.com" />
    </div>
  );
}

function StepObservability({ formData, setFormData }: StepProps) {
  const { get, set, getBool } = useFormField(formData, setFormData, 'observability');
  return (
    <div className="space-y-4">
      <CheckField label="Client needs observability agent (Alloy) installed" checked={getBool('needs_alloy')} onChange={(v) => set('needs_alloy', v)} />
      <TextField label="VMs / Nodes to Monitor" value={get('nodes')} onChange={(v) => set('nodes', v)} placeholder="List VM names and IPs, one per line" multiline />
      <TextField label="Ingestion Endpoint Notes" value={get('endpoint_notes')} onChange={(v) => set('endpoint_notes', v)} placeholder="Any special requirements for ingestion" multiline />
      <CheckField label="AWS Cloud connections needed" checked={getBool('needs_aws')} onChange={(v) => set('needs_aws', v)} />
      <TextField label="AWS Account Details (if applicable)" value={get('aws_details')} onChange={(v) => set('aws_details', v)} placeholder="Account IDs, regions, etc." multiline />
      <CheckField label="Network device monitoring (SNMP/syslog)" checked={getBool('needs_network_monitoring')} onChange={(v) => set('needs_network_monitoring', v)} />
    </div>
  );
}

function StepServicesTeams({ formData, setFormData }: StepProps) {
  const { get, set } = useFormField(formData, setFormData, 'services_teams');
  return (
    <div className="space-y-4">
      <TextField label="Services to Register" value={get('services')} onChange={(v) => set('services', v)} placeholder="List services (one per line): name, type" multiline />
      <TextField label="Teams" value={get('teams')} onChange={(v) => set('teams', v)} placeholder="List teams (one per line): name, members" multiline />
      <TextField label="Users to Invite" value={get('users')} onChange={(v) => set('users', v)} placeholder="List users (one per line): email, role (viewer/agent/manager/tenant_admin)" multiline />
    </div>
  );
}

function StepAlerting({ formData, setFormData }: StepProps) {
  const { get, set, getBool } = useFormField(formData, setFormData, 'alerting');
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Select alert templates to enable:</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {['CPU High', 'Memory High', 'Disk Full', 'Node Down', 'Error Log Spike', 'OOM Killed', 'HTTP Error Rate', 'Latency P99', 'Pod CrashLoop', 'Deployment Unhealthy'].map((t) => (
          <CheckField key={t} label={t} checked={getBool(`template_${t.toLowerCase().replace(/\s+/g, '_')}`)} onChange={(v) => set(`template_${t.toLowerCase().replace(/\s+/g, '_')}`, v)} />
        ))}
      </div>
      <TextField label="Custom Alert Rules" value={get('custom_alerts')} onChange={(v) => set('custom_alerts', v)} placeholder="Describe any custom PromQL/LogQL alerts needed" multiline />
      <TextField label="On-Call Schedule" value={get('oncall_schedule')} onChange={(v) => set('oncall_schedule', v)} placeholder="Rotation type, timezone, handoff time, participants" multiline />
      <TextField label="Escalation Policy" value={get('escalation_policy')} onChange={(v) => set('escalation_policy', v)} placeholder="Describe escalation levels and timeouts" multiline />
    </div>
  );
}

function StepSyntheticMonitoring({ formData, setFormData }: StepProps) {
  const { get, set } = useFormField(formData, setFormData, 'synthetic_monitoring');
  return (
    <div className="space-y-4">
      <TextField label="Endpoints to Monitor" value={get('endpoints')} onChange={(v) => set('endpoints', v)} placeholder="One per line: name, URL, interval (e.g., 60s)" multiline />
      <TextField label="Expected Response Thresholds" value={get('thresholds')} onChange={(v) => set('thresholds', v)} placeholder="e.g., response time < 500ms, status 200" multiline />
    </div>
  );
}

function StepDashboards({ formData, setFormData }: StepProps) {
  const { get, set, getBool } = useFormField(formData, setFormData, 'dashboards');
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Select dashboard templates to instantiate:</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {['System Overview', 'Node Detail', 'HTTP Overview', 'Log Explorer', 'MongoDB', 'Redis', 'Kubernetes', 'AWS Overview'].map((t) => (
          <CheckField key={t} label={t} checked={getBool(`template_${t.toLowerCase().replace(/\s+/g, '_')}`)} onChange={(v) => set(`template_${t.toLowerCase().replace(/\s+/g, '_')}`, v)} />
        ))}
      </div>
      <TextField label="Custom Dashboards" value={get('custom_dashboards')} onChange={(v) => set('custom_dashboards', v)} placeholder="Describe any custom dashboards needed" multiline />
    </div>
  );
}

function StepIntegrations({ formData, setFormData }: StepProps) {
  const { get, set, getBool } = useFormField(formData, setFormData, 'integrations');
  return (
    <div className="space-y-4">
      <CheckField label="Slack Integration" checked={getBool('slack')} onChange={(v) => set('slack', v)} />
      {formData.integrations?.slack && (
        <>
          <TextField label="Slack Workspace" value={get('slack_workspace')} onChange={(v) => set('slack_workspace', v)} placeholder="workspace-name" />
          <TextField label="Slack Channel Mapping" value={get('slack_channels')} onChange={(v) => set('slack_channels', v)} placeholder="Incidents: #incidents\nAlerts: #alerts\nOn-Call: #oncall" multiline />
        </>
      )}
      <CheckField label="Email Notifications" checked={getBool('email')} onChange={(v) => set('email', v)} />
      <CheckField label="Outbound Webhooks" checked={getBool('webhooks')} onChange={(v) => set('webhooks', v)} />
      {formData.integrations?.webhooks && (
        <TextField label="Webhook Details" value={get('webhook_details')} onChange={(v) => set('webhook_details', v)} placeholder="Target URLs and events" multiline />
      )}
    </div>
  );
}

function StepStatusPages({ formData, setFormData }: StepProps) {
  const { get, set, getBool } = useFormField(formData, setFormData, 'status_pages');
  return (
    <div className="space-y-4">
      <CheckField label="Enable Public Status Page" checked={getBool('enabled')} onChange={(v) => set('enabled', v)} />
      {formData.status_pages?.enabled && (
        <>
          <TextField label="Status Page Name" value={get('name')} onChange={(v) => set('name', v)} placeholder="Acme Status" />
          <TextField label="Subdomain or Custom Domain" value={get('domain')} onChange={(v) => set('domain', v)} placeholder="status.acme.com or leave blank for default" />
          <TextField label="Components" value={get('components')} onChange={(v) => set('components', v)} placeholder="List components to show on status page (one per line)" multiline />
        </>
      )}
    </div>
  );
}

function StepCompliance({ formData, setFormData }: StepProps) {
  const { get, set, getBool } = useFormField(formData, setFormData, 'compliance');
  return (
    <div className="space-y-4">
      <CheckField label="GDPR applies (EU users/data)" checked={getBool('gdpr')} onChange={(v) => set('gdpr', v)} />
      <CheckField label="DPDP Act applies (Indian users/data)" checked={getBool('dpdp')} onChange={(v) => set('dpdp', v)} />
      <CheckField label="DPA (Data Processing Agreement) required" checked={getBool('dpa_required')} onChange={(v) => set('dpa_required', v)} />
      <CheckField label="MFA enforcement required" checked={getBool('mfa_required')} onChange={(v) => set('mfa_required', v)} />
      <CheckField label="SSO required" checked={getBool('sso_required')} onChange={(v) => set('sso_required', v)} />
      {formData.compliance?.sso_required && (
        <TextField label="SSO Provider Details" value={get('sso_details')} onChange={(v) => set('sso_details', v)} placeholder="OIDC / SAML, provider name, redirect URLs" multiline />
      )}
      <CheckField label="SCIM provisioning required" checked={getBool('scim_required')} onChange={(v) => set('scim_required', v)} />
      <TextField label="Additional Compliance Notes" value={get('notes')} onChange={(v) => set('notes', v)} placeholder="Any other compliance requirements" multiline />

      <div className="mt-6 p-4 rounded-lg bg-[#F0F9FF] dark:bg-[#0F172A] border border-[#BAE6FD] dark:border-[#1E293B]">
        <h4 className="text-sm font-semibold text-[#0369A1] dark:text-[#38BDF8] mb-2">Final Checklist</h4>
        <div className="space-y-2">
          <CheckField label="All client details are accurate" checked={getBool('checklist_details')} onChange={(v) => set('checklist_details', v)} />
          <CheckField label="Observability requirements documented" checked={getBool('checklist_observability')} onChange={(v) => set('checklist_observability', v)} />
          <CheckField label="Integration requirements documented" checked={getBool('checklist_integrations')} onChange={(v) => set('checklist_integrations', v)} />
          <CheckField label="Ready for review" checked={getBool('checklist_ready')} onChange={(v) => set('checklist_ready', v)} />
        </div>
      </div>
    </div>
  );
}

// ─── Step render map ─────────────────────────────────────────────────

interface StepProps {
  formData: Record<string, any>;
  setFormData: (d: Record<string, any>) => void;
}

const STEP_COMPONENTS: Record<StepKey, (props: StepProps) => ReactNode> = {
  client_details: (p) => <StepClientDetails {...p} />,
  tenant_setup: (p) => <StepTenantSetup {...p} />,
  provider_links: (p) => <StepProviderLinks {...p} />,
  branding: (p) => <StepBranding {...p} />,
  observability: (p) => <StepObservability {...p} />,
  services_teams: (p) => <StepServicesTeams {...p} />,
  alerting: (p) => <StepAlerting {...p} />,
  synthetic_monitoring: (p) => <StepSyntheticMonitoring {...p} />,
  dashboards: (p) => <StepDashboards {...p} />,
  integrations: (p) => <StepIntegrations {...p} />,
  status_pages: (p) => <StepStatusPages {...p} />,
  compliance: (p) => <StepCompliance {...p} />,
};

// ─── Main Form ───────────────────────────────────────────────────────

function OnboardingForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ tenant_name: string; status: string; expired: boolean } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    fetch(`/api/v1/public/onboarding/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || 'Failed to load onboarding.');
        }
        return res.json();
      })
      .then((data) => {
        setMeta(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  async function handleSubmit() {
    if (!token) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/public/onboarding/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_data: formData }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || body.message || 'Failed to submit onboarding form.');
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    }
    setSubmitting(false);
  }

  // Loading state
  if (loading) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#FF6B2B]" />
      </div>
    );
  }

  // No token
  if (!token) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[#DC2626]" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Invalid Link</h2>
        <p className="mb-6 text-[14px] text-[#64748B]">
          This onboarding link is invalid. Please check the link from your email.
        </p>
        <Link
          href="/signin"
          className="inline-flex items-center justify-center rounded-[10px] border-[1.5px] border-[#E2E8F0] bg-white dark:bg-navy-elevated px-6 text-[14px] font-medium text-[#334155] dark:text-[#E2E8F0] transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.06]"
          style={{ height: 44 }}
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  // Error loading
  if (error && !meta) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[#DC2626]" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Error</h2>
        <p className="mb-6 text-[14px] text-[#64748B]">{error}</p>
      </div>
    );
  }

  // Expired
  if (meta?.expired) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[#DC2626]" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Link Expired</h2>
        <p className="text-[14px] text-[#64748B]">
          This onboarding link has expired. Please contact your SREonCall administrator for a new link.
        </p>
      </div>
    );
  }

  // Already submitted
  if (meta?.status !== 'pending_submission' && !submitted) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Already Submitted</h2>
        <p className="text-[14px] text-[#64748B]">
          This onboarding form has already been submitted. Your submission is being reviewed.
        </p>
      </div>
    );
  }

  // Submitted success
  if (submitted) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Submitted!</h2>
        <p className="text-[14px] text-[#64748B]">
          The onboarding form for <strong>{meta?.tenant_name}</strong> has been submitted successfully.
          An administrator will review your submission shortly.
        </p>
      </div>
    );
  }

  // Wizard form
  const step = STEPS[currentStep];
  const StepIcon = step.icon;

  return (
    <div className="w-full max-w-[740px]">
      {/* Header */}
      <div className="mb-6 text-center">
        <h1 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
          Onboarding: {meta?.tenant_name}
        </h1>
        <p className="mt-1 text-[14px] text-[#64748B]">
          Complete the form below to onboard this customer onto SREonCall.
        </p>
      </div>

      {/* Step indicators */}
      <div className="mb-6 flex items-center justify-center gap-1.5">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setCurrentStep(i)}
            className={`h-2 rounded-full transition-all ${
              i === currentStep
                ? 'w-8 bg-[#FF6B2B]'
                : i < currentStep
                ? 'w-2 bg-[#FF6B2B]/40'
                : 'w-2 bg-[#E2E8F0] dark:bg-[#1E293B]'
            }`}
            title={s.label}
          />
        ))}
      </div>

      {/* Form card */}
      <div className="rounded-[14px] bg-white dark:bg-navy-surface shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
        {/* Step header */}
        <div className="border-b border-[#E2E8F0] dark:border-[#1E293B] px-8 py-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.1)]">
            <StepIcon className="h-5 w-5 text-[#FF6B2B]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">{step.label}</h2>
            <p className="text-[12px] text-[#64748B]">Step {currentStep + 1} of {STEPS.length}</p>
          </div>
        </div>

        {/* Step content */}
        <div className="px-8 py-6">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {STEP_COMPONENTS[step.key]({ formData, setFormData })}
        </div>

        {/* Navigation */}
        <div className="border-t border-[#E2E8F0] dark:border-[#1E293B] px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-1.5 text-[14px] font-medium text-[#64748B] transition-colors hover:text-[#334155] disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>

          {currentStep < STEPS.length - 1 ? (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              className="flex items-center gap-1.5 rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Submit
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#FF6B2B]" />
      </div>
    }>
      <OnboardingForm />
    </Suspense>
  );
}
