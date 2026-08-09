'use client';

import { useState } from 'react';
import { ChevronDown, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useBacklogTickets, useUpdateTicket } from '@/lib/hooks/useTickets';
import { useSprints, useAssignTicketsToSprint } from '@/lib/hooks/useSprints';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-green-400',
};

const TYPE_LABELS: Record<string, string> = {
  epic: 'Epic',
  user_story: 'Story',
  task: 'Task',
  bug: 'Bug',
};

interface BacklogPanelProps {
  projectId?: string;
}

function DragHandle({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return (
    <td ref={setNodeRef} className="w-6 cursor-grab px-1 py-2.5" {...attributes} {...listeners}>
      <GripVertical className="h-4 w-4 text-muted-foreground/40 hover:text-muted-foreground" />
    </td>
  );
}

function DroppableSprintZone({ sprintId, sprintName }: { sprintId: string; sprintName: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: sprintId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-lg border-2 border-dashed px-3 py-2 text-center text-xs font-medium transition-colors',
        isOver
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-border text-muted-foreground',
      )}
    >
      {isOver ? `Drop to add to ${sprintName}` : sprintName}
    </div>
  );
}

export function BacklogPanel({ projectId }: BacklogPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sprintDropdownOpen, setSprintDropdownOpen] = useState<string | null>(null);
  const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);

  const { data, isLoading } = useBacklogTickets({ project_id: projectId });
  const { data: sprintsData } = useSprints();
  const assignTickets = useAssignTicketsToSprint();
  const updateTicket = useUpdateTicket();

  async function handleRemoveFromBacklog(ticketId: string) {
    try {
      await updateTicket.mutateAsync({ id: ticketId, input: { is_backlog: false } });
      toast.success('Removed from backlog');
    } catch {
      toast.error('Failed to update ticket');
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const tickets = data?.items ?? [];
  const activeSprints = (sprintsData?.data ?? []).filter(
    (s) => s.status === 'active' || s.status === 'planning',
  );

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingTicketId(null);
    const { active, over } = event;
    if (!over || !active) return;
    const ticketId = String(active.id);
    const sprintId = String(over.id);
    const sprint   = activeSprints.find((s) => s.id === sprintId);
    if (!sprint) return;
    try {
      await assignTickets.mutateAsync({ sprintId, ticketIds: [ticketId] });
      toast.success(`Added to ${sprint.name}`);
    } catch {
      toast.error('Failed to assign ticket');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssign(sprintId: string, ticketIds: string[]) {
    try {
      await assignTickets.mutateAsync({ sprintId, ticketIds });
      setSelected(new Set());
      setSprintDropdownOpen(null);
      toast.success(`${ticketIds.length} ticket${ticketIds.length > 1 ? 's' : ''} added to sprint`);
    } catch {
      toast.error('Failed to assign tickets to sprint');
    }
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading backlog...</div>;
  }

  if (tickets.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No backlog tickets. All tickets are assigned to a sprint.
      </div>
    );
  }

  const selectedIds = Array.from(selected);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDraggingTicketId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingTicketId(null)}
    >
    <div className="space-y-3">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-2">
          <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
          <div className="relative ml-auto">
            <button
              onClick={() => setSprintDropdownOpen(sprintDropdownOpen === 'bulk' ? null : 'bulk')}
              className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
            >
              Add to Sprint
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {sprintDropdownOpen === 'bulk' && (
              <div className="absolute right-0 top-8 z-20 min-w-[180px] rounded-lg border border-border bg-card shadow-lg">
                {activeSprints.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No active sprints</p>
                ) : (
                  activeSprints.map((sprint) => (
                    <button
                      key={sprint.id}
                      onClick={() => handleAssign(sprint.id, selectedIds)}
                      className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                    >
                      {sprint.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {/* Ticket table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="w-6 px-1" />
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.size === tickets.length && tickets.length > 0}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(tickets.map((t) => t.id)) : new Set())
                  }
                  className="accent-brand"
                />
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignee</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr
                key={ticket.id}
                className={cn(
                  'border-b border-border/50 transition-colors hover:bg-muted/30',
                  selected.has(ticket.id) && 'bg-brand/5',
                  draggingTicketId === ticket.id && 'opacity-50',
                )}
              >
                <DragHandle id={ticket.id} />
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(ticket.id)}
                    onChange={() => toggleSelect(ticket.id)}
                    className="accent-brand"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <a href={`/tickets/${ticket.id}`} className="font-medium text-foreground hover:text-brand transition-colors">
                    {ticket.title}
                  </a>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">TK-{String(ticket.number).padStart(4, '0')}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {TYPE_LABELS[ticket.type] ?? ticket.type}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize',
                    ticket.priority === 'high'   && 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400',
                    ticket.priority === 'medium' && 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400',
                    ticket.priority === 'low'    && 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400',
                  )}>
                    {ticket.priority}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {ticket.assignee?.name ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {new Date(ticket.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRemoveFromBacklog(ticket.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-red-400 hover:text-red-400"
                  >
                    Remove
                  </button>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setSprintDropdownOpen(sprintDropdownOpen === ticket.id ? null : ticket.id)
                      }
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                    >
                      Add to Sprint
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {sprintDropdownOpen === ticket.id && (
                      <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border bg-card shadow-lg">
                        {activeSprints.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No active sprints</p>
                        ) : (
                          activeSprints.map((sprint) => (
                            <button
                              key={sprint.id}
                              onClick={() => handleAssign(sprint.id, [ticket.id])}
                              className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                            >
                              {sprint.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sprint drop zones — visible when dragging */}
      {draggingTicketId && activeSprints.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Drop into sprint:</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {activeSprints.map((sprint) => (
              <DroppableSprintZone key={sprint.id} sprintId={sprint.id} sprintName={sprint.name} />
            ))}
          </div>
        </div>
      )}

      <DragOverlay>
        {draggingTicketId && (
          <div className="rounded-lg border border-brand bg-card px-3 py-2 shadow-lg text-sm font-medium text-foreground">
            {tickets.find((t) => t.id === draggingTicketId)?.title ?? 'Ticket'}
          </div>
        )}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
