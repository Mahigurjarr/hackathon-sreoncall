'use client';

import {
  Code2,
  Crown,
  Users,
  Globe,
  MessageSquare,
  Send,
  Pencil,
  Sparkles,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

type Audience = 'internal_engineering' | 'internal_leadership' | 'external_customer' | 'status_page';

interface StakeholderUpdate {
  id: string;
  audience: Audience;
  content: string;
  status: 'draft' | 'sent' | 'pending';
}

interface StakeholderCommsProps {
  updates: StakeholderUpdate[];
  visibleAudiences: Audience[];
  onGenerate: (audience: string) => void;
  onSend: (updateId: string) => void;
}

const audienceConfig: Record<
  Audience,
  { label: string; icon: typeof Code2; color: string; bgColor: string; borderColor: string; badgeVariant: 'info' | 'warning' | 'success' | 'ai' }
> = {
  internal_engineering: {
    label: 'Engineering',
    icon: Code2,
    color: 'text-[#2563EB]',
    bgColor: 'bg-[#EFF6FF] dark:bg-blue-950/20',
    borderColor: 'border-l-[#2563EB]',
    badgeVariant: 'info',
  },
  internal_leadership: {
    label: 'Leadership',
    icon: Crown,
    color: 'text-[#EA580C]',
    bgColor: 'bg-[#FFF7ED] dark:bg-orange-950/20',
    borderColor: 'border-l-[#EA580C]',
    badgeVariant: 'warning',
  },
  external_customer: {
    label: 'Customers',
    icon: Users,
    color: 'text-[#16A34A]',
    bgColor: 'bg-[#F0FDF4] dark:bg-green-950/20',
    borderColor: 'border-l-[#16A34A]',
    badgeVariant: 'success',
  },
  status_page: {
    label: 'Status Page',
    icon: Globe,
    color: 'text-[#7C3AED]',
    bgColor: 'bg-[#F5F3FF] dark:bg-purple-950/20',
    borderColor: 'border-l-[#7C3AED]',
    badgeVariant: 'ai',
  },
};

export function StakeholderComms({
  updates,
  visibleAudiences,
  onGenerate,
  onSend,
}: StakeholderCommsProps) {
  if (visibleAudiences.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-[13px] font-medium text-muted-foreground">No comms access</p>
        <p className="text-[11px] text-[#94A3B8] mt-1">
          Stakeholder communication is not available for this persona.
        </p>
      </div>
    );
  }

  const audienceUpdates = visibleAudiences.map((audience) => {
    const existing = updates.find((u) => u.audience === audience);
    return { audience, update: existing };
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {audienceUpdates.map(({ audience, update }) => {
          const cfg = audienceConfig[audience];
          const Icon = cfg.icon;

          return (
            <Card
              key={audience}
              className={cn('border-l-4 overflow-hidden', cfg.borderColor)}
            >
              <div className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center',
                        cfg.bgColor,
                      )}
                    >
                      <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
                    </div>
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                      {cfg.label}
                    </span>
                  </div>
                  {update && (
                    <Badge
                      variant={update.status === 'sent' ? 'success' : 'secondary'}
                      className="text-[9px]"
                    >
                      {update.status === 'sent' ? 'Sent' : update.status === 'draft' ? 'Draft' : 'Pending'}
                    </Badge>
                  )}
                </div>

                {/* Content */}
                {update ? (
                  <div
                    className={cn(
                      'rounded-[8px] p-3 text-[12px] leading-relaxed whitespace-pre-wrap mb-3 min-h-[80px]',
                      cfg.bgColor,
                      'text-gray-700 dark:text-gray-300',
                    )}
                  >
                    {update.content}
                  </div>
                ) : (
                  <div
                    className={cn(
                      'rounded-[8px] border-2 border-dashed p-6 flex flex-col items-center justify-center text-center mb-3 min-h-[80px]',
                      cfg.bgColor,
                      'border-[#E2E8F0] dark:border-[#1E293B]',
                    )}
                  >
                    <p className="text-[11px] text-[#94A3B8] mb-2">No update drafted yet</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onGenerate(audience)}
                      className={cn('h-[28px] text-[11px]', cfg.color)}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Generate Draft
                    </Button>
                  </div>
                )}

                {/* Actions */}
                {update && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onGenerate(audience)}
                      className="h-[30px] text-[11px] text-[#64748B] flex-1"
                    >
                      <Pencil className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    {update.status !== 'sent' && (
                      <Button
                        size="sm"
                        onClick={() => onSend(update.id)}
                        className="h-[30px] text-[11px] flex-1"
                      >
                        <Send className="w-3 h-3 mr-1" />
                        Send
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Cadence reminder */}
      <div className="flex items-center gap-2 rounded-[8px] bg-[#FEFCE8] dark:bg-yellow-950/20 border border-[#FDE68A]/50 px-3 py-2">
        <Clock className="w-3.5 h-3.5 text-[#A16207] flex-shrink-0" />
        <span className="text-[11px] text-[#A16207] font-medium">
          Stakeholder updates recommended every 30 minutes during active incidents.
          Leadership and customers expect concise, jargon-free language.
        </span>
      </div>
    </div>
  );
}
