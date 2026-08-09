'use client';

import { useState } from 'react';
import {
  ClipboardList,
  Search,
  Loader2,
  Box,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { EmptyState } from '@/components/shared/EmptyState';
import { usePlatformAuditLogs } from '@/lib/hooks/usePlatformAdmin';
import { formatDistanceToNow } from 'date-fns';

const RESULT_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failure: 'bg-red-100 text-red-700',
};

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [actorEmailFilter, setActorEmailFilter] = useState('');

  const { data, isLoading } = usePlatformAuditLogs({
    action: actionFilter || undefined,
    resource_type: resourceTypeFilter || undefined,
    actor_email: actorEmailFilter || undefined,
    limit: 50,
  });

  const logs = data?.data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-tenant audit trail of all platform actions
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              containerClassName="flex-1 min-w-[200px]"
              placeholder="Filter by actor email..."
              value={actorEmailFilter}
              onChange={setActorEmailFilter}
            />
            <Input
              placeholder="Action..."
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-40"
            />
            <FilterSelect
              label="Resource"
              icon={<Box />}
              value={resourceTypeFilter}
              onChange={(e) => setResourceTypeFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="ticket">Ticket</option>
              <option value="user">User</option>
              <option value="tenant">Tenant</option>
              <option value="workflow">Workflow</option>
              <option value="sla">SLA</option>
              <option value="api_key">API Key</option>
            </FilterSelect>
          </div>
        </CardContent>
      </Card>

      {/* Logs */}
      <Card>
        <CardHeader>
          <CardTitle>
            {data?.pagination?.total !== undefined
              ? `${data.pagination.total} log entries`
              : 'Log Entries'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No audit logs found"
              description="No audit log entries match your current filters."
            />
          ) : (
            <div className="divide-y divide-border">
              {logs.map((log) => (
                <div key={log.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{log.action}</span>
                        <Badge variant="outline" className="text-xs">
                          {log.resource_type}
                        </Badge>
                        {log.resource_id && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {log.resource_id}
                          </span>
                        )}
                        <Badge className={RESULT_COLORS[log.result] || ''}>
                          {log.result}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          by {log.actor.email || log.actor.type}
                          {log.actor.impersonated_by && (
                            <span className="text-yellow-600">
                              {' '}(impersonated)
                            </span>
                          )}
                        </span>
                        <span>from {log.actor.ip}</span>
                        <span>tenant: {log.tenant_id}</span>
                      </div>
                      {log.changes.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {log.changes.slice(0, 3).map((change, idx) => (
                            <div
                              key={idx}
                              className="text-xs text-muted-foreground"
                            >
                              <span className="font-mono">{change.field}</span>:{' '}
                              <span className="text-red-500 line-through">
                                {JSON.stringify(change.old_value)}
                              </span>{' '}
                              <span className="text-green-600">
                                {JSON.stringify(change.new_value)}
                              </span>
                            </div>
                          ))}
                          {log.changes.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{log.changes.length - 3} more changes
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="ml-4 shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
