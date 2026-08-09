/**
 * Anonymize an IP address for GDPR compliance.
 * IPv4: zeroes last octet (e.g., 192.168.1.100 → 192.168.1.0)
 * IPv6: zeroes last 4 groups (e.g., 2001:db8::1 → 2001:db8:0:0:0:0:0:0)
 */
export function anonymizeIp(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';

  // Strip IPv6-mapped IPv4 prefix
  const cleaned = ip.replace(/^::ffff:/, '');

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleaned)) {
    const parts = cleaned.split('.');
    parts[3] = '0';
    return parts.join('.');
  }

  // IPv6
  if (cleaned.includes(':')) {
    const expanded = expandIPv6(cleaned);
    const groups = expanded.split(':');
    // Zero out last 4 groups
    for (let i = 4; i < 8; i++) {
      groups[i] = '0000';
    }
    return groups.join(':');
  }

  return ip;
}

function expandIPv6(ip: string): string {
  const parts = ip.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  const middle = Array(missing).fill('0000');
  const full = [...left, ...middle, ...right];
  return full.map((g) => g.padStart(4, '0')).join(':');
}
