import { describe, it, expect } from 'vitest';
import { goldenSignalQueries } from '../golden-signals';

describe('goldenSignalQueries', () => {
  const sigs = goldenSignalQueries('{namespace="payments",service_name="checkout-api"}');

  it('returns the golden signals in order', () => {
    expect(sigs.map((s) => s.key)).toEqual(['request_rate', 'error_rate', 'p99_latency', 'p95_latency', 'cpu', 'memory']);
  });

  it('injects the selector into each query', () => {
    for (const s of sigs) {
      expect(s.query).toContain('namespace="payments"');
      expect(s.query).toContain('service_name="checkout-api"');
    }
  });

  it('error rate is a ratio * 100 (percent)', () => {
    const err = sigs.find((s) => s.key === 'error_rate')!;
    expect(err.unit).toBe('percent');
    expect(err.query).toContain('/');
    expect(err.query).toContain('* 100');
  });

  it('p99 uses histogram_quantile over the _bucket metric', () => {
    const p99 = sigs.find((s) => s.key === 'p99_latency')!;
    expect(p99.query).toContain('histogram_quantile(0.99');
    expect(p99.query).toContain('_bucket');
  });
});
