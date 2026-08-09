'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Plus, BookOpen, Swords, CalendarDays } from 'lucide-react';
import {
  PartnerPage,
  PartnerCard,
  PartnerStat,
  PartnerSectionHeader,
  PartnerMascot,
} from '@/components/partner/PartnerPage';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Deal {
  _id: string;
  referredCompany: string;
  stage: 'prospect' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  estimatedARR: number;
  expectedCloseDate: string;
  commissionRate: number;
  commissionEarned: number;
  createdAt: string;
}

interface CommissionsResponse {
  totalEarned: number;
  totalPaid: number;
  pendingPayout: number;
  deals: Deal[];
}

interface DealListResponse {
  data: Deal[];
}

// ─── API helper ──────────────────────────────────────────────────────────────

async function partnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Stage badge ─────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<Deal['stage'], string> = {
  prospect: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
  demo: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  proposal: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  negotiation: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  closed_won: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  closed_lost: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

const STAGE_LABELS: Record<Deal['stage'], string> = {
  prospect: 'Prospect',
  demo: 'Demo',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

function StageBadge({ stage }: { stage: Deal['stage'] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${STAGE_COLORS[stage]}`}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

// ─── Quick resource card ─────────────────────────────────────────────────────

function QuickLink({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: typeof BookOpen;
  title: string;
  description: string;
  href: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="group flex items-start gap-3 rounded-xl p-4 bg-white border border-[#E2E8F0] hover:border-[#FF6B2B]/40 transition-colors text-left"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#FF6B2B] transition-colors">
          {title}
        </p>
        <p className="text-xs text-[#94A3B8] mt-0.5">{description}</p>
      </div>
    </button>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PartnerDashboardPage() {
  const router = useRouter();

  const { data: commissionsData, isLoading: isLoadingCommissions, error: commissionsError } = useQuery({
    queryKey: ['partner-commissions'],
    queryFn: () => partnerFetch<CommissionsResponse>('/api/v1/partner/commissions'),
  });

  const { data: dealsData, isLoading: isLoadingDeals, error: dealsError } = useQuery({
    queryKey: ['partner-deals'],
    queryFn: () => partnerFetch<DealListResponse>('/api/v1/partner/deals'),
  });

  const deals = dealsData?.data ?? [];
  const totalDeals = deals.length;
  const inPipeline = deals.filter(
    (d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost'
  ).length;
  const totalEarned = commissionsData?.totalEarned ?? 0;
  const pendingPayout = commissionsData?.pendingPayout ?? 0;
  const pipelineARR = deals
    .filter((d) => d.stage !== 'closed_lost')
    .reduce((sum, d) => sum + d.estimatedARR, 0);

  const recentDeals = [...deals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).slice(0, 5);

  const chips = [
    { label: 'Total Deals', value: String(totalDeals), highlight: false },
    { label: 'In Pipeline', value: String(inPipeline), highlight: false },
    { label: 'Pipeline ARR', value: fmtUSD(pipelineARR), highlight: false },
    { label: 'Commission Earned', value: fmtUSD(totalEarned), highlight: true },
    { label: 'Pending Payout', value: fmtUSD(pendingPayout), highlight: false },
  ];

  const action = (
    <button
      type="button"
      onClick={() => router.push('/partner/deals?new=1')}
      className="inline-flex items-center gap-1.5 bg-[#FF6B2B] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#e85e22] transition-colors"
    >
      <Plus size={15} />
      Register Deal
    </button>
  );

  // Loading / error ─────────────────────────────────────────────────────────
  if (isLoadingCommissions || isLoadingDeals) {
    return (
      <PartnerPage title="Dashboard" subtitle="Partner overview" icon={LayoutDashboard} actions={action}>
        <PartnerCard><p className="text-sm text-[#94A3B8]">Loading…</p></PartnerCard>
      </PartnerPage>
    );
  }
  if (commissionsError || dealsError) {
    return (
      <PartnerPage title="Dashboard" subtitle="Partner overview" icon={LayoutDashboard} actions={action}>
        <PartnerCard><p className="text-sm text-red-400">Failed to load dashboard data.</p></PartnerCard>
      </PartnerPage>
    );
  }

  return (
    <PartnerPage title="Dashboard" subtitle="Partner overview" icon={LayoutDashboard} actions={action}>
      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {chips.map((c) => (
          <PartnerStat key={c.label} label={c.label} value={c.value} highlight={c.highlight} />
        ))}
      </div>

      {/* Quick links */}
      <div>
        <PartnerSectionHeader title="Quick access" description="Sales enablement and support" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickLink
            icon={BookOpen}
            title="Sales collateral"
            description="Pitch decks, one-pagers, case studies"
            href="/partner/resources"
          />
          <QuickLink
            icon={Swords}
            title="Competitive battle cards"
            description="Datadog, PagerDuty, Groundcover"
            href="/partner/resources"
          />
          <QuickLink
            icon={CalendarDays}
            title="Book Partner Manager"
            description="Get co-selling and deal support"
            href="/partner/support"
          />
        </div>
      </div>

      {/* Recent deals */}
      <div>
        <PartnerSectionHeader
          title="Recent deals"
          description="Latest referred deals"
          action={
            <button
              type="button"
              onClick={() => router.push('/partner/deals')}
              className="text-xs font-semibold text-[#FF6B2B] hover:underline"
            >
              View all →
            </button>
          }
        />
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
          <table className="w-full text-xs min-w-[600px]">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                {['Referred Company', 'Stage', 'Est. ARR', 'Expected Close'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left font-semibold text-[#94A3B8]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentDeals.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <PartnerMascot variant="happy" size={96} opacity={0.85} />
                      <p className="text-sm text-[#64748B]">
                        No deals yet. Register your first deal to get started.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {recentDeals.map((deal) => (
                <tr
                  key={deal._id}
                  onClick={() => router.push('/partner/deals')}
                  className="hover:bg-[#F8FAFC] cursor-pointer border-b border-[#E2E8F0] transition-colors"
                >
                  <td className="px-5 py-3.5 text-[#0F172A] font-medium">{deal.referredCompany}</td>
                  <td className="px-5 py-3.5">
                    <StageBadge stage={deal.stage} />
                  </td>
                  <td className="px-5 py-3.5 text-[#64748B]">{fmtUSD(deal.estimatedARR)}</td>
                  <td className="px-5 py-3.5 text-[#64748B]">{fmtDate(deal.expectedCloseDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PartnerPage>
  );
}
