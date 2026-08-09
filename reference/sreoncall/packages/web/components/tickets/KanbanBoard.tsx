'use client';

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { TicketCard } from './TicketCard';
import { useUpdateTicket, type Ticket, type BoardColumn } from '@/lib/hooks/useTickets';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface KanbanBoardProps {
  columns: BoardColumn[];
  onQuickCreate?: (status: string) => void;
}

const columnColors: Record<string, string> = {
  discover: 'border-t-[#0EA5E9]',
  open: 'border-t-info',
  in_progress: 'border-t-brand',
  in_review: 'border-t-ai',
  on_hold: 'border-t-[#64748B]',
  resolved: 'border-t-success',
  closed: 'border-t-p5',
};

function DroppableColumn({
  column,
  children,
  onQuickCreate,
}: {
  column: BoardColumn;
  children: React.ReactNode;
  onQuickCreate: (status: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.status,
  });

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-80 shrink-0 flex-col rounded-xl border border-border border-t-4 bg-card',
        columnColors[column.status] || 'border-t-p5',
      )}
    >
      <div className="flex items-center justify-between px-3 py-3">
        <h3 className="text-[13px] font-bold text-foreground">
          {column.label}
        </h3>
        <div className="flex items-center gap-1">
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-xs font-bold text-muted-foreground">
            {column.tickets.length}
          </span>
          <button
            onClick={() => onQuickCreate(column.status)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={`Create ticket in ${column.label}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-0 space-y-3 overflow-y-auto px-3 pb-3 transition-colors',
          isOver && 'bg-brand/5 rounded-b-xl',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function KanbanBoard({ columns, onQuickCreate }: KanbanBoardProps) {
  const updateTicket = useUpdateTicket();
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [localColumns, setLocalColumns] = useState(columns);

  if (columns !== localColumns && !activeTicket && !updateTicket.isPending) {
    setLocalColumns(columns);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const findTicketAndColumn = useCallback(
    (ticketId: string) => {
      for (const column of localColumns) {
        const ticket = column.tickets.find((t) => t.id === ticketId);
        if (ticket) {
          return { ticket, column };
        }
      }
      return null;
    },
    [localColumns],
  );

  function handleDragStart(event: DragStartEvent) {
    const result = findTicketAndColumn(String(event.active.id));
    if (result) {
      setActiveTicket(result.ticket);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeResult = findTicketAndColumn(activeId);
    if (!activeResult) return;

    let targetStatus = overId;
    const overResult = findTicketAndColumn(overId);
    if (overResult) {
      targetStatus = overResult.column.status;
    }

    if (activeResult.column.status === targetStatus) return;

    setLocalColumns((prev) =>
      prev.map((col) => {
        if (col.status === activeResult.column.status) {
          return {
            ...col,
            tickets: col.tickets.filter((t) => t.id !== activeId),
          };
        }
        if (col.status === targetStatus) {
          const alreadyExists = col.tickets.some((t) => t.id === activeId);
          if (alreadyExists) return col;
          return {
            ...col,
            tickets: [
              ...col.tickets,
              { ...activeResult.ticket, status: targetStatus },
            ],
          };
        }
        return col;
      }),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTicket(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    let targetStatus = overId;
    const overResult = findTicketAndColumn(overId);
    if (overResult) {
      targetStatus = overResult.column.status;
    }

    const targetColumn = localColumns.find((c) => c.status === targetStatus);
    if (!targetColumn) return;

    const originalColumn = columns.find((col) =>
      col.tickets.some((t) => t.id === activeId),
    );
    if (!originalColumn || originalColumn.status === targetStatus) return;

    updateTicket.mutate(
      { id: activeId, input: { status: targetStatus } },
      {
        onError: () => {
          toast.error('Failed to update ticket status');
          setLocalColumns(columns);
        },
      },
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full min-h-0 gap-5 overflow-x-auto overflow-y-hidden pb-4">
        {localColumns.map((column) => (
          <SortableContext
            key={column.status}
            items={column.tickets.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <DroppableColumn column={column} onQuickCreate={onQuickCreate ?? (() => {})}>
              {column.tickets.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} />
              ))}
              {column.tickets.length === 0 && (
                <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                  Drop tickets here
                </div>
              )}
            </DroppableColumn>
          </SortableContext>
        ))}
      </div>

      <DragOverlay>
        {activeTicket ? (
          <div className="rotate-2 opacity-90">
            <TicketCard ticket={activeTicket} isDragOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
