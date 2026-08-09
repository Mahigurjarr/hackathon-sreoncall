'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Risk {
  service_name: string;
  risk_type: 'warning' | 'watch' | 'critical';
  severity: string;
  description: string;
  projected_breach_at: string | null;
}

interface EmergingRisksProps {
  risks: Risk[];
}

const riskDotColors: Record<string, string> = {
  critical: '#DC2626',
  warning: '#EAB308',
  watch: '#EA580C',
};

const riskBgColors: Record<string, string> = {
  critical: 'bg-[#FEF2F2] dark:bg-red-950/20',
  warning: 'bg-[#FEFCE8] dark:bg-yellow-950/20',
  watch: 'bg-[#FFF7ED] dark:bg-orange-950/20',
};

function formatProjectedTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'imminent';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
  return `in ${Math.floor(hrs / 24)}d`;
}

export function EmergingRisks({ risks }: EmergingRisksProps) {
  if (!risks || risks.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-[#EAB308]" />
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#A16207]">
            Emerging Risks
          </p>
        </div>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No emerging risks detected</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-[#FDE68A] dark:border-yellow-800/40 bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="p-4 pb-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-[#EAB308]" />
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#A16207]">
            Emerging Risks
          </p>
          <span className="ml-auto inline-flex items-center justify-center rounded-full bg-[#FEFCE8] dark:bg-yellow-950/30 h-5 w-5 text-[10px] font-bold text-[#A16207]">
            {risks.length}
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {risks.map((risk, idx) => {
          const dotColor = riskDotColors[risk.risk_type] || '#64748B';
          const bgClass = riskBgColors[risk.risk_type] || 'bg-[#F8FAFC] dark:bg-navy-elevated';
          const projected = formatProjectedTime(risk.projected_breach_at);

          return (
            <div
              key={`${risk.service_name}-${idx}`}
              className={cn('rounded-[8px] p-3', bgClass)}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-foreground truncate">
                      {risk.service_name}
                    </span>
                    {projected && (
                      <span className="shrink-0 text-[10px] font-mono font-medium text-[#DC2626]">
                        {projected}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#64748B] leading-snug">
                    {risk.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
