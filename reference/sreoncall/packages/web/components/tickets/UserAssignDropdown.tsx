'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useUsers } from '@/lib/hooks/useUsers';
import { useUpdateTicket, type Ticket } from '@/lib/hooks/useTickets';
import { getInitials } from '@/lib/utils';

interface UserAssignDropdownProps {
  ticket: Ticket;
  compact?: boolean;
  field?: 'assignee' | 'reporter';
}

const avatarColors = ['#FF6B2B', '#2563EB', '#16A34A', '#7C3AED', '#DC2626'];

export function UserAssignDropdown({ ticket, compact, field = 'assignee' }: UserAssignDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: users = [] } = useUsers();
  const updateTicket = useUpdateTicket();
  const selectedUser = field === 'reporter' ? ticket.reporter : ticket.assignee;
  const selectedUserId = field === 'reporter' ? ticket.reporter_id : ticket.assignee?.id ?? null;
  const canClear = field === 'assignee';
  const successLabel = field === 'reporter' ? 'Reporter updated' : 'Assignee updated';
  const clearedLabel = field === 'assignee' ? 'Assignee removed' : 'Reporter updated';
  const errorLabel = field === 'reporter' ? 'Failed to update reporter' : 'Failed to update assignee';

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }, []);

  // Create a portal container on mount
  const portalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    portalRef.current = el;
    return () => {
      document.body.removeChild(el);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      // Clear portal content when closed
      if (portalRef.current) portalRef.current.style.display = 'none';
      return;
    }

    if (portalRef.current) portalRef.current.style.display = 'block';
    updatePosition();

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      setSearch('');
    }

    function handleScroll() {
      setOpen(false);
      setSearch('');
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updatePosition]);

  async function handleSelect(userId: string | null) {
    setOpen(false);
    setSearch('');
    try {
      await updateTicket.mutateAsync({
        id: ticket.id,
        input: field === 'reporter' ? { reporter_id: userId || undefined } : { assignee_id: userId },
      });
      toast.success(userId ? successLabel : clearedLabel);
    } catch {
      toast.error(errorLabel);
    }
  }

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  const avatarColor = avatarColors[(ticket.number ?? 0) % avatarColors.length];

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(!open);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted transition-colors text-left"
      >
        {selectedUser ? (
          <>
            {selectedUser.avatar_url ? (
              <img
                src={selectedUser.avatar_url}
                alt={selectedUser.name}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                style={{ backgroundColor: avatarColor }}
              >
                {getInitials(selectedUser.name)}
              </div>
            )}
            {!compact && (
              <span className="text-sm text-foreground truncate max-w-[120px]">
                {selectedUser.name}
              </span>
            )}
          </>
        ) : (
          <>
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[8px] text-muted-foreground">
              ?
            </div>
            {!compact && (
              <span className="text-sm text-muted-foreground">
                {field === 'reporter' ? 'Select reporter' : 'Unassigned'}
              </span>
            )}
          </>
        )}
      </button>

      {open && pos && (
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-64 rounded-lg border border-border bg-card shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="p-2">
            <input
              autoFocus
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {canClear && selectedUser && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                Clear assignment
              </button>
            )}
            {filtered.map((user) => (
              <button
                key={user.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(user.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.name}
                    className="h-5 w-5 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[8px] font-semibold text-primary">
                    {getInitials(user.name)}
                  </div>
                )}
                <div className="flex flex-col items-start leading-none">
                  <span className="text-sm">{user.name}</span>
                  <span className="text-[10px] text-muted-foreground">{user.email}</span>
                </div>
                {selectedUserId === user.id && (
                  <span className="ml-auto text-xs text-primary">Current</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No users found
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
