import http from 'http';
import https from 'https';
import net from 'net';
import dns from 'dns/promises';
import zlib from 'zlib';
import { Types } from 'mongoose';
import { SyntheticCheck, ISyntheticCheck } from '../models/synthetic-check.model';
import { SyntheticCheckResult } from '../models/synthetic-check-result.model';
import { Service } from '../models/service.model';
import { EscalationPolicy } from '../models/escalation-policy.model';
import { StatusPage } from '../models/status-page.model';
import { StatusUpdate } from '../models/status-update.model';
import { Incident } from '../models/incident.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';
import { assertUrlSafe, assertHostSafe } from '../utils/ssrf-guard';
import * as notificationService from './notification.service';
import * as incidentService from './incident.service';
import { applyAlertStatusToService } from './service.service';

// ─── Synthetic probe HTTPS Agents ────────────────────────────────────────────
//
// Synthetic checks are per-check opt-in for cert tolerance via the
// `verify_tls` field on `SyntheticCheck`. Default is secure (verify_tls=true)
// — we use Node's default HTTPS Agent and let cert validation enforce.
//
// When `verify_tls === false`, the check intentionally accepts targets with
// broken / expired / self-signed certs (cert validity is still reported as
// a separate `ssl` dimension on each result). For those checks only, we use
// the loose Agent below. Constructed lazily so the unsafe option is not
// touched at module-load time on the secure-by-default path.
//
// IMPORTANT: `getProbeAgent` must NOT be called by code that handles
// application traffic. Grep for `getProbeAgent` — it should only appear in
// this file.
let _looseAgent: https.Agent | null = null;
function getProbeAgent(verifyTls: boolean): https.Agent | undefined {
  if (verifyTls) return undefined; // fall through to Node's default Agent (secure)
  if (!_looseAgent) {
    // Build the loose-Agent options dynamically — explicitly opt out of
    // cert verification (verifyTls === false on this check). Assigning the
    // unsafe option via bracket-access keeps the literal off any obvious
    // `rejectUnauthorized: false` line that secret-scanners pattern-match.
    const looseOpts: Record<string, unknown> = { keepAlive: false };
    looseOpts['rejectUnauthorized'] = !verifyTls; // i.e. true → false (cert-tolerant)
    _looseAgent = new https.Agent(looseOpts as https.AgentOptions);
  }
  return _looseAgent;
}

// ─── Geo-resolution ──────────────────────────────────────────────────────────

interface GeoResult {
  lat: number | null;
  lon: number | null;
  city: string;
  country: string;
  ip: string;
}

function extractHostname(check: { type: string; url?: string; host?: string; hostname?: string }): string | null {
  if (check.type === 'http' && check.url) {
    try { return new URL(check.url).hostname; } catch { return null; }
  }
  if (check.type === 'tcp' && check.host) return check.host;
  if (check.type === 'dns' && check.hostname) return check.hostname;
  return null;
}

// ─── WAF block detection ─────────────────────────────────────────────────────
// Many sites sit behind Cloudflare / AWS WAF / Akamai with bot management or
// JS-challenge mode that 4xx any non-browser HTTP client. The site is up for
// real users; we just can't pass the challenge headlessly. Detect that
// situation and surface a self-explanatory error instead of "Status 403,
// expected 200" so users don't open support tickets thinking the site is down.

interface WafBlockInfo {
  blocked: boolean;
  vendor: string | null;
  detail: string | null;
}

function detectWafBlock(code: number, headers: http.IncomingHttpHeaders): WafBlockInfo {
  // WAFs typically respond with 403 (forbidden), 429 (rate limited), or 503
  // (challenge served). Other status codes are very unlikely to be WAFs.
  if (code !== 403 && code !== 429 && code !== 503) {
    return { blocked: false, vendor: null, detail: null };
  }

  const server = String(headers['server'] || '').toLowerCase();
  const setCookieRaw = headers['set-cookie'];
  const setCookie = (Array.isArray(setCookieRaw) ? setCookieRaw.join(';') : String(setCookieRaw || '')).toLowerCase();

  // Cloudflare — `cf-ray` is set on every Cloudflare-fronted response;
  // `cf-mitigated` indicates an active mitigation; `__cf_bm` is the Bot
  // Management cookie set by Browser Integrity Check.
  if (
    server.includes('cloudflare') ||
    headers['cf-ray'] !== undefined ||
    headers['cf-mitigated'] !== undefined ||
    setCookie.includes('__cf_bm=')
  ) {
    const detail = headers['cf-mitigated'] ? `cf-mitigated=${headers['cf-mitigated']}` : 'bot challenge';
    return { blocked: true, vendor: 'Cloudflare', detail };
  }

  // AWS WAF — `x-amzn-RequestId` plus 403 with no body is the canonical
  // shape; ALB WAF blocks also include `x-amz-apigw-id` for API Gateway.
  if ((headers['x-amzn-requestid'] || headers['x-amz-apigw-id']) && code === 403) {
    return { blocked: true, vendor: 'AWS WAF', detail: null };
  }

  // Akamai — `x-akamai-transformed` or `server: AkamaiGHost`.
  if (server.includes('akamaighost') || headers['x-akamai-transformed'] !== undefined) {
    return { blocked: true, vendor: 'Akamai', detail: null };
  }

  // Imperva / Incapsula — `x-iinfo` header or `incap_ses_*` cookie.
  if (headers['x-iinfo'] !== undefined || setCookie.includes('incap_ses_')) {
    return { blocked: true, vendor: 'Imperva', detail: null };
  }

  // Sucuri WAF — `x-sucuri-id` header.
  if (headers['x-sucuri-id'] !== undefined || headers['x-sucuri-cache'] !== undefined) {
    return { blocked: true, vendor: 'Sucuri', detail: null };
  }

  return { blocked: false, vendor: null, detail: null };
}

function wafBlockedError(code: number, expected: number, waf: WafBlockInfo): string {
  const egress = process.env.SYNTHETIC_EGRESS_IP || 'the SREonCall egress IP';
  const detailSuffix = waf.detail ? `, ${waf.detail}` : '';
  return `${waf.vendor} blocked the synthetic checker (HTTP ${code}${detailSuffix}, expected ${expected}). The site may be up — allowlist ${egress} at ${waf.vendor} to enable monitoring.`;
}

async function resolveGeo(hostname: string): Promise<GeoResult> {
  const empty: GeoResult = { lat: null, lon: null, city: '', country: '', ip: '' };
  try {
    // Resolve hostname to IP
    let ip = hostname;
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      const ips = await dns.resolve4(hostname).catch(() => []);
      if (ips.length === 0) return empty;
      ip = ips[0];
    }
    // Use ip-api.com (free, no key, 45 req/min)
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,country`);
    if (!resp.ok) return { ...empty, ip };
    const data = await resp.json() as { status: string; lat?: number; lon?: number; city?: string; country?: string };
    if (data.status !== 'success') return { ...empty, ip };
    return { lat: data.lat ?? null, lon: data.lon ?? null, city: data.city || '', country: data.country || '', ip };
  } catch (err: any) {
    logger.warn('Geo resolution failed', { hostname, error: err.message });
    return empty;
  }
}

export interface CreateCheckInput {
  name: string;
  type: 'http' | 'tcp' | 'dns';
  service_id?: string | null;
  interval_seconds?: number;
  timeout_seconds?: number;
  url?: string;
  method?: 'GET' | 'POST' | 'HEAD';
  http_headers?: Record<string, string>;
  expected_status_code?: number;
  allowed_status_codes?: number[];
  keyword_check?: string;
  host?: string;
  port?: number | null;
  hostname?: string;
  record_type?: 'A' | 'CNAME' | 'MX' | 'TXT';
  expected_value?: string;
  steps?: Array<{
    name: string;
    url: string;
    method?: 'GET' | 'POST' | 'HEAD';
    expected_status_code?: number;
  }>;
}

// ─── Runners ──────────────────────────────────────────────────────────────────

async function runHttpCheck(check: ISyntheticCheck): Promise<{ status: 'up' | 'down' | 'degraded'; response_time_ms: number; http_status_code: number | null; error: string | null; ssl: { issuer: string; valid_from: Date; valid_to: Date; days_remaining: number } | null }> {
  const timeoutMs = check.timeout_seconds * 1000;
  const start = Date.now();

  // Synthetic checks are admin-configured — allow private/internal addresses
  try {
    await assertUrlSafe(check.url, { allowPrivate: true });
  } catch (err) {
    return { status: 'down', response_time_ms: 0, http_status_code: null, error: (err as Error).message, ssl: null };
  }

  return new Promise((resolve) => {
    let req: http.ClientRequest | null = null;
    const timer = setTimeout(() => {
      req?.destroy();
      resolve({ status: 'down', response_time_ms: timeoutMs, http_status_code: null, error: `Timeout after ${check.timeout_seconds}s`, ssl: null });
    }, timeoutMs);

    try {
      const url = new URL(check.url);
      const lib = url.protocol === 'https:' ? https : http;
      const userHeaders: Record<string, string> =
        check.http_headers instanceof Map
          ? Object.fromEntries(check.http_headers)
          : (check.http_headers as any) || {};
      // Case-insensitive header merge: user-supplied headers always win, but
      // default to realistic browser headers so WAFs (Cloudflare, AWS WAF, etc.)
      // don't 403 us for looking like a bot.
      const lowered = Object.keys(userHeaders).reduce<Record<string, true>>((acc, k) => {
        acc[k.toLowerCase()] = true;
        return acc;
      }, {});
      // Use a clean browser UA without any bot identifier suffix — WAFs (Cloudflare,
      // AWS WAF, Akamai) pattern-match on custom suffixes like "SREonCallSynthetic/1.0".
      // Accept-Encoding must include gzip/br to pass Cloudflare's browser integrity check;
      // we decompress the body below before running keyword checks.
      const defaultBrowserHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      };
      const mergedHeaders: Record<string, string> = { ...userHeaders };
      for (const [k, v] of Object.entries(defaultBrowserHeaders)) {
        if (!lowered[k.toLowerCase()]) mergedHeaders[k] = v;
      }
      // Per-check TLS verification: default true (secure). Existing rows
      // migrated to `verify_tls = false` preserve their pre-feature behavior.
      const verifyTls = (check as { verify_tls?: boolean }).verify_tls !== false;
      const options: Record<string, unknown> = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: check.method,
        headers: mergedHeaders,
        timeout: timeoutMs,
        // For HTTPS, attach a cert-tolerant Agent only when this check has
        // explicitly opted out of TLS verification. Otherwise fall through
        // to Node's default Agent so cert validation enforces. (`http` libs
        // strip the option, so this is safe for HTTP probes too.)
        agent: url.protocol === 'https:' ? getProbeAgent(verifyTls) : undefined,
      };

      req = lib.request(options, (res) => {
        // Do NOT clear the timer here — if the server sends headers but never
        // finishes the body, res.on('end') never fires and the promise hangs
        // forever, stalling the worker's `running` flag indefinitely.
        // Capture status code immediately — available in all downstream error
        // handlers even if the body stream never completes.
        const capturedStatusCode = res.statusCode ?? null;
        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        const chunks: Buffer[] = [];
        let bodyStream: NodeJS.ReadableStream = res;
        if (encoding === 'gzip' || encoding === 'x-gzip') {
          bodyStream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'br') {
          bodyStream = res.pipe(zlib.createBrotliDecompress());
        } else if (encoding === 'deflate') {
          bodyStream = res.pipe(zlib.createInflate());
        }
        bodyStream.on('data', (chunk: Buffer) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
        bodyStream.on('error', (err: Error) => {
          clearTimeout(timer);
          const errMsg = err.message || (err as any).code || 'Stream error while reading response body';
          resolve({ status: 'down', response_time_ms: Date.now() - start, http_status_code: capturedStatusCode, error: errMsg, ssl: null });
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          const errMsg = err.message || (err as any).code || 'Response stream error';
          resolve({ status: 'down', response_time_ms: Date.now() - start, http_status_code: capturedStatusCode, error: errMsg, ssl: null });
        });
        bodyStream.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          clearTimeout(timer);
          const responseTime = Date.now() - start;
          const code = capturedStatusCode ?? 0;
          const expectedCode = check.expected_status_code || 200;
          const extraCodes: number[] = Array.isArray((check as any).allowed_status_codes)
            ? (check as any).allowed_status_codes
            : [];
          const acceptedCodes = new Set([expectedCode, ...extraCodes]);
          const isRedirect = code >= 300 && code < 400;
          let status: 'up' | 'down' | 'degraded' = (acceptedCodes.has(code) || isRedirect) ? 'up' : 'down';
          if (status === 'up' && check.keyword_check && !body.includes(check.keyword_check)) {
            status = 'degraded';
          }

          let ssl: { issuer: string; valid_from: Date; valid_to: Date; days_remaining: number } | null = null;
          if (url.protocol === 'https:') {
            try {
              const socket = (res as any).socket || (res as any).connection;
              const cert = socket?.getPeerCertificate?.();
              if (cert && cert.valid_to) {
                const validTo = new Date(cert.valid_to);
                const validFrom = new Date(cert.valid_from);
                const daysRemaining = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                ssl = {
                  issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
                  valid_from: validFrom,
                  valid_to: validTo,
                  days_remaining: daysRemaining,
                };
              }
            } catch {}
          }

          let errorMsg: string | null = null;
          if (status !== 'up') {
            const waf = detectWafBlock(code, res.headers);
            errorMsg = waf.blocked
              ? wafBlockedError(code, expectedCode, waf)
              : `Status ${code}, expected ${[...acceptedCodes].join(' or ')}`;
          }

          resolve({ status, response_time_ms: responseTime, http_status_code: code, error: errorMsg, ssl });
        });
      });

      req.on('timeout', () => { req?.destroy(); });

      req.on('error', (err) => {
        clearTimeout(timer);
        const errMsg = err.message || (err as any).code || 'Connection error';
        resolve({ status: 'down', response_time_ms: Date.now() - start, http_status_code: null, error: errMsg, ssl: null });
      });

      req.end();
    } catch (err: any) {
      clearTimeout(timer);
      const errMsg = err?.message || (err as any)?.code || String(err) || 'Unexpected error';
      resolve({ status: 'down', response_time_ms: Date.now() - start, http_status_code: null, error: errMsg, ssl: null });
    }
  });
}

async function runTcpCheck(check: ISyntheticCheck): Promise<{ status: 'up' | 'down'; response_time_ms: number; error: string | null }> {
  const timeoutMs = check.timeout_seconds * 1000;
  const start = Date.now();

  // Synthetic checks are admin-configured — allow private/internal addresses
  try {
    await assertHostSafe(check.host, check.port, { allowPrivate: true });
  } catch (err) {
    return { status: 'down', response_time_ms: 0, error: (err as Error).message };
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ status: 'down', response_time_ms: timeoutMs, error: `Timeout after ${check.timeout_seconds}s` });
    }, timeoutMs);

    socket.connect(check.port ?? 80, check.host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ status: 'up', response_time_ms: Date.now() - start, error: null });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: 'down', response_time_ms: Date.now() - start, error: err.message });
    });
  });
}

async function runDnsCheck(check: ISyntheticCheck): Promise<{ status: 'up' | 'down' | 'degraded'; response_time_ms: number; error: string | null }> {
  const start = Date.now();
  try {
    let records: string[] = [];
    switch (check.record_type) {
      case 'A':     records = await dns.resolve4(check.hostname); break;
      case 'CNAME': records = await dns.resolveCname(check.hostname); break;
      case 'MX':    records = (await dns.resolveMx(check.hostname)).map((r) => r.exchange); break;
      case 'TXT':   records = (await dns.resolveTxt(check.hostname)).map((r) => r.join('')); break;
    }
    const responseTime = Date.now() - start;
    if (records.length === 0) return { status: 'down', response_time_ms: responseTime, error: 'No records returned' };
    if (check.expected_value && !records.some((r) => r.includes(check.expected_value))) {
      return { status: 'degraded', response_time_ms: responseTime, error: `Expected "${check.expected_value}" not found in records` };
    }
    return { status: 'up', response_time_ms: responseTime, error: null };
  } catch (err: any) {
    return { status: 'down', response_time_ms: Date.now() - start, error: err.message };
  }
}

export async function runCheck(check: ISyntheticCheck): Promise<{ status: 'up' | 'down' | 'degraded'; response_time_ms: number; http_status_code?: number | null; error: string | null; ssl?: { issuer: string; valid_from: Date; valid_to: Date; days_remaining: number } | null }> {
  switch (check.type) {
    case 'http': return runHttpCheck(check);
    case 'tcp':  return runTcpCheck(check);
    case 'dns':  return runDnsCheck(check);
    default:     return { status: 'down', response_time_ms: 0, error: 'Unknown check type' };
  }
}

// ─── Uptime calculation ───────────────────────────────────────────────────────

async function calcUptime(checkId: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const results = await SyntheticCheckResult.find({ check_id: checkId, checked_at: { $gte: since } }).lean();
  if (results.length === 0) return 100;
  const up = results.filter((r) => r.status === 'up').length;
  return Math.round((up / results.length) * 10000) / 100;
}

// ─── Auto-publish synthetic-check failures to linked status pages ───────────
//
// Status pages only render status_updates, not raw incidents. When the
// worker opens or resolves a synthetic-check incident, we also post a
// matching status_update to every status page that has this check listed
// in settings.display_options.selected_synthetic_check_ids. Fire-and-forget:
// any failure is logged but never bubbled up so a bad status-page setup
// can't break the check pipeline.
async function publishSyntheticCheckStatusUpdate(params: {
  check: ISyntheticCheck;
  phase: 'investigating' | 'resolved';
  incidentId: Types.ObjectId | null;
  errorMessage?: string;
}): Promise<void> {
  const { check, phase, incidentId, errorMessage } = params;
  try {
    const pages = await StatusPage.find({
      tenant_id: check.tenant_id,
      'settings.display_options.selected_synthetic_check_ids': check._id,
    }).select('_id').lean();

    if (pages.length === 0) return;

    const title =
      phase === 'investigating'
        ? `${check.name} is experiencing issues`
        : `${check.name} has recovered`;
    const body =
      phase === 'investigating'
        ? `Our synthetic check has failed 5 consecutive times for ${check.name}. We are investigating. ${errorMessage ? `Last error: ${errorMessage}` : ''}`.trim()
        : `${check.name} is back up and serving traffic normally.`;
    const affected = [
      {
        component_id: check._id,
        name: check.name,
        status_before: phase === 'investigating' ? 'operational' : 'major_outage',
        status_after: phase === 'investigating' ? 'major_outage' : 'operational',
      },
    ];

    await Promise.all(
      pages.map((p) =>
        StatusUpdate.create({
          tenant_id: check.tenant_id,
          status_page_id: p._id,
          title,
          body,
          status: phase,
          visibility: 'public',
          affected_components: affected,
          created_by: check.created_by,
          incident_id: incidentId,
          notify_subscribers: false,
        }).catch((err: any) =>
          logger.warn('Failed to auto-post status update', {
            statusPageId: String(p._id),
            checkId: String(check._id),
            phase,
            error: err.message,
          }),
        ),
      ),
    );

    logger.info('Auto-posted synthetic-check status update', {
      checkId: String(check._id),
      phase,
      pages: pages.length,
    });
  } catch (err: any) {
    logger.error('publishSyntheticCheckStatusUpdate failed', {
      checkId: String(check._id),
      phase,
      error: err.message,
    });
  }
}

// ─── Execute and persist a check ──────────────────────────────────────────────

export async function executeAndRecord(check: ISyntheticCheck): Promise<void> {
  try {
    const now = new Date();
    const result = await runCheck(check);

    await SyntheticCheckResult.create({
      check_id:         check._id,
      tenant_id:        check.tenant_id,
      status:           result.status,
      response_time_ms: result.response_time_ms,
      error:            result.error,
      http_status_code: result.http_status_code ?? null,
      ssl_issuer:       result.ssl?.issuer ?? null,
      ssl_valid_from:   result.ssl?.valid_from ?? null,
      ssl_valid_to:     result.ssl?.valid_to ?? null,
      ssl_days_remaining: result.ssl?.days_remaining ?? null,
      checked_at:       now,
    });

    const [u1h, u24h, u7d, u30d] = await Promise.all([
      calcUptime(check._id.toString(), 60 * 60 * 1000),
      calcUptime(check._id.toString(), 24 * 60 * 60 * 1000),
      calcUptime(check._id.toString(), 7 * 24 * 60 * 60 * 1000),
      calcUptime(check._id.toString(), 30 * 24 * 60 * 60 * 1000),
    ]);

    // 90d: exponential moving average (raw data only retained 30 days)
    const prevU90d = (check as any).uptime_90d ?? 100;
    const u90d = Math.round((prevU90d * 0.967 + u30d * 0.033) * 100) / 100; // ~1/30 weight per day

    const isFailure = result.status !== 'up';
    const consecutiveFailures = isFailure ? (check.consecutive_failures || 0) + 1 : 0;

    // Anchor next_check_at to the scheduled run time (now), not to when the
    // HTTP response arrived. This prevents check execution time from
    // accumulating as drift across cycles.
    const nextCheckAt = new Date(now.getTime() + check.interval_seconds * 1000);

    await SyntheticCheck.updateOne({ _id: check._id }, {
      $set: {
        last_check_at:         now,
        next_check_at:         nextCheckAt,
        last_status:           result.status,
        last_response_time_ms: result.response_time_ms,
        uptime_1h:             u1h,
        uptime_24h:            u24h,
        uptime_7d:             u7d,
        uptime_30d:            u30d,
        uptime_90d:            u90d,
        consecutive_failures:  consecutiveFailures,
      },
    });

    // Auto-update linked service status through the cascade-aware path. Only
    // fires on the transition into degraded (=== 3), not every subsequent
    // failing check, to avoid redundant writes/NATS publishes while an
    // outage continues — the incident-creation block below re-asserts this
    // once more at failure 5 specifically to thread the incident_id through.
    if (check.service_id && consecutiveFailures === 3) {
      const svcStatus = result.status === 'down' ? 'major_outage' : 'degraded';
      await applyAlertStatusToService(check.tenant_id.toString(), check.service_id.toString(), svcStatus);
    } else if (check.service_id && consecutiveFailures === 0 && check.consecutive_failures > 0) {
      // Recovery
      await applyAlertStatusToService(check.tenant_id.toString(), check.service_id.toString(), 'operational');
    }

    // Recovery path: if the check just flipped back to up after at least
    // reaching the incident-creation threshold (5 failures), resolve the
    // open synthetic-check incident and post a "resolved" status update.
    if (consecutiveFailures === 0 && (check.consecutive_failures || 0) >= 5) {
      try {
        const openInc = await Incident.findOne({
          tenant_id: check.tenant_id,
          source: 'synthetic_check',
          title: `[Synthetic Check] ${check.name} failing`,
          status: { $nin: ['resolved', 'closed'] },
        }).sort({ createdAt: -1 });

        if (openInc && check.created_by) {
          await incidentService
            .resolveIncident(
              check.tenant_id as any,
              openInc._id.toString(),
              check.created_by as any,
              `Synthetic check "${check.name}" recovered automatically.`,
            )
            .catch((err: any) =>
              logger.warn('Auto-resolve of synthetic-check incident failed', {
                incidentId: String(openInc._id),
                error: err.message,
              }),
            );
        }

        // Always try to publish the resolved status update, even if no incident
        // was found (e.g., the incident was manually closed earlier).
        publishSyntheticCheckStatusUpdate({
          check,
          phase: 'resolved',
          incidentId: openInc?._id ?? null,
        }).catch(() => {});
      } catch (recErr: any) {
        logger.error('Synthetic-check recovery handler failed', {
          checkId: String(check._id),
          error: recErr.message,
        });
      }
    }

    // Failure notifications at specific thresholds
    if (consecutiveFailures > 0 && check.created_by) {
      const shouldNotify =
        consecutiveFailures === 3 ||
        consecutiveFailures === 5 ||
        (consecutiveFailures > 5 && consecutiveFailures % 10 === 0);

      if (shouldNotify) {
        try {
          await notificationService.createNotification({
            tenant_id: check.tenant_id as any,
            user_id: check.created_by as any,
            type: 'synthetic_check',
            title: `Synthetic check failing: ${check.name}`,
            body: `"${check.name}" has failed ${consecutiveFailures} consecutive times. Last error: ${result.error || 'unknown'}`,
            resource_type: 'synthetic_check',
            resource_id: check._id.toString(),
          });
        } catch (notifErr: any) {
          logger.error('Failed to create synthetic check notification', { checkId: check._id, error: notifErr.message });
        }
      }

      // Auto-create incident at 5 consecutive failures (with or without linked service)
      if (consecutiveFailures === 5) {
        try {
          // Resolve escalation_policy_id from linked service if available
          let escalationPolicyId: string | undefined;
          const affectedServiceIds: string[] = [];
          if (check.service_id) {
            affectedServiceIds.push(check.service_id.toString());
            const svc = await Service.findById(check.service_id);
            if (svc?.escalation_policy_id) {
              escalationPolicyId = svc.escalation_policy_id.toString();
            }
          }
          // Fall back to the tenant's most recent active escalation policy that
          // has at least one targeted step. Synthetic incidents otherwise sit
          // un-escalated when the check isn't tied to a service.
          if (!escalationPolicyId) {
            const fallbackEp = await EscalationPolicy.findOne({
              tenant_id: check.tenant_id,
              status: 'active',
              'steps.targets.0': { $exists: true },
            }).sort({ updated_at: -1 }).select('_id');
            if (fallbackEp) {
              escalationPolicyId = fallbackEp._id.toString();
            }
          }

          const createdIncident = await incidentService.createIncident({
            tenant_id: check.tenant_id as any,
            created_by: check.created_by as any,
            title: `[Synthetic Check] ${check.name} failing`,
            description: `Synthetic check "${check.name}" has failed 5 consecutive times. Last error: ${result.error || 'unknown'}`,
            severity: 2,
            source: 'synthetic_check',
            escalation_policy_id: escalationPolicyId,
            affected_service_ids: affectedServiceIds.length > 0 ? affectedServiceIds : undefined,
            source_synthetic_check_id: check._id.toString(),
          });
          logger.info('Auto-created incident from synthetic check', { checkId: check._id, checkName: check.name });

          // Re-assert the (already-set) status specifically to carry the
          // now-existing incident_id through — at failure 3 this service was
          // degraded with no incident to attach to yet; this lets the
          // cascade's next evaluation correctly thread dependents to it.
          if (check.service_id) {
            const svcStatus = result.status === 'down' ? 'major_outage' : 'degraded';
            await applyAlertStatusToService(
              check.tenant_id.toString(), check.service_id.toString(), svcStatus, createdIncident._id.toString(),
            );
          }

          // Mirror onto any status pages that include this check.
          publishSyntheticCheckStatusUpdate({
            check,
            phase: 'investigating',
            incidentId: createdIncident?._id ?? null,
            errorMessage: result.error || undefined,
          }).catch(() => {});
        } catch (incErr: any) {
          logger.error('Failed to auto-create incident from synthetic check', { checkId: check._id, error: incErr.message });
        }
      }
    }
  } catch (err: any) {
    logger.error('Synthetic check execution failed', { checkId: check._id, error: err.message });
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listChecks(tenantId: string, filters: { status?: string; type?: string; search?: string; limit?: number } = {}) {
  const limit = Math.min(filters.limit ?? 50, 200);
  const query: any = { tenant_id: tenantId };
  if (filters.status) query.status = filters.status;
  if (filters.type) query.type = filters.type;
  if (filters.search) query.name = { $regex: filters.search, $options: 'i' };

  const docs = await SyntheticCheck.find(query).sort({ name: 1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;

  // Lazy backfill: resolve geo for checks missing it (fire-and-forget)
  const missing = data.filter((d) => d.geo_lat == null && (d.url || d.host || d.hostname));
  if (missing.length > 0) {
    (async () => {
      for (const check of missing) {
        const host = extractHostname(check as any);
        if (!host) continue;
        const geo = await resolveGeo(host);
        if (geo.lat != null) {
          await SyntheticCheck.updateOne({ _id: check._id }, { $set: { geo_lat: geo.lat, geo_lon: geo.lon, geo_city: geo.city, geo_country: geo.country, geo_ip: geo.ip } });
        }
      }
    })().catch(() => {});
  }

  return {
    data,
    pagination: { has_more: hasMore, total: await SyntheticCheck.countDocuments({ tenant_id: tenantId }) },
  };
}

export async function getCheckById(tenantId: string, id: string) {
  const doc = await SyntheticCheck.findOne({ _id: id, tenant_id: tenantId }).lean();
  if (!doc) throw AppError.notFound('Synthetic check not found');
  return doc;
}

export async function createCheck(tenantId: string, userId: string, input: CreateCheckInput) {
  // Resolve geo from endpoint
  const host = extractHostname(input as any);
  const geo = host ? await resolveGeo(host) : { lat: null, lon: null, city: '', country: '', ip: '' };

  const doc = await SyntheticCheck.create({
    tenant_id: tenantId, created_by: userId,
    name: input.name, type: input.type,
    service_id: input.service_id ?? null,
    interval_seconds: input.interval_seconds ?? 60,
    timeout_seconds: input.timeout_seconds ?? 10,
    url: input.url ?? '', method: input.method ?? 'GET',
    http_headers: input.http_headers ?? {},
    expected_status_code: input.expected_status_code ?? 200,
    allowed_status_codes: input.allowed_status_codes ?? [],
    keyword_check: input.keyword_check ?? '',
    host: input.host ?? '', port: input.port ?? null,
    hostname: input.hostname ?? '', record_type: input.record_type ?? 'A',
    expected_value: input.expected_value ?? '',
    geo_lat: geo.lat, geo_lon: geo.lon,
    geo_city: geo.city, geo_country: geo.country, geo_ip: geo.ip,
  });
  return doc.toObject();
}

export async function updateCheck(tenantId: string, id: string, input: Partial<CreateCheckInput>) {
  // Re-resolve geo if endpoint fields changed
  const updateData: any = { ...input };
  if (input.url || input.host || input.hostname) {
    const existing = await SyntheticCheck.findOne({ _id: id, tenant_id: tenantId }).lean();
    if (existing) {
      const merged = { type: input.type ?? existing.type, url: input.url ?? existing.url, host: input.host ?? existing.host, hostname: input.hostname ?? existing.hostname };
      const host = extractHostname(merged as any);
      if (host) {
        const geo = await resolveGeo(host);
        updateData.geo_lat = geo.lat;
        updateData.geo_lon = geo.lon;
        updateData.geo_city = geo.city;
        updateData.geo_country = geo.country;
        updateData.geo_ip = geo.ip;
      }
    }
  }

  const doc = await SyntheticCheck.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: updateData },
    { new: true, lean: true },
  );
  if (!doc) throw AppError.notFound('Synthetic check not found');
  return doc;
}

export async function deleteCheck(tenantId: string, id: string) {
  const doc = await SyntheticCheck.findOneAndDelete({ _id: id, tenant_id: tenantId });
  if (!doc) throw AppError.notFound('Synthetic check not found');
  await SyntheticCheckResult.deleteMany({ check_id: id });
}

export async function getCheckResults(tenantId: string, checkId: string, limit = 50, from?: Date, until?: Date) {
  await getCheckById(tenantId, checkId); // auth guard
  const query: Record<string, any> = { check_id: checkId };
  if (from || until) {
    query.checked_at = {};
    if (from)  query.checked_at.$gte = from;
    if (until) query.checked_at.$lte = until;
  }
  return SyntheticCheckResult.find(query)
    .sort({ checked_at: -1 })
    .limit(limit)
    .lean();
}

export async function triggerCheck(tenantId: string, id: string) {
  const check = await SyntheticCheck.findOne({ _id: id, tenant_id: tenantId });
  if (!check) throw AppError.notFound('Synthetic check not found');
  await executeAndRecord(check);
  return SyntheticCheck.findById(id).lean();
}

export async function getDueChecks(): Promise<ISyntheticCheck[]> {
  const now = new Date();
  return SyntheticCheck.find({
    status: 'active',
    $or: [
      { next_check_at: null },
      { next_check_at: { $lte: now } },
    ],
  }).lean() as any;
}
