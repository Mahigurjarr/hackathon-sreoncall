'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Hash,
  Lock,
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
  useConsumerChannels,
  useCreateChannel,
  useDeleteChannel,
  useUpdateChannel,
  useSlackInstallations,
  useSlackChannelList,
  useSelectSlackChannels,
  useDeleteSlackInstallation,
} from '@/lib/hooks/useCommunications';
import { useSession } from 'next-auth/react';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';

type ChannelRole = 'bidirectional' | 'ingest_only' | 'notify_only';

// ─── Teams manual entry schema ──────────────────────────────────────────

const teamsChannelSchema = z.object({
  external_channel_id: z.string().min(1, 'Channel ID is required'),
  display_name: z.string().min(1, 'Display name is required').max(200),
  team_id: z.string().min(1, 'Team ID is required'),
  app_id: z.string().min(1, 'App (client) ID is required'),
  aad_tenant_id: z.string().min(1, 'Azure AD tenant ID is required'),
  access_token: z.string().min(1, 'App password (client secret) is required'),
  signing_secret: z.string().min(1, 'Signing secret is required'),
});

type TeamsChannelFormData = z.infer<typeof teamsChannelSchema>;

export default function CommunicationChannelsPage() {
  const searchParams = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteInstallationId, setDeleteInstallationId] = useState<string | null>(null);

  // Channel picker state (shown after Slack OAuth callback)
  const [pickerInstallationId, setPickerInstallationId] = useState<string | null>(null);
  const [pickerWorkspaceName, setPickerWorkspaceName] = useState('');
  const [selectedSlackChannels, setSelectedSlackChannels] = useState<Set<string>>(new Set());
  const [newSlackChannelRole, setNewSlackChannelRole] = useState<ChannelRole>('ingest_only');
  const [pickerSourceFilter, setPickerSourceFilter] = useState<Set<string>>(new Set());

  // Edit-source-filter dialog state
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editSourceFilter, setEditSourceFilter] = useState<Set<string>>(new Set());

  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType;
  const tenantId = (session?.user as any)?.tenantId as string | undefined;
  const { data: linkedConsumers } = useLinkedConsumers();

  const { data, isLoading } = useConsumerChannels();
  const createChannel = useCreateChannel();
  const deleteChannel = useDeleteChannel();
  const updateChannel = useUpdateChannel();
  const { data: installationsData } = useSlackInstallations();
  const { data: slackChannelsData, isLoading: isLoadingSlackChannels } = useSlackChannelList(pickerInstallationId);
  const selectSlackChannels = useSelectSlackChannels();
  const deleteInstallation = useDeleteSlackInstallation();

  const channels = data?.data ?? [];
  const installations = installationsData?.data ?? [];
  const slackChannelOptions = slackChannelsData?.data ?? [];

  // Detect OAuth callback redirect with ?slack_installation=...
  useEffect(() => {
    const installationId = searchParams.get('slack_installation');
    const workspace = searchParams.get('workspace');
    if (installationId) {
      setPickerInstallationId(installationId);
      setPickerWorkspaceName(workspace || 'Slack Workspace');
      // Clean up URL params
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams]);

  useEffect(() => {
    setNewSlackChannelRole('ingest_only');
  }, [channels]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TeamsChannelFormData>({
    resolver: zodResolver(teamsChannelSchema),
  });

  async function onTeamsSubmit(formData: TeamsChannelFormData) {
    try {
      await createChannel.mutateAsync({
        platform: 'teams',
        channel_role: 'bidirectional',
        ...formData,
      });
      toast.success('Teams channel connected');
      setShowCreate(false);
      reset();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create channel');
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteChannel.mutateAsync(deleteId);
      toast.success('Channel disconnected');
      setDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete channel');
    }
  }

  async function handleDeleteInstallation() {
    if (!deleteInstallationId) return;
    try {
      await deleteInstallation.mutateAsync(deleteInstallationId);
      toast.success('Slack workspace disconnected');
      setDeleteInstallationId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to disconnect workspace');
    }
  }

  async function handleSlackOAuth() {
    try {
      const res = await fetch('/api/auth/session');
      const session = await res.json();
      const tenantId = session?.user?.tenantId;
      const token = session?.accessToken;
      if (!tenantId || !token) {
        toast.error('Unable to retrieve session. Please sign in again.');
        return;
      }
      window.location.href = `/api/v1/oauth/slack/start?tenant_id=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}&origin=${encodeURIComponent(window.location.host)}`;
    } catch {
      toast.error('Failed to start Slack OAuth. Please try again.');
    }
  }

  function toggleSlackChannel(channelId: string) {
    setSelectedSlackChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  }

  async function handleSelectChannels() {
    if (!pickerInstallationId || selectedSlackChannels.size === 0) return;

    const sourceIds = Array.from(pickerSourceFilter);
    const channelsToSelect = slackChannelOptions
      .filter((ch) => selectedSlackChannels.has(ch.id))
      .map((ch) => ({
        slack_channel_id: ch.id,
        display_name: `#${ch.name}`,
        channel_role: newSlackChannelRole,
        source_consumer_tenant_ids: sourceIds.length > 0 ? sourceIds : undefined,
      }));

    try {
      await selectSlackChannels.mutateAsync({
        installationId: pickerInstallationId,
        channels: channelsToSelect,
      });
      toast.success(`${channelsToSelect.length} channel(s) connected`);
      setPickerInstallationId(null);
      setSelectedSlackChannels(new Set());
      setPickerSourceFilter(new Set());
    } catch (err: any) {
      toast.error(err?.message || 'Failed to connect channels');
    }
  }

  function roleLabel(role: ChannelRole): string {
    switch (role) {
      case 'ingest_only':
        return 'Ingest Alerts';
      case 'notify_only':
        return 'Notify Only';
      default:
        return 'Bidirectional';
    }
  }

  async function handleSaveSourceFilter() {
    if (!editingChannelId) return;
    try {
      await updateChannel.mutateAsync({
        id: editingChannelId,
        updates: { source_consumer_tenant_ids: Array.from(editSourceFilter) },
      });
      toast.success('Source filter updated');
      setEditingChannelId(null);
      setEditSourceFilter(new Set());
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update source filter');
    }
  }

  // Get channels grouped by installation
  function getChannelsForInstallation(installationId: string) {
    return channels.filter((ch) => ch.installation_id === installationId);
  }

  const manualChannels = channels.filter((ch) => !ch.installation_id);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Connect your Slack workspaces and Teams channels to communicate with your provider SRE team.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSlackOAuth} variant="outline">
            <ExternalLink className="mr-2 h-4 w-4" />
            Add to Slack
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Teams Channel
          </Button>
        </div>
      </div>

      {/* Connected Slack Workspaces */}
      {installations.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">Slack Workspaces</h3>
          {installations.map((inst) => {
            const linkedChannels = getChannelsForInstallation(inst._id);
            return (
              <Card key={inst._id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="font-medium text-foreground">{inst.team_name}</span>
                        <Badge variant="secondary" className="text-xs">Slack</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span>Workspace ID: <code className="rounded bg-muted px-1.5 py-0.5">{inst.team_id}</code></span>
                        <span>Connected {new Date(inst.createdAt).toLocaleDateString()}</span>
                      </div>
                      {/* Linked channels */}
                      {linkedChannels.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {linkedChannels.map((ch) => {
                            const sourceCount = (ch.source_consumer_tenant_ids || []).length;
                            return (
                              <div key={ch._id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
                                <div className="flex items-center gap-2">
                                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span>{ch.display_name}</span>
                                  <Badge variant="secondary" className="text-xs">{roleLabel((ch.channel_role as ChannelRole) || 'bidirectional')}</Badge>
                                  {tenantType === 'provider' && (
                                    <Badge variant="secondary" className="text-xs">
                                      {sourceCount === 0 ? 'All sources' : `${sourceCount} source${sourceCount > 1 ? 's' : ''}`}
                                    </Badge>
                                  )}
                                  {!ch.is_active && (
                                    <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  {tenantType === 'provider' && (
                                    <button
                                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                                      onClick={() => {
                                        setEditingChannelId(ch._id);
                                        setEditSourceFilter(new Set(ch.source_consumer_tenant_ids || []));
                                      }}
                                      title="Edit source routing"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <button
                                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => setDeleteId(ch._id)}
                                    title="Disconnect channel"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        onClick={() => {
                          setPickerInstallationId(inst._id);
                          setPickerWorkspaceName(inst.team_name);
                        }}
                        title="Add more channels"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteInstallationId(inst._id)}
                        title="Disconnect workspace"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Manual channels (Teams + legacy Slack) */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : manualChannels.length > 0 ? (
        <div className="space-y-4">
          {installations.length > 0 && (
            <h3 className="text-sm font-medium text-foreground">Other Channels</h3>
          )}
          {manualChannels.map((channel) => (
            <Card key={channel._id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {channel.is_active ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 text-gray-400" />
                      )}
                      <span className="font-medium text-foreground">{channel.display_name}</span>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {channel.platform}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {roleLabel((channel.channel_role as ChannelRole) || 'bidirectional')}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span>Channel: <code className="rounded bg-muted px-1.5 py-0.5">{channel.external_channel_id}</code></span>
                      {channel.token_prefix && (
                        <span>Token: <code className="rounded bg-muted px-1.5 py-0.5">{channel.token_prefix}</code></span>
                      )}
                      <span>Connected {new Date(channel.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteId(channel._id)}
                    title="Disconnect channel"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : installations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No communication channels"
          description="Connect a Slack workspace or Teams channel to start communicating with your provider."
          actionLabel="Add to Slack"
          onAction={handleSlackOAuth}
        />
      ) : null}

      {/* Slack Channel Picker Dialog */}
      <Dialog open={!!pickerInstallationId} onClose={() => { setPickerInstallationId(null); setSelectedSlackChannels(new Set()); }}>
        <DialogContent>
          <DialogClose onClose={() => { setPickerInstallationId(null); setSelectedSlackChannels(new Set()); }} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Select Channels — {pickerWorkspaceName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              Choose which Slack channels to connect. Use separate roles if you want one Slack channel for inbound alert ingestion and another for outbound incident notifications.
            </p>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <label className="text-sm font-medium text-foreground">Role for selected channels</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={newSlackChannelRole}
                onChange={(e) => setNewSlackChannelRole(e.target.value as ChannelRole)}
              >
                <option value="ingest_only">Ingest Alerts</option>
                <option value="notify_only">Notify Only</option>
                <option value="bidirectional">Bidirectional</option>
              </select>
              <p className="text-xs text-muted-foreground">
                `Ingest Alerts` creates incidents from Slack messages. `Notify Only` sends SREonCall incident updates to Slack without using that channel for Slack alert ingestion. `Bidirectional` keeps the older combined behavior.
              </p>
            </div>
            {isLoadingSlackChannels ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : slackChannelOptions.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No channels found. Make sure the Slack app has been invited to at least one channel.
              </p>
            ) : (
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2">
                {(() => {
                  const connectedIds = new Set(
                    pickerInstallationId
                      ? getChannelsForInstallation(pickerInstallationId).map((ch) => ch.external_channel_id)
                      : []
                  );
                  return slackChannelOptions.map((ch) => {
                    const alreadyConnected = connectedIds.has(ch.id);
                    return (
                      <label
                        key={ch.id}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                          alreadyConnected
                            ? 'opacity-50 cursor-not-allowed'
                            : `cursor-pointer hover:bg-muted/50 ${selectedSlackChannels.has(ch.id) ? 'bg-primary/5' : ''}`
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSlackChannels.has(ch.id)}
                          onChange={() => !alreadyConnected && toggleSlackChannel(ch.id)}
                          disabled={alreadyConnected}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                        <div className="flex items-center gap-1.5 text-sm">
                          {ch.is_private ? (
                            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium">{ch.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {alreadyConnected ? 'Already connected' : `${ch.num_members} member${ch.num_members !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                      </label>
                    );
                  });
                })()}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => { setPickerInstallationId(null); setSelectedSlackChannels(new Set()); }}>
                Cancel
              </Button>
              <Button
                onClick={handleSelectChannels}
                disabled={selectedSlackChannels.size === 0 || selectSlackChannels.isPending}
              >
                {selectSlackChannels.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect {selectedSlackChannels.size > 0 ? `${selectedSlackChannels.size} Channel${selectedSlackChannels.size > 1 ? 's' : ''}` : 'Channels'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Teams Channel Dialog */}
      <Dialog open={showCreate} onClose={() => { setShowCreate(false); reset(); }}>
        <DialogContent>
          <DialogClose onClose={() => { setShowCreate(false); reset(); }} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Connect Microsoft Teams Channel
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <form onSubmit={handleSubmit(onTeamsSubmit)} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Register an Azure AD app in your own Microsoft 365 tenant, grant it the
                <code className="mx-1 rounded bg-muted px-1">ChannelMessage.Send</code>
                application permission with admin consent, then enter its details below.
              </p>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Team ID</label>
                <Input placeholder="the Teams Team ID" {...register('team_id')} />
                {errors.team_id && <p className="text-xs text-destructive">{errors.team_id.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Channel ID</label>
                <Input placeholder="your-channel-id" {...register('external_channel_id')} />
                {errors.external_channel_id && <p className="text-xs text-destructive">{errors.external_channel_id.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Display Name</label>
                <Input placeholder="e.g., SRE Support" {...register('display_name')} />
                {errors.display_name && <p className="text-xs text-destructive">{errors.display_name.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Azure AD Tenant ID</label>
                <Input placeholder="your Azure AD tenant GUID or domain" {...register('aad_tenant_id')} />
                {errors.aad_tenant_id && <p className="text-xs text-destructive">{errors.aad_tenant_id.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">App (Client) ID</label>
                <Input placeholder="Azure AD app registration's client ID" {...register('app_id')} />
                {errors.app_id && <p className="text-xs text-destructive">{errors.app_id.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">App Password (Client Secret)</label>
                <Input type="password" placeholder="your app's client secret" {...register('access_token')} />
                {errors.access_token && <p className="text-xs text-destructive">{errors.access_token.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Signing Secret</label>
                <Input type="password" placeholder="reserved for future inbound verification" {...register('signing_secret')} />
                {errors.signing_secret && <p className="text-xs text-destructive">{errors.signing_secret.message}</p>}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowCreate(false); reset(); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createChannel.isPending}>
                  {createChannel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect Channel
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Channel Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Disconnect Channel"
        description="Are you sure you want to disconnect this channel? Messages will no longer be routed through it."
        confirmLabel="Disconnect"
        variant="destructive"
      />

      {/* Delete Installation Confirm */}
      <ConfirmDialog
        open={!!deleteInstallationId}
        onClose={() => setDeleteInstallationId(null)}
        onConfirm={handleDeleteInstallation}
        title="Disconnect Slack Workspace"
        description="Are you sure you want to disconnect this Slack workspace? All linked channels will also be disconnected."
        confirmLabel="Disconnect"
        variant="destructive"
      />
    </div>
  );
}
