'use client';

import { useState } from 'react';
import { Search, Download, User, Clock, Loader2, Activity, Box } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SearchInput } from '@/components/ui/SearchInput';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { cn } from '@/lib/utils';
import { useAuditLogs } from '@/lib/hooks/useAuditLogs';
import { toast } from 'sonner';

const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  invite: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  login: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  breach: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  comment: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  role_change: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

function getActionColor(action: string): string {
  const key = action.split('.')[1] || action;
  return actionColors[key] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export default function AuditLogPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');

  const { data, isLoading } = useAuditLogs({
    action: actionFilter || undefined,
    resource_type: resourceFilter || undefined,
    limit: 100,
  });

  const entries = data?.data ?? [];

  const filtered = entries.filter((entry) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      entry.actor?.email?.toLowerCase().includes(q) ||
      entry.actor?.name?.toLowerCase().includes(q) ||
      entry.action.toLowerCase().includes(q) ||
      entry.resource_type.toLowerCase().includes(q) ||
      (entry.resource_id || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          containerClassName="flex-1 sm:max-w-xs"
          placeholder="Search audit log..."
          value={search}
          onChange={setSearch}
        />
        <FilterSelect label="Action" icon={<Activity />} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="">All</option>
          <option value="auth">Authentication</option>
          <option value="ticket">Tickets</option>
          <option value="user">Users</option>
          <option value="settings">Settings</option>
          <option value="sla">SLA</option>
        </FilterSelect>
        <FilterSelect label="Resource" icon={<Box />} value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
          <option value="">All</option>
          <option value="ticket">Ticket</option>
          <option value="user">User</option>
          <option value="tenant">Tenant</option>
        </FilterSelect>
        <Button variant="outline" onClick={() => toast.info('Export coming soon')}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Resource
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((entry) => (
                    <tr key={entry.id} className="transition-colors hover:bg-muted/50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          {new Date(entry.timestamp).toLocaleString()}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-foreground">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <div>
                            <div>{entry.actor?.name || entry.actor?.email || 'System'}</div>
                            {entry.actor?.ip && (
                              <div className="font-mono text-xs text-muted-foreground">
                                {entry.actor.ip}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            getActionColor(entry.action)
                          )}
                        >
                          {entry.action}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {entry.resource_type}
                        {entry.resource_id ? ` · ${entry.resource_id}` : ''}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            entry.result === 'success'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          )}
                        >
                          {entry.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    No audit log entries match your filters
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
