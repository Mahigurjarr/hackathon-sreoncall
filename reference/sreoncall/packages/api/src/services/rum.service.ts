export interface RumSeriesPoint {
  time: string;
  value: number;
}

export interface RumTableRow {
  url_path: string;
  value: number;
}

export interface RumBrowserRow {
  name: string;
  value: number;
}

export interface RumSummary {
  hasData: boolean;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  jsErrors: RumSeriesPoint[];
  pageLoad: RumTableRow[];
  sessions: RumSeriesPoint[];
  browsers: RumBrowserRow[];
  samples: number;
}

interface RumMeasurement {
  name: 'lcp' | 'inp' | 'cls' | 'page_load';
  value: number;
  urlPath?: string;
}

interface ParsedRumEvent {
  timestampMs: number;
  appName: string | null;
  browser: string;
  sessionId: string | null;
  urlPath: string;
  hasError: boolean;
  measurements: RumMeasurement[];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const STRING_KEYS = [
  'browser_name',
  'browserName',
  'session_id',
  'sessionId',
  'faroSessionId',
  'url',
  'page_url',
  'pageUrl',
  'pathname',
  'path',
  'message',
  'type',
  'kind',
  'name',
  'event',
  'level',
];

const LCP_NAMES = new Set(['lcp', 'largestcontentfulpaint', 'largest-contentful-paint']);
const INP_NAMES = new Set(['inp', 'interactiontonextpaint', 'interaction-to-next-paint']);
const CLS_NAMES = new Set(['cls', 'cumulativelayoutshift', 'cumulative-layout-shift']);
const PAGE_LOAD_NAMES = new Set([
  'pageload',
  'page-load',
  'page_load',
  'pageloadtime',
  'page-load-time',
  'page_load_time',
  'loadtime',
  'load_time',
  'navigationduration',
  'navigation-duration',
]);

function normalizeToken(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function normalizeMetricName(input: string): RumMeasurement['name'] | null {
  const token = normalizeToken(input);
  if (LCP_NAMES.has(token)) return 'lcp';
  if (INP_NAMES.has(token)) return 'inp';
  if (CLS_NAMES.has(token)) return 'cls';
  if (PAGE_LOAD_NAMES.has(token)) return 'page_load';
  return null;
}

function coerceFiniteNumber(value: JsonValue | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function visitJson(value: JsonValue, fn: (node: Record<string, JsonValue>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) visitJson(item, fn);
    return;
  }
  if (!isRecord(value)) return;
  fn(value);
  for (const child of Object.values(value)) visitJson(child, fn);
}

function findFirstString(value: JsonValue, keys: string[]): string | null {
  let found: string | null = null;
  const wanted = new Set(keys);
  visitJson(value, (node) => {
    if (found) return;
    for (const [key, nodeValue] of Object.entries(node)) {
      if (!wanted.has(key) || typeof nodeValue !== 'string') continue;
      const trimmed = nodeValue.trim();
      if (trimmed) {
        found = trimmed;
        return;
      }
    }
  });
  return found;
}

function hasTruthyArray(value: JsonValue, keys: string[]): boolean {
  let found = false;
  const wanted = new Set(keys);
  visitJson(value, (node) => {
    if (found) return;
    for (const [key, nodeValue] of Object.entries(node)) {
      if (wanted.has(key) && Array.isArray(nodeValue) && nodeValue.length > 0) {
        found = true;
        return;
      }
    }
  });
  return found;
}

function parseUrlPath(raw: string | null): string {
  if (!raw) return 'unknown';
  if (raw.startsWith('/')) return raw;
  try {
    return new URL(raw).pathname || '/';
  } catch {
    return raw;
  }
}

function detectBrowser(value: JsonValue): string {
  const browser = findFirstString(value, ['browser_name', 'browserName', 'name']);
  return browser || 'unknown';
}

function detectAppName(value: JsonValue): string | null {
  const direct = findFirstString(value, ['app_name', 'appName']);
  if (direct) return direct;

  let nested: string | null = null;
  visitJson(value, (node) => {
    if (nested) return;
    const app = node['app'];
    if (!isRecord(app)) return;
    const name = app['name'];
    if (typeof name !== 'string') return;
    const trimmed = name.trim();
    if (trimmed) nested = trimmed;
  });

  return nested;
}

function detectSessionId(value: JsonValue): string | null {
  return findFirstString(value, ['session_id', 'sessionId', 'faroSessionId', 'session']) || null;
}

function detectUrlPath(value: JsonValue): string {
  return parseUrlPath(findFirstString(value, ['page_url', 'pageUrl', 'url', 'pathname', 'path']));
}

function detectError(value: JsonValue): boolean {
  if (hasTruthyArray(value, ['exceptions', 'errors'])) return true;

  let found = false;
  visitJson(value, (node) => {
    if (found) return;
    for (const [key, nodeValue] of Object.entries(node)) {
      if (typeof nodeValue !== 'string') continue;
      if (!STRING_KEYS.includes(key)) continue;
      const token = normalizeToken(nodeValue);
      if (token.includes('exception') || token === 'error' || token === 'consoleerror' || token === 'jserror') {
        found = true;
        return;
      }
    }
  });
  return found;
}

function collectMeasurements(value: JsonValue): RumMeasurement[] {
  const measurements: RumMeasurement[] = [];
  const seen = new Set<string>();

  function pushMeasurement(name: RumMeasurement['name'], rawValue: JsonValue | undefined, urlPath?: string) {
    const value = coerceFiniteNumber(rawValue);
    if (value === null) return;
    const key = `${name}:${urlPath || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    measurements.push(urlPath ? { name, value, urlPath } : { name, value });
  }

  visitJson(value, (node) => {
    for (const [key, nodeValue] of Object.entries(node)) {
      const metricName = normalizeMetricName(key);
      if (metricName) pushMeasurement(metricName, nodeValue);

      if (key.startsWith('value_')) {
        const derivedMetricName = normalizeMetricName(key.slice('value_'.length));
        if (derivedMetricName) pushMeasurement(derivedMetricName, nodeValue);
      }
    }

    const explicitName = ['name', 'type', 'metric', 'measurement', 'kind', 'event', 'event_name']
      .map((key) => node[key])
      .find((candidate): candidate is string => typeof candidate === 'string');
    const explicitMetric = explicitName ? normalizeMetricName(explicitName) : null;
    const explicitValue = ['value', 'duration', 'score']
      .map((key) => node[key])
      .find((candidate) => coerceFiniteNumber(candidate) !== null);

    if (explicitMetric && explicitValue !== undefined) {
      pushMeasurement(explicitMetric, explicitValue);
    }

    if (node.type === 'web-vitals' || node.kind === 'measurement') {
      pushMeasurement('lcp', node.value_lcp ?? node.lcp);
      pushMeasurement('inp', node.value_inp ?? node.inp);
      pushMeasurement('cls', node.value_cls ?? node.cls);
    }

    if (node.event_name === 'faro.performance.resource') {
      const resourcePath = parseUrlPath(typeof node.event_data_name === 'string' ? node.event_data_name : null);
      pushMeasurement('page_load', node.event_data_duration ?? node.duration ?? node.value, resourcePath);
    }
  });

  return measurements;
}

function parseLogfmt(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=("(?:[^"\\]|\\.)*"|[^\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const key = m[1];
    const raw = m[2];
    result[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
  }
  return result;
}

export function parseRumLogLine(line: string, timestampNs: string): ParsedRumEvent | null {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(line) as JsonValue;
  } catch {
    const flat = parseLogfmt(line);
    if (Object.keys(flat).length === 0) return null;
    parsed = flat as unknown as JsonValue;
  }

  const timestampMs = Math.floor(Number(timestampNs) / 1e6);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;

  const event: ParsedRumEvent = {
    timestampMs,
    appName: detectAppName(parsed),
    browser: detectBrowser(parsed),
    sessionId: detectSessionId(parsed),
    urlPath: detectUrlPath(parsed),
    hasError: detectError(parsed),
    measurements: collectMeasurements(parsed),
  };

  if (!event.hasError && event.measurements.length === 0 && !event.sessionId) return null;
  return event;
}

function bucketTimeLabel(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildRumSummary(entries: Array<{ timestampNs: string; line: string }>): RumSummary {
  const lcpValues: number[] = [];
  const inpValues: number[] = [];
  const clsValues: number[] = [];
  const pageLoadByPath = new Map<string, number[]>();
  const errorBuckets = new Map<string, number>();
  const sessionBuckets = new Map<string, Set<string>>();
  const browserSessions = new Map<string, Set<string>>();
  let samples = 0;

  for (const entry of entries) {
    const event = parseRumLogLine(entry.line, entry.timestampNs);
    if (!event) continue;
    samples += 1;

    const timeBucket = bucketTimeLabel(event.timestampMs);
    const sessionKey = event.sessionId || `${event.browser}:${event.urlPath}:${Math.floor(event.timestampMs / 60000)}`;

    if (!sessionBuckets.has(timeBucket)) sessionBuckets.set(timeBucket, new Set());
    sessionBuckets.get(timeBucket)!.add(sessionKey);

    if (!browserSessions.has(event.browser)) browserSessions.set(event.browser, new Set());
    browserSessions.get(event.browser)!.add(sessionKey);

    if (event.hasError) {
      errorBuckets.set(timeBucket, (errorBuckets.get(timeBucket) || 0) + 1);
    }

    for (const measurement of event.measurements) {
      if (measurement.name === 'lcp') lcpValues.push(measurement.value);
      if (measurement.name === 'inp') inpValues.push(measurement.value);
      if (measurement.name === 'cls') clsValues.push(measurement.value);
      if (measurement.name === 'page_load') {
        const path = measurement.urlPath || event.urlPath;
        if (!pageLoadByPath.has(path)) pageLoadByPath.set(path, []);
        pageLoadByPath.get(path)!.push(measurement.value);
      }
    }
  }

  const jsErrors = Array.from(errorBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, value]) => ({ time, value }));

  const sessions = Array.from(sessionBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, ids]) => ({ time, value: ids.size }));

  const browsers = Array.from(browserSessions.entries())
    .map(([name, ids]) => ({ name, value: ids.size }))
    .sort((a, b) => b.value - a.value);

  const pageLoad = Array.from(pageLoadByPath.entries())
    .map(([url_path, values]) => ({
      url_path,
      value: average(values) || 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  return {
    hasData: samples > 0,
    lcp: average(lcpValues),
    inp: average(inpValues),
    cls: average(clsValues),
    jsErrors,
    pageLoad,
    sessions,
    browsers,
    samples,
  };
}

export function filterRumEntriesByAppName(
  entries: Array<{ timestampNs: string; line: string }>,
  expectedAppName: string,
): Array<{ timestampNs: string; line: string }> {
  return entries.filter((entry) => {
    const event = parseRumLogLine(entry.line, entry.timestampNs);
    return event?.appName === expectedAppName;
  });
}
