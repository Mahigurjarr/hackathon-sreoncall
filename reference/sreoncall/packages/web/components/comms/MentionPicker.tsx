'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChannelMembers, type ChannelMember } from '@/lib/hooks/useCommunications';

interface MentionPickerProps {
  threadId: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}

export function MentionPicker({ threadId, textareaRef, value, onChange }: MentionPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const { data: membersData } = useChannelMembers(threadId);
  const allMembers = membersData?.data ?? [];

  const filtered = query
    ? allMembers.filter((m) => m.display_name.toLowerCase().includes(query.toLowerCase()))
    : allMembers;

  const insertMention = useCallback((member: ChannelMember) => {
    if (triggerPos === null) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const before = value.slice(0, triggerPos);
    const after = value.slice(textarea.selectionStart);
    const mention = `<@${member.id}>`;
    const newValue = before + mention + ' ' + after;
    onChange(newValue);
    setShowPicker(false);
    setQuery('');
    setTriggerPos(null);

    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      const pos = before.length + mention.length + 1;
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
    });
  }, [triggerPos, value, onChange, textareaRef]);

  // Handle keydown on the textarea
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!showPicker || filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' && showPicker) {
      e.preventDefault();
      insertMention(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowPicker(false);
      setQuery('');
      setTriggerPos(null);
    }
  }, [showPicker, filtered, selectedIndex, insertMention]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.addEventListener('keydown', handleKeyDown);
    return () => textarea.removeEventListener('keydown', handleKeyDown);
  }, [textareaRef, handleKeyDown]);

  // Detect @ trigger on input
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleInput = () => {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = textarea.value.slice(0, cursorPos);

      // Find the last @ that's not inside <@...>
      const lastAt = textBeforeCursor.lastIndexOf('@');
      if (lastAt === -1 || (lastAt > 0 && textBeforeCursor[lastAt - 1] === '<')) {
        setShowPicker(false);
        setQuery('');
        setTriggerPos(null);
        return;
      }

      // Check there's no space between @ and cursor (allow typing query)
      const queryStr = textBeforeCursor.slice(lastAt + 1);
      if (queryStr.includes(' ') || queryStr.includes('\n')) {
        setShowPicker(false);
        setQuery('');
        setTriggerPos(null);
        return;
      }

      setTriggerPos(lastAt);
      setQuery(queryStr);
      setShowPicker(true);
      setSelectedIndex(0);
    };

    textarea.addEventListener('input', handleInput);
    return () => textarea.removeEventListener('input', handleInput);
  }, [textareaRef]);

  if (!showPicker || filtered.length === 0) return null;

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg z-10"
    >
      {filtered.slice(0, 20).map((member, idx) => (
        <button
          key={member.id}
          type="button"
          className={`w-full px-3 py-2 text-left text-sm transition-colors ${
            idx === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted'
          }`}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            insertMention(member);
          }}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <span className="font-medium">{member.display_name}</span>
        </button>
      ))}
    </div>
  );
}
