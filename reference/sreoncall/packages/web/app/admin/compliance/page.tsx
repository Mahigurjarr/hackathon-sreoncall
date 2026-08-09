'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Shield, FileText, Users, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';

export default function ComplianceDashboardPage() {
  const { data: dsarData } = useQuery<{ data: any[] }>({
    queryKey: ['admin-dsar-stats'],
    queryFn: () => api.get('/api/v1/platform-admin/dsar'),
  });

  const requests = dsarData?.data || [];
  const pending = requests.filter((r: any) => r.status === 'pending').length;
  const processing = requests.filter((r: any) => r.status === 'processing').length;
  const completed = requests.filter((r: any) => r.status === 'completed').length;
  const total = requests.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Compliance Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GDPR &amp; DPDP Act compliance overview
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total DSAR Requests</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{total}</p>
        </div>
        <div className="rounded-xl border border-yellow-200 dark:border-yellow-900/50 bg-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-muted-foreground">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{pending}</p>
        </div>
        <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-muted-foreground">Processing</span>
          </div>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{processing}</p>
        </div>
        <div className="rounded-xl border border-green-200 dark:border-green-900/50 bg-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm text-muted-foreground">Completed</span>
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{completed}</p>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/admin/dsar"
          className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
        >
          <Users className="h-5 w-5 text-primary mb-2" />
          <h3 className="font-semibold text-foreground">DSAR Requests</h3>
          <p className="text-sm text-muted-foreground mt-1">Manage data subject access requests</p>
        </Link>
        <Link
          href="/admin/compliance/breaches"
          className="rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-destructive mb-2" />
          <h3 className="font-semibold text-foreground">Breach Tracker</h3>
          <p className="text-sm text-muted-foreground mt-1">Track and report data breaches</p>
        </Link>
        <div className="rounded-xl border border-border bg-card p-5">
          <Shield className="h-5 w-5 text-green-500 mb-2" />
          <h3 className="font-semibold text-foreground">Data Protection</h3>
          <p className="text-sm text-muted-foreground mt-1">
            MFA secrets: AES-256-GCM encrypted<br />
            Passwords: bcrypt (12 rounds)<br />
            IPs: anonymized in audit logs<br />
            Audit log TTL: plan-based retention
          </p>
        </div>
      </div>

      {/* Compliance checklist */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Compliance Checklist</h2>
        <div className="space-y-3">
          {[
            { label: 'Privacy Policy published', done: true },
            { label: 'Terms of Service published', done: true },
            { label: 'Consent tracking at signup', done: true },
            { label: 'Cookie consent banner', done: true },
            { label: 'Data export (DSAR access)', done: true },
            { label: 'Right to erasure (DSAR erasure)', done: true },
            { label: 'MFA secrets encrypted at rest', done: true },
            { label: 'Audit log retention TTL', done: true },
            { label: 'IP anonymization', done: true },
            { label: 'Breach notification process', done: true },
            { label: 'LGTM TLS enabled', done: true },
            { label: 'LGTM log PII scrubbing', done: true },
            { label: 'Nominee registration (DPDP Sec 12)', done: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <CheckCircle2 className={`h-4 w-4 ${item.done ? 'text-green-500' : 'text-muted-foreground'}`} />
              <span className={`text-sm ${item.done ? 'text-foreground' : 'text-muted-foreground'}`}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
