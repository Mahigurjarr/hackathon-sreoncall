'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import {
  useDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  type Dashboard,
  type DashboardPanel,
} from '@/lib/hooks/useDashboards';

const NEW_DASHBOARD = '__new__';

/**
 * Add-to-dashboard flow for the metrics explorer. Given the current query, lets the user append a
 * line-chart panel to an existing dashboard (or spin up a new one). Uses the existing dashboards API
 * (useDashboards / useCreateDashboard / useUpdateDashboard) so the panel shows up exactly like one
 * added from the dashboard editor.
 *
 * Own-tenant only: the caller gates this on `!consumerId` because a panel's managed data source runs
 * against the current tenant's Mimir, not a customer's.
 */
export function AddToDashboardModal({
  open,
  onClose,
  query,
  defaultTitle,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  defaultTitle: string;
}) {
  const dashboards = useDashboards({ is_template: false });
  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();

  const list = useMemo<Dashboard[]>(() => dashboards.data?.data ?? [], [dashboards.data]);
  const [selected, setSelected] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [panelTitle, setPanelTitle] = useState(defaultTitle);

  // Keep the panel-title default in sync when the modal (re)opens for a new query.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && seededFor !== query) {
    setSeededFor(query);
    setPanelTitle(defaultTitle);
    setSelected(list.length ? list[0].id : NEW_DASHBOARD);
    setNewName('');
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const busy = createDashboard.isPending || updateDashboard.isPending;
  const creatingNew = selected === NEW_DASHBOARD || list.length === 0;

  function buildPanel(existingCount: number): DashboardPanel {
    return {
      id: `panel-${Date.now()}`,
      title: panelTitle.trim() || 'Metric',
      type: 'line_chart',
      grid: { x: 0, y: existingCount * 4, w: 6, h: 4 },
      data_source: { type: 'managed', provider: null, service_id: null },
      query,
      options: {},
      thresholds: [],
    };
  }

  async function handleAdd() {
    if (!query.trim()) return;
    try {
      if (creatingNew) {
        const name = newName.trim() || 'New dashboard';
        const created = await createDashboard.mutateAsync({ name, panels: [buildPanel(0)] });
        toast.success(`Panel added to “${created.name}”`);
      } else {
        const dash = list.find((d) => d.id === selected);
        if (!dash) {
          toast.error('Pick a dashboard');
          return;
        }
        await updateDashboard.mutateAsync({
          id: dash.id,
          input: { panels: [...dash.panels, buildPanel(dash.panels.length)] },
        });
        toast.success(`Panel added to “${dash.name}”`);
      }
      onClose();
    } catch {
      toast.error('Could not add the panel — please try again.');
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent data-testid="add-to-dashboard-modal">
        <DialogClose onClose={onClose} />
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Add to dashboard</DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 pt-2 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">Query</label>
            <div
              className="rounded-[8px] border border-border bg-muted/40 px-3 py-2 font-mono text-[12px] text-foreground break-all"
              data-testid="add-dashboard-query"
            >
              {query || <span className="text-muted-foreground">no query</span>}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">Panel title</label>
            <input
              data-testid="add-dashboard-title"
              value={panelTitle}
              onChange={(e) => setPanelTitle(e.target.value)}
              placeholder="Panel title"
              className="flex h-[40px] w-full rounded-[8px] border-[1.5px] border-border bg-card px-4 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">Dashboard</label>
            {dashboards.isLoading ? (
              <div className="text-[13px] text-muted-foreground">Loading dashboards…</div>
            ) : (
              <Select
                data-testid="add-dashboard-select"
                value={list.length === 0 ? NEW_DASHBOARD : selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={list.length === 0}
              >
                {list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.panels.length} panel{d.panels.length === 1 ? '' : 's'})
                  </option>
                ))}
                <option value={NEW_DASHBOARD}>➕ New dashboard…</option>
              </Select>
            )}
          </div>

          {creatingNew && (
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">New dashboard name</label>
              <input
                data-testid="add-dashboard-newname"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. SRE Golden Signals"
                className="flex h-[40px] w-full rounded-[8px] border-[1.5px] border-border bg-card px-4 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:border-primary"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={busy || !query.trim()} data-testid="add-dashboard-confirm">
              {busy ? 'Adding…' : 'Add panel'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
