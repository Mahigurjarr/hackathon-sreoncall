'use client';

import { useState } from 'react';
import { Coins } from 'lucide-react';
import {
  usePartnerCommissions,
  usePartnerPayouts,
} from '@/lib/hooks/usePartnerCommissions';
import {
  PartnerPage,
  PartnerCard,
  PartnerStat,
  PartnerSectionHeader,
} from '@/components/partner/PartnerPage';
import {
  PLAN_TIERS,
  RESELLER_MARGIN,
  MSP_RATES,
  MANAGED_SERVICES,
  resellerNetPrice,
  resellerMargin,
} from '@/lib/partner/pricing';

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Compute next payout date — quarter-end + 30 days, per partner-engagement.md §Referral.
function nextPayoutDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  // Quarter end months (0-indexed): 2 (Mar), 5 (Jun), 8 (Sep), 11 (Dec)
  const quarterEnds = [2, 5, 8, 11];
  const nextEndMonth = quarterEnds.find((m) => m >= month) ?? quarterEnds[0];
  const endYear = nextEndMonth >= month ? year : year + 1;
  // Quarter end = last day of that month
  const end = new Date(endYear, nextEndMonth + 1, 0);
  // Add 30 days
  const payout = new Date(end);
  payout.setDate(payout.getDate() + 30);
  return fmtDate(payout.toISOString());
}

// ─── Stage badge ─────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  pending_approval: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  prospect: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
  demo: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  proposal: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  negotiation: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  closed_won: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  closed_lost: 'bg-red-500/10 text-red-400 border border-red-500/20',
  rejected: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

const STAGE_LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  prospect: 'Prospect',
  demo: 'Demo',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  rejected: 'Rejected',
};

function StageBadge({ stage }: { stage: string }) {
  const colorClass = STAGE_COLORS[stage] ?? 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
  const label = STAGE_LABELS[stage] ?? stage;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${colorClass}`}>
      {label}
    </span>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

type Track = 'referral' | 'reseller' | 'msp';

function Tabs({ active, onChange }: { active: Track; onChange: (t: Track) => void }) {
  const tabs: { key: Track; label: string }[] = [
    { key: 'referral', label: 'Referral' },
    { key: 'reseller', label: 'Reseller Margin' },
    { key: 'msp', label: 'MSP Revenue Share' },
  ];
  return (
    <div className="flex gap-1 border-b border-[#E2E8F0]">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`px-4 py-2.5 text-xs font-semibold transition-colors relative ${
              isActive ? 'text-[#FF6B2B]' : 'text-[#94A3B8] hover:text-[#64748B]'
            }`}
          >
            {t.label}
            {isActive && (
              <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-[#FF6B2B]" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Reseller pricing table ──────────────────────────────────────────────────

function ResellerTrack() {
  return (
    <>
      <PartnerCard>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
              Reseller margin schedule
            </p>
            <div className="mt-1.5 flex items-center gap-4 text-sm">
              {RESELLER_MARGIN.map((row, i) => (
                <span key={row.year} className="flex items-center gap-4">
                  {i > 0 && <span className="text-[#94A3B8]">|</span>}
                  <span className="text-[#0F172A]">
                    <span className="font-bold text-[#FF6B2B]">{row.margin}%</span> · {row.year}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-[#94A3B8] max-w-sm">
            You invoice the customer at list price and pay SREonCall the net shown below. Deal protection 120 days from registration · monthly invoice net 30.
          </p>
        </div>
      </PartnerCard>

      <div>
        <PartnerSectionHeader
          title="Partner economics by plan"
          description="List price is what your customer pays SREonCall (annual billing). Partner net is what you pay us. Margin is yours to keep per month, per sub."
        />
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">Plan</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">List (mo)</th>
                {RESELLER_MARGIN.map((r) => (
                  <th key={r.year} className="px-5 py-3 text-left font-semibold text-[#94A3B8]">
                    {r.year} · you earn
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLAN_TIERS.map((plan) => (
                <tr key={plan.id} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC]">
                  <td className="px-5 py-3.5">
                    <p className="text-[#0F172A] font-semibold">{plan.name}</p>
                    <p className="text-[#94A3B8] text-[11px] mt-0.5">{plan.target}</p>
                  </td>
                  <td className="px-5 py-3.5 text-[#0F172A] font-medium">{fmtUSD(plan.annualMonthly)}</td>
                  {RESELLER_MARGIN.map((r) => (
                    <td key={r.year} className="px-5 py-3.5">
                      <p className="text-[#FF6B2B] font-semibold">
                        {fmtUSD(resellerMargin(plan.annualMonthly, r.margin))}
                      </p>
                      <p className="text-[11px] text-[#94A3B8] mt-0.5">
                        pay us {fmtUSD(resellerNetPrice(plan.annualMonthly, r.partnerPays))}
                      </p>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[#94A3B8]">
          Customers billed monthly instead of annually pay a 15% uplift on list. Reseller Certification (4-hour self-paced) required before first order.
        </p>
      </div>
    </>
  );
}

// ─── MSP pricing ─────────────────────────────────────────────────────────────

function MspTrack() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PartnerCard>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
            Platform revenue share
          </p>
          <p className="mt-1 text-3xl font-bold text-[#FF6B2B]">{MSP_RATES.platformMarginPct}%</p>
          <p className="text-xs text-[#64748B] mt-1">
            Flat margin to MSP on all platform subscriptions. No taper. SREonCall keeps {100 - MSP_RATES.platformMarginPct}%.
          </p>
        </PartnerCard>
        <PartnerCard>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
            Managed services revenue share
          </p>
          <p className="mt-1 text-3xl font-bold text-[#FF6B2B]">{MSP_RATES.managedServicesMarginPct}%</p>
          <p className="text-xs text-[#64748B] mt-1">
            MSP keeps {MSP_RATES.managedServicesMarginPct}% of managed-services billings. {100 - MSP_RATES.managedServicesMarginPct}% platform facilitation fee to SREonCall.
          </p>
        </PartnerCard>
      </div>

      <div>
        <PartnerSectionHeader
          title="Platform economics by plan"
          description={`Flat ${MSP_RATES.platformMarginPct}% margin on list price, every year.`}
        />
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">Plan</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">List (mo)</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">You pay us</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">You earn</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_TIERS.map((plan) => (
                <tr key={plan.id} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC]">
                  <td className="px-5 py-3.5">
                    <p className="text-[#0F172A] font-semibold">{plan.name}</p>
                    <p className="text-[#94A3B8] text-[11px] mt-0.5">{plan.target}</p>
                  </td>
                  <td className="px-5 py-3.5 text-[#0F172A] font-medium">{fmtUSD(plan.annualMonthly)}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">
                    {fmtUSD(resellerNetPrice(plan.annualMonthly, 100 - MSP_RATES.platformMarginPct))}
                  </td>
                  <td className="px-5 py-3.5 text-[#FF6B2B] font-semibold">
                    {fmtUSD(resellerMargin(plan.annualMonthly, MSP_RATES.platformMarginPct))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <PartnerSectionHeader
          title="Managed services add-ons"
          description={`Optional services you resell on top of the platform. You keep ${MSP_RATES.managedServicesMarginPct}% of the list price.`}
        />
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">Service</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">Startup</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">Growth</th>
                <th className="px-5 py-3 text-left font-semibold text-[#94A3B8]">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {MANAGED_SERVICES.map((s) => (
                <tr key={s.service} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC]">
                  <td className="px-5 py-3.5 text-[#0F172A] font-medium">{s.service}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{fmtUSD(s.startup)}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{fmtUSD(s.growth)}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{fmtUSD(s.enterprise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[#94A3B8]">
          MSP Technical Certification (8-hour self-paced) required. Provider control plane + cross-tenant visibility included.
        </p>
      </div>
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PartnerCommissionsPage() {
  const [track, setTrack] = useState<Track>('referral');
  const { data: commissions, isLoading: isLoadingCommissions, error: commissionsError } = usePartnerCommissions();
  const { data: payouts, isLoading: isLoadingPayouts, error: payoutsError } = usePartnerPayouts();

  const totalEarned = commissions?.totalEarned ?? 0;
  const totalPaid = commissions?.totalPaid ?? 0;
  const pendingPayout = commissions?.pendingPayout ?? (totalEarned - totalPaid);
  const deals = commissions?.deals ?? [];
  const forecast = commissions?.forecast;
  const payoutList = payouts ?? [];

  const summaryCards = [
    { label: 'Total Earned', value: fmtUSD(totalEarned), highlight: true },
    { label: 'Total Paid', value: fmtUSD(totalPaid), highlight: false },
    { label: 'Pending Payout', value: fmtUSD(pendingPayout), highlight: false },
    { label: 'Next Payout', value: nextPayoutDate(), highlight: false },
  ];

  return (
    <PartnerPage
      title="Commissions & Payouts"
      subtitle="Track earnings across your active partner tracks"
      icon={Coins}
    >
      <Tabs active={track} onChange={setTrack} />

      {track === 'referral' && (
        <>
          {/* Rate banner from partner-engagement.md */}
          <PartnerCard>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                  Referral commission rates
                </p>
                <div className="mt-1.5 flex items-center gap-4 text-sm">
                  <span className="text-[#0F172A]">
                    <span className="font-bold text-[#FF6B2B]">15%</span> of ARR · Year 1
                  </span>
                  <span className="text-[#94A3B8]">|</span>
                  <span className="text-[#0F172A]">
                    <span className="font-bold text-[#FF6B2B]">7.5%</span> of ARR · Year 2+
                  </span>
                </div>
              </div>
              <p className="text-xs text-[#94A3B8] max-w-sm">
                Paid quarterly in arrears, within 30 days of each quarter close. Commission is
                payable on customers who remain active past month 3.
              </p>
            </div>
          </PartnerCard>

          {isLoadingCommissions || isLoadingPayouts ? (
            <PartnerCard><p className="text-sm text-[#94A3B8]">Loading…</p></PartnerCard>
          ) : commissionsError || payoutsError ? (
            <PartnerCard><p className="text-sm text-red-400">Failed to load commissions data.</p></PartnerCard>
          ) : (
            <>
              {/* Summary chips */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {summaryCards.map((card) => (
                  <PartnerStat
                    key={card.label}
                    label={card.label}
                    value={card.value}
                    highlight={card.highlight}
                  />
                ))}
              </div>

              {/* 3-year forecast */}
              {forecast && (
                <div>
                  <PartnerSectionHeader
                    title="3-year commission forecast"
                    description="Expected payouts across all active deals, plus a pipeline-weighted estimate."
                  />
                  <PartnerCard>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Year 1</p>
                        <p className="mt-1 text-xl font-bold text-[#0F172A]">{fmtUSD(forecast.year1)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Year 2</p>
                        <p className="mt-1 text-xl font-bold text-[#0F172A]">{fmtUSD(forecast.year2)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Year 3</p>
                        <p className="mt-1 text-xl font-bold text-[#0F172A]">{fmtUSD(forecast.year3)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Total 3-yr</p>
                        <p className="mt-1 text-xl font-bold text-[#0F172A]">{fmtUSD(forecast.totalThreeYear)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Stage-weighted</p>
                        <p className="mt-1 text-xl font-bold text-[#FF6B2B]">{fmtUSD(forecast.weighted)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] text-[#94A3B8]">
                      Weighted estimate applies win probability by stage (prospect 10% → demo 25% → proposal 50% → negotiation 75% → closed-won 100%).
                    </p>
                  </PartnerCard>
                </div>
              )}

              {/* Deals with commission table */}
              <div>
                <PartnerSectionHeader
                  title="Deals with commission"
                  description="Closed-won deals that generate commission"
                />
                <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
                  <table className="w-full text-xs min-w-[700px]">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                        {['Referred Company', 'Stage', 'Est. ARR', 'Commission Rate', 'Commission Earned'].map((h) => (
                          <th key={h} className="px-5 py-3 text-left font-semibold text-[#94A3B8]">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {deals.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-5 py-10 text-center text-[#94A3B8]">
                            No commissions yet. They appear here once a referred deal is closed.
                          </td>
                        </tr>
                      )}
                      {deals.map((deal) => (
                        <tr
                          key={deal._id}
                          className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors"
                        >
                          <td className="px-5 py-3.5 text-[#0F172A] font-medium">{deal.referredCompany}</td>
                          <td className="px-5 py-3.5">
                            <StageBadge stage={deal.stage} />
                          </td>
                          <td className="px-5 py-3.5 text-[#64748B]">{fmtUSD(deal.estimatedARR)}</td>
                          <td className="px-5 py-3.5 text-[#64748B]">{deal.commissionRate}%</td>
                          <td className="px-5 py-3.5 text-[#64748B]">{fmtUSD(deal.commissionEarned)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payout history */}
              <div>
                <PartnerSectionHeader
                  title="Payout history"
                  description="Quarterly payouts from SREonCall"
                />
                <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
                  <table className="w-full text-xs min-w-[500px]">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                        {['Date', 'Amount', 'Reference', 'Notes'].map((h) => (
                          <th key={h} className="px-5 py-3 text-left font-semibold text-[#94A3B8]">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {payoutList.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-5 py-10 text-center text-[#94A3B8]">
                            No payouts recorded yet.
                          </td>
                        </tr>
                      )}
                      {payoutList.map((payout) => (
                        <tr
                          key={payout._id}
                          className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors"
                        >
                          <td className="px-5 py-3.5 text-[#64748B]">{fmtDate(payout.paidAt)}</td>
                          <td className="px-5 py-3.5 text-[#0F172A] font-medium">
                            {fmtUSD(payout.amount)}{payout.currency !== 'USD' ? ` ${payout.currency}` : ''}
                          </td>
                          <td className="px-5 py-3.5 text-[#64748B]">{payout.reference}</td>
                          <td className="px-5 py-3.5 text-[#94A3B8]">{payout.notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {track === 'reseller' && <ResellerTrack />}

      {track === 'msp' && <MspTrack />}
    </PartnerPage>
  );
}
