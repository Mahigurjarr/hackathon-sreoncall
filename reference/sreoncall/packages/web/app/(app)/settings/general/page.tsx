'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

const settingsSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase with hyphens'),
  logo_url: z.string().url().optional().or(z.literal('')),
  support_email: z.string().email().optional().or(z.literal('')),
  timezone: z.string().min(1),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

const DEFAULT_VOICE_GREETING = 'Hello. You have a notification from SRE on Call.';

export default function GeneralSettingsPage() {
  const [isSaving, setIsSaving] = useState(false);
  const [voiceGreeting, setVoiceGreeting] = useState(DEFAULT_VOICE_GREETING);
  const [savingVoice, setSavingVoice] = useState(false);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant-current'],
    queryFn: () => api.get<any>('/api/v1/tenants/current'),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      slug: '',
      logo_url: '',
      support_email: '',
      timezone: 'UTC',
    },
  });

  useEffect(() => {
    if (tenant) {
      reset({
        name: tenant.name || '',
        slug: tenant.slug || '',
        logo_url: tenant.branding?.logo_url || '',
        support_email: '',
        timezone: 'UTC',
      });
      setVoiceGreeting(tenant.voice_call_settings?.greeting || DEFAULT_VOICE_GREETING);
    }
  }, [tenant, reset]);

  async function onSubmit(data: SettingsFormData) {
    setIsSaving(true);
    try {
      await api.patch('/api/v1/tenants/current', {
        name: data.name,
        branding: data.logo_url ? { logo_url: data.logo_url } : undefined,
      });
      toast.success('Settings saved successfully');
    } catch {
      toast.error('Failed to save settings');
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>Organization Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Organization Name
              </label>
              <Input
                placeholder="Acme Corp"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Slug
              </label>
              <Input
                placeholder="acme-corp"
                {...register('slug')}
                disabled
              />
              <p className="text-xs text-muted-foreground">
                Slug cannot be changed after creation
              </p>
              {errors.slug && (
                <p className="text-xs text-destructive">{errors.slug.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Logo URL
              </label>
              <Input
                placeholder="https://example.com/logo.png"
                {...register('logo_url')}
              />
              {errors.logo_url && (
                <p className="text-xs text-destructive">
                  {errors.logo_url.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Support Email
              </label>
              <Input
                type="email"
                placeholder="support@company.com"
                {...register('support_email')}
              />
              {errors.support_email && (
                <p className="text-xs text-destructive">
                  {errors.support_email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Timezone
              </label>
              <Input
                placeholder="UTC"
                {...register('timezone')}
              />
              {errors.timezone && (
                <p className="text-xs text-destructive">
                  {errors.timezone.message}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter className="justify-end border-t border-border pt-6">
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
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Voice Call Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Voice Greeting
            </label>
            <textarea
              className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Hello. You have a notification from SRE on Call."
              value={voiceGreeting}
              onChange={(e) => setVoiceGreeting(e.target.value)}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              This greeting is spoken at the start of automated voice calls. The incident details and action prompts are appended automatically.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button
            disabled={savingVoice}
            onClick={async () => {
              setSavingVoice(true);
              try {
                await api.patch('/api/v1/tenants/current', {
                  voice_call_settings: { greeting: voiceGreeting.trim() || DEFAULT_VOICE_GREETING },
                });
                toast.success('Voice call settings saved');
              } catch {
                toast.error('Failed to save voice call settings');
              } finally {
                setSavingVoice(false);
              }
            }}
          >
            {savingVoice ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
            ) : (
              <><Save className="mr-2 h-4 w-4" />Save Voice Settings</>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
