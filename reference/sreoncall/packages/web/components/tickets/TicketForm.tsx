'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  useCreateTicket,
  useCreateConsumerTicket,
  useUploadTicketAttachment,
  type TicketType,
  type TicketPriority,
} from '@/lib/hooks/useTickets';
import { useProjects } from '@/lib/hooks/useProjects';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTeams } from '@/lib/hooks/useTeams';
import { useLinkedConsumers } from '@/lib/hooks/useProvider';

const ticketSchema = z.object({
  project_id: z.string().optional().default(''),
  type: z.enum(['epic', 'user_story', 'task', 'bug'] as const),
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().max(10000).optional().default(''),
  priority: z.enum(['high', 'medium', 'low'] as const),
  assignee_id: z.string().optional(),
  team_id: z.string().optional(),
  parent_id: z.string().optional(),
  time_estimate: z.string().optional(),
});

type TicketFormData = z.infer<typeof ticketSchema>;

interface TicketFormProps {
  onSuccess?: () => void;
  /** When true, show consumer selector for provider tenants */
  forConsumer?: boolean;
}

export function TicketForm({ onSuccess, forConsumer = false }: TicketFormProps) {
  const createTicket = useCreateTicket();
  const createConsumerTicket = useCreateConsumerTicket();
  const uploadAttachment = useUploadTicketAttachment();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.data ?? [];
  const { data: orgUsers = [] } = useUsers();
  const { data: teams = [] } = useTeams();
  const { data: consumers = [] } = useLinkedConsumers();
  const [selectedConsumerId, setSelectedConsumerId] = useState<string>('');
  const activeConsumers = consumers.filter(
    (c) => c.status === 'active' && c.scope.includes('tickets') && c.consumer
  );
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const ACCEPTED_TYPES = new Set([
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain', 'text/markdown',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/zip', 'application/x-tar', 'application/gzip',
    'application/json', 'application/x-yaml', 'text/yaml',
  ]);

  const addFiles = useCallback((incoming: File[]) => {
    const maxSize = 25 * 1024 * 1024;
    const valid = incoming.filter((f) => {
      if (f.size > maxSize) { toast.error(`${f.name} exceeds 25MB limit`); return false; }
      return true;
    });
    if (valid.length > 0) setPendingFiles((prev) => [...prev, ...valid]);
  }, []);

  // Global paste handler — captures image/file pastes anywhere in the form
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData?.files?.length) return;
      addFiles(Array.from(e.clipboardData.files));
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketFormData>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      project_id: '',
      type: 'task',
      title: '',
      description: '',
      priority: 'medium',
      assignee_id: '',
      team_id: '',
      parent_id: '',
      time_estimate: '',
    },
  });

  function addLabel() {
    const trimmed = labelInput.trim().toLowerCase();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
      setLabelInput('');
    }
  }

  function removeLabel(label: string) {
    setLabels(labels.filter((l) => l !== label));
  }

  function handleLabelKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addLabel();
    }
    if (e.key === 'Backspace' && !labelInput && labels.length > 0) {
      setLabels(labels.slice(0, -1));
    }
  }

  async function onSubmit(data: TicketFormData) {
    try {
      if (forConsumer && selectedConsumerId) {
        // Create ticket in consumer tenant via provider route (also auto-creates bridge)
        const created = await createConsumerTicket.mutateAsync({
          consumerId: selectedConsumerId,
          input: {
            type: data.type as TicketType,
            title: data.title,
            description: data.description,
            priority: data.priority as TicketPriority,
            labels,
            time_estimate: data.time_estimate || undefined,
          },
        });

        // Upload attachments to the mirrored provider ticket (same tenant as current user)
        if (pendingFiles.length > 0 && created?.provider_ticket_id) {
          for (const file of pendingFiles) {
            try {
              await uploadAttachment.mutateAsync({ ticketId: created.provider_ticket_id, file });
            } catch {
              toast.error(`Failed to attach ${file.name}`);
            }
          }
        }

        toast.success('Ticket created for consumer successfully');
        onSuccess?.();
        return;
      }

      const created = await createTicket.mutateAsync({
        project_id: data.project_id,
        type: data.type as TicketType,
        title: data.title,
        description: data.description,
        priority: data.priority as TicketPriority,
        assignee_id: data.assignee_id || null,
        team_id: data.team_id || null,
        labels,
        parent_id: data.parent_id || undefined,
        time_estimate: data.time_estimate || undefined,
      });

      // Upload pending attachments
      if (pendingFiles.length > 0 && created?.id) {
        for (const file of pendingFiles) {
          try {
            await uploadAttachment.mutateAsync({ ticketId: created.id, file });
          } catch {
            // Non-fatal — ticket was created, attachment failed
            toast.error(`Failed to attach ${file.name}`);
          }
        }
      }

      toast.success('Work ticket created successfully');
      onSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create work ticket',
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-6 pb-6">
      {/* Consumer selector (provider mode only) */}
      {forConsumer && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Consumer Tenant *</label>
          <Select
            value={selectedConsumerId}
            onChange={(e) => setSelectedConsumerId(e.target.value)}
          >
            <option value="">Select a consumer...</option>
            {activeConsumers.map((c) => (
              <option key={c.consumer!._id} value={c.consumer!._id}>
                {c.consumer!.name}
              </option>
            ))}
          </Select>
          {!selectedConsumerId && (
            <p className="text-xs text-muted-foreground">
              Ticket will be created in the selected consumer&apos;s tenant.
            </p>
          )}
        </div>
      )}

      {/* Project (hidden when creating for consumer — backend picks default) */}
      {!forConsumer && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Project *</label>
          <Select {...register('project_id')}>
            <option value="">Select a project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {errors.project_id && (
            <p className="text-xs text-destructive">{errors.project_id.message}</p>
          )}
        </div>
      )}

      {/* Type */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Type <span className="text-destructive">*</span></label>
        <Select {...register('type')}>
          <option value="task">Task</option>
          <option value="bug">Bug</option>
          <option value="user_story">User Story</option>
          <option value="epic">Epic</option>
        </Select>
        {errors.type && (
          <p className="text-xs text-destructive">{errors.type.message}</p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Title <span className="text-destructive">*</span></label>
        <Input placeholder="Brief summary of the issue" {...register('title')} />
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Description</label>
        <textarea
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Describe the issue in detail..."
          {...register('description')}
        />
        {errors.description && (
          <p className="text-xs text-destructive">
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Priority <span className="text-destructive">*</span></label>
        <Select {...register('priority')}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        {errors.priority && (
          <p className="text-xs text-destructive">{errors.priority.message}</p>
        )}
      </div>

      {/* Assignee (not available when creating for consumer) */}
      {!forConsumer && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Assignee</label>
          <Select {...register('assignee_id')}>
            <option value="">Unassigned</option>
            {orgUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </Select>
        </div>
      )}

      {/* Team (not available when creating for consumer) */}
      {!forConsumer && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Team</label>
          <Select {...register('team_id')}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id ?? t._id} value={t.id ?? t._id}>{t.name}</option>
            ))}
          </Select>
        </div>
      )}

      {/* Parent Ticket (not available when creating for consumer) */}
      {!forConsumer && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Parent Ticket (optional)</label>
          <Input placeholder="Parent ticket ID" {...register('parent_id')} />
        </div>
      )}

      {/* Time Estimate */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Time Estimate</label>
        <Input
          placeholder="e.g. 30m, 2h, 1d, 1w"
          {...register('time_estimate')}
        />
        <p className="text-xs text-muted-foreground">
          Formats: 30m, 1h, 2d (8h/day), 1w (40h/week), 2h30m
        </p>
      </div>

      {/* Labels */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Labels</label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2">
          {labels.map((label) => (
            <span
              key={label}
              className="flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              {label}
              <button
                type="button"
                onClick={() => removeLabel(label)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground min-w-[80px]"
            placeholder={labels.length === 0 ? 'Type and press Enter' : ''}
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={handleLabelKeyDown}
            onBlur={addLabel}
          />
        </div>
      </div>

      {/* Attachments */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Attachments</label>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip,.tar,.gz,.log,.json,.yaml,.yml"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              addFiles(Array.from(e.target.files));
              e.target.value = '';
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            dragCounterRef.current += 1;
            setIsDragging(true);
          }}
          onDragLeave={() => {
            dragCounterRef.current -= 1;
            if (dragCounterRef.current === 0) setIsDragging(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dragCounterRef.current = 0;
            setIsDragging(false);
            const files = Array.from(e.dataTransfer.files).filter((f) =>
              ACCEPTED_TYPES.has(f.type) || f.type === ''
            );
            addFiles(files);
          }}
          className={`flex flex-col items-center gap-1 rounded-md border border-dashed px-3 py-3 text-sm transition-colors w-full ${
            isDragging
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-input bg-background text-muted-foreground hover:border-primary hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            {isDragging ? 'Drop files here' : 'Click, drag & drop, or paste files'}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            PDF, DOCX, PNG, JPG, CSV, ZIP and more &middot; Max 25MB per file
          </span>
        </button>
        {pendingFiles.length > 0 && (
          <div className="space-y-1">
            {pendingFiles.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Paperclip className="h-3.5 w-3.5 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground leading-tight">{file.name}</p>
                    <p className="text-muted-foreground mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onSuccess}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || (forConsumer && !selectedConsumerId)}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : forConsumer ? (
            'Create for Consumer'
          ) : (
            'Create Work Ticket'
          )}
        </Button>
      </div>
    </form>
  );
}
