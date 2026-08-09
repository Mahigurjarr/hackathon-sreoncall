'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ticket,
  Plus,
  Send,
  Ban,
  Copy,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  useActivationCodes,
  useGenerateCode,
  useRevokeCode,
  useResendCodeEmail,
  type ActivationCode,
  type ActivationCodeStatus,
} from '@/lib/hooks/useActivationCodes';
import { useBillingPlans } from '@/lib/hooks/useBilling';
import { api } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TenantItem {
  _id: string;
  name: string;
  slug?: string;
}

interface TenantsListResponse {
  data: TenantItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function defaultExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Redeemed', value: 'redeemed' },
  { label: 'Expired', value: 'expired' },
  { label: 'Revoked', value: 'revoked' },
];

const DURATION_OPTIONS = [
  { label: '1 month', value: 1 },
  { label: '3 months', value: 3 },
  { label: '6 months', value: 6 },
  { label: '12 months', value: 12 },
  { label: '24 months', value: 24 },
];

function statusBadge(status: ActivationCodeStatus) {
  const map: Record<ActivationCodeStatus, string> = {
    pending: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    redeemed: 'bg-green-500/10 text-green-400 border border-green-500/20',
    expired: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
    revoked: 'bg-red-500/10 text-red-400 border border-red-500/20',
  };
  return map[status] ?? map.expired;
}

// ─── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      title="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── Generate Drawer ───────────────────────────────────────────────────────────

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  tenants: TenantItem[];
}

function GenerateDrawer({ open, onClose, tenants }: DrawerProps) {
  const generateCode = useGenerateCode();
  const { data: plansData } = useBillingPlans();

  const plans: import('@/lib/hooks/useBilling').BillingPlan[] = plansData?.data ?? [];

  const [tenantId, setTenantId] = useState('');
  const [plan, setPlan] = useState('');
  const [durationMonths, setDurationMonths] = useState(12);
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [generatedCode, setGeneratedCode] = useState<ActivationCode | null>(null);

  function reset() {
    setTenantId('');
    setPlan('');
    setDurationMonths(12);
    setExpiresAt(defaultExpiry());
    setNotes('');
    setSendEmail(true);
    setGeneratedCode(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId || !plan) {
      toast.error('Please select a tenant and plan');
      return;
    }
    try {
      const result = await generateCode.mutateAsync({
        tenant_id: tenantId,
        plan,
        duration_months: durationMonths,
        expires_at: new Date(expiresAt).toISOString(),
        notes: notes || undefined,
        send_email: sendEmail,
      });
      setGeneratedCode(result);
      toast.success('Activation code generated');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate code';
      toast.error(msg);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col
          bg-[#161B22] border-l border-[#1E293B] shadow-2xl
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1E293B] px-6 py-4">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-[#FF6B2B]" />
            <h2 className="text-[15px] font-semibold text-white">Generate Activation Code</h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-[#64748B] hover:bg-white/[0.06] hover:text-[#94A3B8]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {generatedCode ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-green-500/20 bg-green-500/[0.06] p-4">
                <p className="mb-2 text-[12px] font-medium uppercase tracking-wider text-green-400">
                  Code Generated Successfully
                </p>
                <div className="flex items-center gap-2 rounded-lg bg-[#0D1117] px-4 py-3">
                  <span className="flex-1 font-mono text-[18px] font-bold tracking-widest text-white">
                    {generatedCode?.code}
                  </span>
                  <CopyButton text={generatedCode?.code ?? ''} />
                </div>
                {generatedCode?.email_sent && (
                  <p className="mt-2 text-[11px] text-[#64748B]">
                    Email has been sent to the tenant admin.
                  </p>
                )}
              </div>
              <button
                onClick={reset}
                className="w-full rounded-lg border border-[#1E293B] px-4 py-2 text-[13px] text-[#94A3B8] hover:bg-white/[0.04]"
              >
                Generate Another
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Tenant */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#94A3B8]">
                  Tenant <span className="text-[#FF6B2B]">*</span>
                </label>
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[#1E293B] bg-[#0D1117] px-3 py-2 text-[13px] text-white
                    focus:border-[#FF6B2B] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]/30"
                >
                  <option value="">Select tenant…</option>
                  {tenants.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name} {t.slug ? `(${t.slug})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Plan */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#94A3B8]">
                  Plan <span className="text-[#FF6B2B]">*</span>
                </label>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[#1E293B] bg-[#0D1117] px-3 py-2 text-[13px] text-white
                    focus:border-[#FF6B2B] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]/30"
                >
                  <option value="">Select plan…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name.charAt(0).toUpperCase() + p.name.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Duration */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#94A3B8]">
                  Duration
                </label>
                <select
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(Number(e.target.value))}
                  className="w-full rounded-lg border border-[#1E293B] bg-[#0D1117] px-3 py-2 text-[13px] text-white
                    focus:border-[#FF6B2B] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]/30"
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Expiry date */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#94A3B8]">
                  Code Expires On
                </label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-lg border border-[#1E293B] bg-[#0D1117] px-3 py-2 text-[13px] text-white
                    focus:border-[#FF6B2B] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]/30
                    [color-scheme:dark]"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#94A3B8]">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Internal notes (optional)"
                  className="w-full resize-none rounded-lg border border-[#1E293B] bg-[#0D1117] px-3 py-2 text-[13px] text-white placeholder-[#475569]
                    focus:border-[#FF6B2B] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]/30"
                />
              </div>

              {/* Send email toggle */}
              <div className="flex items-center justify-between rounded-lg border border-[#1E293B] bg-[#0D1117]/50 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-white">Send email on generate</p>
                  <p className="text-[11px] text-[#64748B]">Notify tenant via email with the code</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSendEmail((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors
                    ${sendEmail ? 'bg-[#FF6B2B]' : 'bg-[#1E293B]'}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform
                      ${sendEmail ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={generateCode.isPending}
                className="w-full rounded-lg bg-[#FF6B2B] px-4 py-2.5 text-[13px] font-semibold text-white
                  hover:bg-[#FF6B2B]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generateCode.isPending ? 'Generating…' : 'Generate Code'}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ActivationCodesPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const revokeCode = useRevokeCode();
  const resendEmail = useResendCodeEmail();

  const { data, isLoading } = useActivationCodes(
    { status: statusFilter || undefined },
    page
  );

  const { data: allTenantsData } = useQuery<TenantsListResponse>({
    queryKey: ['admin-tenants-lookup'],
    queryFn: () => api.get<TenantsListResponse>('/api/v1/platform-admin/tenants', { limit: 500 }),
  });

  const tenantMap = useMemo(() => {
    const map: Record<string, string> = {};
    allTenantsData?.data?.forEach((t) => { map[t._id] = t.name; });
    return map;
  }, [allTenantsData]);

  const codes: ActivationCode[] = data?.data ?? [];
  const pagination = data?.pagination;

  function handleStatusFilter(val: string) {
    setStatusFilter(val);
    setPage(1);
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this activation code?')) return;
    try {
      await revokeCode.mutateAsync(id);
      toast.success('Code revoked');
    } catch {
      toast.error('Failed to revoke code');
    }
  }

  async function handleResend(id: string) {
    try {
      await resendEmail.mutateAsync(id);
      toast.success('Email sent');
    } catch {
      toast.error('Failed to send email');
    }
  }

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FF6B2B]/10">
            <Ticket className="h-5 w-5 text-[#FF6B2B]" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-foreground">Activation Codes</h1>
            <p className="text-[12px] text-muted-foreground">Manage plan activation codes for tenants</p>
          </div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-[#FF6B2B] px-4 py-2 text-[13px] font-semibold text-white
            hover:bg-[#FF6B2B]/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Generate Code
        </button>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleStatusFilter(f.value)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors
              ${statusFilter === f.value
                ? 'bg-[rgba(255,107,43,0.15)] text-[#FF6B2B] border border-[#FF6B2B]/30'
                : 'bg-card text-muted-foreground border border-border hover:bg-muted/50'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {['Code', 'Tenant', 'Plan', 'Duration', 'Status', 'Expires', 'Actions'].map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : codes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  No activation codes found.
                </td>
              </tr>
            ) : (
              codes.map((code) => (
                <tr
                  key={code._id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                >
                  {/* Code */}
                  <td className="px-4 py-3">
                    <div className="flex items-center">
                      <span className="font-mono text-[13px] font-semibold tracking-wider text-foreground">
                        {code.code}
                      </span>
                      <CopyButton text={code.code} />
                    </div>
                  </td>

                  {/* Tenant */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {tenantMap[code.tenant_id] ?? code.tenant_id.slice(-6)}
                  </td>

                  {/* Plan */}
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[#FF6B2B]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#FF6B2B] border border-[#FF6B2B]/20">
                      {code.plan}
                    </span>
                  </td>

                  {/* Duration */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {code.duration_months}mo
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${statusBadge(code.status)}`}>
                      {code.status}
                    </span>
                  </td>

                  {/* Expires */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmtDate(code.expires_at)}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    {code.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRevoke(code._id)}
                          title="Revoke code"
                          disabled={revokeCode.isPending}
                          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-red-500
                            border border-red-500/20 bg-red-500/[0.06] hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <Ban className="h-3 w-3" />
                          Revoke
                        </button>
                        <button
                          onClick={() => handleResend(code._id)}
                          title="Resend email"
                          disabled={resendEmail.isPending}
                          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-blue-500
                            border border-blue-500/20 bg-blue-500/[0.06] hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                        >
                          <Send className="h-3 w-3" />
                          Resend
                        </button>
                      </div>
                    ) : code.status === 'redeemed' ? (
                      <span className="text-[11px] text-muted-foreground">
                        Redeemed {fmtDate(code.redeemed_at)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-[12px] text-muted-foreground">
              Page {pagination.page} of {pagination.pages} — {pagination.total} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground
                  hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                disabled={pagination.page >= pagination.pages}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground
                  hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Generate drawer */}
      <GenerateDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} tenants={allTenantsData?.data ?? []} />
    </div>
  );
}
