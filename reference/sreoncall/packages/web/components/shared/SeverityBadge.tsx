import { cn } from '@/lib/utils';

type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4' | 'SEV5';

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

/* SVG Section 04: Severity badges — same color scale as priority, rx=5, 10px w700 */
const severityConfig: Record<Severity, { label: string; bg: string; border: string; text: string }> = {
  SEV1: { label: 'SEV1', bg: '#FEF2F2', border: '#FECACA', text: '#DC2626' },
  SEV2: { label: 'SEV2', bg: '#FFF7ED', border: '#FED7AA', text: '#EA580C' },
  SEV3: { label: 'SEV3', bg: '#FEFCE8', border: '#FDE68A', text: '#A16207' },
  SEV4: { label: 'SEV4', bg: '#EFF6FF', border: '#BFDBFE', text: '#2563EB' },
  SEV5: { label: 'SEV5', bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B' },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = severityConfig[severity] || {
    label: severity,
    bg: '#F8FAFC',
    border: '#E2E8F0',
    text: '#64748B',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-bold tracking-[0.02em]',
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
