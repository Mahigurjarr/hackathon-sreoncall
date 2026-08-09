export interface ExploreScope {
  cluster?: string;
  namespace?: string;
  service?: string;
  pod?: string;
}

// Order matters for a stable, readable selector. Maps `service` → `service_name`.
const ORDER: Array<[keyof ExploreScope, string]> = [
  ['cluster', 'cluster'],
  ['namespace', 'namespace'],
  ['service', 'service_name'],
  ['pod', 'pod'],
];

export function buildPromQLSelector(scope: ExploreScope): string {
  const parts = ORDER.filter(([k]) => scope[k]).map(([k, label]) => `${label}="${scope[k]}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

// Removing a level clears everything deeper than it (cluster > namespace > service > pod).
export function clearFrom(scope: ExploreScope, key: keyof ExploreScope): ExploreScope {
  const idx = ORDER.findIndex(([k]) => k === key);
  const next: ExploreScope = {};
  ORDER.forEach(([k], i) => {
    if (i < idx && scope[k]) next[k] = scope[k];
  });
  return next;
}
