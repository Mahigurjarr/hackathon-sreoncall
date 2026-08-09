'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLabelSuggestions } from '@/lib/hooks/useObservabilityConnections';

/**
 * LabelsEditor — three first-class rows (environment / team / tier) plus an
 * expandable "Custom labels" section for power users. Every value is
 * autocompleted off the backend label-suggestions endpoint (static defaults
 * + whatever the tenant has previously used + the tenant's Team collection).
 *
 * The editor owns a `Record<string,string>` state externally — pass `value`
 * and `onChange`. Invalid keys are blocked inline; server-side validation
 * is still the source of truth.
 */

const PRIMARY_KEYS = ['environment', 'team', 'tier'] as const;
type PrimaryKey = (typeof PRIMARY_KEYS)[number];

const PRIMARY_META: Record<PrimaryKey, { label: string; placeholder: string; help: string }> = {
  environment: {
    label: 'Environment',
    placeholder: 'production',
    help: 'Which deploy environment this connection represents.',
  },
  team: {
    label: 'Team',
    placeholder: 'payments',
    help: 'Owning team — drives alert routing and filters.',
  },
  tier: {
    label: 'Tier',
    placeholder: 'tier-1',
    help: 'Criticality tier for SLOs and dashboards.',
  },
};

const KEY_RE = /^[a-z_][a-z0-9_]*$/;
const MAX_KEY_LEN = 64;
const MAX_VALUE_LEN = 256;

function keyError(key: string, reserved: Set<string>, existingKeys: Set<string>): string | null {
  if (!key) return null;
  if (key.length > MAX_KEY_LEN) return `Max ${MAX_KEY_LEN} chars`;
  if (!KEY_RE.test(key)) return 'Lowercase, a–z/0–9/_, must start with letter or _';
  if (reserved.has(key)) return 'Reserved — platform label';
  if (existingKeys.has(key)) return 'Already added above';
  return null;
}

function valueError(value: string): string | null {
  if (!value) return null;
  if (value.length > MAX_VALUE_LEN) return `Max ${MAX_VALUE_LEN} chars`;
  if (/[\n\r\t]/.test(value)) return 'No line breaks or tabs';
  return null;
}

export function LabelsEditor({
  value,
  onChange,
  disabled,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const { data: suggestionsResp } = useLabelSuggestions();
  const suggestions = suggestionsResp?.data;
  const reservedSet = useMemo(
    () => new Set(suggestions?.reserved_keys || ['tenant_id', 'source', 'service_name', 'job', 'emitter']),
    [suggestions],
  );

  const [showCustom, setShowCustom] = useState(
    Object.keys(value).some((k) => !PRIMARY_KEYS.includes(k as PrimaryKey)),
  );
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  function setPrimary(k: PrimaryKey, v: string) {
    const next = { ...value };
    const trimmed = v.trim();
    if (trimmed) next[k] = trimmed;
    else delete next[k];
    onChange(next);
  }

  function removeKey(k: string) {
    const next = { ...value };
    delete next[k];
    onChange(next);
  }

  function addCustom() {
    const k = newKey.trim();
    const v = newVal.trim();
    const existingKeys = new Set(Object.keys(value));
    if (!k || !v) return;
    if (keyError(k, reservedSet, existingKeys)) return;
    if (valueError(v)) return;
    onChange({ ...value, [k]: v });
    setNewKey('');
    setNewVal('');
  }

  const customEntries = Object.entries(value).filter(
    ([k]) => !PRIMARY_KEYS.includes(k as PrimaryKey),
  );

  const inputCls =
    'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Labels
        </h4>
        <span
          className="text-[10px] text-muted-foreground inline-flex items-center gap-1"
          title="Stamped on every log, metric, and trace that flows through this connection so you can filter by environment, team, or tier in Grafana."
        >
          <Info className="h-3 w-3" />
          Auto-attached to every signal
        </span>
      </div>

      {PRIMARY_KEYS.map((k) => {
        const meta = PRIMARY_META[k];
        const vals = suggestions?.values?.[k] || [];
        const listId = `labels-${k}-suggestions`;
        return (
          <div key={k} className="grid grid-cols-[110px_1fr] items-center gap-2">
            <label
              htmlFor={`labels-${k}-input`}
              className="text-xs text-muted-foreground"
              title={meta.help}
            >
              {meta.label}
            </label>
            <div>
              <input
                id={`labels-${k}-input`}
                className={inputCls}
                placeholder={meta.placeholder}
                value={value[k] || ''}
                onChange={(e) => setPrimary(k, e.target.value)}
                list={listId}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id={listId}>
                {vals.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setShowCustom((s) => !s)}
        className="text-[11px] font-semibold text-primary hover:underline"
      >
        {showCustom ? 'Hide' : 'Show'} custom labels
        {customEntries.length > 0 ? ` (${customEntries.length})` : ''}
      </button>

      {showCustom && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          {customEntries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <div className="text-xs font-mono text-foreground truncate">{k}</div>
              <input
                className={inputCls}
                value={v}
                onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                disabled={disabled}
              />
              <button
                type="button"
                className="h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
                onClick={() => removeKey(k)}
                title="Remove label"
                disabled={disabled}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {/* Add-new row */}
          <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2 pt-1">
            <div>
              <input
                className={cn(inputCls, 'font-mono')}
                placeholder="key (e.g. region)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toLowerCase())}
                disabled={disabled}
                list="labels-recommended-keys"
                autoComplete="off"
                spellCheck={false}
              />
              {keyError(newKey, reservedSet, new Set(Object.keys(value))) && (
                <p className="text-[10px] text-[#DC2626] mt-1">
                  {keyError(newKey, reservedSet, new Set(Object.keys(value)))}
                </p>
              )}
              <datalist id="labels-recommended-keys">
                {(suggestions?.recommended_keys || []).map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div>
              <input
                className={inputCls}
                placeholder="value"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                disabled={disabled}
                list={newKey ? `labels-value-suggestions-${newKey}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {valueError(newVal) && (
                <p className="text-[10px] text-[#DC2626] mt-1">{valueError(newVal)}</p>
              )}
              {newKey && suggestions?.values?.[newKey] && (
                <datalist id={`labels-value-suggestions-${newKey}`}>
                  {suggestions.values[newKey].map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              )}
            </div>
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              onClick={addCustom}
              disabled={
                disabled ||
                !newKey ||
                !newVal ||
                !!keyError(newKey, reservedSet, new Set(Object.keys(value))) ||
                !!valueError(newVal)
              }
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
