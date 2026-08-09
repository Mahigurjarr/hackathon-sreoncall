import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  read: boolean;
  link?: string;
  created_at: string;
}

interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  add: (notification: Omit<Notification, 'id' | 'read' | 'created_at'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  setNotifications: (notifications: Notification[]) => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],
  unreadCount: 0,

  add: (notification) =>
    set((state) => {
      const newNotification: Notification = {
        ...notification,
        id: crypto.randomUUID(),
        read: false,
        created_at: new Date().toISOString(),
      };
      const notifications = [newNotification, ...state.notifications];
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  markRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  remove: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  clear: () => set({ notifications: [], unreadCount: 0 }),

  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
    }),
}));
