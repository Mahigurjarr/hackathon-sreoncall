'use client';

import { useState, useEffect } from 'react';
import { Loader2, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';

interface NotificationPrefs {
  email: boolean;
  in_app: boolean;
  sms: boolean;
  slack: boolean;
  voice: boolean;
  whatsapp: boolean;
  channels?: { comms?: boolean };
  comms_sound?: boolean;
  comms_browser_notifications?: boolean;
}

export default function NotificationSettingsPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    email: true,
    in_app: true,
    sms: false,
    slack: false,
    voice: false,
    whatsapp: false,
    channels: { comms: true },
    comms_sound: true,
    comms_browser_notifications: true,
  });
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const user = await api.get<any>('/api/v1/users/me');
        setPrefs({
          email: user.notification_preferences?.email ?? true,
          in_app: user.notification_preferences?.in_app ?? true,
          sms: user.notification_preferences?.sms ?? false,
          slack: user.notification_preferences?.slack ?? false,
          voice: user.notification_preferences?.voice ?? false,
          whatsapp: user.notification_preferences?.whatsapp ?? false,
          channels: { comms: user.notification_preferences?.channels?.comms ?? true },
          comms_sound: user.notification_preferences?.comms_sound ?? true,
          comms_browser_notifications: user.notification_preferences?.comms_browser_notifications ?? true,
        });
        setPhoneNumber(user.phone_number || '');
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/api/v1/users/me', {
        notification_preferences: prefs,
        phone_number: phoneNumber.trim() || undefined,
      });
      toast.success('Notification preferences saved');
    } catch {
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notification Preferences
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you want to receive notifications
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Delivery Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">In-App</span>
              <p className="text-xs text-muted-foreground">Notifications in the app bell icon</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.in_app}
              onChange={(e) => setPrefs((p) => ({ ...p, in_app: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">Email</span>
              <p className="text-xs text-muted-foreground">Receive email notifications</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.email}
              onChange={(e) => setPrefs((p) => ({ ...p, email: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">SMS</span>
              <p className="text-xs text-muted-foreground">Text message alerts for critical notifications</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.sms}
              onChange={(e) => setPrefs((p) => ({ ...p, sms: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">Voice Call</span>
              <p className="text-xs text-muted-foreground">Automated phone calls with TTS for critical alerts</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.voice}
              onChange={(e) => setPrefs((p) => ({ ...p, voice: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">WhatsApp</span>
              <p className="text-xs text-muted-foreground">Alert notifications via WhatsApp</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.whatsapp}
              onChange={(e) => setPrefs((p) => ({ ...p, whatsapp: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">Slack</span>
              <p className="text-xs text-muted-foreground">Direct messages via Slack</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.slack}
              onChange={(e) => setPrefs((p) => ({ ...p, slack: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>
        </CardContent>
      </Card>

      {(prefs.sms || prefs.voice || prefs.whatsapp) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Phone Number</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="+1 555 123 4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="max-w-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Required for SMS, voice call, and WhatsApp notifications. Include country code.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Communications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">Message Notifications</span>
              <p className="text-xs text-muted-foreground">Get notified when consumers send new messages</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.channels?.comms ?? true}
              onChange={(e) => setPrefs((p) => ({ ...p, channels: { ...p.channels, comms: e.target.checked } }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">Notification Sound</span>
              <p className="text-xs text-muted-foreground">Play a chime when new messages arrive</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.comms_sound ?? true}
              onChange={(e) => setPrefs((p) => ({ ...p, comms_sound: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground">Browser Notifications</span>
              <p className="text-xs text-muted-foreground">Show desktop notifications for new messages</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.comms_browser_notifications ?? true}
              onChange={(e) => setPrefs((p) => ({ ...p, comms_browser_notifications: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
          ) : (
            'Save Preferences'
          )}
        </Button>
      </div>
    </div>
  );
}
