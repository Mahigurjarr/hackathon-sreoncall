'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { cn, formatTicketNumber, formatMinutes } from '@/lib/utils';
import { type Ticket, useUpdateTicket } from '@/lib/hooks/useTickets';
import { UserAssignDropdown } from './UserAssignDropdown';
import { toast } from 'sonner';

interface TicketCardProps {
  ticket: Ticket;
  isDragOverlay?: boolean;
}

/* Priority top strip colors */
const priorityBarColors: Record<string, string> = {
  high: '#DC2626',
  medium: '#EAB308',
  low: '#2563EB',
};

/* Priority badge styles */
const priorityBadgeStyles: Record<string, { bg: string; border: string; text: string; label: string }> = {
  high: { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', label: 'High' },
  medium: { bg: '#FEFCE8', border: '#FDE68A', text: '#A16207', label: 'Medium' },
  low: { bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB', label: 'Low' },
};

/* Type badge styles */
const typeBadgeStyles: Record<string, { bg: string; text: string }> = {
  epic: { bg: '#F3E8FF', text: '#7C3AED' },
  user_story: { bg: '#DBEAFE', text: '#1D4ED8' },
  task: { bg: '#F0FDF4', text: '#16A34A' },
  bug: { bg: '#FEF2F2', text: '#DC2626' },
};

/* Spec Section 06: tag colors for common labels */
const tagColors: Record<string, { bg: string; text: string }> = {
  production: { bg: '#FFF3ED', text: '#C2410C' },
  staging: { bg: '#FEFCE8', text: '#A16207' },
  'api-gw': { bg: '#EFF6FF', text: '#1D4ED8' },
  frontend: { bg: '#F0FDF4', text: '#16A34A' },
  backend: { bg: '#EFF6FF', text: '#2563EB' },
  database: { bg: '#FDF4FF', text: '#7C3AED' },
};

const defaultTagColor = { bg: '#F1F5F9', text: '#64748B' };

export function TicketCard({ ticket, isDragOverlay }: TicketCardProps) {
  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType || 'standalone';
  const updateTicket = useUpdateTicket();

  async function handleMoveToBacklog(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (!ticket.is_backlog) {
        // Moving TO backlog — also clear sprint assignment
        await updateTicket.mutateAsync({
          id: ticket.id,
          input: { is_backlog: true, sprint_id: null },
        });
        toast.success(
          ticket.sprint_id
            ? 'Moved to backlog and removed from sprint'
            : 'Moved to backlog',
        );
      } else {
        // Removing FROM backlog
        await updateTicket.mutateAsync({ id: ticket.id, input: { is_backlog: false } });
        toast.success('Removed from backlog');
      }
    } catch {
      toast.error('Failed to update ticket');
    }
  }
  const isProvider = tenantType === 'provider';
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ticket.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const pBadge = priorityBadgeStyles[ticket.priority] || priorityBadgeStyles.medium;
  const tBadge = typeBadgeStyles[ticket.type] || typeBadgeStyles.task;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative flex cursor-grab flex-col overflow-hidden rounded-[12px] border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-navy-surface transition-all hover:shadow-[0_8px_24px_rgba(0,0,0,0.2)] hover:-translate-y-0.5',
        ticket.priority === 'high' ? 'shadow-[0_4px_16px_rgba(0,0,0,0.12)]' : 'shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
        isDragging && 'opacity-30',
        isDragOverlay && 'shadow-[0_8px_24px_rgba(0,0,0,0.2)] cursor-grabbing',
      )}
    >
      {/* Priority color bar — spec: 6px top strip rx=3 */}
      <div
        className="h-1.5 w-full rounded-t-[3px]"
        style={{ backgroundColor: priorityBarColors[ticket.priority] || '#94A3B8' }}
      />

      <div className="flex-1 px-4 py-3">
        {/* Row 1: Ticket ID + Priority badge + Type badge */}
        <div className="mb-2 flex items-center gap-2">
          {/* Ticket ID — spec: monospace 11px #94A3B8 */}
          <span className="font-mono text-[11px] text-[#94A3B8]">
            {formatTicketNumber(ticket.number, ticket.project_key)}
          </span>
          {/* Priority badge */}
          <span
            className="inline-flex items-center justify-center rounded-[4px] px-2 py-0.5 text-[9px] font-bold"
            style={{
              backgroundColor: pBadge.bg,
              border: `0.5px solid ${pBadge.border}`,
              color: pBadge.text,
            }}
          >
            {pBadge.label || ticket.priority}
          </span>
          {/* Type badge — spec: rx=4, 9px semibold, blue tint */}
          {ticket.type && (
            <span
              className="inline-flex items-center justify-center rounded-[4px] px-2 py-0.5 text-[9px] font-semibold capitalize"
              style={{
                backgroundColor: tBadge.bg,
                color: tBadge.text,
              }}
            >
              {ticket.type.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {/* Title — spec: 13px semibold #0F172A, 2 lines */}
        <Link
          href={`/tickets/${ticket.id}`}
          className="block text-[13px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] hover:text-[#FF6B2B] line-clamp-2 leading-[1.35]"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {ticket.title}
        </Link>

        {/* Project chip — identifies which project the ticket belongs to in
            cross-project views (backlog, timesheet, approvals). Colored per
            project so cards are scannable at a glance. */}
        {ticket.project_name && (
          <div className="mt-2 flex items-center">
            <span
              className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[9px] font-semibold"
              style={{
                backgroundColor: `${ticket.project_color || '#64748B'}1A`,
                color: ticket.project_color || '#64748B',
                border: `0.5px solid ${ticket.project_color || '#64748B'}33`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: ticket.project_color || '#64748B' }}
              />
              {ticket.project_name}
            </span>
          </div>
        )}

        {/* Link indicators: blocked / blocks / related / parent */}
        {((ticket.blocked_by_ids?.length ?? 0) > 0 ||
          (ticket.blocks_ids?.length ?? 0) > 0 ||
          (ticket.related_ids?.length ?? 0) > 0 ||
          !!ticket.parent_id) && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {(ticket.blocked_by_ids?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-red-50 dark:bg-red-950/50 px-2 py-0.5 text-[9px] font-semibold text-red-600 dark:text-red-400">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                Blocked · {ticket.blocked_by_ids.length}
              </span>
            )}
            {(ticket.blocks_ids?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                Blocks · {ticket.blocks_ids.length}
              </span>
            )}
            {(ticket.related_ids?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Related · {ticket.related_ids.length}
              </span>
            )}
            {!!ticket.parent_id && (
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 text-[9px] font-semibold text-purple-600 dark:text-purple-400">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3v18h18"/><path d="m7 12 4-4 4 4 4-4"/></svg>
                Sub-task
              </span>
            )}
          </div>
        )}

        {/* Consumer tenant name badge (for provider view) */}
        {isProvider && ticket.tenant_name && !ticket.custom_fields?.escalated_from && (
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[9px] font-semibold"
              style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8', border: '0.5px solid #BFDBFE' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              {ticket.tenant_name}
            </span>
          </div>
        )}

        {/* Escalation source badge */}
        {ticket.custom_fields?.escalated_from && (
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[9px] font-semibold"
              style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8', border: '0.5px solid #BFDBFE' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              {ticket.custom_fields.escalated_from}
            </span>
          </div>
        )}

        {/* Tags — spec: rx=4, 8px font-weight 500, colored bg per label */}
        {ticket.labels && ticket.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ticket.labels.slice(0, 3).map((label) => {
              const tc = tagColors[label.toLowerCase()] || defaultTagColor;
              return (
                <span
                  key={label}
                  className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[8px] font-medium"
                  style={{ backgroundColor: tc.bg, color: tc.text }}
                >
                  {label}
                </span>
              );
            })}
            {ticket.labels.length > 3 && (
              <span className="text-[8px] text-[#94A3B8]">
                +{ticket.labels.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Time progress bar — shown when estimate exists and time has been logged */}
        {ticket.time_estimate_minutes && ticket.time_estimate_minutes > 0 && (
          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] text-[#94A3B8]">
                {ticket.time_spent_minutes >= 60
                  ? `${(ticket.time_spent_minutes / 60).toFixed(1)}h`
                  : `${ticket.time_spent_minutes}m`} logged
              </span>
              <span className="text-[9px] text-[#94A3B8]">
                {ticket.time_estimate_minutes >= 60
                  ? `${(ticket.time_estimate_minutes / 60).toFixed(1)}h`
                  : `${ticket.time_estimate_minutes}m`}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[#F1F5F9] dark:bg-[#1E293B]">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  ticket.time_spent_minutes > ticket.time_estimate_minutes
                    ? 'bg-red-400'
                    : ticket.time_spent_minutes / ticket.time_estimate_minutes > 0.8
                    ? 'bg-amber-400'
                    : 'bg-emerald-400',
                )}
                style={{ width: `${Math.min(100, Math.round((ticket.time_spent_minutes / ticket.time_estimate_minutes) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Divider — spec: stroke #F1F5F9 */}
        <div className="my-3 border-t border-[#F1F5F9] dark:border-[#1E293B]" />

        {/* Footer row: assignee left, backlog + time right */}
        <div className="flex items-center justify-between" onPointerDown={(e) => e.stopPropagation()}>
          <UserAssignDropdown ticket={ticket} compact />
          <div className="flex items-center gap-2">
            <button
              onClick={handleMoveToBacklog}
              title={
                ticket.is_backlog
                  ? 'Remove from backlog'
                  : ticket.sprint_id
                  ? 'Move to backlog (removes from sprint)'
                  : 'Move to backlog'
              }
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-semibold opacity-0 transition-opacity group-hover:opacity-100',
                ticket.is_backlog
                  ? 'bg-brand/10 text-brand'
                  : ticket.sprint_id
                  ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400 hover:bg-brand/10 hover:text-brand'
                  : 'bg-muted text-muted-foreground hover:bg-brand/10 hover:text-brand',
              )}
            >
              {ticket.is_backlog ? 'In Backlog' : ticket.sprint_id ? '→ Backlog' : 'Backlog'}
            </button>
            {(ticket.time_estimate_minutes || ticket.time_estimate_raw || ticket.time_spent_minutes > 0) && (
              <span className="text-[10px] text-[#94A3B8]" title="Logged / Estimate">
                {formatMinutes(ticket.time_spent_minutes)}
                {ticket.time_estimate_raw
                  ? ` / ${ticket.time_estimate_raw}`
                  : ticket.time_estimate_minutes
                    ? ` / ${formatMinutes(ticket.time_estimate_minutes)}`
                    : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
