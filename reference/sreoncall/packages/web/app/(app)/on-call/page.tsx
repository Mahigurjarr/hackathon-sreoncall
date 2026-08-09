'use client';

import { useState, useMemo } from 'react';
import {
  Phone, Plus, ChevronLeft, ChevronRight, User, Clock, CalendarDays,
  Loader2, X, Trash2, ShieldAlert, AlertCircle, Pencil, Users, Layers, Power,
  Calendar as CalendarIcon, LayoutList, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { UserMultiSelect } from '@/components/shared/UserMultiSelect';
import { UserSelect } from '@/components/shared/UserSelect';
import { cn } from '@/lib/utils';
import {
  useOnCallSchedules,
  useCreateOnCallSchedule,
  useUpdateOnCallSchedule,
  useDeleteOnCallSchedule,
  useCurrentOnCall,
  useAddOverride,
  useDeleteOverride,
  type OnCallSchedule,
  type ScheduleLayer,
  type ScheduleOverride,
  type RotationType,
} from '@/lib/hooks/useOnCallSchedules';
import { useUsers, type TenantUser } from '@/lib/hooks/useUsers';
import { useEscalationPolicies } from '@/lib/hooks/useEscalationPolicies';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata',
  'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney',
];

const LAYER_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-indigo-500',
];

const LAYER_COLORS_LIGHT = [
  'bg-blue-200', 'bg-emerald-200', 'bg-amber-200', 'bg-purple-200',
  'bg-rose-200', 'bg-cyan-200', 'bg-orange-200', 'bg-indigo-200',
];

const LAYER_ROW_BG = [
  'bg-blue-500/5', 'bg-emerald-500/5', 'bg-amber-500/5', 'bg-purple-500/5',
  'bg-rose-500/5', 'bg-cyan-500/5', 'bg-orange-500/5', 'bg-indigo-500/5',
];

const LAYER_RING = [
  'ring-blue-500/40', 'ring-emerald-500/40', 'ring-amber-500/40', 'ring-purple-500/40',
  'ring-rose-500/40', 'ring-cyan-500/40', 'ring-orange-500/40', 'ring-indigo-500/40',
];

const LAYER_TEXT = [
  'text-[#2563EB] dark:text-blue-400', 'text-[#16A34A] dark:text-emerald-400',
  'text-[#A16207] dark:text-amber-400', 'text-[#7C3AED] dark:text-purple-400',
  'text-rose-600 dark:text-rose-400', 'text-cyan-600 dark:text-cyan-400',
  'text-[#EA580C] dark:text-orange-400', 'text-indigo-600 dark:text-indigo-400',
];

function humanizeSecs(s: number): string {
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// ─── Who-is-on-call badge ──────────────────────────────────────────────────────

function OnCallBadge({
  scheduleId,
  users,
}: {
  scheduleId: string;
  users: TenantUser[];
}) {
  const { data: current, isLoading } = useCurrentOnCall(scheduleId);

  if (isLoading) return <span className="text-xs text-muted-foreground">Loading…</span>;
  if (!current || !current.current_user_id) {
    return <span className="text-xs text-muted-foreground italic">No one on-call</span>;
  }

  const user = users.find((u) => u.id === current.current_user_id);
  const displayName = user?.name ?? current.current_user_id.slice(-8);

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-foreground truncate max-w-[160px]">
        {displayName}
      </span>
      {user && (
        <span className="text-xs text-muted-foreground truncate max-w-[160px]">{user.email}</span>
      )}
      {current.override_active && (
        <span className="text-xs text-[#A16207] dark:text-amber-400">Override active</span>
      )}
    </div>
  );
}

// ─── Current On-Call Widget ────────────────────────────────────────────────────

function CurrentOnCallWidget({ schedule, users }: { schedule: OnCallSchedule; users: TenantUser[] }) {
  const { data: current, isLoading } = useCurrentOnCall(schedule.id);

  if (isLoading) return null;

  const primaryUser = current?.current_user_id ? users.find((u) => u.id === current.current_user_id) : null;
  const nextUser = current?.next_user_id ? users.find((u) => u.id === current.next_user_id) : null;

  const handoffIn = current?.handoff_in_seconds;
  const handoffStr = handoffIn != null
    ? handoffIn < 3600 ? `${Math.round(handoffIn / 60)}m` : `${Math.round(handoffIn / 3600)}h ${Math.round((handoffIn % 3600) / 60)}m`
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{schedule.name}</span>
        {current?.override_active && (
          <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">Override</span>
        )}
      </div>

      {/* Primary */}
      <div className="flex items-center gap-3 mb-2">
        {primaryUser?.avatar_url ? (
          <img src={primaryUser.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
            {primaryUser?.name?.charAt(0) || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{primaryUser?.name || 'No one on-call'}</p>
          <p className="text-xs text-muted-foreground truncate">{primaryUser?.email || ''}</p>
        </div>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">PRIMARY</span>
      </div>

      {/* Next / Secondary */}
      {nextUser && (
        <div className="flex items-center gap-3 mb-2 opacity-70">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ml-1">
            {nextUser.name?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{nextUser.name}</p>
          </div>
          <span className="text-[10px] text-muted-foreground">NEXT</span>
        </div>
      )}

      {/* Handoff timer */}
      {handoffStr && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Handoff in <span className="font-mono font-semibold text-foreground">{handoffStr}</span></span>
        </div>
      )}
    </div>
  );
}

// ─── Coverage Timeline ─────────────────────────────────────────────────────────

function CoverageTimeline({ layers }: { layers: ScheduleLayer[] }) {
  const HOURS = [0, 6, 12, 18];

  function timeToPercent(time: string): number {
    const [h, m] = time.split(':').map(Number) as [number, number];
    return ((h * 60 + m) / 1440) * 100;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">24h Coverage</p>
      <div className="relative h-8 rounded-md bg-muted/50 border border-border overflow-hidden">
        {/* Hour markers */}
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 border-l border-border/50"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {/* Layer segments */}
        {layers.map((layer, idx) => {
          const startPct = timeToPercent(layer.start_time || '09:00');
          const endPct = timeToPercent(layer.end_time || '17:00');
          const colorClass = LAYER_COLORS_LIGHT[idx % LAYER_COLORS_LIGHT.length];

          if (startPct <= endPct) {
            return (
              <div
                key={layer.id}
                className={cn('absolute top-0.5 bottom-0.5 rounded-sm opacity-80', colorClass)}
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                title={`${layer.name}: ${layer.start_time} - ${layer.end_time}`}
              />
            );
          } else {
            // Overnight: two segments
            return (
              <div key={layer.id}>
                <div
                  className={cn('absolute top-0.5 bottom-0.5 rounded-sm opacity-80', colorClass)}
                  style={{ left: `${startPct}%`, width: `${100 - startPct}%` }}
                  title={`${layer.name}: ${layer.start_time} - ${layer.end_time}`}
                />
                <div
                  className={cn('absolute top-0.5 bottom-0.5 rounded-sm opacity-80', colorClass)}
                  style={{ left: '0%', width: `${endPct}%` }}
                  title={`${layer.name}: ${layer.start_time} - ${layer.end_time}`}
                />
              </div>
            );
          }
        })}
      </div>
      {/* Hour labels */}
      <div className="relative h-4">
        {HOURS.map((h) => (
          <span
            key={h}
            className="absolute text-[10px] text-muted-foreground -translate-x-1/2"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
        <span
          className="absolute text-[10px] text-muted-foreground"
          style={{ right: 0 }}
        >
          24
        </span>
      </div>
      {/* Color legend */}
      {layers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {layers.map((layer, idx) => (
            <div key={layer.id} className="flex items-center gap-1">
              <div className={cn('h-2.5 w-2.5 rounded-sm', LAYER_COLORS[idx % LAYER_COLORS.length])} />
              <span className="text-[10px] text-muted-foreground">{layer.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create schedule dialog (simplified) ────────────────────────────────────

function CreateScheduleDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [escalationPolicyId, setEscalationPolicyId] = useState('');
  // Layer fields
  const [layerName, setLayerName] = useState('Primary');
  const [rotationType, setRotationType] = useState<'daily' | 'weekly' | 'monthly' | 'custom_hours'>('weekly');
  const [layerUsers, setLayerUsers] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:00');

  const { data: allUsers = [] } = useUsers({ status: 'active,invited' });
  const { data: escalationPolicies = [] } = useEscalationPolicies({ status: 'active' });
  const createMutation = useCreateOnCallSchedule();

  if (!open) return null;

  function resetForm() {
    setStep(1); setName(''); setDescription(''); setTimezone('UTC'); setEscalationPolicyId('');
    setLayerName('Primary'); setRotationType('weekly'); setLayerUsers([]); setStartTime('09:00'); setEndTime('09:00');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const layers = layerUsers.length > 0
        ? [{ name: layerName.trim() || 'Primary', rotation_type: rotationType, users: layerUsers, start_time: startTime, end_time: endTime, timezone }]
        : undefined;
      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        timezone,
        layers,
        escalation_policy_id: escalationPolicyId || null,
      });
      toast.success(`Schedule "${name}" created`);
      resetForm();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create schedule');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-card-foreground">Create On-Call Schedule</h2>
          <button onClick={() => { resetForm(); onClose(); }} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 pt-4">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${step >= 1 ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>1</span>
          <div className="h-px flex-1 bg-border" />
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${step >= 2 ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>2</span>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {step === 1 && (
            <>
              <p className="text-xs text-muted-foreground">Step 1: Schedule details</p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Schedule Name *</label>
                <Input placeholder="Primary On-Call" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Description</label>
                <Input placeholder="Optional description" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Timezone</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Escalation Policy</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={escalationPolicyId} onChange={(e) => setEscalationPolicyId(e.target.value)}>
                  <option value="">None</option>
                  {escalationPolicies.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
                <Button type="button" disabled={!name.trim()} onClick={() => setStep(2)}>Next: Add Layer</Button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-xs text-muted-foreground">Step 2: Configure first rotation layer (optional)</p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Layer Name</label>
                <Input placeholder="Primary" value={layerName} onChange={(e) => setLayerName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Rotation</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={rotationType} onChange={(e) => setRotationType(e.target.value as any)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom_hours">Custom Hours</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Start Time</label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">End Time</label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Members</label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {allUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setLayerUsers((prev) => prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id])}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                        layerUsers.includes(u.id)
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary/30'
                      }`}
                    >
                      {u.name}
                    </button>
                  ))}
                </div>
                {layerUsers.length > 0 && <p className="text-[11px] text-muted-foreground">{layerUsers.length} member{layerUsers.length !== 1 ? 's' : ''} selected</p>}
              </div>
              <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
                <div className="flex gap-2">
                  <Button type="submit" variant="outline" onClick={() => { setLayerUsers([]); }} disabled={createMutation.isPending}>
                    Skip &amp; Create
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || layerUsers.length === 0}>
                    {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : 'Create Schedule'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

// ─── Edit schedule dialog (metadata only) ──────────────────────────────────

function EditScheduleDialog({
  schedule,
  open,
  onClose,
}: {
  schedule: OnCallSchedule;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(schedule.name);
  const [description, setDescription] = useState(schedule.description ?? '');
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [escalationPolicyId, setEscalationPolicyId] = useState(schedule.escalation_policy_id ?? '');
  const updateMutation = useUpdateOnCallSchedule();
  const { data: escalationPolicies = [] } = useEscalationPolicies({ status: 'active' });

  const [lastId, setLastId] = useState(schedule.id);
  if (schedule.id !== lastId) {
    setLastId(schedule.id);
    setName(schedule.name);
    setDescription(schedule.description ?? '');
    setTimezone(schedule.timezone);
    setEscalationPolicyId(schedule.escalation_policy_id ?? '');
  }

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await updateMutation.mutateAsync({
        id: schedule.id,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          timezone,
          escalation_policy_id: escalationPolicyId || null,
        },
      });
      toast.success('Schedule updated');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update schedule');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-card-foreground">Edit Schedule</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Schedule Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Timezone</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Escalation Policy</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              value={escalationPolicyId}
              onChange={(e) => setEscalationPolicyId(e.target.value)}
            >
              <option value="">None</option>
              {escalationPolicies.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                : 'Save Changes'
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Layer dialog ──────────────────────────────────────────────────────────

function AddLayerDialog({
  schedule,
  open,
  onClose,
  users,
}: {
  schedule: OnCallSchedule;
  open: boolean;
  onClose: () => void;
  users: TenantUser[];
}) {
  const [layerName, setLayerName] = useState('');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [rotationType, setRotationType] = useState<RotationType>('weekly');
  const updateMutation = useUpdateOnCallSchedule();

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!layerName.trim()) return;
    try {
      const existingLayers = schedule.layers.map((l) => ({
        id: l.id,
        name: l.name,
        rotation_type: l.rotation_type,
        users: l.users,
        start_time: l.start_time,
        end_time: l.end_time,
        timezone: l.timezone,
      }));
      await updateMutation.mutateAsync({
        id: schedule.id,
        input: {
          layers: [
            ...existingLayers,
            {
              name: layerName.trim(),
              rotation_type: rotationType,
              users: userIds,
              start_time: startTime,
              end_time: endTime,
            },
          ],
        },
      });
      toast.success(`Layer "${layerName}" added`);
      setLayerName('');
      setUserIds([]);
      setStartTime('09:00');
      setEndTime('17:00');
      setRotationType('weekly');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add layer');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-card-foreground">Add Layer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col overflow-y-auto flex-1">
          <div className="px-6 py-4 space-y-4 flex-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Layer Name *</label>
              <Input placeholder="e.g. Business Hours" value={layerName} onChange={(e) => setLayerName(e.target.value)} required />
            </div>

            <div className="relative">
              <UserMultiSelect
                users={users}
                selectedIds={userIds}
                onChange={setUserIds}
                label="Members in rotation"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Start Time</label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">End Time</label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Rotation</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={rotationType}
                onChange={(e) => setRotationType(e.target.value as RotationType)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {userIds.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Rotation order: {userIds.map((id, i) => {
                  const u = users.find((x) => x.id === id);
                  return (
                    <span key={id}>
                      {i > 0 && ' \u2192 '}
                      <span className="font-medium text-foreground">{u?.name ?? id.slice(-6)}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={updateMutation.isPending || !layerName.trim()}>
              {updateMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</>
                : 'Add Layer'
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Layer dialog ─────────────────────────────────────────────────────────

function EditLayerDialog({
  schedule,
  layer,
  open,
  onClose,
  users,
}: {
  schedule: OnCallSchedule;
  layer: ScheduleLayer;
  open: boolean;
  onClose: () => void;
  users: TenantUser[];
}) {
  const [layerName, setLayerName] = useState(layer.name);
  const [userIds, setUserIds] = useState<string[]>(layer.users);
  const [startTime, setStartTime] = useState(layer.start_time || '09:00');
  const [endTime, setEndTime] = useState(layer.end_time || '17:00');
  const [rotationType, setRotationType] = useState<RotationType>(layer.rotation_type);
  const updateMutation = useUpdateOnCallSchedule();

  const [lastId, setLastId] = useState(layer.id);
  if (layer.id !== lastId) {
    setLastId(layer.id);
    setLayerName(layer.name);
    setUserIds(layer.users);
    setStartTime(layer.start_time || '09:00');
    setEndTime(layer.end_time || '17:00');
    setRotationType(layer.rotation_type);
  }

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!layerName.trim()) return;
    try {
      const updatedLayers = schedule.layers.map((l) => {
        if (l.id === layer.id) {
          return {
            id: l.id,
            name: layerName.trim(),
            rotation_type: rotationType,
            users: userIds,
            start_time: startTime,
            end_time: endTime,
            timezone: l.timezone,
          };
        }
        return {
          id: l.id,
          name: l.name,
          rotation_type: l.rotation_type,
          users: l.users,
          start_time: l.start_time,
          end_time: l.end_time,
          timezone: l.timezone,
        };
      });
      await updateMutation.mutateAsync({
        id: schedule.id,
        input: { layers: updatedLayers },
      });
      toast.success('Layer updated');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update layer');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-card-foreground">Edit Layer</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col overflow-y-auto flex-1">
          <div className="px-6 py-4 space-y-4 flex-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Layer Name *</label>
              <Input value={layerName} onChange={(e) => setLayerName(e.target.value)} required />
            </div>

            <div className="relative">
              <UserMultiSelect
                users={users}
                selectedIds={userIds}
                onChange={setUserIds}
                label="Members in rotation"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Start Time</label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">End Time</label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Rotation</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={rotationType}
                onChange={(e) => setRotationType(e.target.value as RotationType)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {userIds.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Rotation order: {userIds.map((id, i) => {
                  const u = users.find((x) => x.id === id);
                  return (
                    <span key={id}>
                      {i > 0 && ' \u2192 '}
                      <span className="font-medium text-foreground">{u?.name ?? id.slice(-6)}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={updateMutation.isPending || !layerName.trim()}>
              {updateMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                : 'Save Changes'
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Override dialog ───────────────────────────────────────────────────────────

function AddOverrideDialog({
  scheduleId,
  open,
  onClose,
  users,
  layers,
  scheduleTimezone,
  prefillStart,
  prefillEnd,
  prefillLayerId,
}: {
  scheduleId: string;
  open: boolean;
  onClose: () => void;
  users: TenantUser[];
  layers: ScheduleLayer[];
  scheduleTimezone: string;
  prefillStart?: string;
  prefillEnd?: string;
  prefillLayerId?: string;
}) {
  const [userId, setUserId] = useState('');
  const [layerId, setLayerId] = useState(prefillLayerId ?? '');
  const [start, setStart] = useState(prefillStart ?? '');
  const [end, setEnd] = useState(prefillEnd ?? '');
  const [reason, setReason] = useState('');
  const addMutation = useAddOverride();

  if (!open) return null;

  // Convert datetime-local value to ISO string in the schedule's timezone
  function localInputToIso(val: string): string {
    // val is like "2026-03-11T14:00" — user intends this in the schedule timezone
    // Parse the components and convert to UTC
    const [datePart, timePart] = val.split('T');
    if (!datePart || !timePart) return val;
    const [y, m, d] = datePart.split('-').map(Number) as [number, number, number];
    const [h, min] = timePart.split(':').map(Number) as [number, number];
    const utcMs = clientLocalToUtcMs(y, m, d, h, min, scheduleTimezone);
    return new Date(utcMs).toISOString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !start || !end || !layerId) return;
    try {
      await addMutation.mutateAsync({
        scheduleId,
        user_id: userId,
        layer_id: layerId,
        start: localInputToIso(start),
        end: localInputToIso(end),
        reason: reason || undefined,
      });
      toast.success('Override added');
      setUserId(''); setLayerId(''); setStart(''); setEnd(''); setReason('');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add override');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-card-foreground">Add Override</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Layer *</label>
            <select
              value={layerId}
              onChange={(e) => setLayerId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              required
            >
              <option value="">Select layer…</option>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">On-call user *</label>
            <UserSelect
              users={users}
              value={userId}
              onChange={setUserId}
              placeholder="Select who covers this slot…"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">Times in {scheduleTimezone}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Start *</label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">End *</label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Reason</label>
            <Input placeholder="e.g. vacation, sick leave" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={addMutation.isPending || !userId || !start || !end || !layerId}>
              {addMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</>
                : 'Add Override'
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Override dialog (delete + re-create) ───────────────────────────────

/** Convert a UTC ISO date to datetime-local string in a specific timezone */
/** Format a UTC ISO date for display in a given timezone (e.g. "Mar 11, 14:00") */
function formatInTz(isoStr: string, tz: string): string {
  const d = new Date(isoStr);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(d);
}

function utcToLocalInput(isoStr: string, tz: string): string {
  const d = new Date(isoStr);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = p['hour'] === '24' ? '00' : p['hour'];
  return `${p['year']}-${p['month']}-${p['day']}T${hour}:${p['minute']}`;
}

function EditOverrideDialog({
  scheduleId,
  override,
  open,
  onClose,
  users,
  layers,
  scheduleTimezone,
}: {
  scheduleId: string;
  override: ScheduleOverride;
  open: boolean;
  onClose: () => void;
  users: TenantUser[];
  layers: ScheduleLayer[];
  scheduleTimezone: string;
}) {
  const [userId, setUserId] = useState(override.user_id);
  const [layerId, setLayerId] = useState(override.layer_id ?? '');
  const [start, setStart] = useState(utcToLocalInput(override.start, scheduleTimezone));
  const [end, setEnd] = useState(utcToLocalInput(override.end, scheduleTimezone));
  const [reason, setReason] = useState(override.reason ?? '');
  const addMutation = useAddOverride();
  const deleteMutation = useDeleteOverride();
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  function localInputToIso(val: string): string {
    const [datePart, timePart] = val.split('T');
    if (!datePart || !timePart) return val;
    const [y, m, d] = datePart.split('-').map(Number) as [number, number, number];
    const [h, min] = timePart.split(':').map(Number) as [number, number];
    const utcMs = clientLocalToUtcMs(y, m, d, h, min, scheduleTimezone);
    return new Date(utcMs).toISOString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !start || !end || !layerId) return;
    setSaving(true);
    try {
      // Delete old then create new
      await deleteMutation.mutateAsync({ scheduleId, overrideId: override.id });
      await addMutation.mutateAsync({
        scheduleId,
        user_id: userId,
        layer_id: layerId,
        start: localInputToIso(start),
        end: localInputToIso(end),
        reason: reason || undefined,
      });
      toast.success('Override updated');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update override');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-card-foreground">Edit Override</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Layer *</label>
            <select
              value={layerId}
              onChange={(e) => setLayerId(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              required
            >
              <option value="">Select layer…</option>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">On-call user *</label>
            <UserSelect
              users={users}
              value={userId}
              onChange={setUserId}
              placeholder="Select who covers this slot…"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">Times in {scheduleTimezone}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Start *</label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">End *</label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Reason</label>
            <Input placeholder="e.g. vacation, sick leave" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !userId || !start || !end || !layerId}>
              {saving
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                : 'Save Changes'
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Overrides panel ──────────────────────────────────────────────────────────

function OverridesPanel({
  schedule,
  users,
  scheduleTimezone,
}: {
  schedule: OnCallSchedule;
  users: TenantUser[];
  scheduleTimezone: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingOverride, setEditingOverride] = useState<ScheduleOverride | null>(null);
  const deleteMutation = useDeleteOverride();

  const now = new Date();
  const active = schedule.overrides.filter((o) => new Date(o.start) <= now && new Date(o.end) >= now);
  const upcoming = schedule.overrides.filter((o) => new Date(o.start) > now);
  const past = schedule.overrides.filter((o) => new Date(o.end) < now);

  async function handleDelete(overrideId: string) {
    try {
      await deleteMutation.mutateAsync({ scheduleId: schedule.id, overrideId });
      toast.success('Override removed');
    } catch {
      toast.error('Failed to remove override');
    }
  }

  function OverrideRow({ o }: { o: ScheduleOverride }) {
    const user = users.find((u) => u.id === o.user_id);
    return (
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {user?.name ?? o.user_id.slice(-8)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatInTz(o.start, scheduleTimezone)} {'\u2192'} {formatInTz(o.end, scheduleTimezone)}
            {o.reason && ` \u00b7 ${o.reason}`}
          </p>
        </div>
        <div className="ml-2 flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setEditingOverride(o)}
            title="Edit override"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => handleDelete(o.id)}
            disabled={deleteMutation.isPending}
            title="Delete override"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Overrides</h3>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Override
        </Button>
      </div>

      {active.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-[#A16207] dark:text-amber-400">Active</p>
          {active.map((o) => <OverrideRow key={o.id} o={o} />)}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Upcoming</p>
          {upcoming.map((o) => <OverrideRow key={o.id} o={o} />)}
        </div>
      )}
      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Past</p>
          {past.slice(0, 3).map((o) => <OverrideRow key={o.id} o={o} />)}
        </div>
      )}
      {schedule.overrides.length === 0 && (
        <p className="text-sm text-muted-foreground">No overrides set.</p>
      )}

      <AddOverrideDialog
        scheduleId={schedule.id}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        users={users}
        layers={schedule.layers}
        scheduleTimezone={schedule.timezone || 'UTC'}
      />
      {editingOverride && (
        <EditOverrideDialog
          scheduleId={schedule.id}
          override={editingOverride}
          open={!!editingOverride}
          onClose={() => setEditingOverride(null)}
          users={users}
          layers={schedule.layers}
          scheduleTimezone={schedule.timezone || 'UTC'}
        />
      )}
    </div>
  );
}

// ─── Weekly calendar view ──────────────────────────────────────────────────────

/**
 * Client-side rotation computation that mirrors the backend logic.
 * Returns the on-call user ID for a given layer at a specific point in time.
 */
function computeLayerUserForDate(
  layer: ScheduleLayer,
  scheduleTz: string,
  date: Date,
): string | null {
  const userIds = layer.users;
  if (userIds.length === 0) return null;

  const tz = layer.timezone || scheduleTz || 'UTC';
  const [sh, sm] = (layer.start_time || '09:00').split(':').map(Number) as [number, number];
  const nowMs = date.getTime();

  if (layer.rotation_type === 'weekly') {
    // Weekly rotation: handoff on Monday (weekday 1) at start_time
    const handoffWeekday = 1; // Monday
    const epochRef = clientFirstHandoffMs(handoffWeekday, sh, sm, tz);
    const msPerWeek = 7 * 86_400_000;
    const elapsed = nowMs - epochRef;
    const periodIdx = elapsed < 0 ? 0 : Math.floor(elapsed / msPerWeek);
    const userIdx = ((periodIdx % userIds.length) + userIds.length) % userIds.length;
    return userIds[userIdx] ?? null;
  }

  if (layer.rotation_type === 'daily') {
    const epochRef = clientFirstHandoffMs(0 /* Sunday — matches backend epochRef */, sh, sm, tz);
    const msPerDay = 86_400_000;
    const elapsed = nowMs - epochRef;
    const periodIdx = elapsed < 0 ? 0 : Math.floor(elapsed / msPerDay);
    const userIdx = ((periodIdx % userIds.length) + userIds.length) % userIds.length;
    return userIds[userIdx] ?? null;
  }

  if (layer.rotation_type === 'monthly') {
    const parts = clientTzParts(date, tz);
    const monthIndex = (parts.year - 1970) * 12 + (parts.month - 1);
    const userIdx = ((monthIndex % userIds.length) + userIds.length) % userIds.length;
    return userIds[userIdx] ?? null;
  }

  // custom_hours or fallback
  return userIds[0] ?? null;
}

/** Returns date components in the given timezone (mirrors backend tzParts). */
function clientTzParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(p['hour']!, 10);
  return {
    year:    parseInt(p['year']!, 10),
    month:   parseInt(p['month']!, 10),
    day:     parseInt(p['day']!, 10),
    weekday: weekdayMap[p['weekday']!] ?? 0,
    hour:    hour === 24 ? 0 : hour,
    minute:  parseInt(p['minute']!, 10),
  };
}

/** Converts local time in a timezone to UTC ms (mirrors backend localToUtcMs). */
function clientLocalToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number,
  tz: string,
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const proxyUtc = new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00.000Z`,
  );
  const actual = clientTzParts(proxyUtc, tz);
  const desiredMs = Date.UTC(year, month - 1, day, hour, minute);
  const actualMs  = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
  return proxyUtc.getTime() + (desiredMs - actualMs);
}

/** Mirrors backend firstHandoffAfterEpochMs. */
function clientFirstHandoffMs(
  handoffWeekday: number, handoffHour: number, handoffMinute: number, tz: string,
): number {
  let candidate = new Date(0);
  for (let i = 0; i < 8; i++) {
    const p = clientTzParts(candidate, tz);
    if (p.weekday === handoffWeekday) {
      const ts = clientLocalToUtcMs(p.year, p.month, p.day, handoffHour, handoffMinute, tz);
      if (ts >= 0) return ts;
    }
    candidate = new Date(candidate.getTime() + 86_400_000);
  }
  return 0;
}

function WeeklyCalendar({
  schedule,
  weekOffset,
  users,
  onEditLayer,
  onAddOverride,
  onEditOverride,
  onDeleteOverride,
}: {
  schedule: OnCallSchedule;
  weekOffset: number;
  users: TenantUser[];
  onEditLayer?: (layer: ScheduleLayer) => void;
  onAddOverride?: (prefillStart?: string, prefillEnd?: string, prefillLayerId?: string) => void;
  onEditOverride?: (override: ScheduleOverride) => void;
  onDeleteOverride?: (overrideId: string) => void;
}) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - TODAY_INDEX + weekOffset * 7);

  const layers = schedule.layers.filter((l) => l.users.length > 0);

  // Pre-compute day dates
  const dayDates = DAYS.map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  // Compute overrides that fall within this week
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekOverrides = schedule.overrides.filter((o) => {
    const oStart = new Date(o.start);
    const oEnd = new Date(o.end);
    return oStart < weekEnd && oEnd > weekStart;
  });

  // Group overrides by layer_id; unassigned go to all layers
  const overridesByLayer: Record<string, ScheduleOverride[]> = {};
  const globalOverrides: ScheduleOverride[] = [];
  for (const o of weekOverrides) {
    if (o.layer_id) {
      if (!overridesByLayer[o.layer_id]) overridesByLayer[o.layer_id] = [];
      overridesByLayer[o.layer_id].push(o);
    } else {
      globalOverrides.push(o);
    }
  }

  return (
    <div className="space-y-3">
      {/* Day header strip */}
      <div className="grid grid-cols-7 gap-1.5 pl-[116px]">
        {DAYS.map((day, i) => {
          const isToday = i === TODAY_INDEX && weekOffset === 0;
          return (
            <div key={day} className="text-center">
              <p className={cn(
                'text-[11px] font-semibold',
                isToday ? 'text-primary' : 'text-muted-foreground',
              )}>
                {day}
              </p>
              <div className={cn(
                'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium tabular-nums',
                isToday
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground',
              )}>
                {format(dayDates[i]!, 'd')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-layer swim lanes */}
      {layers.map((layer, layerIdx) => {
        const ci = layerIdx % LAYER_COLORS.length;

        // Pre-compute on-call user per day, with override check
        const layerOverrides = [...(overridesByLayer[layer.id] ?? []), ...globalOverrides];
        const tz = layer.timezone || schedule.timezone || 'UTC';
        const [lsH, lsM] = (layer.start_time || '09:00').split(':').map(Number) as [number, number];
        const [leH, leM] = (layer.end_time || '17:00').split(':').map(Number) as [number, number];
        const lsMin = lsH * 60 + lsM;
        const leMin = leH * 60 + leM;
        const midMin = lsMin <= leMin
          ? Math.floor((lsMin + leMin) / 2)
          : Math.floor(((lsMin + leMin + 1440) / 2) % 1440);

        type DayEntry = { user: TenantUser | null; isOverride: boolean; override?: ScheduleOverride };
        const dayEntries: DayEntry[] = dayDates.map((dayDate) => {
          // Compute layer window for this day
          const winStartMs = clientLocalToUtcMs(dayDate.getFullYear(), dayDate.getMonth() + 1, dayDate.getDate(), lsH, lsM, tz);
          const winEndMs = clientLocalToUtcMs(dayDate.getFullYear(), dayDate.getMonth() + 1, dayDate.getDate(), leH, leM, tz);
          const winStart = new Date(winStartMs);
          const winEnd = new Date(winEndMs > winStartMs ? winEndMs : winEndMs + 86400000);

          // Check if any override overlaps this day's layer window
          for (const o of layerOverrides) {
            const oStart = new Date(o.start);
            const oEnd = new Date(o.end);
            if (oStart < winEnd && oEnd > winStart) {
              return { user: users.find((u) => u.id === o.user_id) ?? null, isOverride: true, override: o };
            }
          }

          // Base rotation
          const probeDate = new Date(
            clientLocalToUtcMs(dayDate.getFullYear(), dayDate.getMonth() + 1, dayDate.getDate(), Math.floor(midMin / 60), midMin % 60, tz),
          );
          const userId = computeLayerUserForDate(layer, schedule.timezone, probeDate);
          return { user: userId ? users.find((u) => u.id === userId) ?? null : null, isOverride: false };
        });

        // Group consecutive days with same user + same override status into spans
        type Span = { user: TenantUser | null; isOverride: boolean; override?: ScheduleOverride; startIdx: number; endIdx: number };
        const spans: Span[] = [];
        for (let i = 0; i < 7; i++) {
          const entry = dayEntries[i]!;
          const prev = spans[spans.length - 1];
          if (prev && prev.user?.id === entry.user?.id && prev.isOverride === entry.isOverride && prev.override?.id === entry.override?.id) {
            prev.endIdx = i;
          } else {
            spans.push({ ...entry, startIdx: i, endIdx: i });
          }
        }

        return (
          <div key={layer.id}>
          <div className="flex items-stretch gap-2">
            {/* Layer label pill */}
            <div
              className={cn(
                'group/label flex w-[108px] shrink-0 flex-col justify-center rounded-lg px-3 py-2 transition-colors hover:bg-muted/60 cursor-pointer',
                LAYER_ROW_BG[ci],
              )}
              onClick={() => onEditLayer?.(layer)}
              title="Click to edit layer"
            >
              <div className="flex items-center gap-1.5">
                <div className={cn('h-2 w-2 shrink-0 rounded-full', LAYER_COLORS[ci])} />
                <p className={cn('text-xs font-semibold truncate', LAYER_TEXT[ci])}>{layer.name}</p>
              </div>
              <p className="text-[9px] text-muted-foreground tabular-nums mt-0.5 pl-3.5">
                {layer.start_time} – {layer.end_time}
              </p>
              {/* Edit hint on hover */}
              <div className="flex items-center gap-1 mt-1 pl-3.5 opacity-0 group-hover/label:opacity-100 transition-opacity">
                <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[8px] text-muted-foreground">Edit</span>
              </div>
            </div>

            {/* Continuous swim lane */}
            <div className={cn('relative flex-1 rounded-lg py-1.5 px-1', LAYER_ROW_BG[ci])}>
              {/* Today highlight column */}
              {weekOffset === 0 && (
                <div
                  className="absolute inset-y-0 rounded-md bg-primary/6 pointer-events-none"
                  style={{
                    left: `${(TODAY_INDEX / 7) * 100}%`,
                    width: `${100 / 7}%`,
                  }}
                />
              )}

              {/* User & override spans — merged pills across consecutive same-user days */}
              <div className="relative grid grid-cols-7 gap-1">
                {spans.map((span) => {
                  const colSpan = span.endIdx - span.startIdx + 1;
                  const user = span.user;
                  const initials = user
                    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                    : '\u2014';
                  const containsToday = weekOffset === 0
                    && TODAY_INDEX >= span.startIdx
                    && TODAY_INDEX <= span.endIdx;
                  const isOv = span.isOverride;
                  const ovData = span.override;

                  // Pre-fill override times for this span
                  const spanStart = new Date(dayDates[span.startIdx]!);
                  spanStart.setHours(9, 0, 0, 0);
                  const spanEnd = new Date(dayDates[span.endIdx]!);
                  spanEnd.setHours(17, 0, 0, 0);
                  const isoStart = format(spanStart, "yyyy-MM-dd'T'HH:mm");
                  const isoEnd = format(spanEnd, "yyyy-MM-dd'T'HH:mm");

                  const schTz = layer.timezone || schedule.timezone || 'UTC';
                  const periodStr = ovData
                    ? `${formatInTz(ovData.start, schTz)} \u2192 ${formatInTz(ovData.end, schTz)}`
                    : '';

                  // ── Override span: icon-only by default, details on hover ──
                  if (isOv) {
                    return (
                      <div
                        key={`${layer.id}-${span.startIdx}`}
                        className={cn(
                          'group/span relative flex items-center justify-center rounded-md py-2 px-1 transition-all duration-150 border border-dashed cursor-default',
                          containsToday
                            ? `${LAYER_COLORS[ci]} text-white shadow-sm border-white/40`
                            : `${LAYER_COLORS_LIGHT[ci]} ${LAYER_TEXT[ci]} border-border/60`,
                        )}
                        style={{ gridColumn: `${span.startIdx + 1} / span ${colSpan}` }}
                      >
                        {/* Shield icon — always visible */}
                        <ShieldAlert className={cn(
                          'h-4 w-4 shrink-0',
                          containsToday ? 'text-white/80' : LAYER_TEXT[ci],
                        )} />

                        {/* Hover tooltip with full details */}
                        <div className={cn(
                          'absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 w-52 rounded-lg border shadow-lg p-2.5',
                          'opacity-0 pointer-events-none group-hover/span:opacity-100 group-hover/span:pointer-events-auto transition-opacity duration-150',
                          'bg-popover text-popover-foreground border-border',
                        )}>
                          {/* Override user */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className={cn(
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                              `${LAYER_COLORS_LIGHT[ci]} ${LAYER_TEXT[ci]}`,
                            )}>
                              {initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              {user && (
                                <p className="text-xs font-semibold leading-tight truncate text-foreground">
                                  {user.name}
                                </p>
                              )}
                              <p className="text-[9px] text-muted-foreground">Override</p>
                            </div>
                          </div>
                          {/* Period */}
                          {periodStr && (
                            <p className="text-[10px] text-muted-foreground tabular-nums mb-0.5">
                              {periodStr}
                            </p>
                          )}
                          {/* Reason */}
                          {ovData?.reason && (
                            <p className="text-[10px] text-muted-foreground italic truncate mb-1.5">
                              {ovData.reason}
                            </p>
                          )}
                          {/* Actions */}
                          <div className="flex items-center gap-1 border-t border-border pt-1.5">
                            {onEditOverride && ovData && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onEditOverride(ovData); }}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              >
                                <Pencil className="h-2.5 w-2.5" /> Edit
                              </button>
                            )}
                            {onDeleteOverride && ovData && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteOverride(ovData.id); }}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              >
                                <Trash2 className="h-2.5 w-2.5" /> Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Regular span: solid layer color (same as "today" styling) ──
                  return (
                    <div
                      key={`${layer.id}-${span.startIdx}`}
                      className={cn(
                        'group/span relative flex items-center gap-2 rounded-md px-2 py-2 transition-all duration-150 text-white',
                        `${LAYER_COLORS[ci]}`,
                        containsToday ? 'shadow-sm' : 'hover:shadow-md hover:-translate-y-px',
                      )}
                      style={{
                        gridColumn: `${span.startIdx + 1} / span ${colSpan}`,
                      }}
                    >
                      {/* Avatar */}
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold text-white transition-transform duration-150 group-hover/span:scale-110">
                        {initials}
                      </div>

                      {/* Name + day range */}
                      <div className="min-w-0 flex-1">
                        {user && (
                          <p className="text-[11px] font-semibold leading-tight truncate text-white">
                            {user.name}
                          </p>
                        )}
                        <p className="text-[9px] leading-tight text-white/70">
                          {colSpan === 1
                            ? DAYS[span.startIdx]
                            : `${DAYS[span.startIdx]} – ${DAYS[span.endIdx]}`
                          }
                        </p>
                      </div>

                      {/* Hover action buttons */}
                      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 opacity-0 group-hover/span:opacity-100 transition-opacity">
                        {onEditLayer && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditLayer(layer); }}
                            className="rounded p-1 transition-colors hover:bg-white/20 text-white/80 hover:text-white"
                            title="Edit layer"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {onAddOverride && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onAddOverride(isoStart, isoEnd, layer.id); }}
                            className="rounded p-1 transition-colors hover:bg-white/20 text-white/80 hover:text-white"
                            title="Add override for this period"
                          >
                            <ShieldAlert className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      {/* Handoff dot */}
                      {span.startIdx > 0 && user && (
                        <div className={cn(
                          'absolute -left-0.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full border-2 border-card',
                          LAYER_COLORS[ci],
                        )} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
        );
      })}



      {layers.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">No layers with members configured.</p>
      )}
    </div>
  );
}

// ─── Monthly Calendar View ─────────────────────────────────────────────────────

type ViewMode = 'timeline' | 'calendar';

interface DayDetail {
  date: Date;
  entries: Array<{
    layerName: string;
    layerIdx: number;
    userName: string | null;
    userId: string | null;
    isOverride: boolean;
    overrideReason?: string | null;
  }>;
  hasGap: boolean;
}

function MonthlyCalendar({
  schedule,
  monthOffset,
  users,
}: {
  schedule: OnCallSchedule;
  monthOffset: number;
  users: TenantUser[];
}) {
  const [selectedDay, setSelectedDay] = useState<DayDetail | null>(null);

  const today = new Date();
  const viewMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth(); // 0-indexed

  const layers = schedule.layers.filter((l) => l.users.length > 0);
  const tz = schedule.timezone || 'UTC';

  // Build the calendar grid: starts on Monday, fills partial weeks
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday = 0 offset. JS getDay(): 0=Sun,1=Mon,...6=Sat
    const startWeekday = firstDay.getDay();
    const mondayOffset = startWeekday === 0 ? 6 : startWeekday - 1;

    const gridStart = new Date(firstDay);
    gridStart.setDate(gridStart.getDate() - mondayOffset);

    // Build 6 weeks (42 days) to cover all possible month layouts
    const days: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push({
        date: d,
        inMonth: d.getMonth() === month,
      });
    }

    // Trim trailing week if entirely outside month
    while (days.length > 35 && days.slice(-7).every((d) => !d.inMonth)) {
      days.splice(-7);
    }

    return days;
  }, [year, month]);

  // Pre-compute on-call data for each day in the grid
  const dayDetails = useMemo(() => {
    const details: Map<string, DayDetail> = new Map();

    for (const { date } of calendarDays) {
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const entries: DayDetail['entries'] = [];

      for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
        const layer = layers[layerIdx]!;
        const layerTz = layer.timezone || tz;
        const [lsH, lsM] = (layer.start_time || '09:00').split(':').map(Number) as [number, number];
        const [leH, leM] = (layer.end_time || '17:00').split(':').map(Number) as [number, number];
        const lsMin = lsH * 60 + lsM;
        const leMin = leH * 60 + leM;
        const midMin = lsMin <= leMin
          ? Math.floor((lsMin + leMin) / 2)
          : Math.floor(((lsMin + leMin + 1440) / 2) % 1440);

        // Compute layer window for this day
        const winStartMs = clientLocalToUtcMs(date.getFullYear(), date.getMonth() + 1, date.getDate(), lsH, lsM, layerTz);
        const winEndMs = clientLocalToUtcMs(date.getFullYear(), date.getMonth() + 1, date.getDate(), leH, leM, layerTz);
        const winStart = new Date(winStartMs);
        const winEnd = new Date(winEndMs > winStartMs ? winEndMs : winEndMs + 86400000);

        // Check for overrides
        const layerOverrides = schedule.overrides.filter(
          (o) => !o.layer_id || o.layer_id === layer.id,
        );

        let isOverride = false;
        let overrideUserId: string | null = null;
        let overrideReason: string | null = null;

        for (const o of layerOverrides) {
          const oStart = new Date(o.start);
          const oEnd = new Date(o.end);
          if (oStart < winEnd && oEnd > winStart) {
            isOverride = true;
            overrideUserId = o.user_id;
            overrideReason = o.reason;
            break;
          }
        }

        if (isOverride) {
          const user = users.find((u) => u.id === overrideUserId);
          entries.push({
            layerName: layer.name,
            layerIdx,
            userName: user?.name ?? overrideUserId?.slice(-6) ?? null,
            userId: overrideUserId,
            isOverride: true,
            overrideReason,
          });
        } else {
          // Base rotation
          const probeDate = new Date(
            clientLocalToUtcMs(
              date.getFullYear(), date.getMonth() + 1, date.getDate(),
              Math.floor(midMin / 60), midMin % 60, layerTz,
            ),
          );
          const userId = computeLayerUserForDate(layer, schedule.timezone, probeDate);
          const user = userId ? users.find((u) => u.id === userId) : null;
          entries.push({
            layerName: layer.name,
            layerIdx,
            userName: user?.name ?? (userId ? userId.slice(-6) : null),
            userId: userId,
            isOverride: false,
          });
        }
      }

      // A gap exists if there are active layers but at least one layer has no user
      const hasGap = layers.length > 0 && entries.some((e) => !e.userId);

      details.set(key, { date, entries, hasGap });
    }

    return details;
  }, [calendarDays, layers, schedule.overrides, schedule.timezone, users, tz]);

  const gapCount = useMemo(() => {
    let count = 0;
    for (const { date, inMonth } of calendarDays) {
      if (!inMonth) continue;
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const detail = dayDetails.get(key);
      if (detail?.hasGap) count++;
    }
    return count;
  }, [calendarDays, dayDetails]);

  const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthName = viewMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Gap warning banner */}
      {gapCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="text-[#DC2626] dark:text-red-400 font-medium">
            {gapCount} day{gapCount !== 1 ? 's' : ''} with coverage gaps in {viewMonth.toLocaleString('en-US', { month: 'long' })}
          </span>
        </div>
      )}

      {/* Layer legend */}
      {layers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {layers.map((layer, idx) => (
            <div key={layer.id} className="flex items-center gap-1.5">
              <div className={cn('h-2.5 w-2.5 rounded-sm', LAYER_COLORS[idx % LAYER_COLORS.length])} />
              <span className="text-xs text-muted-foreground">{layer.name}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm border-2 border-dashed border-amber-500" />
            <span className="text-xs text-muted-foreground">Override</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-red-500/30 border border-red-500" />
            <span className="text-xs text-muted-foreground">Gap</span>
          </div>
        </div>
      )}

      {/* Calendar grid */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/30">
          {WEEKDAY_HEADERS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map(({ date, inMonth }, idx) => {
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            const detail = dayDetails.get(key);
            const isToday = date.getDate() === today.getDate()
              && date.getMonth() === today.getMonth()
              && date.getFullYear() === today.getFullYear();
            const isSelected = selectedDay
              && selectedDay.date.getDate() === date.getDate()
              && selectedDay.date.getMonth() === date.getMonth()
              && selectedDay.date.getFullYear() === date.getFullYear();

            const hasOverride = detail?.entries.some((e) => e.isOverride) ?? false;
            const hasGap = detail?.hasGap ?? false;

            // Border logic: right border for all except last col, bottom for all except last row
            const col = idx % 7;
            const row = Math.floor(idx / 7);
            const totalRows = Math.ceil(calendarDays.length / 7);

            return (
              <div
                key={idx}
                onClick={() => detail && setSelectedDay(isSelected ? null : detail)}
                className={cn(
                  'relative min-h-[88px] p-1.5 cursor-pointer transition-colors',
                  col < 6 && 'border-r border-border',
                  row < totalRows - 1 && 'border-b border-border',
                  !inMonth && 'bg-muted/20',
                  inMonth && 'hover:bg-muted/40',
                  isToday && 'bg-primary/5',
                  isSelected && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
                  hasGap && inMonth && 'bg-red-500/5',
                )}
              >
                {/* Day number */}
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                      isToday && 'bg-primary text-primary-foreground',
                      !isToday && inMonth && 'text-foreground',
                      !isToday && !inMonth && 'text-muted-foreground/50',
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {hasOverride && (
                      <ShieldAlert className="h-3 w-3 text-amber-500" />
                    )}
                    {hasGap && inMonth && (
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                    )}
                  </div>
                </div>

                {/* On-call user chips (compact) */}
                {inMonth && detail && (
                  <div className="space-y-0.5">
                    {detail.entries.slice(0, 2).map((entry, eIdx) => {
                      const ci = entry.layerIdx % LAYER_COLORS.length;
                      return (
                        <div
                          key={eIdx}
                          className={cn(
                            'flex items-center gap-1 rounded px-1 py-0.5 text-[9px] leading-tight truncate',
                            entry.isOverride
                              ? 'border border-dashed border-amber-500/50 bg-amber-500/10'
                              : `${LAYER_COLORS_LIGHT[ci]} ${LAYER_TEXT[ci]}`,
                            !entry.userId && 'bg-red-500/10 text-[#DC2626] border border-red-500/30',
                          )}
                        >
                          <div className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            entry.userId ? LAYER_COLORS[ci] : 'bg-red-500',
                          )} />
                          <span className="truncate">
                            {entry.userName ?? 'No coverage'}
                          </span>
                        </div>
                      );
                    })}
                    {detail.entries.length > 2 && (
                      <p className="text-[8px] text-muted-foreground pl-1">
                        +{detail.entries.length - 2} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {format(selectedDay.date, 'EEEE, MMMM d, yyyy')}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedDay.hasGap && (
              <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-[#DC2626] dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Coverage gap detected — not all layers have an on-call user
              </div>
            )}

            {selectedDay.entries.length === 0 && (
              <p className="text-sm text-muted-foreground">No layers configured.</p>
            )}

            {selectedDay.entries.map((entry, idx) => {
              const ci = entry.layerIdx % LAYER_COLORS.length;
              return (
                <div
                  key={idx}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2.5',
                    entry.isOverride ? 'border-amber-500/40 bg-amber-500/5' : 'border-border',
                    !entry.userId && 'border-red-500/40 bg-red-500/5',
                  )}
                >
                  <div className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    entry.userId
                      ? `${LAYER_COLORS_LIGHT[ci]} ${LAYER_TEXT[ci]}`
                      : 'bg-red-500/20 text-[#DC2626]',
                  )}>
                    {entry.userName
                      ? entry.userName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
                      : '--'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {entry.userName ?? 'No coverage'}
                      </span>
                      {entry.isOverride && (
                        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-medium text-[#A16207] dark:text-amber-400">
                          Override
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <div className={cn('h-2 w-2 rounded-sm', LAYER_COLORS[ci])} />
                      {entry.layerName}
                      {entry.overrideReason && (
                        <span className="italic">— {entry.overrideReason}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OnCallPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<OnCallSchedule | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [addLayerSchedule, setAddLayerSchedule] = useState<OnCallSchedule | null>(null);
  const [editLayer, setEditLayer] = useState<{ schedule: OnCallSchedule; layer: ScheduleLayer } | null>(null);
  const [deleteLayerInfo, setDeleteLayerInfo] = useState<{ schedule: OnCallSchedule; layer: ScheduleLayer } | null>(null);
  const [overrideDialog, setOverrideDialog] = useState<{ open: boolean; prefillStart?: string; prefillEnd?: string; prefillLayerId?: string }>({ open: false });
  const [editOverrideTarget, setEditOverrideTarget] = useState<ScheduleOverride | null>(null);

  const { data: schedules = [], isLoading, error } = useOnCallSchedules();
  const { data: users = [] } = useUsers({ status: 'active,invited' });
  const deleteMutation = useDeleteOnCallSchedule();
  const updateMutation = useUpdateOnCallSchedule();
  const deleteOverrideMutation = useDeleteOverride();

  const selected = schedules.find((s) => s.id === selectedId) ?? schedules[0] ?? null;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - TODAY_INDEX + weekOffset * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  async function handleDelete(id: string) {
    if (!confirm('Delete this schedule? This cannot be undone.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Schedule deleted');
      if (selectedId === id) setSelectedId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete schedule');
    }
  }

  async function handleToggleEnabled(schedule: OnCallSchedule) {
    try {
      await updateMutation.mutateAsync({
        id: schedule.id,
        input: { enabled: !schedule.enabled },
      });
      toast.success(schedule.enabled ? 'Schedule disabled' : 'Schedule enabled');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update schedule');
    }
  }

  async function handleDeleteLayer() {
    if (!deleteLayerInfo) return;
    const { schedule, layer } = deleteLayerInfo;
    try {
      const remainingLayers = schedule.layers
        .filter((l) => l.id !== layer.id)
        .map((l) => ({
          id: l.id,
          name: l.name,
          rotation_type: l.rotation_type,
          users: l.users,
          start_time: l.start_time,
          end_time: l.end_time,
          timezone: l.timezone,
        }));
      await updateMutation.mutateAsync({
        id: schedule.id,
        input: { layers: remainingLayers },
      });
      toast.success(`Layer "${layer.name}" removed`);
      setDeleteLayerInfo(null);
    } catch {
      toast.error('Failed to delete layer');
    }
  }

  async function handleDeleteOverrideFromWeekly(overrideId: string) {
    if (!selected) return;
    try {
      await deleteOverrideMutation.mutateAsync({ scheduleId: selected.id, overrideId });
      toast.success('Override deleted');
    } catch {
      toast.error('Failed to delete override');
    }
  }

  // Compute total unique members across all layers for a schedule
  function uniqueMemberCount(s: OnCallSchedule): number {
    const ids = new Set<string>();
    for (const layer of s.layers) {
      for (const uid of layer.users) ids.add(uid);
    }
    return ids.size;
  }

  return (
    <div className="space-y-6">
      <CreateScheduleDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {selected && (
        <AddOverrideDialog
          scheduleId={selected.id}
          open={overrideDialog.open}
          onClose={() => setOverrideDialog({ open: false })}
          users={users}
          layers={selected.layers}
          scheduleTimezone={selected.timezone || 'UTC'}
          prefillStart={overrideDialog.prefillStart}
          prefillEnd={overrideDialog.prefillEnd}
          prefillLayerId={overrideDialog.prefillLayerId}
        />
      )}
      {selected && editOverrideTarget && (
        <EditOverrideDialog
          scheduleId={selected.id}
          override={editOverrideTarget}
          open={!!editOverrideTarget}
          onClose={() => setEditOverrideTarget(null)}
          users={users}
          layers={selected.layers}
          scheduleTimezone={selected.timezone || 'UTC'}
        />
      )}
      {editSchedule && (
        <EditScheduleDialog
          schedule={editSchedule}
          open={!!editSchedule}
          onClose={() => setEditSchedule(null)}
        />
      )}
      {addLayerSchedule && (
        <AddLayerDialog
          schedule={addLayerSchedule}
          open={!!addLayerSchedule}
          onClose={() => setAddLayerSchedule(null)}
          users={users}
        />
      )}
      {editLayer && (
        <EditLayerDialog
          schedule={editLayer.schedule}
          layer={editLayer.layer}
          open={!!editLayer}
          onClose={() => setEditLayer(null)}
          users={users}
        />
      )}
      <ConfirmDialog
        open={!!deleteLayerInfo}
        onClose={() => setDeleteLayerInfo(null)}
        onConfirm={handleDeleteLayer}
        title="Delete Layer"
        description={`Are you sure you want to delete "${deleteLayerInfo?.layer.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        isLoading={updateMutation.isPending}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">On-Call</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage on-call schedules and rotations</p>
        </div>
        <Button data-testid="create-schedule-btn" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Schedule
        </Button>
      </div>

      {/* Current On-Call Widget */}
      {!isLoading && schedules.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {schedules.filter((s) => s.enabled).map((schedule) => (
            <CurrentOnCallWidget key={schedule.id} schedule={schedule} users={users} />
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading schedules…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load schedules: {(error as any).message}
        </div>
      )}

      {!isLoading && schedules.length === 0 && (
        <EmptyState
          variant="offduty"
          title="No schedules yet"
          description="Create an on-call schedule to start managing rotations."
          actionLabel="Create Schedule"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {schedules.length > 0 && (
        <>
          {/* Schedule cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {schedules.map((s) => {
              const totalMembers = uniqueMemberCount(s);
              return (
                <Card
                  key={s.id}
                  className={cn(
                    'cursor-pointer transition-shadow hover:shadow-md',
                    selected?.id === s.id && 'ring-2 ring-primary',
                    !s.enabled && 'opacity-50',
                  )}
                  onClick={() => setSelectedId(s.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.description || s.timezone}</p>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                          {s.layers.length} layer{s.layers.length !== 1 ? 's' : ''}
                        </span>
                        {!s.enabled && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            Disabled
                          </span>
                        )}
                        <button
                          onClick={() => setEditSchedule(s)}
                          className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Who's on-call now */}
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <OnCallBadge scheduleId={s.id} users={users} />
                    </div>

                    {/* Layer/member counts */}
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {s.layers.length} layer{s.layers.length !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {totalMembers} member{totalMembers !== 1 ? 's' : ''}
                      </span>
                      {s.overrides.filter((o) => new Date(o.start) <= new Date() && new Date(o.end) >= new Date()).length > 0 && (
                        <span className="text-[#A16207] dark:text-amber-400">override active</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* View mode toggle */}
          {selected && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
              <button
                onClick={() => setViewMode('timeline')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === 'timeline'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutList className="h-3.5 w-3.5" />
                Timeline
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === 'calendar'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Calendar
              </button>
            </div>
          )}

          {/* Detail panel */}
          {selected && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Main view area */}
              <div className={viewMode === 'calendar' ? 'lg:col-span-3' : 'lg:col-span-2'}>
                {viewMode === 'timeline' ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <CalendarDays className="h-5 w-5" />
                          {selected.name} — Weekly View
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset - 1)}>
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
                          </span>
                          <Button variant="outline" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                          {weekOffset !== 0 && (
                            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>Today</Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <WeeklyCalendar
                        schedule={selected}
                        weekOffset={weekOffset}
                        users={users}
                        onEditLayer={(layer) => setEditLayer({ schedule: selected, layer })}
                        onAddOverride={(prefillStart, prefillEnd, prefillLayerId) =>
                          setOverrideDialog({ open: true, prefillStart, prefillEnd, prefillLayerId })
                        }
                        onEditOverride={(o) => setEditOverrideTarget(o)}
                        onDeleteOverride={handleDeleteOverrideFromWeekly}
                      />

                      {/* Coverage timeline */}
                      {selected.layers.length > 0 && (
                        <CoverageTimeline layers={selected.layers} />
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <CalendarIcon className="h-5 w-5" />
                          {selected.name} — Monthly Calendar
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setMonthOffset(monthOffset - 1)}>
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm text-muted-foreground min-w-[120px] text-center">
                            {new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1)
                              .toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <Button variant="outline" size="sm" onClick={() => setMonthOffset(monthOffset + 1)}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                          {monthOffset !== 0 && (
                            <Button variant="ghost" size="sm" onClick={() => setMonthOffset(0)}>Today</Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <MonthlyCalendar
                        schedule={selected}
                        monthOffset={monthOffset}
                        users={users}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Details sidebar — timeline mode only */}
              {viewMode === 'timeline' && (
              <div>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldAlert className="h-4 w-4" />
                        Schedule Details
                      </CardTitle>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditSchedule(selected)}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Enable / Disable toggle */}
                    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Power className={cn('h-4 w-4', selected.enabled ? 'text-emerald-500' : 'text-muted-foreground')} />
                        <span className="text-sm font-medium text-foreground">
                          {selected.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleToggleEnabled(selected)}
                        disabled={updateMutation.isPending}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
                          selected.enabled ? 'bg-emerald-500' : 'bg-muted',
                          updateMutation.isPending && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        <span
                          className={cn(
                            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform mt-0.5',
                            selected.enabled ? 'translate-x-4' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                    </div>

                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Timezone</span>
                        <span className="font-medium text-foreground">{selected.timezone}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Layers</span>
                        <span className="font-medium text-foreground">{selected.layers.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Members</span>
                        <span className="font-medium text-foreground">{uniqueMemberCount(selected)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Created</span>
                        <span className="font-medium text-foreground">
                          {selected.created_at
                            ? formatDistanceToNow(new Date(selected.created_at), { addSuffix: true })
                            : '\u2014'}
                        </span>
                      </div>
                    </div>

                    <hr className="border-border" />

                    {/* Layers */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-foreground">Layers</h3>
                        <Button size="sm" variant="outline" onClick={() => setAddLayerSchedule(selected)}>
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Add Layer
                        </Button>
                      </div>

                      {selected.layers.length === 0 && (
                        <p className="text-sm text-muted-foreground">No layers. Add one to start.</p>
                      )}

                      {selected.layers.map((layer, idx) => (
                        <div key={layer.id} className="rounded-md border border-border p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={cn('h-2.5 w-2.5 rounded-sm', LAYER_COLORS[idx % LAYER_COLORS.length])} />
                              <span className="text-sm font-medium text-foreground">{layer.name}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditLayer({ schedule: selected, layer })}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="Edit layer"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setDeleteLayerInfo({ schedule: selected, layer })}
                                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                title="Delete layer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <p>
                              <span className="capitalize font-medium text-foreground">{layer.rotation_type}</span>
                              {' \u00b7 '}
                              {layer.start_time} – {layer.end_time}
                              {' \u00b7 '}
                              {layer.users.length} member{layer.users.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                          {layer.users.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap gap-1">
                                {layer.users.map((uid) => {
                                  const u = users.find((x) => x.id === uid);
                                  const hasPhone = !!(u as any)?.phone_number;
                                  return (
                                    <span
                                      key={uid}
                                      className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
                                    >
                                      <User className="h-3 w-3 text-muted-foreground" />
                                      {u?.name ?? uid.slice(-6)}
                                      {!hasPhone && (
                                        <span title="No phone number — Voice / WhatsApp / SMS will be skipped for this user">
                                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                              {(() => {
                                const missing = layer.users.filter((uid) => !(users.find((x) => x.id === uid) as any)?.phone_number).length;
                                return missing > 0 ? (
                                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                    ⚠ {missing} of {layer.users.length} member{layer.users.length !== 1 ? 's' : ''} {missing === 1 ? 'has' : 'have'} no phone number — Voice / WhatsApp / SMS will be skipped
                                  </p>
                                ) : null;
                              })()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <hr className="border-border" />
                    <OverridesPanel schedule={selected} users={users} scheduleTimezone={selected.timezone || 'UTC'} />
                  </CardContent>
                </Card>
              </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
