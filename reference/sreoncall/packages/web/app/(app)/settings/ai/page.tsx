'use client';

import { useState, useEffect } from 'react';
import { Bot, Eye, EyeOff, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { APIError } from '@/lib/api';
import {
  useAIConfig,
  useUpdateAIConfig,
  useDeleteAIConfig,
  AI_PROVIDERS_CLIENT,
  AI_MODELS_CLIENT,
  AI_PROVIDER_LABELS,
  type AIProviderClient,
} from '@/lib/hooks/useAIConfig';

export default function AISettingsPage() {
  const { data: config, isLoading } = useAIConfig();
  const updateMutation = useUpdateAIConfig();
  const deleteMutation = useDeleteAIConfig();

  const [provider, setProvider] = useState<AIProviderClient>('openai');
  const [model, setModel] = useState<string>('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const isConfigured = !!config?.provider;

  useEffect(() => {
    if (config?.provider) {
      setProvider(config.provider as AIProviderClient);
      setModel(config.model ?? AI_MODELS_CLIENT[config.provider as AIProviderClient][0] ?? '');
    }
  }, [config?.provider, config?.model]);

  function handleProviderChange(p: AIProviderClient) {
    setProvider(p);
    setModel(AI_MODELS_CLIENT[p][0] ?? '');
    setSaveError(null);
  }

  async function handleSave() {
    setSaveError(null);
    if (!apiKey.trim()) {
      setSaveError('API key is required');
      return;
    }
    try {
      await updateMutation.mutateAsync({ provider, model, api_key: apiKey });
      setApiKey('');
      toast.success('AI configuration saved');
    } catch (err: unknown) {
      if (err instanceof APIError && err.isPlanLimitError()) {
        setSaveError(
          `Your current plan does not support BYOK AI configuration. Upgrade to enable this feature.`,
        );
      } else if (err instanceof APIError) {
        setSaveError(err.message || 'Failed to save AI configuration');
      } else if (err instanceof Error) {
        setSaveError(err.message || 'Failed to save AI configuration');
      } else {
        setSaveError('Failed to save AI configuration');
      }
    }
  }

  async function handleRemove() {
    setRemoveError(null);
    try {
      await deleteMutation.mutateAsync();
      toast.success('AI configuration removed');
    } catch {
      setRemoveError('Failed to remove AI configuration. Please try again.');
    }
    setShowRemoveDialog(false);
  }

  if (isLoading) {
    return <div className="py-8 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">AI Configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your own AI provider and API key. All AI features (observability queries, RCA
          summaries, agents) will use your key and bill to your account.
        </p>
      </div>

      {!isConfigured && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400"
          data-testid="ai-config-unconfigured-banner"
        >
          AI features are disabled. Configure your AI provider below to enable natural language
          queries, RCA summaries, and agent capabilities.
        </div>
      )}

      {isConfigured && (
        <Card data-testid="ai-config-current">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {AI_PROVIDER_LABELS[config.provider as AIProviderClient]}
                  </span>
                  <Badge variant="secondary" data-testid="ai-config-model-badge">
                    {config.model}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Key: {config.api_key_hint}
                  {config.configured_by && ` · Configured by ${config.configured_by}`}
                  {config.configured_at &&
                    ` · ${new Date(config.configured_at).toLocaleDateString()}`}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              data-testid="ai-config-remove"
              onClick={() => setShowRemoveDialog(true)}
              aria-label="Remove AI configuration"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <h3 className="font-medium text-foreground">
            {isConfigured ? 'Update Configuration' : 'Add Configuration'}
          </h3>

          {saveError && (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="ai-config-error"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="space-y-1">
            <label
              htmlFor="ai-provider-select"
              className="text-sm font-medium text-foreground"
            >
              Provider
            </label>
            <select
              id="ai-provider-select"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={provider}
              data-testid="ai-config-provider"
              onChange={(e) => handleProviderChange(e.target.value as AIProviderClient)}
            >
              {AI_PROVIDERS_CLIENT.map((p) => (
                <option key={p} value={p}>
                  {AI_PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="ai-model-select"
              className="text-sm font-medium text-foreground"
            >
              Model
            </label>
            <select
              id="ai-model-select"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={model}
              data-testid="ai-config-model"
              onChange={(e) => { setModel(e.target.value); setSaveError(null); }}
            >
              {AI_MODELS_CLIENT[provider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="ai-api-key-input"
              className="text-sm font-medium text-foreground"
            >
              API Key
            </label>
            <div className="relative">
              <Input
                id="ai-api-key-input"
                type={showKey ? 'text' : 'password'}
                placeholder={isConfigured ? 'Enter new key to replace current' : 'sk-...'}
                value={apiKey}
                data-testid="ai-config-api-key"
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (saveError) setSaveError(null);
                }}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                data-testid="ai-config-toggle-key"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            data-testid="ai-config-save"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </CardContent>
      </Card>

      {removeError && (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="ai-config-remove-error"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{removeError}</span>
        </div>
      )}

      <ConfirmDialog
        open={showRemoveDialog}
        onClose={() => setShowRemoveDialog(false)}
        onConfirm={handleRemove}
        title="Remove AI Configuration"
        description="This will disable all AI features for your organization until a new key is configured."
        confirmLabel="Remove"
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
