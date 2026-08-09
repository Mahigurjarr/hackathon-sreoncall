'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { X, Plus, BriefcaseBusiness, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import { PartnerPage } from '@/components/partner/PartnerPage';
import {
  usePartnerDeals,
  useCreateDeal,
  useUpdatePartnerDeal,
  type Deal,
  type DealStage,
  type ProductTier,
  type CreateDealBody,
} from '@/lib/hooks/usePartnerDeals';

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<DealStage, string> = {
  pending_approval: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  prospect: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
  demo: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  proposal: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  negotiation: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  closed_won: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  closed_lost: 'bg-red-500/10 text-red-400 border border-red-500/20',
  rejected: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

const STAGE_LABELS: Record<DealStage, string> = {
  pending_approval: 'Pending Approval',
  prospect: 'Prospect',
  demo: 'Demo',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  rejected: 'Rejected',
};

const ACTIVE_STAGES: DealStage[] = ['prospect', 'demo', 'proposal', 'negotiation'];

const PRODUCT_TIER_LABELS: Record<ProductTier, string> = {
  startup: 'Startup',
  growth: 'Growth',
  enterprise: 'Enterprise',
  self_hosted: 'Self Hosted',
  services: 'Services',
};
const ALL_STAGES: DealStage[] = ['pending_approval', 'prospect', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost', 'rejected'];

function Badge({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${className}`}>
      {text}
    </span>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), 'MMM d, yyyy');
}

function fmtUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Register Deal slide-over ─────────────────────────────────────────────────

interface RegisterDealPanelProps {
  onClose: () => void;
}

function RegisterDealPanel({ onClose }: RegisterDealPanelProps) {
  const createDeal = useCreateDeal();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<{
    referredCompany: string;
    contactName: string;
    contactEmail: string;
    estimatedARR: string;
    productTier: ProductTier;
    currentTools: string;
    expectedCloseDate: string;
  }>({
    referredCompany: '',
    contactName: '',
    contactEmail: '',
    estimatedARR: '',
    productTier: 'startup',
    currentTools: '',
    expectedCloseDate: '',
  });

  function handleClose() {
    onClose();
    // Remove ?new=1 from URL if present
    if (searchParams.get('new') === '1') {
      router.replace('/partner/deals');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const body: CreateDealBody = {
      referredCompany: form.referredCompany,
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      estimatedARR: Number(form.estimatedARR),
      productTier: form.productTier,
      expectedCloseDate: form.expectedCloseDate,
    };

    if (form.currentTools.trim()) {
      body.currentTools = form.currentTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    createDeal.mutate(body, {
      onSuccess: () => {
        toast.success('Deal registered successfully');
        handleClose();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to register deal');
      },
    });
  }

  const labelStyle = 'block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#94A3B8]';
  const inputStyle =
    'w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] outline-none focus:border-[#FF6B2B]';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto flex flex-col bg-white border-l border-[#E2E8F0]"
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-start justify-between p-5 bg-white border-b border-[#E2E8F0]"
        >
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Register Deal</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">Submit a new referral deal for tracking</p>
          </div>
          <button type="button" onClick={handleClose} className="text-[#94A3B8] hover:text-[#64748B] mt-0.5">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 p-5 space-y-5">
          {/* Referred Company */}
          <div>
            <label className={labelStyle}>Referred Company *</label>
            <input
              type="text"
              required
              value={form.referredCompany}
              onChange={(e) => setForm((f) => ({ ...f, referredCompany: e.target.value }))}
              placeholder="Acme Corp"
              className={inputStyle}
            />
          </div>

          {/* Contact Name */}
          <div>
            <label className={labelStyle}>Contact Name *</label>
            <input
              type="text"
              required
              value={form.contactName}
              onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
              placeholder="Jane Smith"
              className={inputStyle}
            />
          </div>

          {/* Contact Email */}
          <div>
            <label className={labelStyle}>Contact Email *</label>
            <input
              type="email"
              required
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              placeholder="jane@acme.com"
              className={inputStyle}
            />
          </div>

          {/* Estimated ARR */}
          <div>
            <label className={labelStyle}>Estimated ARR (USD) *</label>
            <input
              type="number"
              required
              min={0}
              value={form.estimatedARR}
              onChange={(e) => setForm((f) => ({ ...f, estimatedARR: e.target.value }))}
              placeholder="12000"
              className={inputStyle}
            />
          </div>

          {/* Product Tier */}
          <div>
            <label className={labelStyle}>Product Tier *</label>
            <select
              required
              value={form.productTier}
              onChange={(e) => setForm((f) => ({ ...f, productTier: e.target.value as ProductTier }))}
              className={inputStyle}
            >
              <option value="startup">Startup — $999/mo</option>
              <option value="growth">Growth — $1,999/mo</option>
              <option value="enterprise">Enterprise — $5,999/mo</option>
              <option value="self_hosted">Self Hosted — custom pricing</option>
              <option value="services">Services only — custom pricing</option>
            </select>
            {(form.productTier === 'self_hosted' || form.productTier === 'services') && (
              <p className="mt-1.5 text-[11px] text-[#94A3B8]">
                Pricing is custom per client. Enter your best-estimate ARR above — the SREonCall sales team will finalise pricing during discovery.
              </p>
            )}
          </div>

          {/* Current Tools */}
          <div>
            <label className={labelStyle}>Current Tools (optional)</label>
            <input
              type="text"
              value={form.currentTools}
              onChange={(e) => setForm((f) => ({ ...f, currentTools: e.target.value }))}
              placeholder="PagerDuty, Datadog, Jira…"
              className={inputStyle}
            />
            <p className="mt-1 text-[10px] text-[#94A3B8]">Comma-separated list of tools the prospect currently uses</p>
          </div>

          {/* Expected Close Date */}
          <div>
            <label className={labelStyle}>Expected Close Date *</label>
            <input
              type="date"
              required
              value={form.expectedCloseDate}
              onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))}
              className={inputStyle}
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={createDeal.isPending}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#FF6B2B' }}
            >
              {createDeal.isPending ? 'Registering…' : 'Register Deal'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-[#E2E8F0] text-[#94A3B8] hover:text-[#64748B]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Deal detail slide-over ───────────────────────────────────────────────────

interface DealDetailPanelProps {
  deal: Deal;
  onClose: () => void;
}

function DealDetailPanel({ deal, onClose }: DealDetailPanelProps) {
  const updateDeal = useUpdatePartnerDeal();
  const isPendingOrRejected = deal.stage === 'pending_approval' || deal.stage === 'rejected';
  const isLocked = deal.stage === 'closed_won' || deal.stage === 'closed_lost' || isPendingOrRejected;

  const [estimatedARR, setEstimatedARR] = useState<number>(deal.estimatedARR);
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : ''
  );
  const [notes, setNotes] = useState(deal.notes || '');

  function handleStageChange(stage: DealStage) {
    if (isLocked) return;
    updateDeal.mutate(
      { id: deal._id, data: { stage } },
      {
        onSuccess: () => toast.success('Stage updated'),
        onError: () => toast.error('Failed to update stage'),
      }
    );
  }

  function handleARRBlur() {
    if (isLocked) return;
    updateDeal.mutate(
      { id: deal._id, data: { estimatedARR } },
      {
        onSuccess: () => toast.success('ARR updated'),
        onError: () => toast.error('Failed to update ARR'),
      }
    );
  }

  function handleCloseDateBlur() {
    if (isLocked) return;
    updateDeal.mutate(
      { id: deal._id, data: { expectedCloseDate: expectedCloseDate || undefined } },
      {
        onSuccess: () => toast.success('Close date updated'),
        onError: () => toast.error('Failed to update close date'),
      }
    );
  }

  function handleNotesBlur() {
    if (isLocked) return;
    updateDeal.mutate(
      { id: deal._id, data: { notes } },
      {
        onSuccess: () => toast.success('Notes saved'),
        onError: () => toast.error('Failed to save notes'),
      }
    );
  }

  const labelStyle = 'block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#94A3B8]';
  const inputStyle =
    'w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-[#0F172A] outline-none focus:border-[#FF6B2B] disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto flex flex-col bg-white border-l border-[#E2E8F0]"
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-start justify-between p-5 bg-white border-b border-[#E2E8F0]"
        >
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">{deal.referredCompany}</h2>
            <p className="text-xs text-[#94A3B8]">
              {deal.contactName} ·{' '}
              <a href={`mailto:${deal.contactEmail}`} className="text-[#FF6B2B] hover:underline">
                {deal.contactEmail}
              </a>
            </p>
            <div className="flex gap-2 mt-2">
              <Badge text={STAGE_LABELS[deal.stage]} className={STAGE_COLORS[deal.stage]} />
              <span className="text-[10px] text-[#94A3B8]">{fmtDate(deal.createdAt)}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[#94A3B8] hover:text-[#64748B] mt-0.5">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 p-5 space-y-6">
          {/* Pending / Rejected banner */}
          {deal.stage === 'pending_approval' && (
            <div className="rounded-lg p-4" style={{ background: '#1A1500', border: '1px solid #854D0E' }}>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Awaiting approval</p>
              <p className="text-xs text-[#94A3B8] mt-1">
                Your deal registration has been submitted and is being reviewed by the SREonCall team. You'll be able to progress the deal once it's approved.
              </p>
            </div>
          )}
          {deal.stage === 'rejected' && (
            <div className="rounded-lg p-4" style={{ background: '#1A0D0D', border: '1px solid #7F1D1D' }}>
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Deal rejected</p>
              <p className="text-xs text-[#94A3B8] mt-1">
                This deal registration was not approved. Contact your partner manager for details.
              </p>
            </div>
          )}

          {/* Read-only info */}
          <div>
            <label className={labelStyle}>Deal Info</label>
            <div
              className="rounded-lg p-4 space-y-2 text-sm"
              style={{ background: '#0D1117', border: '1px solid #1E293B' }}
            >
              {[
                ['Contact Name', deal.contactName],
                ['Contact Email', deal.contactEmail],
                ['Product Tier', PRODUCT_TIER_LABELS[deal.productTier] ?? deal.productTier],
                [
                  'Current Tools',
                  deal.currentTools.length > 0 ? deal.currentTools.join(', ') : '—',
                ],
                ['Commission Rate', `${deal.commissionRate}%`],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-[#94A3B8] w-32 shrink-0">{k}</span>
                  <span className="text-[#64748B] capitalize">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stage pills */}
          <div>
            <label className={labelStyle}>Stage</label>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVE_STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStageChange(s)}
                  disabled={isLocked}
                  title={isLocked ? 'Stage set by SREonCall team' : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:cursor-not-allowed ${
                    deal.stage === s
                      ? STAGE_COLORS[s] + ' opacity-100'
                      : 'border-[#E2E8F0] text-[#94A3B8] hover:border-[#CBD5E1] disabled:hover:border-[#E2E8F0]'
                  }`}
                >
                  {STAGE_LABELS[s]}
                </button>
              ))}
              {/* Locked closed stages */}
              {(['closed_won', 'closed_lost'] as DealStage[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled
                  title="Stage set by SREonCall team"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-not-allowed flex items-center gap-1 ${
                    deal.stage === s
                      ? STAGE_COLORS[s] + ' opacity-70'
                      : 'border-[#E2E8F0] text-[#94A3B8] opacity-50'
                  }`}
                >
                  <Lock size={10} />
                  {STAGE_LABELS[s]}
                </button>
              ))}
            </div>
            {isLocked && (
              <p className="mt-1.5 text-[10px] text-[#94A3B8]">Stage set by SREonCall team — fields are read-only</p>
            )}
          </div>

          {/* Est. ARR */}
          <div>
            <label className={labelStyle}>Est. ARR (USD)</label>
            <input
              type="number"
              min={0}
              value={estimatedARR}
              onChange={(e) => setEstimatedARR(Number(e.target.value))}
              onBlur={handleARRBlur}
              disabled={isLocked}
              className={inputStyle}
            />
          </div>

          {/* Expected Close Date */}
          <div>
            <label className={labelStyle}>Expected Close Date</label>
            <input
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
              onBlur={handleCloseDateBlur}
              disabled={isLocked}
              className={inputStyle}
            />
          </div>

          {/* Notes */}
          <div>
            <label className={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              disabled={isLocked}
              maxLength={4000}
              rows={4}
              placeholder="Add notes about this deal…"
              className={inputStyle + ' resize-none'}
            />
            <p className="mt-1 text-[10px] text-[#94A3B8] text-right">{notes.length}/4000</p>
          </div>

          {/* Commission summary */}
          <div>
            <label className={labelStyle}>Commission</label>
            <div
              className="rounded-lg p-4 space-y-2"
              style={{ background: '#0D1117', border: '1px solid #1E293B' }}
            >
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-[#94A3B8] mb-1">Commission Rate</p>
                  <p className="text-base font-bold text-[#0F172A]">{deal.commissionRate}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-[#94A3B8] mb-1">Commission Earned</p>
                  <p className="text-base font-bold text-[#0F172A]">{fmtUSD(deal.stage === 'closed_won' ? deal.commissionEarned : 0)}</p>
                </div>
              </div>
              {deal.stage !== 'closed_won' && deal.stage !== 'closed_lost' && (
                <p className="text-[10px] text-[#94A3B8] mt-2">Commission calculated on deal closure</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PartnerDealsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [stageFilter, setStageFilter] = useState<DealStage | ''>('');
  const [showRegister, setShowRegister] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  const { data, isLoading, error } = usePartnerDeals(stageFilter);
  const selectedDeal = data?.data.find((d) => d._id === selectedDealId) ?? null;

  // Open register panel if ?new=1 is in the URL
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowRegister(true);
    }
  }, [searchParams]);

  function handleCloseRegister() {
    setShowRegister(false);
    // Remove ?new=1 from URL if present
    if (searchParams.get('new') === '1') {
      router.replace('/partner/deals');
    }
  }

  const selectStyle =
    'bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs text-[#64748B] outline-none';

  const action = (
    <button
      type="button"
      onClick={() => setShowRegister(true)}
      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#FF6B2B] hover:bg-[#e85e22] transition-colors"
    >
      <Plus size={15} />
      Register Deal
    </button>
  );

  return (
    <PartnerPage
      title="Deals"
      subtitle="Your referred deals and commission tracking"
      icon={BriefcaseBusiness}
      actions={action}
    >
      {/* Stage filter */}
      <div className="flex gap-3">
        <select
          className={selectStyle}
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as DealStage | '')}
        >
          <option value="">All stages</option>
          {ALL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading && (
        <p className="text-sm text-[#94A3B8] py-8 text-center">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-red-400 py-8 text-center">Failed to load deals.</p>
      )}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid #1E293B' }}>
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr style={{ background: '#0D1117', borderBottom: '1px solid #1E293B' }}>
                  {['Referred Company', 'Contact', 'Stage', 'Est. ARR', 'Expected Close', 'Commission', 'Registered'].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 text-left font-semibold text-[#94A3B8]">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[#94A3B8]">
                      No deals found.{' '}
                      <button
                        type="button"
                        onClick={() => setShowRegister(true)}
                        className="text-[#FF6B2B] hover:underline"
                      >
                        Register your first deal →
                      </button>
                    </td>
                  </tr>
                )}
                {data.data.map((deal) => (
                  <tr
                    key={deal._id}
                    onClick={() => setSelectedDealId(deal._id)}
                    className="cursor-pointer hover:bg-[#F8FAFC] transition-colors"
                    style={{ borderBottom: '1px solid #1E293B' }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#0F172A]">{deal.referredCompany}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#64748B]">{deal.contactName}</p>
                      <p className="text-[#94A3B8] mt-0.5">{deal.contactEmail}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge text={STAGE_LABELS[deal.stage]} className={STAGE_COLORS[deal.stage]} />
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">{fmtUSD(deal.estimatedARR)}</td>
                    <td className="px-4 py-3 text-[#94A3B8]">{fmtDate(deal.expectedCloseDate)}</td>
                    <td className="px-4 py-3 text-[#64748B]">{fmtUSD(deal.commissionEarned)}</td>
                    <td className="px-4 py-3 text-[#94A3B8]">{fmtDate(deal.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-[#94A3B8]">
                {data.pagination.total} deal{data.pagination.total !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </>
      )}

      {/* Register Deal slide-over */}
      {showRegister && <RegisterDealPanel onClose={handleCloseRegister} />}

      {/* Deal detail slide-over */}
      {selectedDeal && (
        <DealDetailPanel deal={selectedDeal} onClose={() => setSelectedDealId(null)} />
      )}
    </PartnerPage>
  );
}
