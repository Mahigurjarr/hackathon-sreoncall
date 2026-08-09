'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Shield, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

interface DsarRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  notes: string | null;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function DsarAdminPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery<{ data: DsarRecord[] }>({
    queryKey: ['admin-dsar', statusFilter],
    queryFn: () => api.get(`/api/v1/platform-admin/dsar${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/api/v1/platform-admin/dsar/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-dsar'] });
      toast.success('DSAR status updated');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6" />
            DSAR Requests
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Data Subject Access Requests across all tenants
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tenant</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Requested</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Notes</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              </td></tr>
            )}
            {data?.data?.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No DSAR requests found</td></tr>
            )}
            {data?.data?.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 capitalize font-medium">{r.type}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[r.status] || ''}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.tenant_id.slice(-8)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.user_id.slice(-8)}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(r.requested_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{r.notes || '—'}</td>
                <td className="px-4 py-3">
                  {r.status === 'pending' && (
                    <button
                      onClick={() => updateStatus.mutate({ id: r.id, status: 'processing' })}
                      className="text-xs text-primary hover:underline"
                    >
                      Start Processing
                    </button>
                  )}
                  {r.status === 'processing' && (
                    <button
                      onClick={() => updateStatus.mutate({ id: r.id, status: 'completed' })}
                      className="text-xs text-green-600 hover:underline"
                    >
                      Mark Complete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
