'use client';

import {
  AlertTriangle,
  Repeat,
  Hammer,
  Bot,
  Bell,
  ArrowRight,
  TrendingDown,
  FileText,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface RecurrenceData {
  is_recurring: boolean;
  pattern_description: string;
  open_action_items: number;
}

interface ToilItem {
  description: string;
  count: number;
}

interface AlertQualityItem {
  name: string;
  signal_score: number;
  recommendation: string;
}

interface LearnPanelProps {
  recurrence: RecurrenceData | null;
  toil: ToilItem[];
  alertQuality: AlertQualityItem[];
  showToil: boolean;
  showAlertQuality: boolean;
  incidentId?: string;
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-[#16A34A]' : score >= 50 ? 'bg-[#EAB308]' : 'bg-[#DC2626]';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[#E2E8F0] dark:bg-navy-elevated overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold text-[#64748B]">{score}%</span>
    </div>
  );
}

export function LearnPanel({
  recurrence,
  toil,
  alertQuality,
  showToil,
  showAlertQuality,
  incidentId,
}: LearnPanelProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Recurrence Detection */}
      <Card className="border-l-4 border-l-[#EAB308]">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-[#FEFCE8] dark:bg-yellow-950/20 flex items-center justify-center">
              <Repeat className="w-3.5 h-3.5 text-[#A16207]" />
            </div>
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              Recurrence
            </span>
          </div>

          {recurrence ? (
            recurrence.is_recurring ? (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-[8px] bg-[#FEFCE8] dark:bg-yellow-950/20 p-3">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#A16207] mt-0.5 flex-shrink-0" />
                  <p className="text-[12px] text-[#A16207] leading-relaxed">
                    {recurrence.pattern_description}
                  </p>
                </div>
                {recurrence.open_action_items > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#64748B]">
                      {recurrence.open_action_items} open action item{recurrence.open_action_items !== 1 ? 's' : ''}
                    </span>
                    <Link
                      href={incidentId ? `/postmortems?incident_id=${incidentId}` : '/postmortems'}
                      className="inline-flex items-center h-[26px] px-2 text-[10px] font-medium text-[#A16207] hover:text-[#92400E] transition-colors"
                    >
                      View Items <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-[#64748B]">
                No recurring pattern detected. This appears to be a novel incident.
              </p>
            )
          ) : (
            <p className="text-[12px] text-[#94A3B8]">
              Recurrence analysis not yet available.
            </p>
          )}
        </div>
      </Card>

      {/* Toil Detection */}
      <Card className={cn('border-l-4 border-l-[#2563EB]', !showToil && 'opacity-50')}>
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-[#EFF6FF] dark:bg-blue-950/20 flex items-center justify-center">
              <Hammer className="w-3.5 h-3.5 text-[#2563EB]" />
            </div>
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              Toil Detected
            </span>
            {!showToil && (
              <Badge variant="secondary" className="text-[8px]">Requires Data</Badge>
            )}
          </div>

          {showToil && toil.length > 0 ? (
            <div className="space-y-2">
              {toil.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-[6px] bg-[#EFF6FF] dark:bg-blue-950/20 px-2.5 py-1.5"
                >
                  <span className="text-[12px] text-[#2563EB] font-medium truncate flex-1 mr-2">
                    {item.description}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-[#2563EB] flex-shrink-0">
                    {item.count}x
                  </span>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="h-[26px] text-[10px] text-[#2563EB] w-full">
                <TrendingDown className="w-3 h-3 mr-1" />
                View Automation Opportunities
              </Button>
            </div>
          ) : showToil ? (
            <p className="text-[12px] text-[#64748B]">
              No repetitive manual tasks detected for this incident type.
            </p>
          ) : (
            <p className="text-[12px] text-[#94A3B8]">
              Toil analysis requires historical incident data.
            </p>
          )}
        </div>
      </Card>

      {/* Auto Post-Mortem */}
      <Card className="border-l-4 border-l-[#7C3AED]">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-[#F5F3FF] dark:bg-purple-950/20 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-[#7C3AED]" />
            </div>
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              Auto Post-Mortem
            </span>
            <Badge variant="ai" className="text-[8px]">AI</Badge>
          </div>

          <p className="text-[12px] text-[#64748B] leading-relaxed mb-3">
            AI will compile a blameless post-mortem from incident timeline, comms, resolution steps,
            and telemetry data when the incident is resolved.
          </p>

          <Button variant="outline" size="sm" className="h-[30px] text-[11px] w-full">
            <FileText className="w-3 h-3 mr-1.5" />
            Preview Post-Mortem Draft
          </Button>
        </div>
      </Card>

      {/* Alert Quality */}
      <Card className={cn('border-l-4 border-l-[#16A34A]', !showAlertQuality && 'opacity-50')}>
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-[#F0FDF4] dark:bg-green-950/20 flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-[#16A34A]" />
            </div>
            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
              Alert Quality
            </span>
            {!showAlertQuality && (
              <Badge variant="secondary" className="text-[8px]">Requires Data</Badge>
            )}
          </div>

          {showAlertQuality && alertQuality.length > 0 ? (
            <div className="space-y-3">
              {alertQuality.map((alert, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-gray-900 dark:text-gray-100 truncate">
                      {alert.name}
                    </span>
                  </div>
                  <ScoreBar score={alert.signal_score} />
                  <p className="text-[10px] text-[#64748B] mt-1">{alert.recommendation}</p>
                </div>
              ))}
            </div>
          ) : showAlertQuality ? (
            <p className="text-[12px] text-[#64748B]">
              No alerts associated with this incident.
            </p>
          ) : (
            <p className="text-[12px] text-[#94A3B8]">
              Alert quality scoring requires alert correlation data.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
