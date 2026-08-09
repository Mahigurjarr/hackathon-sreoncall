'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Plus, Loader2, Send, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import { NotetakerPanel } from '@/components/notetaker/NotetakerPanel';
import {
  useChannels,
  useCreateChannel,
  useChannelMessages,
  useSendMessage,
  type ChannelType,
} from '@/lib/hooks/useChannels';

const channelTypeBadge: Record<string, string> = {
  general: 'bg-blue-100 text-blue-700',
  incident_war_room: 'bg-red-100 text-red-700',
  dm: 'bg-gray-100 text-gray-700',
  customer: 'bg-purple-100 text-purple-700',
  topic: 'bg-teal-100 text-teal-700',
  broadcast: 'bg-amber-100 text-amber-700',
  internal_escalation: 'bg-orange-100 text-orange-700',
};

const channelTypeLabel: Record<string, string> = {
  general: 'General',
  incident_war_room: 'War Room',
  dm: 'DM',
  customer: 'Customer',
  topic: 'Topic',
  broadcast: 'Broadcast',
  internal_escalation: 'Escalation',
};

export default function ChannelsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ChannelType>('general');
  const [newDescription, setNewDescription] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');
  const [slackChannelName, setSlackChannelName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: channels, isLoading: channelsLoading } = useChannels();
  const { data: messages, isLoading: messagesLoading } = useChannelMessages(selectedChannelId);
  const createMutation = useCreateChannel();
  const sendMutation = useSendMessage();

  const selectedChannel = channels?.find((c) => c._id === selectedChannelId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!selectedChannelId || !messageInput.trim()) return;
    const body = messageInput.trim();
    setMessageInput('');
    try {
      await sendMutation.mutateAsync({ channelId: selectedChannelId, body });
    } catch {
      toast.error('Failed to send message');
      setMessageInput(body);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const channel = await createMutation.mutateAsync({
        name: newName.trim(),
        type: newType,
        description: newDescription.trim() || undefined,
        ...(slackChannelId && slackChannelName ? {
          slack_integration: {
            workspace_id: '',
            channel_id: slackChannelId.trim(),
            channel_name: slackChannelName.trim(),
          },
        } : {}),
      });
      toast.success('Channel created');
      setShowCreate(false);
      setNewName('');
      setNewType('general');
      setNewDescription('');
      setSlackChannelId('');
      setSlackChannelName('');
      setSelectedChannelId(channel._id);
    } catch {
      toast.error('Failed to create channel');
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Channels</h1>
          <p className="mt-1 text-sm text-muted-foreground">War rooms and communication channels</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Channel
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden rounded-lg border border-border">
        {/* Channel List */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Channels
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {channelsLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : !channels || channels.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-xs text-muted-foreground">No channels yet</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Create one
                </button>
              </div>
            ) : (
              channels.map((channel) => (
                <button
                  key={channel._id}
                  onClick={() => setSelectedChannelId(channel._id)}
                  className={cn(
                    'mb-0.5 flex w-full flex-col rounded-md px-2 py-2 text-left transition-colors',
                    selectedChannelId === channel._id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-sm font-medium">{channel.name}</span>
                  </div>
                  <span
                    className={cn(
                      'mt-1 inline-flex self-start rounded-full px-1.5 py-0.5 text-xs font-medium',
                      channelTypeBadge[channel.type as ChannelType] ?? 'bg-gray-100 text-gray-700',
                    )}
                  >
                    {channelTypeLabel[channel.type as ChannelType] ?? channel.type}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          {!selectedChannelId ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Select a channel to start messaging</p>
              </div>
            </div>
          ) : (
            <>
              {/* Channel header */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">{selectedChannel?.name}</span>
                {selectedChannel && (
                  <>
                    <span
                      className={cn(
                        'ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        channelTypeBadge[selectedChannel.type] ?? channelTypeBadge.general,
                      )}
                    >
                      {channelTypeLabel[selectedChannel.type] ?? selectedChannel.type}
                    </span>
                    {selectedChannel.slack_integration && (
                      <span className="ml-1 inline-flex rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-medium">
                        Slack
                      </span>
                    )}
                    {selectedChannel.teams_integration && (
                      <span className="ml-1 inline-flex rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">
                        Teams
                      </span>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  variant={showNotes ? 'default' : 'ghost'}
                  className="ml-auto"
                  onClick={() => setShowNotes((v) => !v)}
                >
                  <Mic className="h-4 w-4" />
                  <span className="ml-1">Notes</span>
                </Button>
              </div>

              {showNotes ? (
                /* AI Notetaker panel for this channel */
                <div className="flex-1 overflow-y-auto p-4">
                  <NotetakerPanel
                    channelId={selectedChannelId}
                    incidentId={selectedChannel?.incident_id || undefined}
                  />
                </div>
              ) : (
              <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messagesLoading ? (
                  <div className="flex h-20 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !messages || messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">No messages yet. Say something!</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg._id} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {msg.author?.name ?? 'Unknown'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{msg.body}</p>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    className="flex-1 min-h-[40px] max-h-32 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                  />
                  <Button
                    size="sm"
                    onClick={handleSend}
                    disabled={!messageInput.trim() || sendMutation.isPending}
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create Channel Dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowCreate(false)} />
          <DialogHeader>
            <DialogTitle>Create Channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateChannel} className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Name *</label>
              <Input
                placeholder="e.g. incident-2024-prod-outage"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Type</label>
              <Select value={newType} onChange={(e) => setNewType(e.target.value as ChannelType)}>
                <option value="general">General</option>
                <option value="incident_war_room">Incident War Room</option>
                <option value="dm">Direct Message</option>
                <option value="customer">Customer</option>
                <option value="topic">Topic</option>
                <option value="broadcast">Broadcast</option>
                <option value="internal_escalation">Internal Escalation</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Description</label>
              <Input
                placeholder="What is this channel for?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Slack Integration (optional)</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Slack Channel ID"
                  value={slackChannelId}
                  onChange={(e) => setSlackChannelId(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Channel Name"
                  value={slackChannelName}
                  onChange={(e) => setSlackChannelName(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !newName.trim()}>
                {createMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>
                ) : (
                  'Create Channel'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
