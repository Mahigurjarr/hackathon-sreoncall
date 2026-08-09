'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Plug,
  Key,
  Plus,
  Copy,
  Trash2,
  Bell,
  GitBranch,
  BarChart3,
  Radio,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  Sparkles,
  Check,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/hooks/useApiKeys';
import { useMcpProposals, useApproveMcpProposal, useRejectMcpProposal } from '@/lib/hooks/useMcpProposals';

function SlackLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 127 127" fill="none" aria-hidden="true" className={className}>
      {/* Pink/Red */}
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80z" fill="#E01E5A"/>
      <path d="M33.8 80c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A"/>
      {/* Cyan/Blue */}
      <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47z" fill="#36C5F0"/>
      <path d="M47 33.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H14c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33z" fill="#36C5F0"/>
      {/* Green */}
      <path d="M99.9 47c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V47z" fill="#2EB67D"/>
      <path d="M93.3 47c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V14c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33z" fill="#2EB67D"/>
      {/* Yellow */}
      <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2z" fill="#ECB22E"/>
      <path d="M80.1 93.2c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2h-33z" fill="#ECB22E"/>
    </svg>
  );
}

const integrations = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send notifications and manage incidents from Slack channels',
    icon: <SlackLogo className="h-6 w-6" />,
    category: 'Communication',
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    description: 'Sync on-call schedules and escalation policies',
    icon: <Bell className="h-6 w-6" />,
    category: 'Alerting',
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Bi-directional sync between tickets and Jira issues',
    icon: <Plug className="h-6 w-6" />,
    category: 'Project Management',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Link pull requests and deployments to change requests',
    icon: <GitBranch className="h-6 w-6" />,
    category: 'Development',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: 'Auto-create incidents from Datadog alerts and monitors',
    icon: <BarChart3 className="h-6 w-6" />,
    category: 'Monitoring',
  },
  {
    id: 'snmp-trapper',
    name: 'SNMP Trapper',
    description: 'Deploy on-premise agents to collect SNMP traps and forward alerts',
    icon: <Radio className="h-6 w-6" />,
    category: 'Network',
  },
];

export default function IntegrationsPage() {
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreatedKey, setShowCreatedKey] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<string | null>(null);

  const { data, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const { data: proposalsData, isLoading: isLoadingProposals } = useMcpProposals('pending');
  const approveProposal = useApproveMcpProposal();
  const rejectProposal = useRejectMcpProposal();
  const pendingProposals = proposalsData?.data ?? [];

  const apiKeys = data?.data ?? [];

  async function handleCreateKey() {
    if (!keyName.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }
    try {
      const result = await createKey.mutateAsync({ name: keyName.trim() });
      setCreatedKey(result.key);
      setShowCreateKey(false);
      setKeyName('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create API key');
    }
  }

  async function handleRevoke() {
    if (!keyToRevoke) return;
    try {
      await revokeKey.mutateAsync(keyToRevoke);
      toast.success('API key revoked');
      setKeyToRevoke(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to revoke key');
    }
  }

  function copyKey(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4 py-6">
      {/* API Keys Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Key className="h-5 w-5" />
              API Keys
            </h2>
            <p className="text-sm text-muted-foreground">
              Manage API keys for programmatic access
            </p>
          </div>
          <Button onClick={() => setShowCreateKey(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create API Key
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-muted-foreground">No API keys created yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Key
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Created
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Last Used
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {apiKeys.map((key) => (
                      <tr key={key.id} className="transition-colors hover:bg-muted/50">
                        <td className="px-4 py-3 text-sm font-medium text-foreground">
                          {key.name}
                        </td>
                        <td className="px-4 py-3">
                          <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                            {key.key_prefix}...
                          </code>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {new Date(key.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {key.last_used_at
                            ? new Date(key.last_used_at).toLocaleDateString()
                            : 'Never'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setKeyToRevoke(key.id)}
                            title="Revoke key"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* MCP / AI Assistant Access Section */}
      <div className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Sparkles className="h-5 w-5" />
            AI Assistant Access (MCP)
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect Claude or another MCP-compatible AI assistant using one of the API keys above.
            The assistant can look up incidents, tickets, alerts, on-call, and runbooks directly, and
            can draft a ticket or change request — but nothing is created until you approve it below.
          </p>
        </div>

        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                MCP Endpoint
              </p>
              <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-sm text-foreground">
                {typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp'}
              </code>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/mcp`);
                toast.success('Endpoint copied');
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-semibold text-foreground">Pending proposals</h3>
          <p className="text-xs text-muted-foreground">
            Drafted by an AI assistant, waiting on a real decision from you before anything is created.
          </p>
        </div>

        {isLoadingProposals ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : pendingProposals.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No pending proposals"
            description="When a connected AI assistant drafts a ticket or change request, it shows up here for your review."
          />
        ) : (
          <div className="space-y-3">
            {pendingProposals.map((proposal) => (
              <Card key={proposal.id}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {proposal.target_type === 'ticket' ? 'New ticket' : 'New change request'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">via {proposal.tool_name}</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{proposal.summary}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rejectProposal.isPending}
                      onClick={() =>
                        rejectProposal.mutate(proposal.id, {
                          onSuccess: () => toast.success('Proposal rejected'),
                          onError: () => toast.error('Failed to reject proposal'),
                        })
                      }
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveProposal.isPending}
                      onClick={() =>
                        approveProposal.mutate(proposal.id, {
                          onSuccess: () => toast.success('Proposal approved'),
                          onError: () => toast.error('Failed to approve proposal'),
                        })
                      }
                    >
                      <Check className="mr-1.5 h-4 w-4" />
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Integrations Section */}
      <div className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Plug className="h-5 w-5" />
            Third-Party Integrations
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect external tools to streamline your workflow
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {integrations.map((integration) => (
            <Card key={integration.id}>
              <CardContent className="flex items-start gap-4 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {integration.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{integration.name}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {integration.category}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{integration.description}</p>
                  <div className="mt-3">
                    {integration.id === 'slack' ? (
                      <Link href="/settings/communication-channels">
                        <Button size="sm" variant="outline">
                          Connect
                        </Button>
                      </Link>
                    ) : integration.id === 'snmp-trapper' || integration.id === 'external-alert-sources' ? (
                      <Link href={`/settings/integrations/${integration.id}`}>
                        <Button size="sm" variant="outline">
                          Manage
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toast.info(`${integration.name} integration coming soon`)}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <Dialog open={showCreateKey} onClose={() => setShowCreateKey(false)}>
        <DialogContent>
          <DialogClose onClose={() => setShowCreateKey(false)} />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Create API Key
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Key Name</label>
              <Input
                placeholder="e.g., CI/CD Pipeline"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
              />
              <p className="text-xs text-muted-foreground">
                Give your API key a descriptive name for easy identification
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowCreateKey(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateKey} disabled={createKey.isPending}>
                {createKey.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create Key
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Show Created Key Once Dialog */}
      <Dialog
        open={!!createdKey}
        onClose={() => {
          setCreatedKey(null);
          setShowCreatedKey(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              API Key Created
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              Copy this key now. You won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
              <code className="flex-1 break-all font-mono text-sm text-foreground">
                {showCreatedKey ? createdKey : createdKey?.replace(/./g, '•')}
              </code>
              <button
                onClick={() => setShowCreatedKey(!showCreatedKey)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {showCreatedKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={() => copyKey(createdKey || '')}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setCreatedKey(null);
                  setShowCreatedKey(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm */}
      <ConfirmDialog
        open={!!keyToRevoke}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={handleRevoke}
        title="Revoke API Key"
        description="Are you sure you want to revoke this API key? Any integrations using it will immediately lose access."
        confirmLabel="Revoke"
        variant="destructive"
      />
    </div>
  );
}
