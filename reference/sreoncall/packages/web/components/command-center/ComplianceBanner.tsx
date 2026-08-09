'use client';

import { AlertTriangle, Shield, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface ComplianceAction {
  key: string;
  action: string;
  status: 'pending' | 'completed' | 'in_progress';
}

interface ComplianceBannerProps {
  regulation: string;
  deadline: Date;
  timeRemaining: string;
  actions: ComplianceAction[];
  canAct: boolean;
  onMarkAction?: (key: string) => void;
}

export function ComplianceBanner({
  regulation,
  deadline,
  timeRemaining,
  actions,
  canAct,
  onMarkAction,
}: ComplianceBannerProps) {
  const completedCount = actions.filter((a) => a.status === 'completed').length;
  const isUrgent = new Date().getTime() > deadline.getTime() - 4 * 60 * 60 * 1000; // < 4 hours

  return (
    <div
      className={cn(
        'rounded-[8px] border px-4 py-2.5 flex items-center gap-3 flex-wrap',
        isUrgent
          ? 'border-[#FECACA] bg-[#FEF2F2] dark:bg-red-950/20 dark:border-red-900/40'
          : 'border-[#FDE68A] bg-[#FEFCE8] dark:bg-yellow-950/20 dark:border-yellow-900/40',
      )}
    >
      {/* Warning icon */}
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
          isUrgent ? 'bg-[#DC2626]/10' : 'bg-[#A16207]/10',
        )}
      >
        {isUrgent ? (
          <AlertTriangle className="w-3.5 h-3.5 text-[#DC2626]" />
        ) : (
          <Shield className="w-3.5 h-3.5 text-[#A16207]" />
        )}
      </div>

      {/* Regulation + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-[13px] font-bold',
              isUrgent ? 'text-[#DC2626]' : 'text-[#A16207]',
            )}
          >
            {regulation}
          </span>
          <Badge
            variant={isUrgent ? 'destructive' : 'warning'}
            className="text-[8px]"
          >
            {completedCount}/{actions.length} actions done
          </Badge>
        </div>
        <p
          className={cn(
            'text-[11px] mt-0.5',
            isUrgent ? 'text-[#DC2626]/80' : 'text-[#A16207]/80',
          )}
        >
          Breach notification deadline:{' '}
          {deadline.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>

      {/* Countdown timer */}
      <div className="font-mono text-[16px] font-bold tracking-wider flex-shrink-0"
        style={{ color: isUrgent ? '#DC2626' : '#A16207' }}
      >
        {timeRemaining}
      </div>

      {/* Per-action checklist */}
      {actions.length > 0 && (
        <div className="w-full mt-2 space-y-1">
          {actions.map((a) => (
            <div key={a.key} className="flex items-center gap-2">
              {a.status === 'completed' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] flex-shrink-0" />
              ) : (
                <Circle className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: isUrgent ? '#DC2626' : '#A16207' }}
                />
              )}
              <span className={cn(
                'text-[11px] flex-1',
                a.status === 'completed'
                  ? 'line-through text-[#94A3B8]'
                  : isUrgent ? 'text-[#DC2626]/80' : 'text-[#A16207]/80',
              )}>
                {a.action}
              </span>
              {canAct && a.status !== 'completed' && onMarkAction && (
                <button
                  onClick={() => onMarkAction(a.key)}
                  className="text-[10px] font-medium underline flex-shrink-0"
                  style={{ color: isUrgent ? '#DC2626' : '#A16207' }}
                >
                  Mark done
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
