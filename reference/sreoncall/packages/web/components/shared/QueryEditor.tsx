'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: 'promql' | 'logql';
  placeholder?: string;
  height?: string;
  onFocus?: () => void;
}

export function QueryEditor({
  value,
  onChange,
  language,
  placeholder,
  height = '80px',
  onFocus,
}: QueryEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const lineCount = useMemo(() => Math.max(1, value.split('\n').length), [value]);

  async function copyQuery() {
    if (!value.trim()) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-muted-foreground">
            {language}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onChange('');
              textareaRef.current?.focus();
            }}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            title="Clear query"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={copyQuery}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40"
            title="Copy query"
            disabled={!value.trim()}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder ?? (language === 'logql' ? '{service_name="api"} |= "error"' : 'up')}
        spellCheck={false}
        style={{ minHeight: height }}
        className={cn(
          'block w-full resize-y border-0 bg-background px-3 py-2 font-mono text-[12px] leading-5 text-foreground outline-none',
          'placeholder:text-muted-foreground/60 focus:ring-0',
        )}
      />
    </div>
  );
}
