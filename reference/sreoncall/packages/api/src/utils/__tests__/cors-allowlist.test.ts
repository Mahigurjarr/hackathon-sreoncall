import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();
const mockTenantFindOne = vi.fn();

vi.mock('../../config/redis', () => ({
  getRedis: () => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
  }),
}));

vi.mock('../../models/tenant.model', () => ({
  Tenant: {
    findOne: (...args: any[]) => mockTenantFindOne(...args),
  },
}));

import { isOriginAllowed } from '../cors-allowlist';

describe('isOriginAllowed', () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisSetex.mockReset();
    mockTenantFindOne.mockReset();
    mockRedisGet.mockResolvedValue(null);
  });

  it('rejects empty / missing origin', async () => {
    expect(await isOriginAllowed(undefined)).toBe(false);
    expect(await isOriginAllowed(null)).toBe(false);
    expect(await isOriginAllowed('')).toBe(false);
  });

  it('rejects the literal "null" origin (sandboxed iframes)', async () => {
    expect(await isOriginAllowed('null')).toBe(false);
  });

  it('rejects attacker origins', async () => {
    mockTenantFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    expect(await isOriginAllowed('https://attacker.com')).toBe(false);
    expect(await isOriginAllowed('https://evil.example')).toBe(false);
  });

  it('rejects look-alike domains that do not end in .sreoncall.com', async () => {
    mockTenantFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    expect(await isOriginAllowed('https://sreoncall.com.evil.com')).toBe(false);
    expect(await isOriginAllowed('https://notsreoncall.com')).toBe(false);
  });

  it('accepts static platform origins', async () => {
    expect(await isOriginAllowed('https://sreoncall.com')).toBe(true);
    expect(await isOriginAllowed('https://web.sreoncall.com')).toBe(true);
    expect(await isOriginAllowed('https://dev-web.sreoncall.com')).toBe(true);
    expect(await isOriginAllowed('https://app.sreoncall.com')).toBe(true);
    expect(await isOriginAllowed('http://localhost:3000')).toBe(true);
  });

  it('REJECTS customer tenant subdomains — they are untrusted origins (F-02 2026-04-21)', async () => {
    mockTenantFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    // Any attacker-controlled tenant subdomain created via public signup must
    // NOT receive credentialed CORS access to the main API.
    expect(await isOriginAllowed('https://attacker.sreoncall.com')).toBe(false);
    expect(await isOriginAllowed('https://evil-probe-xyz123.sreoncall.com')).toBe(false);
  });

  it('still accepts tenant subdomains if explicitly registered as custom_domains (DB match)', async () => {
    mockTenantFindOne.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: 't' }) }),
    });
    // Only reachable if an admin has registered the subdomain as a custom
    // domain — the DB-backed path is the source of truth.
    expect(await isOriginAllowed('https://acme.sreoncall.com')).toBe(true);
  });

  it('accepts custom tenant domains via DB lookup', async () => {
    mockTenantFindOne.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: 'tenant-id' }) }),
    });
    expect(await isOriginAllowed('https://monitoring.thepackengers.com')).toBe(true);
  });

  it('caches allow results in Redis', async () => {
    mockRedisGet.mockResolvedValue('1');
    expect(await isOriginAllowed('https://monitoring.thepackengers.com')).toBe(true);
    expect(mockTenantFindOne).not.toHaveBeenCalled();
  });

  it('caches deny results in Redis', async () => {
    mockRedisGet.mockResolvedValue('0');
    expect(await isOriginAllowed('https://attacker.com')).toBe(false);
    expect(mockTenantFindOne).not.toHaveBeenCalled();
  });

  it('rejects malformed origins', async () => {
    expect(await isOriginAllowed('not-a-url')).toBe(false);
    expect(await isOriginAllowed('javascript:alert(1)')).toBe(false);
  });
});
