'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface TimelineEntry {
  timestamp: string;
  type: 'alert' | 'status' | 'ai' | 'step' | 'resolve' | 'note' | 'escalation';
  actor_name: string;
  message: string;
}

interface IncidentTimelineProps {
  entries: TimelineEntry[];
  canAddNotes: boolean;
  onAddNote?: (note: string) => void;
}

const dotColors: Record<string, string> = {
  alert: '#DC2626',
  status: '#EA580C',
  ai: '#7C3AED',
  step: '#2563EB',
  resolve: '#16A34A',
  note: '#64748B',
  escalation: '#EAB308',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function IncidentTimeline({
  entries,
  canAddNotes,
  onAddNote,
}: IncidentTimelineProps) {
  const [showInput, setShowInput] = useState(false);
  const [noteText, setNoteText] = useState('');

  const handleSubmitNote = () => {
    if (noteText.trim()) {
      onAddNote?.(noteText.trim());
      setNoteText('');
      setShowInput(false);
    }
  };

  if (!entries || entries.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface p-4">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          Timeline
        </p>
        <p className="mt-2 text-[13px] text-[#94A3B8]">No timeline entries</p>
      </div>
    );
  }

  // Group entries by date
  let lastDate = '';

  return (
    <div className="rounded-[12px] border border-border bg-card dark:bg-navy-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between p-4 pb-2">
        <p className="text-[10px] uppercase tracking-wide font-bold text-[#FF6B2B]">
          Timeline
        </p>
        {canAddNotes && (
          <Button
            size="sm"
            variant="ghost"
            className="h-[24px] px-2 text-[11px] text-[#64748B]"
            onClick={() => setShowInput(!showInput)}
          >
            <Plus className="h-3 w-3 mr-0.5" />
            Note
          </Button>
        )}
      </div>

      {/* Add note input */}
      {showInput && (
        <div className="px-4 pb-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitNote()}
              placeholder="Add a note..."
              maxLength={500}
              className="flex-1 rounded-[6px] border border-border bg-background px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#FF6B2B]"
              autoFocus
            />
            <Button
              size="sm"
              className="h-[30px] px-3 text-[11px]"
              onClick={handleSubmitNote}
              disabled={!noteText.trim()}
            >
              Add
            </Button>
          </div>
          {noteText.length > 450 && (
            <p className="mt-1 text-right text-[10px] text-[#94A3B8]">
              {500 - noteText.length} characters remaining
            </p>
          )}
        </div>
      )}

      {/* Scrollable timeline */}
      <div className="max-h-[400px] overflow-y-auto px-4 pb-4">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border" />

          <div className="space-y-0">
            {entries.map((entry, idx) => {
              const dotColor = dotColors[entry.type] || '#64748B';
              const entryDate = formatDate(entry.timestamp);
              const showDateHeader = entryDate !== lastDate;
              lastDate = entryDate;

              return (
                <div key={idx}>
                  {showDateHeader && (
                    <div className="relative pl-6 pt-2 pb-1">
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-[#94A3B8]">
                        {entryDate}
                      </span>
                    </div>
                  )}
                  <div className="relative flex items-start gap-3 py-1.5 group">
                    {/* Dot */}
                    <div
                      className={cn(
                        'relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-white dark:border-navy-surface',
                      )}
                      style={{ backgroundColor: dotColor }}
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-mono font-medium text-[#94A3B8] shrink-0">
                          {formatTime(entry.timestamp)}
                        </span>
                        <span className="text-[11px] font-semibold text-foreground truncate">
                          {entry.actor_name}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-[#64748B] leading-snug">
                        {entry.message}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
