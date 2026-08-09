'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  useMigrateHerokuDrains,
  type HerokuDrainMigrationReport,
} from '@/lib/hooks/useObservabilityConnections';

/**
 * HerokuDrainMigrateModal — self-service cutover of a tenant's Heroku
 * drain URLs from the legacy 2-segment shape to the new per-app
 * /:appName URL. Always previews (dry-run) first, then gates the real
 * migration behind a Confirm click.
 */
export function HerokuDrainMigrateModal({
  connectionId,
  connectionName,
  onClose,
}: {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
}) {
  const migrate = useMigrateHerokuDrains();
  const [preview, setPreview] = useState<HerokuDrainMigrationReport | null>(null);
  const [result, setResult] = useState<HerokuDrainMigrationReport | null>(null);
  const [executing, setExecuting] = useState(false);
  const [previewing, setPreviewing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const r = await migrate.mutateAsync({ connectionId, dryRun: true });
      setPreview(r.data);
    } catch (e: any) {
      setError(e?.message || 'Failed to preview migration');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [connectionId, migrate]);

  // Kick off the dry-run as soon as the modal opens.
  useEffect(() => {
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const shown = result || preview;

  // Classify the preview state so the CTA + banner can be explicit
  // about what's going on, not just a generic "nothing to migrate".
  type EmptyState = null | 'all_current' | 'no_sreoncall_drains' | 'no_apps' | 'mixed_none_actionable';
  let emptyState: EmptyState = null;
  if (preview && !result) {
    const { appsSeen, totals } = preview;
    const { migrated, already_current, no_sreoncall_drain } = totals;
    if (appsSeen === 0) emptyState = 'no_apps';
    else if (migrated === 0 && already_current > 0 && no_sreoncall_drain === 0) emptyState = 'all_current';
    else if (migrated === 0 && no_sreoncall_drain > 0 && already_current === 0) emptyState = 'no_sreoncall_drains';
    else if (migrated === 0 && already_current === 0 && no_sreoncall_drain === 0) emptyState = 'mixed_none_actionable';
  }
  const actionable = !!(preview && preview.totals.migrated > 0);

  async function runMigration() {
    setExecuting(true);
    setError(null);
    try {
      const r = await migrate.mutateAsync({ connectionId, dryRun: false });
      setResult(r.data);
      toast.success(
        `Migrated ${r.data.totals.migrated} Heroku drains` +
          (r.data.totals.error > 0 ? ` (${r.data.totals.error} error${r.data.totals.error === 1 ? '' : 's'})` : ''),
      );
    } catch (e: any) {
      setError(e?.message || 'Migration failed');
      toast.error('Migration failed');
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Migrate Heroku drain URLs</h3>
            <p className="text-[11px] text-muted-foreground">
              Connection: <span className="font-mono">{connectionName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 text-xs text-muted-foreground leading-relaxed">
          Heroku's syslog <code className="text-primary">APP-NAME</code> is always
          literally <code className="text-primary">app</code> or <code className="text-primary">heroku</code>,
          so we need the real Heroku app slug in the drain URL to label logs
          correctly. This migration adds the new per-app URL to every app,
          then removes the legacy shared one — no log loss.
        </div>

        {previewing && !shown && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground ml-2">Scanning Heroku apps…</span>
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-rose-900">Preview failed</p>
              <pre className="text-[11px] text-rose-700 mt-1 font-mono whitespace-pre-wrap break-all">
                {error}
              </pre>
            </div>
          </div>
        )}

        {shown && (
          <div className="px-5 pb-4">
            <div className="grid grid-cols-4 gap-2 mb-3">
              <Stat label="Apps" value={shown.appsSeen} />
              <Stat label={result ? 'Migrated' : 'To migrate'} value={shown.totals.migrated} accent="brand" />
              <Stat label="Already current" value={shown.totals.already_current} />
              <Stat label="Errors" value={shown.totals.error} accent={shown.totals.error > 0 ? 'error' : undefined} />
            </div>

            {shown.apps.length > 0 && (
              <div className="max-h-[260px] overflow-y-auto rounded-md border border-border divide-y divide-border">
                {shown.apps.map((a) => (
                  <div key={a.app} className="flex items-center justify-between px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot action={a.action} />
                      <span className="font-mono text-foreground truncate">{a.app}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          a.action === 'migrated'
                            ? 'bg-primary/10 text-primary'
                            : a.action === 'already_current'
                              ? 'bg-emerald-500/10 text-emerald-700'
                              : a.action === 'error'
                                ? 'bg-rose-500/10 text-rose-700'
                                : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {a.action.replace(/_/g, ' ')}
                      </span>
                      {a.legacyDrainsFound != null && a.legacyDrainsFound > 0 && (
                        <span className="text-muted-foreground">{a.legacyDrainsFound} legacy</span>
                      )}
                      {a.error && (
                        <span className="text-rose-600 font-mono truncate max-w-[200px]" title={a.error}>
                          {a.error}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {emptyState && !result && (
              <div
                className={cn(
                  'mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                  emptyState === 'all_current'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-sky-200 bg-sky-50 text-sky-800',
                )}
              >
                {emptyState === 'all_current' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <div>
                  {emptyState === 'all_current' && (
                    <>
                      <p className="font-semibold">All set — no migration needed.</p>
                      <p className="mt-0.5 leading-relaxed">
                        Every reachable Heroku app is already on the per-app URL. Labels like
                        <code className="mx-1 text-primary">service_name=&lt;app&gt;</code>
                        will keep working automatically.
                      </p>
                    </>
                  )}
                  {emptyState === 'no_sreoncall_drains' && (
                    <>
                      <p className="font-semibold">No SREonCall drains found on these apps.</p>
                      <p className="mt-0.5 leading-relaxed">
                        The API key can see {preview!.appsSeen} Heroku app
                        {preview!.appsSeen === 1 ? '' : 's'}, but none have a drain pointing at
                        our ingest endpoint. Add one from the Connect wizard before migrating.
                      </p>
                    </>
                  )}
                  {emptyState === 'no_apps' && (
                    <>
                      <p className="font-semibold">No Heroku apps visible.</p>
                      <p className="mt-0.5 leading-relaxed">
                        The API key on this connection has access to zero apps. Check the key&apos;s
                        scope in Heroku or regenerate it from the Connect wizard.
                      </p>
                    </>
                  )}
                  {emptyState === 'mixed_none_actionable' && (
                    <>
                      <p className="font-semibold">Nothing actionable.</p>
                      <p className="mt-0.5 leading-relaxed">
                        No apps match any of the known states — this usually means the Heroku
                        API returned an unexpected shape. Try refreshing; open a support ticket
                        if it persists.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={runPreview}
            disabled={executing || previewing}
            title="Re-scan Heroku"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', previewing && 'animate-spin')} />
            Re-scan
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={executing}>
            {result || emptyState ? 'Close' : 'Cancel'}
          </Button>
          {!result && actionable && (
            <Button size="sm" onClick={runMigration} disabled={executing}>
              {executing && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Migrate {preview!.totals.migrated} app{preview!.totals.migrated === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'error';
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-base font-bold tabular-nums mt-0.5',
          accent === 'brand' && 'text-primary',
          accent === 'error' && value > 0 && 'text-rose-600',
          !accent && 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatusDot({ action }: { action: string }) {
  const color =
    action === 'migrated'
      ? 'bg-primary'
      : action === 'already_current'
        ? 'bg-emerald-500'
        : action === 'error'
          ? 'bg-rose-500'
          : 'bg-muted-foreground';
  return <span className={cn('h-2 w-2 rounded-full shrink-0', color)} />;
}
