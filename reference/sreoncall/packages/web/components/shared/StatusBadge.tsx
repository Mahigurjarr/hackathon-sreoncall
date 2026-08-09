import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

/* SVG Section 04: Status badges — pill with dot, rx=12, 10px w600 */
const statusConfig: Record<string, { label: string; bg: string; dot: string; text: string }> = {
  discover: { label: 'Discover', bg: '#E0F2FE', dot: '#0EA5E9', text: '#0369A1' },
  open: { label: 'Open', bg: '#DBEAFE', dot: '#2563EB', text: '#1D4ED8' },
  in_progress: { label: 'In Progress', bg: '#FFF3ED', dot: '#FF6B2B', text: '#C2410C' },
  in_review: { label: 'In Review', bg: '#F5F3FF', dot: '#7C3AED', text: '#6D28D9' },
  resolved: { label: 'Resolved', bg: '#F0FDF4', dot: '#16A34A', text: '#15803D' },
  closed: { label: 'Closed', bg: '#F1F5F9', dot: '#64748B', text: '#475569' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status.replace(/_/g, ' '),
    bg: '#F1F5F9',
    dot: '#64748B',
    text: '#475569',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize',
        className,
      )}
      style={{
        backgroundColor: config.bg,
        color: config.text,
      }}
    >
      <span
        className="inline-block h-[7px] w-[7px] rounded-full shrink-0"
        style={{ backgroundColor: config.dot }}
      />
      {config.label}
    </span>
  );
}
