'use client';

import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  trend?: string;
  trendColor?: string;
  trendBg?: string;
  loading?: boolean;
  accent?: 'red' | 'orange' | 'green' | 'blue' | 'yellow';
  pulse?: boolean;
}

const ACCENT_COLORS: Record<string, { border: string; value: string }> = {
  red: { border: '#DC2626', value: '#DC2626' },
  orange: { border: '#FF6B2B', value: '#FF6B2B' },
  green: { border: '#16A34A', value: '#16A34A' },
  blue: { border: '#2563EB', value: '#2563EB' },
  yellow: { border: '#EAB308', value: '#EAB308' },
};

export function MetricCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  trend,
  trendColor = '#64748B',
  trendBg = '#F1F5F9',
  loading,
  accent,
  pulse,
}: MetricCardProps) {
  const accentStyle = accent ? ACCENT_COLORS[accent] : null;

  return (
    <div
      className="relative overflow-hidden rounded-[12px] border bg-white dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
      style={{
        borderColor: accentStyle ? accentStyle.border : '#E2E8F0',
        borderWidth: accentStyle ? 1.5 : 1,
        borderLeftWidth: accentStyle ? 4 : 1,
        minHeight: 110,
      }}
    >
      <div className="flex items-start gap-3 px-4 py-4">
        <div
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]"
          style={{ backgroundColor: iconBg }}
        >
          <Icon className="h-[15px] w-[15px]" style={{ color: iconColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-medium text-[#64748B]">{label}</p>

          {loading ? (
            <div className="mt-1 flex h-7 items-center">
              <div className="h-5 w-5 rounded-full border-2 border-[#E2E8F0] border-t-[#FF6B2B] animate-spin" />
            </div>
          ) : (
            <p
              className={`mt-0.5 text-[22px] font-bold leading-none font-mono ${pulse ? 'animate-pulse' : ''}`}
              style={{ color: accentStyle?.value || '#0F172A' }}
            >
              {value}
            </p>
          )}
        </div>
      </div>

      {trend && (
        <div
          className="mx-4 mb-3 rounded-[4px] px-3 py-1"
          style={{ backgroundColor: trendBg }}
        >
          <span className="text-[9px] font-semibold" style={{ color: trendColor }}>
            {trend}
          </span>
        </div>
      )}
    </div>
  );
}
