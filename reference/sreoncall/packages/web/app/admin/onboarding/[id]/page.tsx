'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  AlertCircle,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import {
  useOnboarding,
  useApproveOnboarding,
  useRejectOnboarding,
} from '@/lib/hooks/useOnboarding';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  pending_submission: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending_submission: 'Pending Submission',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

const PHASE_LABELS: Record<string, string> = {
  client_details: 'Phase 1: Client Details',
  tenant_setup: 'Phase 2: Tenant Setup',
  provider_links: 'Phase 3: Provider Links',
  branding: 'Phase 4: Branding',
  observability: 'Phase 5: Observability',
  services_teams: 'Phase 6: Services & Teams',
  alerting: 'Phase 7: Alerting',
  synthetic_monitoring: 'Phase 8: Synthetic Monitoring',
  dashboards: 'Phase 9: Dashboards',
  integrations: 'Phase 10: Integrations',
  status_pages: 'Phase 11: Status Pages',
  compliance: 'Phase 12: Compliance & Verification',
};

function renderFormValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export default function OnboardingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: onboarding, isLoading, error } = useOnboarding(id);
  const approveMutation = useApproveOnboarding();
  const rejectMutation = useRejectOnboarding();

  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  function handleReview() {
    if (!reviewAction) return;
    const mutation = reviewAction === 'approve' ? approveMutation : rejectMutation;
    mutation.mutate(
      { id, notes: reviewNotes || undefined },
      {
        onSuccess: () => {
          toast.success(reviewAction === 'approve' ? 'Onboarding approved' : 'Onboarding rejected');
          setReviewAction(null);
          setReviewNotes('');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !onboarding) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p>Onboarding not found</p>
        <Button variant="outline" onClick={() => router.push('/admin/onboarding')}>
          Back to Onboardings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin/onboarding')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{onboarding.tenant_name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{onboarding.tenant_slug}</span>
              <Badge className={STATUS_COLORS[onboarding.status] || ''}>
                {STATUS_LABELS[onboarding.status] || onboarding.status}
              </Badge>
            </div>
          </div>
        </div>
        {onboarding.status === 'submitted' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => { setReviewAction('reject'); setReviewNotes(''); }}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Reject
            </Button>
            <Button
              onClick={() => { setReviewAction('approve'); setReviewNotes(''); }}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve
            </Button>
          </div>
        )}
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact Email</p>
              <p className="mt-1 text-sm text-foreground">{onboarding.contact_email}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assignee Email</p>
              <p className="mt-1 text-sm text-foreground">{onboarding.assignee_email}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</p>
              <p className="mt-1 text-sm text-foreground">{new Date(onboarding.created_at).toLocaleString()}</p>
            </div>
            {onboarding.submitted_at && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Submitted</p>
                <p className="mt-1 text-sm text-foreground">{new Date(onboarding.submitted_at).toLocaleString()}</p>
              </div>
            )}
            {onboarding.reviewed_at && (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reviewed</p>
                  <p className="mt-1 text-sm text-foreground">{new Date(onboarding.reviewed_at).toLocaleString()}</p>
                </div>
                {onboarding.review_notes && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Review Notes</p>
                    <p className="mt-1 text-sm text-foreground">{onboarding.review_notes}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Onboarding Link */}
      {onboarding.token && onboarding.status === 'pending_submission' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Onboarding Link</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/onboarding?token=${onboarding.token}`;
              const expired = onboarding.token_expires_at && new Date(onboarding.token_expires_at) < new Date();
              return (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Share this link with the assignee if the email was not delivered. The link is single-use and expires once submitted.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-foreground break-all select-all">
                      {url}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success('Link copied to clipboard');
                      }}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(url, '_blank')}
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Open
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {expired ? (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Expired
                      </span>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Expires {new Date(onboarding.token_expires_at!).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Form Data */}
      {onboarding.form_data ? (
        Object.entries(PHASE_LABELS).map(([key, label]) => {
          const phaseData = onboarding.form_data?.[key];
          if (!phaseData || (typeof phaseData === 'object' && Object.keys(phaseData).length === 0)) return null;

          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-base">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                {typeof phaseData === 'object' && !Array.isArray(phaseData) ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {Object.entries(phaseData).map(([field, value]) => (
                      <div key={field}>
                        <p className="text-xs font-medium text-muted-foreground capitalize">
                          {field.replace(/_/g, ' ')}
                        </p>
                        <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap">
                          {renderFormValue(value)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {renderFormValue(phaseData)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {onboarding.status === 'pending_submission'
                ? 'Waiting for the assignee to submit the form.'
                : 'No form data available.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Review Dialog */}
      <Dialog open={!!reviewAction} onClose={() => setReviewAction(null)}>
        <DialogContent>
          <DialogClose onClose={() => setReviewAction(null)} />
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'approve' ? 'Approve' : 'Reject'} Onboarding
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              {reviewAction === 'approve'
                ? `Approve the onboarding submission for "${onboarding.tenant_name}"?`
                : `Reject the onboarding submission for "${onboarding.tenant_name}"?`}
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Notes (optional)
              </label>
              <textarea
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                rows={3}
                placeholder={reviewAction === 'reject' ? 'Reason for rejection...' : 'Any notes...'}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReviewAction(null)}>
                Cancel
              </Button>
              <Button
                variant={reviewAction === 'reject' ? 'destructive' : 'default'}
                onClick={handleReview}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                {(approveMutation.isPending || rejectMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {reviewAction === 'approve' ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
