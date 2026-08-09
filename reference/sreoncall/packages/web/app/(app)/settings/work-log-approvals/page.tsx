'use client';

import { useState, useEffect } from 'react';
import { Loader2, Trash2, Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useWorkLogSettings, useUpdateWorkLogSettings, type WorkLogApprover } from '@/lib/hooks/useWorkLogSettings';
import { useUsers, type TenantUser } from '@/lib/hooks/useUsers';
import { useProjects, type Project } from '@/lib/hooks/useProjects';

export default function WorkLogApprovalSettingsPage() {
  const { data: settings, isLoading } = useWorkLogSettings();
  const updateSettings = useUpdateWorkLogSettings();
  const { data: usersData } = useUsers();
  const { data: projectsData } = useProjects();

  // useUsers returns TenantUser[] directly; useProjects returns ProjectsResponse with .data
  const users: TenantUser[] = usersData ?? [];
  const projects: Project[] = projectsData?.data ?? [];

  const [approvers, setApprovers] = useState<WorkLogApprover[]>([]);
  const [digestDays, setDigestDays] = useState(3);
  const [autoApproveMinutes, setAutoApproveMinutes] = useState(0);
  const [slaDays, setSlaDays] = useState(0);
  const [slaAction, setSlaAction] = useState<string>('notify_admin');

  // Add approver form state
  const [newUserId, setNewUserId] = useState('');
  const [newScope, setNewScope] = useState<'tenant' | 'project'>('tenant');
  const [newProjectId, setNewProjectId] = useState('');

  // Sync from loaded settings
  useEffect(() => {
    if (settings) {
      setApprovers(settings.approvers || []);
      setDigestDays(settings.digest_interval_days);
      setAutoApproveMinutes(settings.auto_approve_threshold_minutes);
      setSlaDays(settings.approval_sla_days);
      setSlaAction(settings.approval_sla_action);
    }
  }, [settings]);

  function addApprover() {
    if (!newUserId) return;
    // Check for duplicates
    const exists = approvers.some(
      (a) => a.user_id === newUserId && a.scope === newScope && (newScope === 'tenant' || a.project_id === newProjectId),
    );
    if (exists) { toast.error('Approver already added'); return; }
    const approver: WorkLogApprover = { user_id: newUserId, scope: newScope };
    if (newScope === 'project' && newProjectId) approver.project_id = newProjectId;
    setApprovers([...approvers, approver]);
    setNewUserId('');
    setNewProjectId('');
  }

  function removeApprover(index: number) {
    setApprovers(approvers.filter((_, i) => i !== index));
  }

  async function handleSave() {
    try {
      await updateSettings.mutateAsync({
        approvers,
        digest_interval_days: digestDays,
        auto_approve_threshold_minutes: autoApproveMinutes,
        approval_sla_days: slaDays,
        approval_sla_action: slaAction as 'escalate' | 'auto_approve' | 'notify_admin',
      });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    }
  }

  // Helper to get user name by ID
  function getUserName(userId: string): string {
    const user = users.find((u) => u.id === userId);
    return user?.name || user?.email || userId.slice(-8);
  }

  function getProjectName(projectId: string): string {
    const project = projects.find((p) => p.id === projectId);
    return project?.name || projectId.slice(-8);
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Work Log Approval Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure who can approve work logs and how approval reminders work.
        </p>
      </div>

      {/* Approvers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Designated Approvers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {approvers.length > 0 ? (
            <div className="space-y-2">
              {approvers.map((a, i) => (
                <div key={`${a.user_id}-${a.scope}-${i}`} className="flex items-center justify-between rounded-md border border-input px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{getUserName(a.user_id)}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      a.scope === 'tenant' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {a.scope === 'tenant' ? 'All Projects' : getProjectName(a.project_id || '')}
                    </span>
                  </div>
                  <button onClick={() => removeApprover(i)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No approvers configured. Work logs will remain pending until manually approved.</p>
          )}

          {/* Add approver form */}
          <div className="flex items-end gap-2 pt-2 border-t border-input">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">User</label>
              <Select value={newUserId} onChange={(e) => setNewUserId(e.target.value)}>
                <option value="">Select user...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </Select>
            </div>
            <div className="w-32 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Scope</label>
              <Select value={newScope} onChange={(e) => setNewScope(e.target.value as 'tenant' | 'project')}>
                <option value="tenant">All Projects</option>
                <option value="project">Specific Project</option>
              </Select>
            </div>
            {newScope === 'project' && (
              <div className="w-40 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Project</label>
                <Select value={newProjectId} onChange={(e) => setNewProjectId(e.target.value)}>
                  <option value="">Select...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
            )}
            <Button size="sm" onClick={addApprover} disabled={!newUserId}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1.5">
            <Settings className="h-4 w-4" />
            Approval Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Digest Email Interval (days)</label>
              <Input type="number" min={1} max={30} value={digestDays} onChange={(e) => setDigestDays(parseInt(e.target.value) || 3)} />
              <p className="text-xs text-muted-foreground">How often to email approvers with pending work logs</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Auto-Approve Threshold (minutes)</label>
              <Input type="number" min={0} value={autoApproveMinutes} onChange={(e) => setAutoApproveMinutes(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground">Work logs at or below this duration are auto-approved. 0 = disabled.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Approval SLA (days)</label>
              <Input type="number" min={0} value={slaDays} onChange={(e) => setSlaDays(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground">If pending longer than this, trigger the SLA action below. 0 = disabled.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">SLA Action</label>
              <Select value={slaAction} onChange={(e) => setSlaAction(e.target.value)}>
                <option value="notify_admin">Notify Approvers</option>
                <option value="auto_approve">Auto-Approve</option>
                <option value="escalate">Escalate</option>
              </Select>
              <p className="text-xs text-muted-foreground">What happens when approval SLA is breached</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
