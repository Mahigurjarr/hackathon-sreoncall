'use client';

import { GitMerge, Unlink, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SeverityBadge } from '@/components/shared/SeverityBadge';

interface CorrelatedIncident {
  id: string;
  number: string;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4' | 'SEV5';
  service_name: string;
}

interface Correlation {
  correlation_id: string;
  incidents: CorrelatedIncident[];
  correlation_type: string;
  confidence_percent: number;
  evidence: string[];
  status: 'pending' | 'merged' | 'separated';
}

interface CorrelatedIncidentsProps {
  correlations: Correlation[];
  canMerge: boolean;
  onMerge?: (correlationId: string) => void;
  onSeparate?: (correlationId: string) => void;
}

function confidenceColor(pct: number): string {
  if (pct >= 85) return '#7C3AED';
  if (pct >= 60) return '#2563EB';
  return '#64748B';
}

export function CorrelatedIncidents({
  correlations,
  canMerge,
  onMerge,
  onSeparate,
}: CorrelatedIncidentsProps) {
  if (!correlations || correlations.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-[#7C3AED]" />
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#7C3AED]">
            Correlated Incidents
          </p>
        </div>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No correlated incidents found</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="p-4 pb-3">
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-[#7C3AED]" />
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#7C3AED]">
            Correlated Incidents
          </p>
          <Badge variant="ai" className="ml-auto text-[9px]">
            {correlations.length} group{correlations.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {correlations.map((corr) => (
          <div
            key={corr.correlation_id}
            className="rounded-[8px] border border-purple-200/30 dark:border-purple-800/30 bg-[rgba(124,58,237,0.03)] dark:bg-purple-950/10 p-3"
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#7C3AED] capitalize">
                {corr.correlation_type.replace(/_/g, ' ')}
              </span>
              <span
                className="text-[10px] font-bold font-mono"
                style={{ color: confidenceColor(corr.confidence_percent) }}
              >
                {corr.confidence_percent}% match
              </span>
            </div>

            {/* Incident items */}
            <div className="space-y-1.5">
              {(corr.incidents ?? []).filter(Boolean).map((inc) => (
                <div
                  key={inc.id}
                  className="flex items-center gap-2 rounded-[6px] bg-white/60 dark:bg-navy-elevated/60 px-2 py-1.5"
                >
                  <SeverityBadge severity={inc.severity} />
                  <span className="text-[11px] font-mono font-bold text-foreground">
                    #{inc.number}
                  </span>
                  <span className="text-[11px] text-[#64748B] truncate flex-1">
                    {inc.service_name}
                  </span>
                </div>
              ))}
            </div>

            {/* Evidence tags */}
            {corr.evidence.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {corr.evidence.map((ev) => (
                  <span
                    key={ev}
                    className="inline-flex items-center rounded-[4px] bg-purple-100/50 dark:bg-purple-900/20 px-1.5 py-0.5 text-[9px] font-medium text-[#7C3AED]"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            {canMerge && corr.status === 'pending' && (
              <div className="flex gap-2 mt-2.5">
                <Button
                  size="sm"
                  variant="default"
                  className="h-[28px] px-2.5 text-[11px]"
                  onClick={() => onMerge?.(corr.correlation_id)}
                >
                  <GitMerge className="h-3 w-3 mr-1" />
                  Merge
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-[28px] px-2.5 text-[11px] text-[#64748B]"
                  onClick={() => onSeparate?.(corr.correlation_id)}
                >
                  <Unlink className="h-3 w-3 mr-1" />
                  Keep Separate
                </Button>
              </div>
            )}

            {corr.status !== 'pending' && (
              <div className="mt-2">
                <Badge
                  variant={corr.status === 'merged' ? 'success' : 'secondary'}
                  className="text-[9px]"
                >
                  {corr.status === 'merged' ? 'Merged' : 'Kept Separate'}
                </Badge>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
