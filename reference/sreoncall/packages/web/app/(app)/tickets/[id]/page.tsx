'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import DOMPurify from 'dompurify';
import {
  ArrowLeft,
  Clock,
  MessageSquare,
  Activity,
  Loader2,
  Send,
  Trash2,
  Link2,
  X,
  Timer,
  Plus,
  Shield,
  ShieldCheck,
  ShieldX,
  Pause,
  Paperclip,
  Download,
  FileText,
  Film,
  FileArchive,
  File,
  Upload,
  ImageIcon,
  Flag,
  Pencil,
  Users,
  Eye,
  EyeOff,
  Lock,
  UserPlus,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PriorityBadge } from '@/components/shared/PriorityBadge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  useTicket,
  useUpdateTicket,
  useDeleteTicket,
  useLinkTicket,
  useUnlinkTicket,
  useAddWorkLog,
  useRemoveWorkLog,
  useTicketAttachments,
  useUploadTicketAttachment,
  useDeleteTicketAttachment,
  downloadTicketAttachment,
  useTicketWorkflow,
  useUpdateComment,
  useDeleteComment,
  useToggleReaction,
  type TicketPriority,
  type LinkType,
} from '@/lib/hooks/useTickets';
import { useMilestones } from '@/lib/hooks/useMilestones';
import { useSprints } from '@/lib/hooks/useSprints';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTeams } from '@/lib/hooks/useTeams';
import { UserAssignDropdown } from '@/components/tickets/UserAssignDropdown';
import { WorkLogList } from '@/components/tickets/WorkLogList';
import dynamic from 'next/dynamic';
import { formatTicketNumber, formatMinutes, cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { isRichTextEmpty } from '@/lib/utils/rich-text';

const RichTextEditor = dynamic(
  () => import('@/components/shared/RichTextEditor').then((mod) => mod.RichTextEditor),
  { ssr: false, loading: () => <div className="min-h-[80px] rounded-md border border-input bg-background animate-pulse" /> },
);
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useLinkedConsumers, useLinkTicketToConsumer } from '@/lib/hooks/useProvider';

// ─── Milestone selector for ticket sidebar ──────────────────────────────────

function TeamSelector({ ticket }: { ticket: { id: string; team_id: string | null } }) {
  const updateTicket = useUpdateTicket();
  const { data: teams = [] } = useTeams();

  async function handleChange(value: string) {
    try {
      await updateTicket.mutateAsync({
        id: ticket.id,
        input: { team_id: value || null },
      });
      toast.success(value ? 'Team updated' : 'Team removed');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update team');
    }
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        Team
      </p>
      <div className="mt-1">
        <Select
          value={ticket.team_id ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          className="h-8 text-xs"
          disabled={updateTicket.isPending}
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id ?? t._id} value={t.id ?? t._id}>{t.name}</option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function MilestoneSelector({ ticket }: { ticket: { id: string; project_id: string | null; milestone_id?: string | null } }) {
  const updateTicket = useUpdateTicket();
  const { data: milestonesData } = useMilestones(
    ticket.project_id ? { project_id: ticket.project_id } : {},
  );
  const milestones = milestonesData?.data ?? [];

  async function handleChange(value: string) {
    try {
      await updateTicket.mutateAsync({
        id: ticket.id,
        input: { milestone_id: value || null },
      });
      toast.success(value ? 'Milestone updated' : 'Milestone removed');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update milestone');
    }
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        <Flag className="inline h-3 w-3 mr-1" />
        Milestone
      </p>
      <div className="mt-1">
        <Select
          value={ticket.milestone_id ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          className="h-8 text-xs"
          disabled={updateTicket.isPending}
        >
          <option value="">None</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
      </div>
    </div>
  );
}

// ─── Reaction picker ────────────────────────────────────────────────────────

const REACTION_EMOJIS = ['👍', '❤️', '✅', '😄', '🚀', '👀'] as const;

function ReactionPicker({
  onSelect,
  existingReactions,
  currentUserId,
}: {
  onSelect: (emoji: string) => void;
  existingReactions: Array<{ emoji: string; user_ids: string[] }>;
  currentUserId?: string;
}) {
  const [open, setOpen] = useState(false);
  const unreacted = REACTION_EMOJIS.filter(
    (e) => !existingReactions.find((r) => r.emoji === e && r.user_ids.includes(currentUserId ?? '')),
  );
  if (unreacted.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:border-brand/40 hover:text-brand"
        title="Add reaction"
      >
        <span className="text-[11px]">+</span>
      </button>
      {open && (
        <div className="absolute bottom-7 left-0 z-20 flex gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          {unreacted.map((emoji) => (
            <button
              key={emoji}
              onMouseDown={() => { onSelect(emoji); setOpen(false); }}
              className="rounded-lg px-1.5 py-1 text-base transition-colors hover:bg-muted"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Watcher add button ──────────────────────────────────────────────────────

function WatcherAddButton({
  ticketId, watcherIds, orgUsers, onAdd,
}: {
  ticketId: string;
  watcherIds: string[];
  orgUsers: Array<{ id: string; name: string; email: string }>;
  onAdd: (uid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const candidates = orgUsers.filter((u) => !watcherIds.includes(u.id));

  if (candidates.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        title="Add watcher"
      >
        <UserPlus className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-20 max-h-48 w-48 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {candidates.map((u) => (
            <button
              key={u.id}
              onClick={() => { onAdd(u.id); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted text-left"
            >
              <span className="truncate">{u.name || u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sprint selector for ticket sidebar ─────────────────────────────────────

function SprintSelector({ ticket }: { ticket: { id: string; sprint_id?: string | null } }) {
  const updateTicket = useUpdateTicket();
  const { data: sprintsData } = useSprints();
  const sprints = (sprintsData?.data ?? []).filter(
    (s) => s.status === 'planning' || s.status === 'active',
  );

  async function handleChange(value: string) {
    try {
      await updateTicket.mutateAsync({
        id: ticket.id,
        input: { sprint_id: value || null },
      });
      toast.success(value ? 'Added to sprint' : 'Removed from sprint');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update sprint');
    }
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">Sprint</p>
      <div className="mt-1">
        <Select
          value={ticket.sprint_id ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          className="h-8 text-xs"
          disabled={updateTicket.isPending}
        >
          <option value="">None</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </div>
    </div>
  );
}

// Fallback transitions used when no TicketWorkflow is configured for this tenant/type
const fallbackTransitions: Record<string, string[]> = {
  discover:    ['open', 'in_progress'],
  open:        ['in_progress', 'discover'],
  in_progress: ['in_review', 'on_hold', 'open', 'discover'],
  in_review:   ['resolved', 'in_progress', 'on_hold'],
  on_hold:     ['in_progress', 'resolved'],
  resolved:    ['closed', 'open'],
  closed:      ['open'],
};

function SlaCountdown({ deadline }: { deadline: string }) {
  const deadlineDate = new Date(deadline);
  const now = new Date();
  const diffMs = deadlineDate.getTime() - now.getTime();
  const breached = diffMs < 0;
  const absDiff = Math.abs(diffMs);

  const hours = Math.floor(absDiff / 3600000);
  const minutes = Math.floor((absDiff % 3600000) / 60000);

  const totalMs = deadlineDate.getTime() - now.getTime();
  // "at risk" if less than 25% of the original window remains (estimate: if < 1hr left)
  const atRisk = !breached && diffMs < 3600000;

  const label = breached
    ? `Breached ${hours}h ${minutes}m ago`
    : `${hours}h ${minutes}m left`;

  return (
    <span
      className={cn(
        'text-xs font-medium',
        breached ? 'text-red-500' : atRisk ? 'text-yellow-500' : 'text-emerald-500',
      )}
    >
      {label}
    </span>
  );
}

function CreatedAtEditor({ ticket }: { ticket: { id: string; created_at: string } }) {
  const updateTicket = useUpdateTicket();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ticket.created_at.slice(0, 10));

  async function handleSave() {
    try {
      await updateTicket.mutateAsync({ id: ticket.id, input: { created_at: new Date(value).toISOString() } });
      toast.success('Creation date updated');
      setEditing(false);
    } catch {
      toast.error('Failed to update creation date');
    }
  }

  if (editing) {
    return (
      <div>
        <p className="text-xs font-medium uppercase text-muted-foreground">Created</p>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={updateTicket.isPending}>
            {updateTicket.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">Created</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-foreground group">
        <Clock className="h-3.5 w-3.5" />
        {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          title="Edit creation date"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </p>
    </div>
  );
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const queryClient = useQueryClient();
  const { data: ticket, isLoading, error } = useTicket(id);
  const updateTicket = useUpdateTicket();
  const deleteTicket = useDeleteTicket();
  const linkTicket = useLinkTicket();
  const unlinkTicket = useUnlinkTicket();
  const addWorkLog = useAddWorkLog();
  const removeWorkLog = useRemoveWorkLog();
  const { data: attachmentsData } = useTicketAttachments(id);
  const uploadAttachment = useUploadTicketAttachment();
  const deleteAttachment = useDeleteTicketAttachment();

  const { data: session } = useSession();
  const tenantType = (session?.user as any)?.tenantType || 'standalone';
  const isConsumer = tenantType === 'consumer';
  const isProvider = tenantType === 'provider';
  const userRole   = (session?.user as any)?.role as string | undefined;
  const canApprove = ['manager', 'tenant_admin', 'platform_admin'].includes(userRole ?? '');

  // Workflow-driven transitions — falls back to the hardcoded map when no
  // TicketWorkflow document exists for this tenant/ticket type.
  const workflow = useTicketWorkflow(ticket?.type ?? '');
  const updateComment  = useUpdateComment();
  const deleteComment  = useDeleteComment();
  const toggleReaction = useToggleReaction();
  const currentUserId  = (session?.user as any)?.id as string | undefined;
  const { data: orgUsers = [] } = useUsers();

  // Check if this ticket already has a bridge (was escalated)
  const [escalatedJustNow, setEscalatedJustNow] = useState(false);
  const { data: bridgeData } = useQuery({
    queryKey: ['ticket-bridge', id],
    queryFn: async () => {
      try {
        const res = await api.get<any>(`/api/v1/bridges/ticket/${id}`);
        return res;
      } catch { return null; }
    },
    enabled: !!id && (isConsumer || isProvider),
  });
  const hasExistingBridge = escalatedJustNow || !!(bridgeData?._id);

  // Provider: link-to-consumer feature
  const { data: linkedConsumers } = useLinkedConsumers();
  const linkToConsumer = useLinkTicketToConsumer();
  const [showLinkConsumerDialog, setShowLinkConsumerDialog] = useState(false);
  const [selectedConsumerId, setSelectedConsumerId] = useState('');
  const consumersWithTicketScope = (linkedConsumers || []).filter(
    (c) => c.consumer && c.scope.includes('tickets'),
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ id: string; name: string } | null>(null);

  const attachments = attachmentsData?.data || [];
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});

  // Load thumbnail URLs for image attachments
  const loadedThumbnailsRef = useRef<Set<string>>(new Set());
  const loadThumbnails = useCallback(async () => {
    for (const att of attachments) {
      if (att.mime_type.startsWith('image/') && !loadedThumbnailsRef.current.has(att._id)) {
        loadedThumbnailsRef.current.add(att._id);
        try {
          const url = await downloadTicketAttachment(att._id);
          setThumbnailUrls((prev) => ({ ...prev, [att._id]: url }));
        } catch { /* ignore */ }
      }
    }
  }, [attachments]);

  // Trigger thumbnail loading when attachments change
  if (attachments.length > 0) {
    loadThumbnails();
  }

  async function handleDownload(fileId: string, filename: string) {
    try {
      const blobUrl = await downloadTicketAttachment(fileId);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Failed to download file');
    }
  }

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      const tempId = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => [...prev, tempId]);
      try {
        await uploadAttachment.mutateAsync({ ticketId: id, file });
        toast.success(`Uploaded ${file.name}`);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      } finally {
        setUploadingFiles((prev) => prev.filter((f) => f !== tempId));
      }
    }
  }, [id, uploadAttachment]);

  const handleDeleteAttachment = useCallback(async () => {
    if (!deleteFileId) return;
    try {
      await deleteAttachment.mutateAsync({ ticketId: id, fileId: deleteFileId });
      toast.success('Attachment deleted');
    } catch {
      toast.error('Failed to delete attachment');
    } finally {
      setDeleteFileId(null);
    }
  }, [id, deleteFileId, deleteAttachment]);

  function getFileIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return null; // Will show thumbnail
    if (mimeType === 'application/pdf') return FileText;
    if (mimeType.startsWith('video/')) return Film;
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return FileArchive;
    return File;
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const [commentText, setCommentText] = useState('');
  const [commentAttachments, setCommentAttachments] = useState<Array<{ file_id: string; filename: string; mime_type: string; size_bytes: number; url: string }>>([]);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'comments' | 'activity' | 'time_log' | 'attachments'>('comments');
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('related');
  const [showLogWorkDialog, setShowLogWorkDialog] = useState(false);
  const [logHours, setLogHours] = useState('');
  const [logMinutes, setLogMinutes] = useState('');
  const [logDescription, setLogDescription] = useState('');
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0]);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<string>('');
  const [editType, setEditType] = useState<string>('');
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [editLabelInput, setEditLabelInput] = useState('');


  async function handleLogWork() {
    const h = parseInt(logHours || '0', 10) || 0;
    const m = parseInt(logMinutes || '0', 10) || 0;
    const totalMinutes = h * 60 + m;
    if (totalMinutes <= 0) {
      toast.error('Please enter time greater than 0');
      return;
    }
    try {
      await addWorkLog.mutateAsync({
        ticketId: id,
        minutes: totalMinutes,
        description: logDescription || undefined,
        logged_at: logDate ? new Date(logDate).toISOString() : undefined,
      });
      toast.success('Work logged');
      setShowLogWorkDialog(false);
      setLogHours('');
      setLogMinutes('');
      setLogDescription('');
      setLogDate(new Date().toISOString().split('T')[0]);
    } catch {
      toast.error('Failed to log work');
    }
  }

  async function handleRemoveWorkLog(logId: string) {
    try {
      await removeWorkLog.mutateAsync({ ticketId: id, logId });
      toast.success('Work log removed');
    } catch {
      toast.error('Failed to remove work log');
    }
  }


  async function handleStatusChange(newStatus: string) {
    try {
      await updateTicket.mutateAsync({ id, input: { status: newStatus } });
      toast.success(`Status changed to ${newStatus.replace(/_/g, ' ')}`);
    } catch {
      toast.error('Failed to update status');
    }
  }

  async function handleSubmitComment() {
    if (isRichTextEmpty(commentText)) return;

    setIsSubmittingComment(true);
    try {
      await api.post(`/api/v1/tickets/${id}/comments`, {
        body: commentText.trim(),
        is_internal: isInternalComment || undefined,
        attachments: commentAttachments.length > 0 ? commentAttachments : undefined,
      });
      setCommentText('');
      setCommentAttachments([]);
      setIsInternalComment(false);
      toast.success('Comment added');
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    } catch {
      toast.error('Failed to add comment');
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function handleCommentFileUpload(files: FileList | File[]) {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      try {
        const result = await uploadAttachment.mutateAsync({ ticketId: id, file });
        // Build download URL for the attachment
        const fileId = result._id;
        setCommentAttachments((prev) => [
          ...prev,
          {
            file_id: fileId,
            filename: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
            url: `/api/v1/storage/files/${fileId}/download`,
          },
        ]);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
  }

  async function handleImagePaste(file: File): Promise<string | null> {
    try {
      const result = await uploadAttachment.mutateAsync({ ticketId: id, file });
      const fileId = result._id;
      const downloadUrl = `/api/v1/storage/files/${fileId}/download`;
      setCommentAttachments((prev) => [
        ...prev,
        {
          file_id: fileId,
          filename: file.name || 'pasted-image.png',
          mime_type: file.type || 'image/png',
          size_bytes: file.size,
          url: downloadUrl,
        },
      ]);
      return downloadUrl;
    } catch {
      toast.error('Failed to upload pasted image');
      return null;
    }
  }

  async function handleAddLink() {
    if (!linkTargetId.trim()) return;
    try {
      await linkTicket.mutateAsync({ id, targetId: linkTargetId.trim(), type: linkType });
      toast.success('Link added');
      setShowLinkDialog(false);
      setLinkTargetId('');
    } catch {
      toast.error('Failed to add link — check the ticket ID is valid');
    }
  }

  async function handleRemoveLink(targetId: string) {
    try {
      await unlinkTicket.mutateAsync({ id, targetId });
      toast.success('Link removed');
    } catch {
      toast.error('Failed to remove link');
    }
  }

  function openEditDialog() {
    setEditTitle(ticket!.title);
    setEditDescription(ticket!.description);
    setEditPriority(ticket!.priority);
    setEditType(ticket!.type);
    setEditLabels(ticket!.labels || []);
    setShowEditDialog(true);
  }

  async function handleSaveEdit() {
    try {
      await updateTicket.mutateAsync({
        id,
        input: {
          title: editTitle,
          description: editDescription,
          priority: editPriority as TicketPriority,
          labels: editLabels,
        },
      });
      toast.success('Ticket updated');
      setShowEditDialog(false);
    } catch {
      toast.error('Failed to update ticket');
    }
  }

  async function handleDelete() {
    try {
      await deleteTicket.mutateAsync(id);
      toast.success('Ticket deleted');
      router.push('/tickets');
    } catch {
      toast.error('Failed to delete ticket');
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <p className="text-sm text-destructive">
          {error?.message || 'Ticket not found'}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => router.push('/tickets')}
        >
          Back to Tickets
        </Button>
      </div>
    );
  }

  // Derive allowed next statuses from workflow config, or fall back to hardcoded map
  const allowedTransitions: string[] = workflow
    ? workflow.transitions
        .filter((t) => {
          if (t.from !== ticket.status) return false;
          // Respect role restrictions — empty allowed_roles means anyone can transition
          if (t.allowed_roles.length > 0 && userRole && !t.allowed_roles.includes(userRole)) return false;
          return true;
        })
        .map((t) => t.to)
    : (fallbackTransitions[ticket.status] ?? []);

  // Map status name → label for the transition buttons
  const statusLabel = (s: string): string =>
    workflow?.states.find((st) => st.name === s)?.label ?? s.replace(/_/g, ' ');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/tickets')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tickets
      </button>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                navigator.clipboard.writeText(formatTicketNumber(ticket.number, ticket.project_key));
                toast.success(`${formatTicketNumber(ticket.number, ticket.project_key)} copied`);
              }}
              className="group flex items-center gap-1 font-mono text-sm text-muted-foreground hover:text-foreground transition-colors"
              title="Copy ticket ID"
            >
              {formatTicketNumber(ticket.number, ticket.project_key)}
              <svg className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <PriorityBadge priority={ticket.priority as TicketPriority} />
            <StatusBadge status={ticket.status} />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{ticket.title}</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success('URL copied to clipboard');
            }}
            title="Copy link"
          >
            <Link2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openEditDialog}
          >
            <Pencil className="mr-1.5 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.description ? (
                <div className="prose prose-sm max-w-none text-foreground">
                  <CommentBody body={ticket.description} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No description provided.</p>
              )}
            </CardContent>
          </Card>

          {/* Status transitions */}
          {allowedTransitions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {allowedTransitions.map((status) => (
                    <Button
                      key={status}
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusChange(status)}
                      disabled={updateTicket.isPending}
                    >
                      Move to {statusLabel(status)}
                    </Button>
                  ))}
                  {isProvider && consumersWithTicketScope.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={hasExistingBridge}
                      className={hasExistingBridge ? 'opacity-50 cursor-not-allowed' : ''}
                      onClick={() => {
                        setSelectedConsumerId('');
                        setShowLinkConsumerDialog(true);
                      }}
                    >
                      <Users className="mr-1.5 h-4 w-4" />
                      {hasExistingBridge ? 'Linked to Consumer' : 'Link to Consumer'}
                    </Button>
                  )}
                  {isConsumer && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={hasExistingBridge}
                      className={hasExistingBridge ? 'opacity-50 cursor-not-allowed' : ''}
                      onClick={async () => {
                        try {
                          await api.post(`/api/v1/tickets/${id}/escalate`, {});
                          setEscalatedJustNow(true);
                          toast.success('Ticket moved to Platform Team');
                          queryClient.invalidateQueries({ queryKey: ['ticket-bridge', id] });
                        } catch (err: any) {
                          toast.error(err?.body?.detail || 'Failed to move ticket to Platform Team');
                        }
                      }}
                    >
                      {hasExistingBridge ? 'Escalated to Platform Team' : 'Move to Platform Team'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs: Comments / Activity */}
          <div>
            <div className="flex border-b border-border">
              <button
                onClick={() => setActiveTab('comments')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'comments'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                Comments ({ticket.comments?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('activity')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'activity'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Activity className="h-4 w-4" />
                Activity ({ticket.activity?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('time_log')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'time_log'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Timer className="h-4 w-4" />
                Time Log
              </button>
              <button
                onClick={() => setActiveTab('attachments')}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'attachments'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Paperclip className="h-4 w-4" />
                Attachments ({attachments.length})
              </button>
            </div>

            <div className="mt-4">
              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {/* Comment list */}
                  {ticket.comments && ticket.comments.length > 0 ? (
                    ticket.comments.map((comment) => {
                      const isOwn = comment.author.id === (session?.user as any)?.id;
                      const canEditComment = isOwn || ['platform_admin', 'tenant_admin'].includes(userRole ?? '');
                      const isEditingThis = editingCommentId === comment.id;
                      const isDeletingThis = deletingCommentId === comment.id;
                      return (
                        <div
                          key={comment.id}
                          className={cn(
                            'flex gap-3 rounded-lg border p-4 group',
                            comment.is_internal
                              ? 'border-yellow-300/60 bg-yellow-50/60 dark:border-yellow-700/40 dark:bg-yellow-950/30'
                              : 'border-border bg-card',
                          )}
                        >
                          <UserAvatar name={comment.author.name} imageUrl={comment.author.avatar_url} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{comment.author.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                                </span>
                                {comment.edited_at && (
                                  <span className="text-[10px] text-muted-foreground/60">(edited)</span>
                                )}
                                {comment.is_internal && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-700 dark:text-yellow-300">
                                    <Lock className="h-2.5 w-2.5" />
                                    Internal
                                  </span>
                                )}
                              </div>
                              {canEditComment && !isEditingThis && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}
                                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                                    title="Edit comment"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingCommentId(comment.id)}
                                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-muted"
                                    title="Delete comment"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Delete confirmation */}
                            {isDeletingThis && (
                              <div className="mt-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                                <span className="flex-1 text-xs text-foreground">Delete this comment?</span>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-xs"
                                  disabled={deleteComment.isPending}
                                  onClick={async () => {
                                    try {
                                      await deleteComment.mutateAsync({ ticketId: id, commentId: comment.id });
                                      toast.success('Comment deleted');
                                    } catch { toast.error('Failed to delete comment'); }
                                    setDeletingCommentId(null);
                                  }}
                                >
                                  {deleteComment.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDeletingCommentId(null)}>Cancel</Button>
                              </div>
                            )}

                            {/* Inline edit */}
                            {isEditingThis ? (
                              <div className="mt-2 space-y-2">
                                <RichTextEditor
                                  value={editingCommentBody}
                                  onChange={setEditingCommentBody}
                                  onSubmit={async () => {
                                    if (isRichTextEmpty(editingCommentBody)) return;
                                    try {
                                      await updateComment.mutateAsync({ ticketId: id, commentId: comment.id, body: editingCommentBody.trim() });
                                      toast.success('Comment updated');
                                      setEditingCommentId(null);
                                    } catch { toast.error('Failed to update comment'); }
                                  }}
                                  placeholder="Edit comment..."
                                />
                                <div className="flex gap-2 justify-end">
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingCommentId(null)}>Cancel</Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={updateComment.isPending || isRichTextEmpty(editingCommentBody)}
                                    onClick={async () => {
                                      if (isRichTextEmpty(editingCommentBody)) return;
                                      try {
                                        await updateComment.mutateAsync({ ticketId: id, commentId: comment.id, body: editingCommentBody.trim() });
                                        toast.success('Comment updated');
                                        setEditingCommentId(null);
                                      } catch { toast.error('Failed to update comment'); }
                                    }}
                                  >
                                    {updateComment.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-1">
                                <CommentBody body={comment.body} />
                              </div>
                            )}

                            {/* Comment-level attachments */}
                            {!isEditingThis && comment.attachments && comment.attachments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {comment.attachments.map((att) => (
                                  <button
                                    key={att.file_id}
                                    onClick={async () => {
                                      try {
                                        const url = await downloadTicketAttachment(att.file_id);
                                        const a = document.createElement('a');
                                        a.href = url; a.download = att.filename; a.click();
                                        URL.revokeObjectURL(url);
                                      } catch { toast.error('Failed to download file'); }
                                    }}
                                    className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                                  >
                                    {att.mime_type.startsWith('image/') ? <ImageIcon className="h-3 w-3" />
                                      : att.mime_type === 'application/pdf' ? <FileText className="h-3 w-3" />
                                      : <File className="h-3 w-3" />}
                                    <span className="max-w-[150px] truncate">{att.filename}</span>
                                    <span className="text-[10px]">({formatFileSize(att.size_bytes)})</span>
                                    <Download className="h-3 w-3" />
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Reaction row */}
                            {!isEditingThis && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {/* Existing reactions */}
                                {(comment.reactions ?? []).map((r) => {
                                  const reacted = r.user_ids.includes(currentUserId ?? '');
                                  return (
                                    <button
                                      key={r.emoji}
                                      onClick={() => toggleReaction.mutate({ ticketId: id, commentId: comment.id, emoji: r.emoji })}
                                      className={cn(
                                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                                        reacted
                                          ? 'border-brand/40 bg-brand/10 text-brand'
                                          : 'border-border bg-background text-muted-foreground hover:border-brand/40 hover:bg-brand/5 hover:text-brand',
                                      )}
                                      title={reacted ? 'Remove reaction' : 'Add reaction'}
                                    >
                                      {r.emoji} <span className="font-medium">{r.count}</span>
                                    </button>
                                  );
                                })}

                                {/* Add reaction picker */}
                                <ReactionPicker
                                  onSelect={(emoji) => toggleReaction.mutate({ ticketId: id, commentId: comment.id, emoji })}
                                  existingReactions={comment.reactions ?? []}
                                  currentUserId={currentUserId}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No comments yet
                    </p>
                  )}

                  {/* Add comment */}
                  <div className="space-y-2">
                    {/* Editor — has its own border and min-height from RichTextEditor styles */}
                    <RichTextEditor
                      value={commentText}
                      onChange={setCommentText}
                      onSubmit={handleSubmitComment}
                      onImagePaste={handleImagePaste}
                      placeholder="Write a comment... (Ctrl+Enter to submit)"
                    />
                    {/* Pending attachments */}
                    {commentAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {commentAttachments.map((att) => (
                          <span
                            key={att.file_id}
                            className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
                          >
                            <Paperclip className="h-3 w-3" />
                            <span className="max-w-[150px] truncate">{att.filename}</span>
                            <button
                              onClick={() => setCommentAttachments((prev) => prev.filter((a) => a.file_id !== att.file_id))}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Action row — entirely below the editor, no overflow */}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setIsInternalComment((v) => !v)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                          isInternalComment
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                        title={isInternalComment ? 'Team-only — click to make public' : 'Mark as internal (team only)'}
                      >
                        {isInternalComment ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {isInternalComment ? 'Internal note' : 'Internal note?'}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <input
                          ref={commentFileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              handleCommentFileUpload(e.target.files);
                              e.target.value = '';
                            }
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => commentFileInputRef.current?.click()}
                          title="Attach file"
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={handleSubmitComment}
                          disabled={isSubmittingComment || isRichTextEmpty(commentText)}
                          size="sm"
                        >
                          {isSubmittingComment ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="mr-1.5 h-4 w-4" />
                          )}
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'activity' && (
                <div className="space-y-3">
                  {ticket.activity && ticket.activity.length > 0 ? (
                    ticket.activity.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 border-l-2 border-border pl-4 py-2"
                      >
                        <div className="flex-1">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">
                              {entry.actor.name}
                            </span>{' '}
                            {entry.action}
                            {entry.field && (
                              <>
                                {' '}
                                <span className="font-medium">{entry.field}</span>
                              </>
                            )}
                            {entry.old_value && entry.new_value && (
                              <>
                                {' '}
                                from{' '}
                                <span className="line-through text-muted-foreground">
                                  {entry.old_value}
                                </span>{' '}
                                to{' '}
                                <span className="font-medium">
                                  {entry.new_value}
                                </span>
                              </>
                            )}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(entry.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No activity recorded yet
                    </p>
                  )}
                </div>
              )}

              {activeTab === 'time_log' && (
                <div className="space-y-2">
                  {(ticket.time_estimate_raw || ticket.time_estimate_minutes) && (
                    <p className="text-xs text-muted-foreground">
                      Estimate: <span className="font-medium text-foreground">
                        {ticket.time_estimate_raw || formatMinutes(ticket.time_estimate_minutes!)}
                      </span>
                    </p>
                  )}
                  <WorkLogList
                    ticketId={id}
                    logs={ticket.work_logs ?? []}
                    totalMinutes={ticket.time_spent_minutes}
                    canApprove={canApprove}
                  />
                </div>
              )}

              {activeTab === 'attachments' && (
                <div className="space-y-4">
                  {/* Drop zone */}
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer',
                      isDragOver
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      if (e.dataTransfer.files.length > 0) {
                        handleFileUpload(e.dataTransfer.files);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Drag & drop files here, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Max 250MB per file</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleFileUpload(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                  </div>

                  {/* Upload progress */}
                  {uploadingFiles.length > 0 && (
                    <div className="space-y-2">
                      {uploadingFiles.map((name) => (
                        <div key={name} className="flex items-center gap-2 rounded-md border border-border p-2">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground truncate">{name.split('-').slice(0, -1).join('-')}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* File grid */}
                  {attachments.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {attachments.map((att) => {
                        const IconComponent = getFileIcon(att.mime_type);
                        const isImage = att.mime_type.startsWith('image/');
                        return (
                          <div
                            key={att._id}
                            className="group relative flex flex-col rounded-lg border border-border bg-card overflow-hidden"
                          >
                            {/* Preview area */}
                            <div
                              className={`flex items-center justify-center h-28 bg-muted/30 ${isImage ? 'cursor-pointer' : ''}`}
                              onClick={() => isImage && setPreviewAttachment({ id: att._id, name: att.original_name })}
                            >
                              {isImage && thumbnailUrls[att._id] ? (
                                <img
                                  src={thumbnailUrls[att._id]}
                                  alt={att.original_name}
                                  className="h-full w-full object-cover"
                                />
                              ) : isImage ? (
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                              ) : IconComponent ? (
                                <IconComponent className="h-10 w-10 text-muted-foreground" />
                              ) : (
                                <File className="h-10 w-10 text-muted-foreground" />
                              )}
                            </div>
                            {/* Info */}
                            <div className="p-2 space-y-0.5">
                              <p className="text-xs font-medium text-foreground truncate" title={att.original_name}>
                                {att.original_name}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {formatFileSize(att.size_bytes)} &middot; {new Date(att.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            {/* Actions */}
                            <div className="flex border-t border-border">
                              <button
                                onClick={() => handleDownload(att._id, att.original_name)}
                                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              >
                                <Download className="h-3 w-3" />
                                Download
                              </button>
                              <button
                                onClick={() => setDeleteFileId(att._id)}
                                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors border-l border-border"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    uploadingFiles.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No attachments yet
                      </p>
                    )
                  )}

                  {/* Delete attachment confirmation */}
                  <ConfirmDialog
                    open={!!deleteFileId}
                    onClose={() => setDeleteFileId(null)}
                    onConfirm={handleDeleteAttachment}
                    title="Delete Attachment"
                    description="Are you sure you want to delete this attachment? This action cannot be undone."
                    confirmLabel="Delete"
                    variant="destructive"
                  />

                  {/* Image preview lightbox */}
                  <Dialog open={!!previewAttachment} onClose={() => setPreviewAttachment(null)} wrapperClassName="max-w-3xl">
                    <DialogContent className="w-full p-0 overflow-hidden">
                      <DialogHeader className="px-4 py-3 border-b border-border">
                        <DialogTitle className="text-sm font-medium truncate pr-8">
                          {previewAttachment?.name}
                        </DialogTitle>
                        <DialogClose onClose={() => setPreviewAttachment(null)} />
                      </DialogHeader>
                      <div className="flex items-center justify-center bg-muted/20 min-h-[300px] max-h-[75vh] p-4">
                        {previewAttachment && thumbnailUrls[previewAttachment.id] ? (
                          <img
                            src={thumbnailUrls[previewAttachment.id]}
                            alt={previewAttachment.name}
                            className="max-h-[70vh] max-w-full object-contain rounded"
                          />
                        ) : (
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => previewAttachment && handleDownload(previewAttachment.id, previewAttachment.name)}
                        >
                          <Download className="h-4 w-4 mr-1.5" />
                          Download
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Type
                </p>
                <p className="mt-1 text-sm capitalize text-foreground">
                  {ticket.type.replace(/_/g, ' ')}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Priority
                </p>
                <div className="mt-1">
                  <PriorityBadge priority={ticket.priority as TicketPriority} />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Status
                </p>
                <div className="mt-1">
                  <StatusBadge status={ticket.status} />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Assignee
                </p>
                <div className="mt-1">
                  <UserAssignDropdown ticket={ticket} />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Reporter
                </p>
                <div className="mt-1">
                  <UserAssignDropdown ticket={ticket} field="reporter" />
                </div>
              </div>
              <TeamSelector ticket={ticket} />
              <SprintSelector ticket={ticket} />
              <MilestoneSelector ticket={ticket} />
              {ticket.labels && ticket.labels.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Labels
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ticket.labels.map((label) => (
                      <span
                        key={label}
                        className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <CreatedAtEditor ticket={ticket} />
              {/* resolved_at */}
              {ticket.resolved_at && (
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    <CheckCircle2 className="inline h-3 w-3 mr-1 text-emerald-500" />
                    Resolved
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {formatDistanceToNow(new Date(ticket.resolved_at), { addSuffix: true })}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Last Updated
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {formatDistanceToNow(new Date(ticket.updated_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              {/* Watchers */}
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  <Eye className="inline h-3 w-3 mr-1" />
                  Watchers
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {(ticket.watcher_ids ?? []).map((wid) => {
                    const u = orgUsers.find((u) => u.id === wid);
                    if (!u) return null;
                    return (
                      <span key={wid} className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 pl-1 pr-1.5 py-0.5 text-xs text-foreground">
                        <UserAvatar name={u.name || u.email} imageUrl={u.avatar_url} size="sm" />
                        <span className="max-w-[80px] truncate">{u.name || u.email}</span>
                        <button
                          onClick={() => updateTicket.mutate({ id, input: { watcher_ids: ticket.watcher_ids.filter((x) => x !== wid) } })}
                          className="ml-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove watcher"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                  <WatcherAddButton
                    ticketId={id}
                    watcherIds={ticket.watcher_ids ?? []}
                    orgUsers={orgUsers}
                    onAdd={(uid) => updateTicket.mutate({ id, input: { watcher_ids: [...(ticket.watcher_ids ?? []), uid] } })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SLA Tracking */}
          {ticket.sla && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-1.5">
                  <Shield className="h-4 w-4" />
                  SLA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ticket.sla.paused_at && (
                  <div className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-2.5 py-1.5 text-xs font-medium text-yellow-600">
                    <Pause className="h-3.5 w-3.5" />
                    SLA Clock Paused
                  </div>
                )}
                {/* Response SLA */}
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Response</p>
                  <div className="mt-1 flex items-center gap-2">
                    {ticket.sla.response_met === true && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                        <ShieldCheck className="h-3 w-3" /> MET
                      </span>
                    )}
                    {ticket.sla.response_met === false && (
                      <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-500">
                        <ShieldX className="h-3 w-3" /> BREACHED
                      </span>
                    )}
                    {ticket.sla.response_met === null && ticket.sla.response_deadline && (
                      <SlaCountdown deadline={ticket.sla.response_deadline} />
                    )}
                  </div>
                </div>
                {/* Resolution SLA */}
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Resolution</p>
                  <div className="mt-1 flex items-center gap-2">
                    {ticket.sla.resolution_met === true && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                        <ShieldCheck className="h-3 w-3" /> MET
                      </span>
                    )}
                    {ticket.sla.resolution_met === false && (
                      <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-500">
                        <ShieldX className="h-3 w-3" /> BREACHED
                      </span>
                    )}
                    {ticket.sla.resolution_met === null && ticket.sla.resolution_deadline && (
                      <SlaCountdown deadline={ticket.sla.resolution_deadline} />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Time Tracking */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-1.5">
                  <Timer className="h-4 w-4" />
                  Time Tracking
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowLogWorkDialog(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Estimate</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {ticket.time_estimate_raw || (ticket.time_estimate_minutes ? formatMinutes(ticket.time_estimate_minutes) : '—')}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Logged</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {formatMinutes(ticket.time_spent_minutes)}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              {ticket.time_estimate_minutes && ticket.time_estimate_minutes > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>
                      {Math.min(100, Math.round((ticket.time_spent_minutes / ticket.time_estimate_minutes) * 100))}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-2 rounded-full transition-all',
                        ticket.time_spent_minutes > ticket.time_estimate_minutes
                          ? 'bg-destructive'
                          : 'bg-primary',
                      )}
                      style={{
                        width: `${Math.min(100, (ticket.time_spent_minutes / ticket.time_estimate_minutes) * 100)}%`,
                      }}
                    />
                  </div>
                  {ticket.time_spent_minutes < ticket.time_estimate_minutes && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMinutes(ticket.time_estimate_minutes - ticket.time_spent_minutes)} remaining
                    </p>
                  )}
                  {ticket.time_spent_minutes > ticket.time_estimate_minutes && (
                    <p className="mt-1 text-xs text-destructive">
                      {formatMinutes(ticket.time_spent_minutes - ticket.time_estimate_minutes)} over estimate
                    </p>
                  )}
                </div>
              )}

              {/* Work logs */}
              {ticket.work_logs && ticket.work_logs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Work Logs</p>
                  {ticket.work_logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-2 rounded-md border border-border p-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground">
                            {log.user?.name || 'Unknown'}
                          </span>
                          <span className="text-xs font-semibold text-primary">
                            {formatMinutes(log.minutes)}
                          </span>
                        </div>
                        {log.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            {log.description}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(log.logged_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveWorkLog(log.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        title="Remove work log"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked Tickets */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Linked Tickets</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowLinkDialog(true)}>
                  <Link2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Blocks', ids: ticket.blocks_ids },
                { label: 'Blocked by', ids: ticket.blocked_by_ids },
                { label: 'Related', ids: ticket.related_ids },
                ...(ticket.parent_id ? [{ label: 'Parent', ids: [ticket.parent_id] }] : []),
              ].filter((g) => g.ids.length > 0).map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-medium uppercase text-muted-foreground mb-1">{group.label}</p>
                  {group.ids.map((linkedId) => {
                    const linked = ticket.linked_tickets?.[linkedId];
                    return (
                    <div key={linkedId} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 mb-1">
                      <a
                        href={`/tickets/${linkedId}`}
                        className="min-w-0 hover:underline"
                        title={linked?.title}
                      >
                        <span className="text-xs font-mono text-primary">{linked?.key ?? linkedId.slice(-8)}</span>
                        {linked?.title && (
                          <span className="ml-2 text-xs text-muted-foreground truncate">{linked.title}</span>
                        )}
                      </a>
                      <button
                        onClick={() => handleRemoveLink(linkedId)}
                        className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                        title="Remove link"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    );
                  })}
                </div>
              ))}
              {!ticket.blocks_ids?.length && !ticket.blocked_by_ids?.length &&
               !ticket.related_ids?.length && !ticket.parent_id && (
                <p className="text-xs text-muted-foreground">No linked tickets</p>
              )}
            </CardContent>
          </Card>

          {/* Linked Incidents */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Linked Incidents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ticket.linked_incident_ids && ticket.linked_incident_ids.length > 0 ? (
                ticket.linked_incident_ids.map((incId) => (
                  <div key={incId} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                    <a
                      href={`/incidents/${incId}`}
                      className="text-xs font-mono text-primary hover:underline truncate"
                    >
                      {incId.slice(-8)}
                    </a>
                    <button
                      onClick={async () => {
                        try {
                          await api.delete(`/api/v1/tickets/${id}/link-incident/${incId}`);
                          toast.success('Incident unlinked');
                          queryClient.invalidateQueries({ queryKey: ['ticket', id] });
                        } catch { toast.error('Failed to unlink incident'); }
                      }}
                      className="ml-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No linked incidents</p>
              )}
            </CardContent>
          </Card>

          {/* Linked Change Requests */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Linked Change Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ticket.linked_change_request_ids && ticket.linked_change_request_ids.length > 0 ? (
                ticket.linked_change_request_ids.map((crId) => (
                  <div key={crId} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                    <a
                      href={`/changes/${crId}`}
                      className="text-xs font-mono text-primary hover:underline truncate"
                    >
                      {crId.slice(-8)}
                    </a>
                    <button
                      onClick={async () => {
                        try {
                          await api.delete(`/api/v1/tickets/${id}/link-change-request/${crId}`);
                          toast.success('Change request unlinked');
                          queryClient.invalidateQueries({ queryKey: ['ticket', id] });
                        } catch { toast.error('Failed to unlink change request'); }
                      }}
                      className="ml-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No linked change requests</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Ticket"
        description={`Are you sure you want to delete ${formatTicketNumber(ticket.number, ticket.project_key)}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
      />

      {/* Add Link dialog */}
      <Dialog open={showLinkDialog} onClose={() => { setShowLinkDialog(false); setLinkTargetId(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Relationship</label>
              <Select value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)}>
                <option value="related">Related to</option>
                <option value="blocks">Blocks</option>
                <option value="blocked_by">Blocked by</option>
                <option value="parent">Parent of (this is a child of target)</option>
                <option value="child">Child of (target is parent)</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Target ticket</label>
              <input
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. TK-0898"
                value={linkTargetId}
                onChange={(e) => setLinkTargetId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              />
              <p className="text-xs text-muted-foreground">Enter the ticket key (e.g. TK-0898) or its number.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowLinkDialog(false); setLinkTargetId(''); }}>
                Cancel
              </Button>
              <Button
                onClick={handleAddLink}
                disabled={!linkTargetId.trim() || linkTicket.isPending}
              >
                {linkTicket.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                Add Link
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Work dialog */}
      <Dialog open={showLogWorkDialog} onClose={() => { setShowLogWorkDialog(false); setLogHours(''); setLogMinutes(''); setLogDescription(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Work</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Time Spent</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={logHours}
                  onChange={(e) => setLogHours(e.target.value)}
                  className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">hours</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  placeholder="0"
                  value={logMinutes}
                  onChange={(e) => setLogMinutes(e.target.value)}
                  className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Date</label>
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                placeholder="What did you work on?"
                value={logDescription}
                onChange={(e) => setLogDescription(e.target.value)}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowLogWorkDialog(false); setLogHours(''); setLogMinutes(''); setLogDescription(''); }}>
                Cancel
              </Button>
              <Button
                onClick={handleLogWork}
                disabled={addWorkLog.isPending}
              >
                {addWorkLog.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Timer className="mr-2 h-4 w-4" />
                )}
                Log Work
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link to Consumer dialog */}
      <Dialog open={showLinkConsumerDialog} onClose={() => setShowLinkConsumerDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Ticket to Consumer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6">
            <p className="text-sm text-muted-foreground">
              This will create a corresponding ticket in the selected consumer's tenant and link them via a bridge for synced updates.
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Consumer</label>
              <Select
                value={selectedConsumerId}
                onChange={(e) => setSelectedConsumerId(e.target.value)}
              >
                <option value="">Select a consumer...</option>
                {consumersWithTicketScope.map((c) => (
                  <option key={c.consumer!._id} value={c.consumer!._id}>
                    {c.consumer!.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowLinkConsumerDialog(false)}>
                Cancel
              </Button>
              <Button
                disabled={!selectedConsumerId || linkToConsumer.isPending}
                onClick={async () => {
                  try {
                    await linkToConsumer.mutateAsync({
                      ticketId: id,
                      consumerId: selectedConsumerId,
                    });
                    toast.success('Ticket linked to consumer');
                    setShowLinkConsumerDialog(false);
                    queryClient.invalidateQueries({ queryKey: ['ticket-bridge', id] });
                  } catch (err: any) {
                    toast.error(err?.body?.detail || err?.message || 'Failed to link ticket to consumer');
                  }
                }}
              >
                {linkToConsumer.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Users className="mr-2 h-4 w-4" />
                )}
                Link to Consumer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit ticket dialog */}
      <Dialog open={showEditDialog} onClose={() => setShowEditDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Ticket title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Priority</label>
              <Select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Labels</label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2">
                {editLabels.map((label) => (
                  <span
                    key={label}
                    className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => setEditLabels(editLabels.filter((l) => l !== label))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground min-w-[80px]"
                  placeholder={editLabels.length === 0 ? 'Type and press Enter' : ''}
                  value={editLabelInput}
                  onChange={(e) => setEditLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const trimmed = editLabelInput.trim().toLowerCase();
                      if (trimmed && !editLabels.includes(trimmed)) {
                        setEditLabels([...editLabels, trimmed]);
                        setEditLabelInput('');
                      }
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={updateTicket.isPending}>
                {updateTicket.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const COMMENT_SANITIZE_OPTS = {
  ALLOWED_TAGS: [
    'p', 'strong', 'em', 'u', 's', 'strike', 'del', 'a', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'br', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'data-type', 'data-checked'],
};

// Restricts href/src beyond DOMPurify's defaults to http(s) links and image data URIs only.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  for (const attr of ['href', 'src']) {
    const value = node.getAttribute(attr);
    if (value && !/^(https?:|data:image\/)/i.test(value.trim())) {
      node.removeAttribute(attr);
    }
  }
});

function sanitizeCommentHtml(html: string) {
  return DOMPurify.sanitize(html, COMMENT_SANITIZE_OPTS);
}

/** Renders comment body — detects HTML (from rich editor) vs plain text (legacy comments) */
function CommentBody({ body }: { body: string }) {
  const isHtml = body.startsWith('<');
  const [sanitized, setSanitized] = useState('');
  useEffect(() => {
    if (isHtml) setSanitized(sanitizeCommentHtml(body));
  }, [isHtml, body]);

  if (isHtml) {
    return (
      <>
        <style jsx global>{`
          .comment-html p { margin: 0.125rem 0; font-size: 0.875rem; color: hsl(var(--foreground)); line-height: 1.5; }
          .comment-html h1, .comment-html h2, .comment-html h3 { font-weight: 600; line-height: 1.3; margin: 0.5rem 0 0.25rem; color: hsl(var(--foreground)); }
          .comment-html h1 { font-size: 1.25rem; }
          .comment-html h2 { font-size: 1.125rem; }
          .comment-html h3 { font-size: 1rem; }
          .comment-html ul { list-style-type: disc; padding-left: 1.5rem; margin: 0.25rem 0; font-size: 0.875rem; }
          .comment-html ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.25rem 0; font-size: 0.875rem; }
          .comment-html li { margin: 0.125rem 0; }
          .comment-html li p { margin: 0; }
          .comment-html ul[data-type='taskList'] { list-style: none; padding-left: 0.25rem; }
          .comment-html li[data-type='taskItem'] { display: flex; align-items: flex-start; gap: 0.375rem; }
          .comment-html li[data-type='taskItem']::before {
            content: '';
            flex-shrink: 0;
            width: 0.8125rem;
            height: 0.8125rem;
            margin-top: 0.1875rem;
            border: 1.5px solid hsl(var(--border));
            border-radius: 0.25rem;
            background: transparent;
          }
          .comment-html li[data-type='taskItem'][data-checked='true']::before {
            background: hsl(var(--brand));
            border-color: hsl(var(--brand));
          }
          .comment-html li[data-type='taskItem'][data-checked='true'] { color: hsl(var(--muted-foreground)); text-decoration: line-through; }
          .comment-html strong { font-weight: 600; }
          .comment-html em { font-style: italic; }
          .comment-html u { text-decoration: underline; }
          .comment-html s, .comment-html strike, .comment-html del { text-decoration: line-through; }
          .comment-html blockquote { border-left: 3px solid hsl(var(--border)); margin: 0.375rem 0; padding: 0.125rem 0 0.125rem 0.75rem; color: hsl(var(--muted-foreground)); }
          .comment-html code { background: hsl(var(--muted)); border-radius: 0.25rem; padding: 0.1rem 0.3rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8125rem; }
          .comment-html pre { background: hsl(var(--muted)); border-radius: 0.375rem; padding: 0.5rem 0.75rem; margin: 0.375rem 0; overflow-x: auto; }
          .comment-html pre code { background: none; padding: 0; }
          .comment-html a { color: hsl(var(--brand)); text-decoration: underline; }
          .comment-html table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
          .comment-html th, .comment-html td { border: 1px solid hsl(var(--border)); padding: 0.375rem 0.5rem; font-size: 0.8125rem; text-align: left; }
          .comment-html th { font-weight: 600; background: hsl(var(--muted)); }
          .comment-html img { max-width: 100%; border-radius: 0.375rem; margin: 0.25rem 0; }
        `}</style>
        <div
          className="comment-html"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      </>
    );
  }

  return (
    <p className="text-sm text-foreground whitespace-pre-wrap">{body}</p>
  );
}
