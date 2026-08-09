import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Platform-wide resource scope that narrows every dashboard panel / observability
 * query to a chosen cluster, namespace, region, or service. Values are appended
 * as PromQL / LogQL label matchers post-variable-substitution, skipping any
 * label already bound by a per-dashboard variable.
 *
 * Persisted in localStorage so selection survives reload — matches Grafana's
 * behaviour where the scope picker sticks until you change it.
 */

export interface ResourceScope {
  cluster?: string;
  namespace?: string;
  region?: string;
  service_name?: string;
}

interface ResourceScopeState {
  scope: ResourceScope;
  setScope: (patch: Partial<ResourceScope>) => void;
  clearScope: () => void;
}

export const useResourceScopeStore = create<ResourceScopeState>()(
  persist(
    (set) => ({
      scope: {},
      setScope: (patch) =>
        set((state) => {
          const next: ResourceScope = { ...state.scope };
          for (const [k, v] of Object.entries(patch) as Array<[keyof ResourceScope, string | undefined]>) {
            if (v === undefined || v === '') delete next[k];
            else next[k] = v;
          }
          return { scope: next };
        }),
      clearScope: () => set({ scope: {} }),
    }),
    { name: 'sreoncall-resource-scope' },
  ),
);
