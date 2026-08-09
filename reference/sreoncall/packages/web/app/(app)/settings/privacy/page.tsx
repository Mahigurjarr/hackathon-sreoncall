'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Shield, Download, Trash2, Loader2, CheckCircle2, Clock, XCircle, UserPlus } from 'lucide-react';

interface ConsentRecord {
  id: string;
  consent_type: string;
  version: string;
  granted: boolean;
  granted_at: string;
  revoked_at: string | null;
}

interface DsarRequestRecord {
  id: string;
  type: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  download_url: string | null;
  notes: string | null;
}

const consentLabels: Record<string, string> = {
  privacy_policy: 'Privacy Policy',
  terms_of_service: 'Terms of Service',
  data_processing: 'Data Processing',
  marketing: 'Marketing Communications',
  status_page_subscription: 'Status Page Subscriptions',
};

const statusIcons: Record<string, typeof CheckCircle2> = {
  pending: Clock,
  processing: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

export default function PrivacySettingsPage() {
  const queryClient = useQueryClient();
  const [confirmErasure, setConfirmErasure] = useState(false);

  const { data: consents } = useQuery<{ consents: ConsentRecord[] }>({
    queryKey: ['consents'],
    queryFn: () => api.get('/api/v1/consent'),
  });

  const { data: dsarData } = useQuery<{ requests: DsarRequestRecord[] }>({
    queryKey: ['dsar-requests'],
    queryFn: () => api.get('/api/v1/dsar'),
  });

  const revokeConsent = useMutation({
    mutationFn: (type: string) => api.delete(`/api/v1/consent/${type}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consents'] });
      toast.success('Consent revoked');
    },
  });

  const requestExport = useMutation({
    mutationFn: () => api.post('/api/v1/dsar', { type: 'access' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dsar-requests'] });
      toast.success('Data export requested. You will be notified when ready.');
    },
  });

  const requestErasure = useMutation({
    mutationFn: () => api.post('/api/v1/dsar', { type: 'erasure' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dsar-requests'] });
      toast.success('Erasure request submitted.');
      setConfirmErasure(false);
    },
  });

  return (
    <div className="space-y-8">
      {/* Consents */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Active Consents</h2>
        </div>
        <div className="space-y-3">
          {consents?.consents?.length === 0 && (
            <p className="text-sm text-muted-foreground">No consent records found.</p>
          )}
          {consents?.consents?.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {consentLabels[c.consent_type] || c.consent_type}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.granted ? `Granted ${new Date(c.granted_at).toLocaleDateString()}` : `Revoked ${c.revoked_at ? new Date(c.revoked_at).toLocaleDateString() : ''}`}
                  {' '}(v{c.version})
                </p>
              </div>
              {c.granted && c.consent_type !== 'privacy_policy' && c.consent_type !== 'terms_of_service' && (
                <button
                  onClick={() => revokeConsent.mutate(c.consent_type)}
                  className="text-xs text-destructive hover:underline"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Data Export */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Export Your Data</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Request a complete export of your personal data in machine-readable format (JSON).
          This includes your profile, tickets, incidents, audit logs, and consents.
        </p>
        <button
          onClick={() => requestExport.mutate()}
          disabled={requestExport.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {requestExport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Request Data Export
        </button>
      </div>

      {/* DSAR Request History */}
      {dsarData?.requests && dsarData.requests.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Request History</h2>
          <div className="space-y-2">
            {dsarData.requests.map((r) => {
              const StatusIcon = statusIcons[r.status] || Clock;
              return (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <StatusIcon className={`h-4 w-4 ${r.status === 'completed' ? 'text-green-500' : r.status === 'failed' ? 'text-red-500' : r.status === 'processing' ? 'text-blue-500 animate-spin' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-sm font-medium text-foreground capitalize">{r.type} Request</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.requested_at).toLocaleString()} — {r.status}
                      </p>
                    </div>
                  </div>
                  {r.status === 'completed' && r.download_url && r.type !== 'erasure' && (
                    <a
                      href={r.download_url}
                      download={`sreoncall-export-${r.id}.json`}
                      className="text-xs text-primary hover:underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nominee Registration (DPDP Section 12) */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Nominee Registration</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Under DPDP Act 2023 (Section 12), you may register a nominee who can exercise your data
          rights on your behalf in case of death or incapacity.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            placeholder="Nominee name"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            placeholder="Nominee email"
            type="email"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            placeholder="Relationship"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <button className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50">
          <UserPlus className="h-4 w-4" />
          Register Nominee
        </button>
      </div>

      {/* Delete Account */}
      <div className="rounded-xl border border-destructive/30 bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="h-5 w-5 text-destructive" />
          <h2 className="text-lg font-semibold text-destructive">Delete My Data</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Request permanent erasure of your personal data. Your name and email will be anonymized,
          MFA credentials removed, and sessions terminated. Operational data (tickets, incidents)
          will be preserved with &quot;Deleted User&quot; attribution. This action cannot be undone.
        </p>
        {!confirmErasure ? (
          <button
            onClick={() => setConfirmErasure(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Request Data Erasure
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => requestErasure.mutate()}
              disabled={requestErasure.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {requestErasure.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm Erasure
            </button>
            <button
              onClick={() => setConfirmErasure(false)}
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
