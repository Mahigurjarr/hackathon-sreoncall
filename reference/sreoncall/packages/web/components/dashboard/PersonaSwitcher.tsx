'use client';

import {
  Zap,
  Users,
  Server,
  Settings,
  Building2,
  UserCheck,
  Shield,
  type LucideIcon,
} from 'lucide-react';

export type PersonaKey =
  | 'sre_engineer'
  | 'sre_manager'
  | 'platform_engineer'
  | 'tenant_admin'
  | 'msp_provider'
  | 'consumer'
  | 'platform_admin';

export interface PersonaDef {
  key: PersonaKey;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Roles that should see this persona */
  roles: string[];
  /** Tenant types that should see this persona (empty = all) */
  tenantTypes: string[];
}

export const PERSONAS: PersonaDef[] = [
  {
    key: 'sre_engineer',
    label: 'SRE Engineer',
    description: 'Frontline on-call responder — incidents, alerts, and runbooks',
    icon: Zap,
    roles: ['agent', 'manager', 'tenant_admin'],
    tenantTypes: ['standalone', 'provider'],
  },
  {
    key: 'sre_manager',
    label: 'SRE Manager',
    description: 'Team performance, SLA compliance, and operational health',
    icon: Users,
    roles: ['manager', 'tenant_admin'],
    tenantTypes: ['standalone', 'provider'],
  },
  {
    key: 'platform_engineer',
    label: 'Platform Engineer',
    description: 'Infrastructure, observability, SLOs, and system reliability',
    icon: Server,
    roles: ['agent', 'manager', 'tenant_admin'],
    tenantTypes: ['standalone', 'provider'],
  },
  {
    key: 'tenant_admin',
    label: 'Org Admin',
    description: 'Organization management, billing, compliance, and configuration',
    icon: Settings,
    roles: ['tenant_admin'],
    tenantTypes: ['standalone', 'provider', 'consumer'],
  },
  {
    key: 'msp_provider',
    label: 'MSP Provider',
    description: 'Consumer tenant health, cross-tenant SLA, and escalations',
    icon: Building2,
    roles: ['tenant_admin', 'manager'],
    tenantTypes: ['provider'],
  },
  {
    key: 'consumer',
    label: 'Consumer',
    description: 'Your operations and provider interaction',
    icon: UserCheck,
    roles: ['agent', 'manager', 'tenant_admin'],
    tenantTypes: ['consumer'],
  },
  {
    key: 'platform_admin',
    label: 'Platform Admin',
    description: 'Platform-wide view across all tenants and system health',
    icon: Shield,
    roles: ['platform_admin'],
    tenantTypes: [],
  },
];

interface PersonaSwitcherProps {
  active: PersonaKey;
  onChange: (key: PersonaKey) => void;
  availablePersonas: PersonaDef[];
}

export function PersonaSwitcher({ active, onChange, availablePersonas }: PersonaSwitcherProps) {
  const activeDef = availablePersonas.find((p) => p.key === active);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {availablePersonas.map((persona) => {
          const Icon = persona.icon;
          const isActive = persona.key === active;
          return (
            <button
              key={persona.key}
              onClick={() => onChange(persona.key)}
              className={`
                inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5
                text-xs font-medium transition-all duration-200
                ${
                  isActive
                    ? 'border-brand bg-brand text-white shadow-sm'
                    : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-brand/50 hover:text-brand dark:bg-navy-surface dark:border-[#334155] dark:text-[#94A3B8] dark:hover:text-brand'
                }
              `}
            >
              <Icon className="h-3.5 w-3.5" />
              {persona.label}
            </button>
          );
        })}
      </div>
      {activeDef && (
        <p className="mt-2 text-[11px] text-[#94A3B8]">{activeDef.description}</p>
      )}
    </div>
  );
}

/** Determine which personas a user can access based on their role and tenant type */
export function getAvailablePersonas(roles: string[], tenantType: string): PersonaDef[] {
  return PERSONAS.filter((p) => {
    const roleMatch = p.roles.some((r) => roles.includes(r));
    const tenantMatch = p.tenantTypes.length === 0 || p.tenantTypes.includes(tenantType);
    return roleMatch && tenantMatch;
  });
}

/** Pick the best default persona for a user */
export function getDefaultPersona(roles: string[], tenantType: string): PersonaKey {
  if (roles.includes('platform_admin')) return 'platform_admin';
  if (tenantType === 'consumer') return 'consumer';
  if (tenantType === 'provider' && (roles.includes('tenant_admin') || roles.includes('manager')))
    return 'msp_provider';
  if (roles.includes('tenant_admin')) return 'tenant_admin';
  if (roles.includes('manager')) return 'sre_manager';
  return 'sre_engineer';
}
