// packages/api/src/routes/platform/__tests__/partners.routes.test.ts
import { describe, it, expect } from 'vitest';

describe('partner route helpers', () => {
  it('escapes regex special chars in search query', () => {
    function escapeRegex(s: string) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    expect(escapeRegex('test.com')).toBe('test\\.com');
    expect(escapeRegex('user+tag')).toBe('user\\+tag');
  });
});
