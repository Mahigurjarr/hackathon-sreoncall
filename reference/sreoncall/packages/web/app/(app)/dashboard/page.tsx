'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/shared/EmptyState';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import {
  PersonaSwitcher,
  getAvailablePersonas,
  getDefaultPersona,
  SREEngineerDash,
  SREManagerDash,
  PlatformEngineerDash,
  TenantAdminDash,
  MSPProviderDash,
  ConsumerDash,
  PlatformAdminDash,
} from '@/components/dashboard';
import type { PersonaKey } from '@/components/dashboard';
import { useDashboardStats, useRecentTickets, useDashboardActivity } from '@/components/dashboard/useDashboardData';

export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: currentUser } = useCurrentUser();

  // Resolve user identity
  const roles = currentUser?.roles || [(session?.user as any)?.role || 'agent'];
  const tenantType = (session?.user as any)?.tenantType || 'standalone';

  // Available personas for this user
  const availablePersonas = useMemo(
    () => getAvailablePersonas(roles, tenantType),
    [roles, tenantType],
  );

  // Active persona state — default based on role & tenant type
  const defaultPersona = useMemo(
    () => getDefaultPersona(roles, tenantType),
    [roles, tenantType],
  );
  const [activePersona, setActivePersona] = useState<PersonaKey>(defaultPersona);

  // Ensure activePersona is valid for available personas
  const persona = availablePersonas.some((p) => p.key === activePersona)
    ? activePersona
    : availablePersonas[0]?.key || 'sre_engineer';

  const handlePersonaChange = useCallback((key: PersonaKey) => {
    setActivePersona(key);
  }, []);

  // Welcome / all-clear detection for empty state
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: ticketsData, isLoading: ticketsLoading } = useRecentTickets();
  const { data: activityData, isLoading: activityLoading } = useDashboardActivity();

  const dataLoaded = !ticketsLoading && !activityLoading && !statsLoading;
  const tickets = ticketsData?.data || [];
  const activity = activityData?.data || [];
  const hasStats = stats && (
    (stats as any).active_incidents > 0 ||
    (stats as any).open_tickets > 0 ||
    (stats as any).total_services > 0 ||
    (stats as any).resolved_today > 0
  );
  const isNewTenant = dataLoaded && !hasStats && tickets.length === 0 && activity.length === 0;

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-[#64748B]">
          Overview of your SRE operations
        </p>
      </div>

      {/* Welcome state for brand new tenants */}
      {isNewTenant && (
        <EmptyState
          variant="welcome"
          title="Welcome to SREonCall!"
          description="Set up your team, services, and on-call schedules to get started with incident management."
          actionLabel="Get Started →"
          onAction={() => router.push('/settings/general')}
        />
      )}

      {/* Persona Switcher — only show if user has more than 1 persona */}
      {availablePersonas.length > 1 && (
        <PersonaSwitcher
          active={persona}
          onChange={handlePersonaChange}
          availablePersonas={availablePersonas}
        />
      )}

      {/* Persona Dashboard Views */}
      {persona === 'sre_engineer' && <SREEngineerDash />}
      {persona === 'sre_manager' && <SREManagerDash />}
      {persona === 'platform_engineer' && <PlatformEngineerDash />}
      {persona === 'tenant_admin' && <TenantAdminDash />}
      {persona === 'msp_provider' && <MSPProviderDash />}
      {persona === 'consumer' && <ConsumerDash />}
      {persona === 'platform_admin' && <PlatformAdminDash />}
    </div>
  );
}
