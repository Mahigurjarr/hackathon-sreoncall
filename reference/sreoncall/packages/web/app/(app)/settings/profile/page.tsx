'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, Save, Camera, Trash2, ImageIcon, Lock, Eye, EyeOff, CheckCircle2, ShieldCheck, ShieldOff, Copy, RefreshCw, AlertTriangle, Download, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { useCurrentUser, useUpdateProfile } from '@/lib/hooks/useCurrentUser';
import { AVATAR_PRESETS } from '@/lib/avatar-presets';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type MfaState = 'idle' | 'setup' | 'verify' | 'backup_codes' | 'enabled';

function MfaSetupCard({ user }: { user: any }) {
  const mfaEnabled = user.mfa_enabled;
  const backupCodesRemaining = user.backup_codes_remaining ?? 0;

  const [state, setState] = useState<MfaState>(mfaEnabled ? 'enabled' : 'idle');
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [regenPassword, setRegenPassword] = useState('');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  // Auto-open MFA setup if ?setup_mfa=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup_mfa') === '1' && !mfaEnabled && state === 'idle') {
      handleStartSetup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync enabled state if user data changes
  useEffect(() => {
    if (mfaEnabled && state === 'idle') setState('enabled');
  }, [mfaEnabled, state]);

  async function handleStartSetup() {
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ secret: string; qr_code: string; otpauth_url: string }>('/api/v1/auth/mfa/setup');
      setQrCode(res.qr_code);
      setSecret(res.secret);
      setState('setup');
    } catch (err: any) {
      setError(err?.body?.detail || err.message || 'Failed to start MFA setup');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (verifyCode.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ backup_codes: string[] }>('/api/v1/auth/mfa/enable', { code: verifyCode });
      setBackupCodes(res.backup_codes);
      setState('backup_codes');
    } catch (err: any) {
      setError(err?.body?.detail || err.message || 'Invalid code');
      setVerifyCode('');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    if (!disablePassword) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/api/v1/auth/mfa/disable', { password: disablePassword });
      toast.success('MFA disabled');
      setState('idle');
      setShowDisableConfirm(false);
      setDisablePassword('');
    } catch (err: any) {
      setError(err?.body?.detail || err.message || 'Failed to disable MFA');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenCodes() {
    if (!regenPassword) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ backup_codes: string[] }>('/api/v1/auth/mfa/backup-codes', { password: regenPassword });
      setBackupCodes(res.backup_codes);
      setState('backup_codes');
      setShowRegenConfirm(false);
      setRegenPassword('');
      toast.success('Backup codes regenerated');
    } catch (err: any) {
      setError(err?.body?.detail || err.message || 'Failed to regenerate codes');
    } finally {
      setLoading(false);
    }
  }

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    toast.success('Backup codes copied to clipboard');
  }

  function downloadBackupCodes() {
    const content = [
      'SREonCall Backup Codes',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Each code can only be used once.',
      '',
      ...backupCodes.map((code, i) => `${i + 1}. ${code}`),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sreoncall-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup codes downloaded');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Two-Factor Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Idle — not enabled */}
        {state === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add an extra layer of security to your account by enabling two-factor authentication with an authenticator app.
            </p>
            {(user as any).mfa_required_by_tenant && (
              <div className="flex items-center gap-2 rounded-lg bg-[#FEFCE8] dark:bg-[#A16207]/20 border border-[#FDE68A] dark:border-[#A16207] px-4 py-3 text-sm text-[#A16207] dark:text-[#FDE68A]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Your organization requires MFA to be enabled.</span>
              </div>
            )}
          </div>
        )}

        {/* Setup — show QR code */}
        {state === 'setup' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
            </p>
            <div className="flex justify-center">
              <div className="rounded-xl border border-border bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCode} alt="MFA QR Code" className="h-48 w-48" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Can&apos;t scan? Enter this key manually:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono tracking-wider break-all">
                  {secret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(secret);
                    toast.success('Secret copied');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Enter the 6-digit code from your app:</p>
              <div className="flex gap-3">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  className="w-40 text-center font-mono text-lg tracking-widest"
                  autoComplete="one-time-code"
                />
                <Button
                  onClick={handleVerify}
                  disabled={loading || verifyCode.length !== 6}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Verify & Enable
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Backup codes — show once */}
        {state === 'backup_codes' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-[#F0FDF4] dark:bg-[#16A34A]/20 border border-[#BBF7D0] dark:border-[#16A34A] px-4 py-3 text-sm text-[#16A34A] dark:text-[#BBF7D0]">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Two-factor authentication has been enabled!</span>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Save your backup codes</p>
              <p className="text-xs text-muted-foreground">
                Store these codes in a safe place. Each code can only be used once. If you lose access to your authenticator app, you can use these codes to sign in.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-4">
              {backupCodes.map((code, i) => (
                <code key={i} className="rounded bg-background px-3 py-1.5 text-center text-sm font-mono tracking-wider">
                  {code}
                </code>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={copyBackupCodes} className="flex-1">
                <Copy className="mr-2 h-4 w-4" />
                Copy All
              </Button>
              <Button variant="outline" onClick={downloadBackupCodes} className="flex-1">
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        )}

        {/* Enabled — status */}
        {state === 'enabled' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-[#F0FDF4] dark:bg-[#16A34A]/20 border border-[#BBF7D0] dark:border-[#16A34A] px-4 py-3 text-sm text-[#16A34A] dark:text-[#BBF7D0]">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Two-factor authentication is enabled</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Backup codes remaining</span>
              <span className={cn('font-medium', backupCodesRemaining <= 2 ? 'text-[#A16207]' : 'text-foreground')}>
                {backupCodesRemaining} of 10
              </span>
            </div>

            {/* Regen confirm */}
            {showRegenConfirm && (
              <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
                <p className="text-sm text-foreground">Enter your password to regenerate backup codes:</p>
                <Input
                  type="password"
                  value={regenPassword}
                  onChange={(e) => setRegenPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleRegenCodes} disabled={loading || !regenPassword}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Regenerate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowRegenConfirm(false); setRegenPassword(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Disable confirm */}
            {showDisableConfirm && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                <p className="text-sm text-foreground">Enter your password to disable MFA:</p>
                <Input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={handleDisable} disabled={loading || !disablePassword}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Disable MFA
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowDisableConfirm(false); setDisablePassword(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Footer actions */}
      {state === 'idle' && (
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button onClick={handleStartSetup} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Enable Two-Factor Authentication
          </Button>
        </CardFooter>
      )}
      {state === 'setup' && (
        <CardFooter className="justify-start border-t border-border pt-6">
          <Button variant="outline" onClick={() => { setState('idle'); setError(''); setVerifyCode(''); }}>
            Cancel
          </Button>
        </CardFooter>
      )}
      {state === 'backup_codes' && (
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button onClick={() => setState('enabled')}>
            Done
          </Button>
        </CardFooter>
      )}
      {state === 'enabled' && !showDisableConfirm && !showRegenConfirm && (
        <CardFooter className="justify-between border-t border-border pt-6">
          <Button variant="outline" onClick={() => setShowRegenConfirm(true)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Regenerate Backup Codes
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setShowDisableConfirm(true)}>
            <ShieldOff className="mr-2 h-4 w-4" />
            Disable MFA
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export default function ProfileSettingsPage() {
  const { data: user, isLoading } = useCurrentUser();
  const updateProfile = useUpdateProfile();

  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [nameInitialized, setNameInitialized] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Initialize name from user data
  if (user && !nameInitialized) {
    setName(user.name);
    setTimezone(user.timezone || 'UTC');
    setPhoneNumber(user.phone_number || '');
    setNameInitialized(true);
  }

  async function handleSaveName() {
    if (!name.trim()) return;
    try {
      await updateProfile.mutateAsync({ name: name.trim(), timezone, phone_number: phoneNumber.trim() || undefined });
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    }
  }

  async function handleSelectPreset(url: string) {
    try {
      await updateProfile.mutateAsync({ avatar_url: url });
      setAvatarPickerOpen(false);
      toast.success('Avatar updated');
    } catch {
      toast.error('Failed to update avatar');
    }
  }

  async function handleUploadPhoto(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File must be under 2MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('File must be an image');
      return;
    }

    setUploading(true);
    try {
      // Upload file to API (proxied to MinIO)
      const formData = new FormData();
      formData.append('file', file);

      const session = await fetch('/api/auth/session').then((r) => r.json());
      const res = await fetch('/api/v1/storage/avatar', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.accessToken}`,
          'X-Tenant-Slug': session?.tenantSlug || 'platform',
        },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();

      await updateProfile.mutateAsync({ avatar_url: url });
      toast.success('Photo uploaded');
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await api.post('/api/v1/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err?.body?.detail || err.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleRemoveAvatar() {
    try {
      await updateProfile.mutateAsync({ avatar_url: null });
      toast.success('Avatar removed');
    } catch {
      toast.error('Failed to remove avatar');
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const isDirty = name.trim() !== user.name || timezone !== ((user as any).timezone || 'UTC') || phoneNumber.trim() !== ((user as any).phone_number || '');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Avatar Section */}
      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <UserAvatar
              name={user.name}
              imageUrl={user.avatar_url}
              size="xl"
            />
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAvatarPickerOpen(true)}
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Choose Avatar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="mr-2 h-4 w-4" />
                  )}
                  Upload Photo
                </Button>
                {user.avatar_url && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveAvatar}
                    disabled={updateProfile.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Choose a predefined avatar or upload a custom photo (max 2MB)
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadPhoto(file);
              e.target.value = '';
            }}
          />
        </CardContent>
      </Card>

      {/* Profile Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Timezone</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {(() => {
                try {
                  return Intl.supportedValuesOf('timeZone').map((tz: string) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                  ));
                } catch {
                  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo',
                    'Asia/Singapore', 'Australia/Sydney'].map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                  ));
                }
              })()}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+91 9876543210"
                className="pl-9"
                maxLength={20}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Used for voice call and SMS escalation notifications. Include country code (e.g. +91).
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Email</label>
            <Input value={user.email} disabled />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Role</label>
            <Input
              value={user.roles?.[0] === 'tenant_admin' ? 'Admin' : user.roles?.[0] || 'Agent'}
              disabled
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button
            onClick={handleSaveName}
            disabled={updateProfile.isPending || !isDirty}
          >
            {updateProfile.isPending ? (
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

      {/* Change Password Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Current Password</label>
            <div className="relative">
              <Input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                tabIndex={-1}
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">New Password</label>
            <div className="relative">
              <Input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowNewPassword(!showNewPassword)}
                tabIndex={-1}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Confirm New Password</label>
            <div className="relative">
              <Input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-border pt-6">
          <Button
            onClick={handleChangePassword}
            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
          >
            {changingPassword ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Changing...
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Change Password
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* MFA Setup Section */}
      <MfaSetupCard user={user} />

      {/* Avatar Picker Dialog */}
      <Dialog open={avatarPickerOpen} onClose={() => setAvatarPickerOpen(false)}>
        <DialogContent className="max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Choose an Avatar</DialogTitle>
            <DialogClose onClose={() => setAvatarPickerOpen(false)} />
          </DialogHeader>

          {/* Avatar grid */}
          <div className="grid grid-cols-4 gap-4 p-6">
            {AVATAR_PRESETS.map((preset) => {
              const isSelected = user.avatar_url === preset.url;
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.url)}
                  disabled={updateProfile.isPending}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl p-3 transition-all hover:bg-muted/50',
                    isSelected && 'ring-2 ring-[#FF6B2B] bg-[rgba(255,107,43,0.05)]',
                  )}
                >
                  <img
                    src={preset.url}
                    alt={preset.label}
                    className="h-16 w-16 rounded-full"
                  />
                  <span className="text-xs text-muted-foreground">{preset.label}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
