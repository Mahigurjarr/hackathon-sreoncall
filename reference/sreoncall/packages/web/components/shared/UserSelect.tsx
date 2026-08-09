'use client';

import type { TenantUser } from '@/lib/hooks/useUsers';

export function UserSelect({
  users,
  value,
  onChange,
  placeholder = 'Select a user\u2026',
  label,
}: {
  users: TenantUser[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <select
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
    </div>
  );
}
