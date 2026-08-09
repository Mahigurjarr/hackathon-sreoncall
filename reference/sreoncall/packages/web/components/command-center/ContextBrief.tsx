'use client';

import { Info, Rocket, Bug, User, Users, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecentIncident {
  number: string;
  title: string;
  resolved_at: string;
}

interface ContextBriefData {
  service_name: string;
  service_description: string;
  owner_team: string;
  oncall_engineer: string;
  last_deploy: {
    version: string;
    deployed_at: string;
    deployed_by: string;
  } | null;
  known_quirks: string[];
  recent_incidents: RecentIncident[];
  current_state: string;
}

interface ContextBriefProps {
  brief: ContextBriefData | null;
  level: 'full' | 'summary';
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ContextBrief({ brief, level }: ContextBriefProps) {
  if (!brief) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <div className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-[#FF6B2B]" />
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
            Context Brief
          </p>
        </div>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No context available</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      {/* Service name header */}
      <div className="p-4 pb-3">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          Context Brief
        </p>
        <h4 className="mt-1 text-[15px] font-bold text-foreground leading-tight">
          {brief.service_name}
        </h4>
        <p className="mt-0.5 text-[12px] text-[#64748B] leading-snug">
          {brief.service_description}
        </p>
      </div>

      <div className="border-t border-border mx-4" />

      {/* Owner + On-call */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-0.5">
              Owner Team
            </p>
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3 text-[#64748B]" />
              <span className="text-[12px] font-medium text-foreground">{brief.owner_team || '—'}</span>
            </div>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-0.5">
              On-Call
            </p>
            <div className="flex items-center gap-1">
              <User className="h-3 w-3 text-[#16A34A]" />
              <span className="text-[12px] font-medium text-foreground">
                {brief.oncall_engineer || '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Current State */}
      <div className="border-t border-border mx-4" />
      <div className="px-4 py-3">
        <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-0.5">
          Current State
        </p>
        <p className="text-[12px] text-foreground leading-snug">{brief.current_state}</p>
      </div>

      {/* Last Deploy */}
      {brief.last_deploy && (
        <>
          <div className="border-t border-border mx-4" />
          <div className="px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1">
              Last Deploy
            </p>
            <div className="flex items-center gap-2">
              <Rocket className="h-3 w-3 text-[#FF6B2B]" />
              <span className="text-[11px] font-mono font-bold text-foreground">
                {brief.last_deploy.version}
              </span>
              <span className="text-[10px] text-[#94A3B8]">
                by {brief.last_deploy.deployed_by}
              </span>
              <span className="ml-auto text-[10px] font-mono text-[#94A3B8]">
                {formatRelativeTime(brief.last_deploy.deployed_at)}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Full mode: Known Quirks + Recent Incidents */}
      {level === 'full' && (
        <>
          {/* Known Quirks */}
          {brief.known_quirks.length > 0 && (
            <>
              <div className="border-t border-border mx-4" />
              <div className="px-4 py-3">
                <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1.5">
                  Known Quirks
                </p>
                <ul className="space-y-1">
                  {brief.known_quirks.map((quirk, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <Bug className="h-3 w-3 mt-0.5 shrink-0 text-[#EAB308]" />
                      <span className="text-[11px] text-[#64748B] leading-snug">{quirk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Recent Incidents */}
          {brief.recent_incidents.length > 0 && (
            <>
              <div className="border-t border-border mx-4" />
              <div className="px-4 py-3 pb-4">
                <p className="text-[9px] uppercase tracking-wide font-medium text-[#64748B] mb-1.5">
                  Recent Incidents
                </p>
                <div className="space-y-1.5">
                  {brief.recent_incidents.map((inc) => (
                    <div key={inc.number} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-[#FF6B2B]">
                        #{inc.number}
                      </span>
                      <span className="text-[11px] text-[#64748B] truncate flex-1">
                        {inc.title}
                      </span>
                      <span className="shrink-0 text-[10px] font-mono text-[#94A3B8]">
                        {formatRelativeTime(inc.resolved_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
