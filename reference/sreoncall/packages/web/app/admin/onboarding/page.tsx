'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Plus,
  Search,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  Send,
  AlertCircle,
  CircleDot,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { FilterSelect } from '@/components/ui/FilterSelect';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useOnboardings,
  useCreateOnboarding,
  useCheckSlug,
} from '@/lib/hooks/useOnboarding';
import { formatDistanceToNow } from 'date-fns';
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

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending_submission: Clock,
  submitted: Send,
  approved: CheckCircle2,
  rejected: XCircle,
};

export default function OnboardingPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formAssigneeEmail, setFormAssigneeEmail] = useState('');

  const { data, isLoading } = useOnboardings({
    search: search || undefined,
    status: statusFilter || undefined,
    limit: 50,
  });

  const createMutation = useCreateOnboarding();
  const { data: slugCheck, isLoading: slugChecking } = useCheckSlug(formSlug);

  const onboardings = data?.data || [];

  function handleCreate() {
    if (!formName || !formSlug || !formContactEmail || !formAssigneeEmail) return;
    createMutation.mutate(
      {
        tenant_name: formName,
        tenant_slug: formSlug,
        contact_email: formContactEmail,
        assignee_email: formAssigneeEmail,
      },
      {
        onSuccess: () => {
          toast.success('Onboarding created and invite email sent');
          setCreateOpen(false);
          setFormName('');
          setFormSlug('');
          setFormContactEmail('');
          setFormAssigneeEmail('');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Onboarding</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage customer onboarding workflows
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Onboarding
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              containerClassName="flex-1 min-w-[200px]"
              placeholder="Search by name, slug, or email..."
              value={search}
              onChange={setSearch}
            />
            <FilterSelect label="Status" icon={<CircleDot />} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="pending_submission">Pending Submission</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </FilterSelect>
          </div>
        </CardContent>
      </Card>

      {/* Onboardings List */}
      <Card>
        <CardHeader>
          <CardTitle>
            {data?.pagination?.total !== undefined
              ? `${data.pagination.total} onboardings`
              : 'Onboardings'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : onboardings.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="No onboardings found"
              description="Create a new onboarding to get started."
            />
          ) : (
            <div className="divide-y divide-border">
              {onboardings.map((item) => {
                const StatusIcon = STATUS_ICONS[item.status] || Clock;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-4 first:pt-0 last:pb-0 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors"
                    onClick={() => router.push(`/admin/onboarding/${item.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{item.tenant_name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.tenant_slug}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge className={STATUS_COLORS[item.status] || ''}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {STATUS_LABELS[item.status] || item.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Assignee: {item.assignee_email}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Created {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogContent>
          <DialogClose onClose={() => setCreateOpen(false)} />
          <DialogHeader>
            <DialogTitle>New Onboarding</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Tenant Name</label>
              <Input
                placeholder="Acme Corp"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Tenant Slug</label>
              <Input
                placeholder="acme-corp"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
              <div className="mt-1 flex items-center gap-1">
                {formSlug.length >= 3 && (
                  slugChecking ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Checking...
                    </span>
                  ) : slugCheck?.available ? (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Available
                    </span>
                  ) : (
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {slugCheck?.reason || 'Unavailable'}
                    </span>
                  )
                )}
                {formSlug.length > 0 && formSlug.length < 3 && (
                  <span className="text-xs text-muted-foreground">Min 3 characters</span>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Contact Email</label>
              <Input
                type="email"
                placeholder="contact@acme.com"
                value={formContactEmail}
                onChange={(e) => setFormContactEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Primary contact for this tenant</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Assignee Email</label>
              <Input
                type="email"
                placeholder="onboarding@sreoncall.com"
                value={formAssigneeEmail}
                onChange={(e) => setFormAssigneeEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Person who will fill the onboarding form (receives the invite link)
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  createMutation.isPending ||
                  !formName ||
                  !formSlug ||
                  !formContactEmail ||
                  !formAssigneeEmail ||
                  (slugCheck && !slugCheck.available)
                }
              >
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create & Send Invite
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
