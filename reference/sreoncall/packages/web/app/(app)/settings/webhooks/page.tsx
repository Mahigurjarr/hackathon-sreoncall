'use client';

import { useState } from 'react';
import {
  Webhook,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Eye,
  EyeOff,
  Play,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
} from '@/lib/hooks/useWebhooks';

const availableEvents = [
  { value: 'ticket.created', label: 'Ticket Created' },
  { value: 'ticket.updated', label: 'Ticket Updated' },
  { value: 'ticket.resolved', label: 'Ticket Resolved' },
  { value: 'incident.declared', label: 'Incident Declared' },
  { value: 'incident.resolved', label: 'Incident Resolved' },
  { value: 'user.invited', label: 'User Invited' },
  { value: 'sla.breached', label: 'SLA Breached' },
];

const webhookSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  description: z.string().optional(),
  secret: z.string().min(16, 'Secret must be at least 16 characters'),
});

type WebhookFormData = z.infer<typeof webhookSchema>;

export default function WebhooksPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [showSecret, setShowSecret] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const testWebhook = useTestWebhook();

  const webhooks = data?.data ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WebhookFormData>({
    resolver: zodResolver(webhookSchema),
  });

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  async function onSubmit(data: WebhookFormData) {
    if (selectedEvents.length === 0) {
      toast.error('Select at least one event');
      return;
    }
    try {
      await createWebhook.mutateAsync({
        url: data.url,
        description: data.description,
        secret: data.secret,
        events: selectedEvents,
      });
      toast.success('Webhook created');
      setShowCreate(false);
      reset();
      setSelectedEvents([]);
      setShowSecret(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create webhook');
    }
  }

  async function handleToggleActive(id: string, active: boolean) {
    try {
      await updateWebhook.mutateAsync({ id, input: { active: !active } });
      toast.success(active ? 'Webhook disabled' : 'Webhook enabled');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update webhook');
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const result = await testWebhook.mutateAsync(id);
      if (result.success) {
        toast.success(`Test delivery succeeded (HTTP ${result.status})`);
      } else {
        toast.error(`Test delivery failed (HTTP ${result.status ?? 'unknown'})`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Test delivery failed');
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteWebhook.mutateAsync(deleteId);
      toast.success('Webhook deleted');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete webhook');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Receive real-time HTTP callbacks when events occur in your organization
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      {/* Webhooks List */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No webhooks configured"
          description="Add a webhook endpoint to receive event notifications."
          actionLabel="Add Webhook"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => (
            <Card key={webhook.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {webhook.active ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 text-gray-400" />
                      )}
                      <code className="rounded bg-muted px-2 py-0.5 font-mono text-sm text-foreground truncate">
                        {webhook.url}
                      </code>
                    </div>
                    {webhook.description && (
                      <p className="text-xs text-muted-foreground">{webhook.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {webhook.events.map((event) => (
                        <Badge key={event} variant="secondary" className="text-xs">
                          {event}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last triggered:{' '}
                        {webhook.last_triggered_at
                          ? new Date(webhook.last_triggered_at).toLocaleString()
                          : 'Never'}
                      </span>
                      {(webhook.delivery_stats.success + webhook.delivery_stats.failed) > 0 && (
                        <span>
                          Success rate:{' '}
                          <span
                            className={
                              webhook.success_rate > 95
                                ? 'font-medium text-emerald-600'
                                : webhook.success_rate > 80
                                  ? 'font-medium text-yellow-600'
                                  : 'font-medium text-red-600'
                            }
                          >
                            {webhook.success_rate.toFixed(1)}%
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => handleTest(webhook.id)}
                      title="Send test payload"
                      disabled={testingId === webhook.id}
                    >
                      {testingId === webhook.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => handleToggleActive(webhook.id, webhook.active)}
                      title={webhook.active ? 'Disable webhook' : 'Enable webhook'}
                    >
                      {webhook.active ? (
                        <ToggleRight className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteId(webhook.id)}
                      title="Delete webhook"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Webhook Dialog */}
      <Dialog
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          reset();
          setSelectedEvents([]);
          setShowSecret(false);
        }}
      >
        <DialogContent>
          <DialogClose
            onClose={() => {
              setShowCreate(false);
              reset();
              setSelectedEvents([]);
              setShowSecret(false);
            }}
          />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Add Webhook
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Endpoint URL</label>
              <Input placeholder="https://example.com/webhook" {...register('url')} />
              {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input placeholder="e.g., Slack notifications" {...register('description')} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Signing Secret</label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  placeholder="At least 16 characters"
                  {...register('secret')}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.secret && (
                <p className="text-xs text-destructive">{errors.secret.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Events</label>
              <div className="grid grid-cols-2 gap-2">
                {availableEvents.map((event) => (
                  <label
                    key={event.value}
                    className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={selectedEvents.includes(event.value)}
                      onChange={() => toggleEvent(event.value)}
                    />
                    <span className="text-foreground">{event.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreate(false);
                  reset();
                  setSelectedEvents([]);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createWebhook.isPending}>
                {createWebhook.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Webhook
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Webhook"
        description="Are you sure you want to delete this webhook? It will stop receiving events immediately."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
