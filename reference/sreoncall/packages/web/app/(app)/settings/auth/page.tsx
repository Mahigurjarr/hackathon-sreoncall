'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Save, Lock, Shield, Key, Smartphone, Globe, Users, Trash2, Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const authSchema = z.object({
  min_password_length: z.coerce.number().min(8).max(128),
  require_uppercase: z.boolean(),
  require_numbers: z.boolean(),
  require_special_chars: z.boolean(),
  session_timeout_hours: z.coerce.number().min(1).max(720),
  max_sessions: z.coerce.number().min(1).max(100),
  mfa_required: z.boolean(),
  sso_enabled: z.boolean(),
});

type AuthFormData = z.infer<typeof authSchema>;

function ScimTokensCard() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  const { data: tokensData, isLoading } = useQuery({
    queryKey: ['scim-tokens'],
    queryFn: () => api.get<any>('/api/v1/scim-tokens'),
  });

  const tokens = tokensData?.tokens || [];

  async function createToken() {
    if (!tokenName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post<any>('/api/v1/scim-tokens', { name: tokenName.trim() });
      setNewToken(res.token);
      setTokenName('');
      queryClient.invalidateQueries({ queryKey: ['scim-tokens'] });
      toast.success('SCIM token created');
    } catch {
      toast.error('Failed to create SCIM token');
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    try {
      await api.delete(`/api/v1/scim-tokens/${id}`);
      queryClient.invalidateQueries({ queryKey: ['scim-tokens'] });
      toast.success('SCIM token revoked');
    } catch {
      toast.error('Failed to revoke token');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          SCIM Provisioning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Use SCIM 2.0 to automatically provision and deprovision users from your identity provider (Okta, Azure AD, Google Workspace).
          Base URL: <code className="text-xs bg-muted px-1 py-0.5 rounded">/scim/v2</code>
        </p>

        {newToken && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 space-y-2">
            <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
              Copy this token now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white dark:bg-navy-elevated p-2 rounded border break-all">
                {newToken}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(newToken);
                  toast.success('Copied to clipboard');
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNewToken(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder="Token name (e.g. Okta SCIM)"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={createToken}
            disabled={creating || !tokenName.trim()}
          >
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create Token
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No SCIM tokens yet. Create one to enable provisioning.
          </p>
        ) : (
          <div className="space-y-2">
            {tokens.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.token_prefix}... {t.revoked_at ? (
                      <span className="text-destructive">(revoked)</span>
                    ) : t.last_used_at ? (
                      <>Last used {new Date(t.last_used_at).toLocaleDateString()}</>
                    ) : (
                      'Never used'
                    )}
                  </p>
                </div>
                {!t.revoked_at && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeToken(t.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SsoConfigCard() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data: ssoConfig, isLoading } = useQuery({
    queryKey: ['sso-config'],
    queryFn: () => api.get<any>('/api/v1/auth/sso/config'),
  });

  const { data: ssoSettings } = useQuery({
    queryKey: ['sso-settings'],
    queryFn: () => api.get<any>('/api/v1/auth/sso/settings'),
  });

  const ssoSchema = z.object({
    provider: z.enum(['oidc', 'keycloak', 'okta', 'azure_ad', 'google']),
    issuer_url: z.string().url('Must be a valid URL'),
    client_id: z.string().min(1, 'Client ID is required'),
    client_secret: z.string().min(1, 'Client secret is required'),
    scopes: z.string(),
    auto_create_users: z.boolean(),
    default_roles: z.string(),
  });

  type SsoFormData = z.infer<typeof ssoSchema>;

  const {
    register: regSso,
    handleSubmit: handleSsoSubmit,
    reset: resetSso,
    watch: watchSso,
    setValue: setValueSso,
    formState: { errors: ssoErrors, isDirty: ssoIsDirty },
  } = useForm<SsoFormData>({
    resolver: zodResolver(ssoSchema),
    defaultValues: {
      provider: 'oidc',
      issuer_url: '',
      client_id: '',
      client_secret: '',
      scopes: 'openid email profile',
      auto_create_users: true,
      default_roles: 'agent',
    },
  });

  useEffect(() => {
    if (ssoSettings?.sso_config) {
      const c = ssoSettings.sso_config;
      resetSso({
        provider: c.provider || 'oidc',
        issuer_url: c.issuer_url || '',
        client_id: c.client_id || '',
        client_secret: '',
        scopes: (c.scopes || ['openid', 'email', 'profile']).join(' '),
        auto_create_users: c.auto_create_users ?? true,
        default_roles: (c.default_roles || ['agent']).join(', '),
      });
    }
  }, [ssoSettings, resetSso]);

  const autoCreate = watchSso('auto_create_users');

  async function onSsoSave(data: SsoFormData) {
    setSaving(true);
    try {
      await api.put('/api/v1/auth/sso/settings', {
        sso_enabled: true,
        provider: data.provider,
        issuer_url: data.issuer_url,
        client_id: data.client_id,
        client_secret: data.client_secret,
        scopes: data.scopes.split(/[\s,]+/).filter(Boolean),
        auto_create_users: data.auto_create_users,
        default_roles: data.default_roles.split(/[\s,]+/).filter(Boolean),
      });
      queryClient.invalidateQueries({ queryKey: ['sso-config'] });
      queryClient.invalidateQueries({ queryKey: ['sso-settings'] });
      toast.success('SSO configuration saved');
    } catch {
      toast.error('Failed to save SSO configuration');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await api.get<any>('/api/v1/auth/sso/config');
      if (res.sso_enabled && res.issuer_url) {
        toast.success(`SSO is configured with ${res.provider} at ${res.issuer_url}`);
      } else {
        toast.error('SSO is not fully configured yet');
      }
    } catch {
      toast.error('Failed to check SSO configuration');
    } finally {
      setTesting(false);
    }
  }

  const providerLabels: Record<string, string> = {
    oidc: 'Generic OIDC',
    keycloak: 'Keycloak',
    okta: 'Okta',
    azure_ad: 'Azure AD',
    google: 'Google Workspace',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          SSO Configuration
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSsoSubmit(onSsoSave)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Identity Provider
            </label>
            <Select {...regSso('provider')}>
              {Object.entries(providerLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Issuer URL
            </label>
            <Input
              placeholder="https://sso.example.com/realms/my-realm"
              {...regSso('issuer_url')}
            />
            {ssoErrors.issuer_url && (
              <p className="text-xs text-destructive">{ssoErrors.issuer_url.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              The OIDC issuer URL. Must support .well-known/openid-configuration discovery.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Client ID
              </label>
              <Input
                placeholder="sreoncall-client"
                {...regSso('client_id')}
              />
              {ssoErrors.client_id && (
                <p className="text-xs text-destructive">{ssoErrors.client_id.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Client Secret
              </label>
              <Input
                type="password"
                placeholder="••••••••••"
                {...regSso('client_secret')}
              />
              {ssoErrors.client_secret && (
                <p className="text-xs text-destructive">{ssoErrors.client_secret.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Scopes
            </label>
            <Input
              placeholder="openid email profile"
              {...regSso('scopes')}
            />
            <p className="text-xs text-muted-foreground">
              Space-separated OIDC scopes. Default: openid email profile
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Auto-create users
                </p>
                <p className="text-xs text-muted-foreground">
                  Automatically create accounts for new SSO users
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoCreate}
                onClick={() => setValueSso('auto_create_users', !autoCreate, { shouldDirty: true })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  autoCreate ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    autoCreate ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Default Roles
            </label>
            <Input
              placeholder="agent"
              {...regSso('default_roles')}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated roles assigned to auto-created users. Default: agent
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing...</>
            ) : (
              'Test Connection'
            )}
          </Button>
          <Button type="submit" disabled={saving || !ssoIsDirty}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
            ) : (
              <><Save className="mr-2 h-4 w-4" />Save SSO Config</>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function AuthSettingsPage() {
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant-current'],
    queryFn: () => api.get<any>('/api/v1/tenants/current'),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<AuthFormData>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      min_password_length: 8,
      require_uppercase: true,
      require_numbers: true,
      require_special_chars: false,
      session_timeout_hours: 8,
      max_sessions: 5,
      mfa_required: false,
      sso_enabled: false,
    },
  });

  useEffect(() => {
    if (tenant?.auth_settings) {
      const auth = tenant.auth_settings;
      reset({
        min_password_length: auth.password_policy?.min_length || 8,
        require_uppercase: auth.password_policy?.require_uppercase ?? true,
        require_numbers: auth.password_policy?.require_numbers ?? true,
        require_special_chars: auth.password_policy?.require_special_chars ?? false,
        session_timeout_hours: auth.session_policy?.session_timeout_hours || 8,
        max_sessions: auth.session_policy?.max_concurrent_sessions || 5,
        mfa_required: auth.mfa_required ?? false,
        sso_enabled: auth.sso_enabled ?? false,
      });
    }
  }, [tenant, reset]);

  async function onSubmit(data: AuthFormData) {
    setIsSaving(true);
    try {
      await api.patch('/api/v1/tenants/current', {
        auth_settings: {
          password_policy: {
            min_length: data.min_password_length,
            require_uppercase: data.require_uppercase,
            require_numbers: data.require_numbers,
            require_special_chars: data.require_special_chars,
          },
          session_policy: {
            session_timeout_hours: data.session_timeout_hours,
            max_concurrent_sessions: data.max_sessions,
          },
          mfa_required: data.mfa_required,
          sso_enabled: data.sso_enabled,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['tenant-current'] });
      toast.success('Authentication settings saved');
    } catch {
      toast.error('Failed to save authentication settings');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const mfaRequired = watch('mfa_required');
  const ssoEnabled = watch('sso_enabled');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Password Policy */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Password Policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Minimum Password Length
              </label>
              <Input
                type="number"
                min={8}
                max={128}
                {...register('min_password_length')}
              />
              {errors.min_password_length && (
                <p className="text-xs text-destructive">
                  {errors.min_password_length.message}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  {...register('require_uppercase')}
                />
                <span className="text-sm text-foreground">
                  Require uppercase letters
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  {...register('require_numbers')}
                />
                <span className="text-sm text-foreground">
                  Require numbers
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  {...register('require_special_chars')}
                />
                <span className="text-sm text-foreground">
                  Require special characters
                </span>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Session Policy */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Session Policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Session Timeout (hours)
              </label>
              <Input
                type="number"
                min={1}
                max={720}
                {...register('session_timeout_hours')}
              />
              {errors.session_timeout_hours && (
                <p className="text-xs text-destructive">
                  {errors.session_timeout_hours.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Max Concurrent Sessions
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                {...register('max_sessions')}
              />
              {errors.max_sessions && (
                <p className="text-xs text-destructive">
                  {errors.max_sessions.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* MFA */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Multi-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Require MFA for all users
                </p>
                <p className="text-xs text-muted-foreground">
                  Users will be prompted to set up MFA on their next login
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mfaRequired}
                onClick={() => setValue('mfa_required', !mfaRequired, { shouldDirty: true })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  mfaRequired ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    mfaRequired ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          </CardContent>
        </Card>

        {/* SSO */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Single Sign-On (SSO)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Enable SSO
                </p>
                <p className="text-xs text-muted-foreground">
                  Allow users to sign in via an external identity provider
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ssoEnabled}
                onClick={() => setValue('sso_enabled', !ssoEnabled, { shouldDirty: true })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  ssoEnabled ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    ssoEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          </CardContent>
        </Card>

        {/* SSO Configuration — only shown when SSO is enabled */}
        {ssoEnabled && <SsoConfigCard />}

        {/* Save Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving || !isDirty}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>

      {/* SCIM Provisioning — outside the main form */}
      <ScimTokensCard />
    </div>
  );
}
