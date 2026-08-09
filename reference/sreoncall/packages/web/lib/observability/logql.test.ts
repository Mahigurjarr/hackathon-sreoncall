import { describe, it, expect } from 'vitest';
import { buildLogQLSelector } from './logql';

describe('buildLogQLSelector', () => {
  it('returns empty string for an empty selection — NOT a catch-all, no hidden tenant_id', () => {
    const result = buildLogQLSelector({}, {});
    expect(result).toBe('');
    expect(result).not.toContain('tenant_id');
    expect(result).not.toMatch(/\{.*=~".+"\}/);
  });

  it('renders stream labels as a sorted, braced selector', () => {
    expect(buildLogQLSelector({ cluster: 'eks-prod-eu', namespace: 'payments' })).toBe(
      '{cluster="eks-prod-eu",namespace="payments"}',
    );
  });

  it('sorts stream labels regardless of input key order', () => {
    expect(buildLogQLSelector({ namespace: 'payments', cluster: 'eks-prod-eu' })).toBe(
      '{cluster="eks-prod-eu",namespace="payments"}',
    );
  });

  // Regression: any stream label — not just the four the rail used to hardcode as
  // "known" — must land INSIDE the {...} stream selector, never after `| json`. The
  // shipped backend's labels-discovery endpoint only ever returns real Loki stream
  // labels, so a facet-rail selection for `job` (or any other label name) must be
  // treated exactly like cluster/namespace/service_name/pod.
  it('puts a non-hardcoded stream label like `job` inside {...}, not after | json', () => {
    expect(buildLogQLSelector({ job: 'api' })).toBe('{job="api"}');
  });

  it('puts line-field filters after | json, separately from stream labels', () => {
    expect(
      buildLogQLSelector({ service_name: 'checkout-api' }, { lineFieldFilters: { status_code: '500' } }),
    ).toBe('{service_name="checkout-api"} | json | status_code="500"');
  });

  it('escapes backslashes and quotes so a value cannot break out of the stream selector', () => {
    const result = buildLogQLSelector({ service_name: 'a"} |= "b' });
    expect(result).toBe('{service_name="a\\"} |= \\"b"}');
  });

  it('uses the base selector as a fallback when there is no stream label, with line fields after | json', () => {
    expect(
      buildLogQLSelector({}, { lineFieldFilters: { status_code: '500' } }, '{job=~".+"}'),
    ).toBe('{job=~".+"} | json | status_code="500"');
  });

  it('returns empty string for line-field-only selection when no base is supplied', () => {
    expect(buildLogQLSelector({}, { lineFieldFilters: { status_code: '500' } })).toBe('');
  });

  it('appends |= "<escaped>" for a non-empty lineContains', () => {
    expect(buildLogQLSelector({ cluster: 'eks-prod-eu' }, { lineContains: 'timeout' })).toBe(
      '{cluster="eks-prod-eu"} |= "timeout"',
    );
  });

  it('appends | json | level=~"a|b" for a strict subset of enabled levels', () => {
    expect(
      buildLogQLSelector(
        { cluster: 'eks-prod-eu' },
        { levels: { error: true, warn: true, info: false, debug: false } },
      ),
    ).toBe('{cluster="eks-prod-eu"} | json | level=~"error|warn"');
  });

  it('omits the level filter when all levels are enabled', () => {
    expect(
      buildLogQLSelector(
        { cluster: 'eks-prod-eu' },
        { levels: { error: true, warn: true, info: true, debug: true } },
      ),
    ).toBe('{cluster="eks-prod-eu"}');
  });

  // Fix 3: all four levels off used to add `| json` but skip the `level=~` filter (guarded
  // by `length > 0`), so it silently returned every level — an inversion of what "all off"
  // should mean. All-off must behave exactly like all-on: no level filtering at all.
  it('treats all-levels-off the same as all-levels-on — no filter, no pointless | json', () => {
    expect(
      buildLogQLSelector(
        { cluster: 'eks-prod-eu' },
        { levels: { error: false, warn: false, info: false, debug: false } },
      ),
    ).toBe('{cluster="eks-prod-eu"}');
  });

  it('combines lineContains, level filter, and sorted line fields in order', () => {
    expect(
      buildLogQLSelector(
        { service_name: 'checkout-api' },
        {
          lineFieldFilters: { status_code: '500', region: 'eu' },
          lineContains: 'timeout',
          levels: { error: true, warn: true, info: false, debug: false },
        },
      ),
    ).toBe(
      '{service_name="checkout-api"} |= "timeout" | json | level=~"error|warn" | region="eu" | status_code="500"',
    );
  });
});
