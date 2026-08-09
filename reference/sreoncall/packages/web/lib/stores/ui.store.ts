import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  notificationsPanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleNotificationsPanel: () => void;
  setNotificationsPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'light',
      notificationsPanelOpen: false,

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),

      setTheme: (theme) => set({ theme }),

      toggleNotificationsPanel: () =>
        set((state) => ({
          notificationsPanelOpen: !state.notificationsPanelOpen,
        })),

      setNotificationsPanelOpen: (open) =>
        set({ notificationsPanelOpen: open }),
    }),
    {
      name: 'sreoncall-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    },
  ),
);
