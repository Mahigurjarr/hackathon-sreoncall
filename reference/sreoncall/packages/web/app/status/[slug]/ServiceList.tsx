'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IncidentHistory } from './IncidentHistory';

interface StatusComponent {
  name: string;
  description: string;
  status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
  uptime_24h?: number;
  uptime_7d?: number;
  uptime_30d?: number;
  uptime_90d?: number;
}

const statusLabels: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Maintenance',
};

const statusPillStyles: Record<string, string> = {
  operational: 'bg-success/10 text-success border-success/20',
  degraded: 'bg-warning/10 text-warning border-warning/20',
  partial_outage: 'bg-brand/10 text-brand border-brand/20',
  major_outage: 'bg-error/10 text-error border-error/20',
  maintenance: 'bg-info/10 text-info border-info/20',
};

const statusDotStyles: Record<string, string> = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  partial_outage: 'bg-brand',
  major_outage: 'bg-error',
  maintenance: 'bg-info',
};

function UptimeBars({ status, uptime }: { status: string; uptime?: number }) {
  const baseColor =
    status === 'operational' ? 'bg-success' :
    status === 'degraded' ? 'bg-warning' :
    status === 'partial_outage' ? 'bg-brand' :
    status === 'major_outage' ? 'bg-error' :
    'bg-info';

  const bars = Array.from({ length: 30 }, (_, i) => {
    if (uptime != null && uptime < 100) {
      const downBars = Math.ceil((100 - uptime) / 100 * 30);
      return i < downBars ? 'bg-error/40' : baseColor + '/30';
    }
    return baseColor + '/30';
  });

  return (
    <div className="flex items-end gap-[2px] h-3">
      {bars.map((color, i) => (
        <div
          key={i}
          className={cn('w-[3px] rounded-sm transition-all', color)}
          style={{ height: `${8 + ((i * 7) % 12)}px` }}
        />
      ))}
    </div>
  );
}

function ServiceRow({
  comp,
  isLast,
  slug,
  apiUrl,
  viewerEmail,
}: {
  comp: StatusComponent;
  isLast: boolean;
  slug: string;
  apiUrl: string;
  viewerEmail?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(!isLast && 'border-b border-slate-100')}>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-5 py-4 transition-colors hover:bg-slate-50/60 text-left focus:outline-none focus-visible:bg-slate-50"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-slate-300 shrink-0 transition-transform duration-200',
              expanded && 'rotate-180 text-slate-500',
            )}
          />
          <div className={cn('h-2 w-2 rounded-full shrink-0', statusDotStyles[comp.status])} />
          <span className="text-sm font-medium text-slate-900 truncate">{comp.name}</span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block">
            <UptimeBars status={comp.status} uptime={comp.uptime_24h} />
          </div>
          <span className="text-xs font-mono text-slate-400 min-w-[44px] text-right">
            {comp.uptime_24h != null ? `${comp.uptime_24h.toFixed(1)}%` : '\u2014'}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
              statusPillStyles[comp.status] ?? 'bg-slate-100 text-slate-500 border-slate-200',
            )}
          >
            {statusLabels[comp.status] ?? comp.status}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pl-12 bg-slate-50/40 border-t border-slate-100">
          {comp.description && (
            <p className="text-xs text-slate-500 leading-relaxed pt-3 pb-1">{comp.description}</p>
          )}
          <IncidentHistory
            slug={slug}
            apiUrl={apiUrl}
            component={comp.name}
            compact
            viewerEmail={viewerEmail}
            componentUptime={{
              uptime_24h: comp.uptime_24h,
              uptime_7d: comp.uptime_7d,
              uptime_30d: comp.uptime_30d,
              uptime_90d: comp.uptime_90d,
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ServiceList({
  components,
  slug,
  apiUrl,
  viewerEmail,
}: {
  components: StatusComponent[];
  slug: string;
  apiUrl: string;
  viewerEmail?: string;
}) {
  if (components.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-14 text-center mb-5 shadow-sm">
        <p className="text-sm text-slate-400">No components configured.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white mb-5 overflow-hidden shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Services</h2>
      </div>
      <div>
        {components.map((comp, i) => (
          <ServiceRow
            key={i}
            comp={comp}
            isLast={i === components.length - 1}
            slug={slug}
            apiUrl={apiUrl}
            viewerEmail={viewerEmail}
          />
        ))}
      </div>
    </div>
  );
}
