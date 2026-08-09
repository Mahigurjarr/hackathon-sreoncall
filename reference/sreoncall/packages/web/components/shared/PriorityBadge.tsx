import { cn } from '@/lib/utils';
import type { TicketPriority } from '@/lib/hooks/useTickets';

interface PriorityBadgeProps {
  priority: TicketPriority;
  className?: string;
}

const priorityConfig: Record<TicketPriority, { label: string; bg: string; border: string; text: string }> = {
  high: { label: 'High', bg: '#FEF2F2', border: '#FECACA', text: '#DC2626' },
  medium: { label: 'Medium', bg: '#FEFCE8', border: '#FDE68A', text: '#A16207' },
  low: { label: 'Low', bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB' },
};

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = priorityConfig[priority] || priorityConfig.medium;

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-[5px] border px-2 py-0.5 text-[10px] font-bold tracking-[0.02em]',
        className,
      )}
      style={{
        backgroundColor: config.bg,
        borderColor: config.border,
        color: config.text,
      }}
    >
      {config.label}
    </span>
  );
}
