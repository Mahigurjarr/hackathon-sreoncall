'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  User,
  Settings,
  LogOut,
  Menu,
  CheckCheck,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui.store';
import {
  useUnreadCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/lib/hooks/useNotifications';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { formatDistanceToNow } from 'date-fns';

interface TopbarProps {
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
  orgSlug: string;
}

export function Topbar({ user, orgSlug }: TopbarProps) {
  const router = useRouter();
  const { toggleSidebar, theme, setTheme } = useUIStore();
  const { data: currentUser } = useCurrentUser();

  const displayName = currentUser?.name || user.name;
  const displayEmail = currentUser?.email || user.email;
  const displayImage = currentUser?.avatar_url || user.image;

  function cycleTheme() {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (next === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', prefersDark);
    }
  }

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: unreadData } = useUnreadCount();
  const { data: notificationsData } = useNotifications(10);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notificationsData?.data ?? [];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleNotificationClick(notification: any) {
    if (!notification.read) {
      markRead.mutate(notification.id);
    }
    if (notification.resource_type === 'ticket' && notification.resource_id) {
      setNotificationsOpen(false);
      router.push(`/tickets/${notification.resource_id}`);
    }
  }

  return (
    <header className="flex h-[50px] shrink-0 items-center gap-4 rounded-[12px] border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-navy-surface px-4 lg:px-6 z-30 shadow-[0_2px_8px_rgba(0,0,0,0.08)] mx-4 mt-4 mb-2">
      {/* Mobile menu toggle */}
      <button
        onClick={toggleSidebar}
        className="rounded-lg p-2 text-[#94A3B8] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] hover:text-[#0F172A] dark:hover:text-[#E2E8F0] lg:hidden"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      <span className="hidden lg:flex items-center gap-1.5 text-[11px] font-semibold text-[#FF6B2B] tracking-wide uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-[#FF6B2B]" />
        Super Admin
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* Dark mode toggle */}
        <button
          onClick={cycleTheme}
          className="rounded-lg p-2 text-[#94A3B8] transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] hover:text-[#0F172A] dark:hover:text-[#E2E8F0]"
          aria-label="Toggle theme"
          title={`Theme: ${theme}`}
        >
          {theme === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : theme === 'system' ? (
            <Monitor className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>

        {/* Notifications bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="relative rounded-lg p-2 text-[#94A3B8] transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] hover:text-[#0F172A] dark:hover:text-[#E2E8F0]"
            aria-label="Toggle notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FF6B2B] text-[10px] font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-[12px] border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-navy-surface shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
              <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#1E293B] px-4 py-3">
                <h3 className="text-sm font-semibold text-[#0F172A] dark:text-[#E2E8F0]">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllRead.mutate()}
                    className="flex items-center gap-1 text-xs text-[#FF6B2B] hover:underline"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length > 0 ? (
                  notifications.map((notif) => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04]',
                        !notif.read && 'bg-[rgba(255,107,43,0.05)]',
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm text-[#0F172A] dark:text-[#E2E8F0]', !notif.read && 'font-medium')}>
                          {notif.title}
                        </p>
                        <p className="mt-0.5 text-xs text-[#64748B] truncate">
                          {notif.body}
                        </p>
                        <p className="mt-1 text-xs text-[#94A3B8]">
                          {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      {!notif.read && (
                        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#FF6B2B]" />
                      )}
                    </button>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-[#64748B]">
                    No notifications
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User avatar — spec: circle r=13 (26px), bg #FF6B2B, initials 8px semibold white */}
        <div className="relative" ref={menuRef}>
          <button
            data-testid="user-menu-trigger"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04]"
          >
            {displayImage ? (
              <img
                src={displayImage}
                alt={displayName}
                className="h-[26px] w-[26px] rounded-full object-cover"
              />
            ) : (
              <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#FF6B2B] text-[8px] font-semibold text-white">
                {getInitials(displayName)}
              </div>
            )}
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[12px] border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-navy-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
              <div className="border-b border-[#E2E8F0] dark:border-[#1E293B] px-4 py-3">
                <p className="text-sm font-medium text-[#0F172A] dark:text-[#E2E8F0]">
                  {displayName}
                </p>
                <p className="text-xs text-[#64748B]">{displayEmail}</p>
              </div>

              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  router.push('/settings/profile');
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#0F172A] dark:text-[#E2E8F0] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] transition-colors"
              >
                <User className="h-4 w-4" />
                Profile
              </button>

              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  router.push('/settings/general');
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#0F172A] dark:text-[#E2E8F0] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] transition-colors"
              >
                <Settings className="h-4 w-4" />
                Settings
              </button>

              <div className="border-t border-[#E2E8F0] dark:border-[#1E293B]">
                <button
                  data-testid="menu-sign-out"
                  onClick={() => signOut({ callbackUrl: `${window.location.origin}/signin` })}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#DC2626] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
