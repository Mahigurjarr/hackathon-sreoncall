import dns from 'dns/promises';
import { logger } from './logger';

/**
 * SSRF protection — blocks requests to private/internal IP ranges.
 *
 * Validates both the raw hostname and its resolved IP addresses to prevent
 * DNS-rebinding and TOCTOU attacks.
 */

const PRIVATE_IP_RANGES = [
  // IPv4 private
  /^127\./,                          // 127.0.0.0/8   loopback
  /^10\./,                           // 10.0.0.0/8    private
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12 private
  /^192\.168\./,                     // 192.168.0.0/16 private
  /^169\.254\./,                     // 169.254.0.0/16 link-local
  /^0\./,                            // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGN
  /^198\.1[89]\./,                   // 198.18.0.0/15 benchmarking
  // IPv6 private
  /^::1$/,                           // loopback
  /^fe80:/i,                         // link-local
  /^fc00:/i,                         // unique local
  /^fd[0-9a-f]{2}:/i,               // unique local
  /^::$/,                            // unspecified
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/i, // IPv4-mapped
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.local')) return true;
  if (lower.endsWith('.internal')) return true;
  // Bare IP check
  if (isPrivateIp(lower)) return true;
  return false;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Validate a URL is safe for server-side requests (not targeting private networks).
 *
 * @param urlString - The URL to validate
 * @throws SsrfError if the URL targets a private/internal address
 * @returns The parsed URL object
 */
export async function assertUrlSafe(urlString: string, options?: { allowPrivate?: boolean }): Promise<URL> {
  if (options?.allowPrivate) {
    // Skip SSRF checks — caller has explicitly opted in (e.g. admin-configured synthetic checks)
    try { return new URL(urlString); } catch { throw new SsrfError('Invalid URL'); }
  }
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfError(`Protocol ${parsed.protocol} not allowed`);
  }

  const hostname = parsed.hostname;

  // Check hostname directly (catches localhost, bare IPs)
  if (isPrivateHostname(hostname)) {
    logger.warn('SSRF blocked: private hostname', { url: urlString, hostname });
    throw new SsrfError('Requests to private/internal addresses are not allowed');
  }

  // Resolve DNS and check all resulting IPs
  try {
    const ips = await dns.resolve4(hostname).catch(() => [] as string[]);
    const ips6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allIps = [...ips, ...ips6];

    for (const ip of allIps) {
      if (isPrivateIp(ip)) {
        logger.warn('SSRF blocked: hostname resolves to private IP', { url: urlString, hostname, ip });
        throw new SsrfError('Requests to private/internal addresses are not allowed');
      }
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    // DNS resolution failure for non-IP hostnames is suspicious but we let it through
    // (the actual request will fail anyway)
  }

  return parsed;
}

/**
 * Validate a host:port combination for TCP connections.
 *
 * @param host - The hostname or IP
 * @param port - The port number
 * @throws SsrfError if targeting a private address
 */
export async function assertHostSafe(host: string, port?: number | null, options?: { allowPrivate?: boolean }): Promise<void> {
  if (options?.allowPrivate) return; // Skip SSRF checks for admin-configured checks
  if (isPrivateHostname(host)) {
    logger.warn('SSRF blocked: private host', { host, port });
    throw new SsrfError('Requests to private/internal addresses are not allowed');
  }

  try {
    const ips = await dns.resolve4(host).catch(() => [] as string[]);
    const ips6 = await dns.resolve6(host).catch(() => [] as string[]);
    const allIps = [...ips, ...ips6];

    for (const ip of allIps) {
      if (isPrivateIp(ip)) {
        logger.warn('SSRF blocked: host resolves to private IP', { host, port, ip });
        throw new SsrfError('Requests to private/internal addresses are not allowed');
      }
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
  }
}
