import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

// Format a ticket number with its project key prefix (e.g. "INFRA-0411").
// Falls back to the generic "TK-" prefix for tickets without a project key.
export function formatTicketNumber(num: number, projectKey?: string | null): string {
  const prefix = projectKey?.trim() ? projectKey.trim().toUpperCase() : 'TK';
  return `${prefix}-${String(num).padStart(4, '0')}`;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
