import type { LucideIcon } from 'lucide-react';
import { Mascot } from '@/components/brand/Mascot';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  /** Show the standing mascot illustration (default: true) */
  showMascot?: boolean;
  /** Variant: 'positive' (default), 'error', 'ai', 'welcome', 'success', 'offduty' */
  variant?: 'positive' | 'error' | 'ai' | 'welcome' | 'success' | 'offduty';
}

/**
 * EmptyState — matches Section 10 of design.svg.
 *
 * Card A (Positive): mascotStand width=140, title 14px #0F172A semibold, subtitle 12px #94A3B8,
 *   CTA rx=7 bg #FF6B2B, border #E2E8F0
 * Card B (Error): mascotStand, title 14px #DC2626, CTA outlined in #DC2626
 * Card C (AI): mascotAnim, progress bar in #7C3AED, title 14px #7C3AED
 * Card D (Welcome): mascotAnim width=180, white bg, #E2E8F0 border, CTA #FF6B2B
 * Card E (Success): mascotHappy width=160, #F0FDF4 bg, #BBF7D0 border, title #15803D, CTA #16A34A
 * Card F (Off-duty): mascotHappy width=160, navy gradient, opacity 35%, no CTA
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
  showMascot = true,
  variant = 'positive',
}: EmptyStateProps) {
  const isError = variant === 'error';
  const isAI = variant === 'ai';
  const isWelcome = variant === 'welcome';
  const isSuccess = variant === 'success';
  const isOffduty = variant === 'offduty';

  // Determine container styles per variant
  const containerClasses = cn(
    'flex flex-col items-center justify-center rounded-[14px] py-10 px-6 text-center',
    // Off-duty has no border; all others have border
    !isOffduty && 'border',
    isError
      ? 'border-[#FEE2E2] bg-white dark:bg-navy-surface'
      : isAI
      ? 'border-[#E2E8F0] bg-[#F8FAFC] dark:bg-navy-elevated'
      : isSuccess
      ? 'border-[#BBF7D0] bg-[#F0FDF4]'
      : isOffduty
      ? '' // gradient applied via inline style
      : 'border-[#E2E8F0] bg-white dark:bg-navy-surface', // positive + welcome
    !isOffduty && 'shadow-[0_4px_16px_rgba(0,0,0,0.12)]',
    className,
  );

  // Off-duty uses a navy gradient background
  const containerStyle = isOffduty
    ? { background: 'linear-gradient(135deg, #0D1117 0%, #111827 50%, #1E3A5F 100%)' }
    : undefined;

  // Title color per variant
  const titleColor = isError
    ? '#DC2626'
    : isAI
    ? '#7C3AED'
    : isSuccess
    ? '#15803D'
    : isOffduty
    ? '#E2E8F0'
    : '#0F172A'; // positive + welcome

  // Subtitle color: off-duty uses #64748B, others use #94A3B8
  const subtitleColor = isOffduty ? '#64748B' : '#94A3B8';

  // Mascot config per variant
  const mascotPose = isAI || isWelcome ? 'anim' : isSuccess || isOffduty ? 'happy' : 'stand';
  const mascotWidth = isWelcome ? 180 : isAI || isSuccess || isOffduty ? 160 : 140;
  const mascotSurface = isOffduty ? 'dark' : 'light';

  // Off-duty suppresses the CTA
  const showCTA = !isOffduty && actionLabel && onAction;

  return (
    <div className={containerClasses} style={containerStyle}>
      {/* Mascot */}
      {showMascot && (
        <Mascot
          pose={mascotPose as 'stand' | 'happy' | 'anim'}
          width={mascotWidth}
          surface={mascotSurface as 'light' | 'dark'}
          className="mb-4"
          {...(isOffduty ? { opacity: 35 } : {})}
        />
      )}

      {/* AI progress bar */}
      {isAI && (
        <div className="mb-4 h-1.5 w-[200px] overflow-hidden rounded-full bg-[#E2E8F0]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[#7C3AED]" />
        </div>
      )}

      {/* Title — spec: 14px semibold */}
      <h3
        className="text-[14px] font-semibold"
        style={{ color: titleColor }}
      >
        {title}
      </h3>

      {/* Subtitle — spec: 12px */}
      <p className="mt-2 max-w-sm text-[12px]" style={{ color: subtitleColor }}>
        {description}
      </p>

      {/* CTA button — spec: rx=7, 12px semibold */}
      {showCTA && (
        <button
          data-testid="empty-state-cta"
          onClick={onAction}
          className={cn(
            'mt-5 rounded-[7px] px-6 py-2 text-[12px] font-semibold transition-all',
            isError
              ? 'border-[1.5px] border-[#DC2626] text-[#DC2626] bg-transparent hover:bg-[#FEF2F2]'
              : isSuccess
              ? 'bg-[#16A34A] text-white hover:shadow-[0_4px_16px_rgba(22,163,74,0.3)]'
              : 'bg-[#FF6B2B] text-white hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)]',
          )}
          style={{ height: 34 }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
