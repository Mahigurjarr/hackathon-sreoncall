import { cn } from '@/lib/utils';

type ServiceStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

interface ServiceStatusBadgeProps {
  status: ServiceStatus;
  className?: string;
}

const statusConfig: Record<ServiceStatus, { label: string; dotClass: string; textClass: string }> = {
  operational: { label: 'Operational', dotClass: 'bg-emerald-500', textClass: 'text-emerald-700' },
  degraded: { label: 'Degraded', dotClass: 'bg-yellow-500', textClass: 'text-yellow-700' },
  partial_outage: { label: 'Partial Outage', dotClass: 'bg-orange-500', textClass: 'text-orange-700' },
  major_outage: { label: 'Major Outage', dotClass: 'bg-red-500', textClass: 'text-red-700' },
  maintenance: { label: 'Maintenance', dotClass: 'bg-blue-500', textClass: 'text-blue-700' },
};

export function ServiceStatusBadge({ status, className }: ServiceStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.operational;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', config.textClass, className)}>
      <span className={cn('h-2 w-2 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  );
}
