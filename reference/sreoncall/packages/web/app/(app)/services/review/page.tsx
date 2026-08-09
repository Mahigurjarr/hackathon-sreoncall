'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, Server, Loader2, ChevronLeft, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  useServices,
  useUpdateService,
  useBulkClassifyServices,
  useDeleteService,
  type Service,
  type ServiceClassification,
} from '@/lib/hooks/useServices';

const CLASSIFICATIONS: ServiceClassification[] = ['app', 'platform', 'infrastructure', 'monitoring', 'system'];

const CLASSIFICATION_CONFIG: Record<ServiceClassification, { label: string; color: string }> = {
  app:            { label: 'Application',    color: 'text-blue-600 bg-blue-50 border-blue-200' },
  platform:       { label: 'Platform',       color: 'text-purple-600 bg-purple-50 border-purple-200' },
  infrastructure: { label: 'Infrastructure', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  monitoring:     { label: 'Monitoring',     color: 'text-green-600 bg-green-50 border-green-200' },
  system:         { label: 'System',         color: 'text-gray-600 bg-gray-50 border-gray-200' },
};

function ClassificationSelect({ value, onChange }: { value: ServiceClassification; onChange: (v: ServiceClassification) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ServiceClassification)}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium cursor-pointer outline-none',
        CLASSIFICATION_CONFIG[value].color,
      )}
    >
      {CLASSIFICATIONS.map((c) => (
        <option key={c} value={c}>{CLASSIFICATION_CONFIG[c].label}</option>
      ))}
    </select>
  );
}

function ServiceRow({
  service,
  onReclassify,
  onDismiss,
}: {
  service: Service;
  onReclassify: (id: string, classification: ServiceClassification) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{service.name}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
          <span className="capitalize">{service.type}</span>
          {service.cloud_metadata?.namespace && (
            <span className="font-mono">ns:{service.cloud_metadata.namespace}</span>
          )}
        </div>
      </div>
      <ClassificationSelect
        value={service.classification ?? 'app'}
        onChange={(c) => onReclassify(service.id, c)}
      />
      <Button
        variant="ghost"
        size="sm"
        className="text-[11px] text-muted-foreground hover:text-destructive"
        onClick={() => onDismiss(service.id)}
      >
        Dismiss
      </Button>
    </div>
  );
}

export default function ReviewServicesPage() {
  const [filter, setFilter] = useState<ServiceClassification | ''>('');
  const { data, isLoading } = useServices({ auto_discovered: true });
  const updateService = useUpdateService();
  const bulkClassify = useBulkClassifyServices();
  const deleteService = useDeleteService();

  const services = data?.data ?? [];
  const filtered = filter ? services.filter((s) => s.classification === filter) : services;

  const counts = CLASSIFICATIONS.reduce<Record<string, number>>((acc, c) => {
    acc[c] = services.filter((s) => s.classification === c).length;
    return acc;
  }, {});

  async function handleReclassify(id: string, classification: ServiceClassification) {
    try {
      await updateService.mutateAsync({ id, input: { classification } });
    } catch {
      toast.error('Failed to reclassify');
    }
  }

  async function handleDismiss(id: string) {
    try {
      await deleteService.mutateAsync(id);
      toast.success('Service dismissed');
    } catch {
      toast.error('Failed to dismiss');
    }
  }

  async function handleBulkClassify(classification: ServiceClassification) {
    const ids = filtered.map((s) => s.id);
    if (ids.length === 0) return;
    try {
      await bulkClassify.mutateAsync({ service_ids: ids, classification });
      toast.success(`Reclassified ${ids.length} services as ${CLASSIFICATION_CONFIG[classification].label}`);
    } catch {
      toast.error('Failed to bulk reclassify');
    }
  }

  return (
    <div className="space-y-6 px-4 py-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/services">
          <Button variant="ghost" size="sm"><ChevronLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#FF6B2B]" />
            <h1 className="text-xl font-bold text-foreground">Review Discovered Services</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {services.length} service{services.length !== 1 ? 's' : ''} auto-discovered from your infrastructure. Review and adjust classifications below.
          </p>
        </div>
      </div>

      {/* Classification summary chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('')}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            !filter ? 'border-foreground/20 bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          All ({services.length})
        </button>
        {CLASSIFICATIONS.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(filter === c ? '' : c)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === c ? CLASSIFICATION_CONFIG[c].color : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {CLASSIFICATION_CONFIG[c].label} ({counts[c] ?? 0})
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {filtered.length > 0 && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Bulk reclassify {filtered.length} shown:</span>
            {CLASSIFICATIONS.map((c) => (
              <button
                key={c}
                onClick={() => handleBulkClassify(c)}
                className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium hover:opacity-80', CLASSIFICATION_CONFIG[c].color)}
                disabled={bulkClassify.isPending}
              >
                {CLASSIFICATION_CONFIG[c].label}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Service list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="text-xs text-muted-foreground mt-1">
              {services.length === 0
                ? 'No auto-discovered services yet. Connect a cloud provider or install the agent to get started.'
                : 'No services match the selected filter.'}
            </p>
            <Link href="/services" className="text-xs text-primary hover:underline mt-3 block">
              Go to Service Catalog &rarr;
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              onReclassify={handleReclassify}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      <div className="flex justify-center">
        <Link href="/services">
          <Button variant="outline">Done &mdash; Go to Service Catalog</Button>
        </Link>
      </div>
    </div>
  );
}
