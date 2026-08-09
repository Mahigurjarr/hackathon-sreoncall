'use client';

import { Rocket, Settings, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

interface Deploy {
  version: string;
  service: string;
  deployed_by: string;
  deployed_at: string;
  minutes_before: number;
}

interface ConfigChange {
  key: string;
  service: string;
  changed_by: string;
  changed_at: string;
  minutes_before: number;
}

interface RecentAlert {
  name: string;
  service: string;
  fired_at: string;
  minutes_before: number;
}

interface ChangeCorrelationData {
  recent_deploys: Deploy[];
  recent_config_changes: ConfigChange[];
  recent_alerts: RecentAlert[];
}

interface ChangeCorrelationProps {
  changes: ChangeCorrelationData | null;
}

function formatMinutesBefore(mins: number): string {
  if (mins < 60) return `${mins}m before`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m before` : `${h}h before`;
}

export function ChangeCorrelation({ changes }: ChangeCorrelationProps) {
  if (!changes) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          What Changed?
        </p>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No change data available</p>
      </div>
    );
  }

  const hasData =
    changes.recent_deploys.length > 0 ||
    changes.recent_config_changes.length > 0 ||
    changes.recent_alerts.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          What Changed?
        </p>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No recent changes detected</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="p-4 pb-3">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          What Changed?
        </p>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {/* Deploys */}
        {changes.recent_deploys.map((deploy, idx) => (
          <div
            key={`deploy-${idx}`}
            className="flex items-start gap-2.5 rounded-[8px] bg-[#FFF7ED] dark:bg-orange-950/20 p-2.5"
          >
            <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[#FF6B2B]/10">
              <Rocket className="h-3 w-3 text-[#FF6B2B]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground truncate">
                  Deploy: {deploy.service}
                </span>
                <Badge variant="warning" className="shrink-0 text-[8px]">
                  <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                  {formatMinutesBefore(deploy.minutes_before)}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-[#64748B]">
                <span className="font-mono font-medium">{deploy.version}</span>
                {' by '}
                {deploy.deployed_by}
              </p>
            </div>
          </div>
        ))}

        {/* Config Changes */}
        {changes.recent_config_changes.map((change, idx) => (
          <div
            key={`config-${idx}`}
            className="flex items-start gap-2.5 rounded-[8px] bg-[#EFF6FF] dark:bg-blue-950/20 p-2.5"
          >
            <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[#2563EB]/10">
              <Settings className="h-3 w-3 text-[#2563EB]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground truncate">
                  Config: {change.key}
                </span>
                <Badge variant="info" className="shrink-0 text-[8px]">
                  <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                  {formatMinutesBefore(change.minutes_before)}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-[#64748B]">
                {change.service} by {change.changed_by}
              </p>
            </div>
          </div>
        ))}

        {/* Recent Alerts */}
        {changes.recent_alerts.map((alert, idx) => (
          <div
            key={`alert-${idx}`}
            className="flex items-start gap-2.5 rounded-[8px] bg-[#FEF2F2] dark:bg-red-950/20 p-2.5"
          >
            <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[#DC2626]/10">
              <AlertCircle className="h-3 w-3 text-[#DC2626]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground truncate">
                  Alert: {alert.name}
                </span>
                <Badge variant="destructive" className="shrink-0 text-[8px]">
                  <Clock className="inline h-2.5 w-2.5 mr-0.5" />
                  {formatMinutesBefore(alert.minutes_before)}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-[#64748B]">{alert.service}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
