import { describe, it, expect } from 'vitest';
import { podStatQueries } from '../pod-stats';

describe('podStatQueries', () => {
  const defs = podStatQueries({ namespace: 'payments', pod: 'checkout-x1' });

  it('returns cpu, memory, restarts in order', () => {
    expect(defs.map((d) => d.key)).toEqual(['cpu', 'memory', 'restarts']);
  });
  it('scopes every query by the pod label', () => {
    for (const d of defs) expect(d.query).toContain('pod="checkout-x1"');
  });
  it('restarts uses kube_pod_container_status_restarts_total', () => {
    expect(defs.find((d) => d.key === 'restarts')!.query).toContain('kube_pod_container_status_restarts_total');
  });
});
