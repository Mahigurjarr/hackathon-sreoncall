// Pure, unit-testable log-line helpers for the "no-LogQL" Logs Explorer (LogsExploreV2).
// Extracted from the previously-unexported getLevelColor() in
// app/(app)/observability/logs/page.tsx so the multi-source level-detection logic
// (stream label → JSON field → regex fallback → default) can be tested in isolation
// and reused by the new component without duplicating it.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Canonicalize a raw level token (from a label, a JSON field, or matched text) to one of the four buckets. */
function normalizeLevel(raw: string): LogLevel | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === 'error' || v === 'err' || v === 'fatal' || v === 'critical' || v === 'crit' || v === '50' || v === '60') {
    return 'error';
  }
  if (v === 'warn' || v === 'warning' || v === '40') return 'warn';
  if (v === 'debug' || v === 'trace' || v === '10' || v === '20') return 'debug';
  if (v === 'info' || v === 'information' || v === 'notice' || v === '30') return 'info';
  return null;
}

/**
 * Parse a log line as a JSON object (for structured-field rendering / level extraction).
 * Returns null for non-JSON lines or JSON that isn't a plain object (arrays, primitives).
 */
export function parseLogLineFields(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

const LEVEL_TAG_PATTERN =
  /\[(ERROR|ERR|FATAL|CRITICAL|CRIT|WARN(?:ING)?|DEBUG|TRACE|INFO)\]|(?:level|severity|lvl)\s*[=:]\s*"?(error|err|fatal|critical|crit|warn(?:ing)?|debug|trace|info)"?|\b(ERROR|ERR|FATAL|CRITICAL|CRIT|WARN(?:ING)?|DEBUG|TRACE)\s*[:\-|]/i;

/**
 * Determine the level of a log line, checking (in order):
 *  1. Stream labels — level / severity / log_level / loglevel (most reliable; Loki-native).
 *  2. JSON line fields — level / severity / loglevel / log_level / lvl / Level / Severity.
 *  3. A regex fallback over the raw text — `[ERROR]`, `level=error`, `ERROR:` etc.
 *  4. Default — 'info' when nothing matches.
 */
export function getLevelColor(line: string, streamLabels: Record<string, string> = {}): LogLevel {
  const streamLevel = streamLabels.level || streamLabels.severity || streamLabels.log_level || streamLabels.loglevel || '';
  if (streamLevel) {
    const norm = normalizeLevel(streamLevel);
    if (norm) return norm;
  }

  const parsed = parseLogLineFields(line);
  if (parsed) {
    const jsonLevel = String(
      parsed.level ?? parsed.severity ?? parsed.loglevel ?? parsed.log_level ?? parsed.lvl ?? parsed.Level ?? parsed.Severity ?? '',
    );
    if (jsonLevel) {
      const norm = normalizeLevel(jsonLevel);
      if (norm) return norm;
    }
  }

  const match = line.match(LEVEL_TAG_PATTERN);
  if (match) {
    const norm = normalizeLevel(match[1] || match[2] || match[3] || '');
    if (norm) return norm;
  }

  return 'info';
}
