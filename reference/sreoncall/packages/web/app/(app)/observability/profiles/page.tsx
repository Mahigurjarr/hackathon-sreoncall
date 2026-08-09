'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Flame, RefreshCw, Cpu, MemoryStick } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useProfileLabelValues, useProfileRender } from '@/lib/hooks/useProfiles';

const PROFILE_TYPES = [
  { id: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds', label: 'CPU', icon: Cpu },
  { id: 'memory:alloc_objects:count:space:bytes', label: 'Memory', icon: MemoryStick },
] as const;

interface TopFunction {
  name: string;
  selfTicks: number;
  totalTicks: number;
  percentage: number;
}

function extractTopFunctions(data: any): TopFunction[] {
  if (!data?.flamebearer?.names || !data?.flamebearer?.levels) return [];

  const names: string[] = data.flamebearer.names;
  const levels: number[][] = data.flamebearer.levels;
  const functionMap = new Map<number, { selfTicks: number; totalTicks: number }>();

  for (const level of levels) {
    // Each entry in a level is: [offset, totalTicks, selfTicks, nameIndex, ...]
    for (let i = 0; i + 3 < level.length; i += 4) {
      const totalTicks = level[i + 1];
      const selfTicks = level[i + 2];
      const nameIndex = level[i + 3];

      if (selfTicks > 0) {
        const existing = functionMap.get(nameIndex);
        if (existing) {
          existing.selfTicks += selfTicks;
          existing.totalTicks += totalTicks;
        } else {
          functionMap.set(nameIndex, { selfTicks, totalTicks });
        }
      }
    }
  }

  const totalSelf = Array.from(functionMap.values()).reduce((s, v) => s + v.selfTicks, 0);

  return Array.from(functionMap.entries())
    .map(([nameIndex, { selfTicks, totalTicks }]) => ({
      name: names[nameIndex] || `<unknown>`,
      selfTicks,
      totalTicks,
      percentage: totalSelf > 0 ? (selfTicks / totalSelf) * 100 : 0,
    }))
    .sort((a, b) => b.selfTicks - a.selfTicks)
    .slice(0, 30);
}

export default function ProfilesPage() {
  const searchParams = useSearchParams();
  const initialService = searchParams.get('service') || '';

  const [selectedService, setSelectedService] = useState(initialService);
  const [profileType, setProfileType] = useState<string>(PROFILE_TYPES[0].id);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: serviceNames, isLoading: servicesLoading } = useProfileLabelValues('service_name');

  const query = selectedService ? `${profileType}{service_name="${selectedService}"}` : null;

  const {
    data: renderData,
    isLoading: renderLoading,
    refetch,
  } = useProfileRender({ query, enabled: !!selectedService });

  const topFunctions = useMemo(() => extractTopFunctions(renderData), [renderData]);

  const maxPercentage = topFunctions.length > 0 ? topFunctions[0].percentage : 100;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-200">Continuous Profiling</h1>
          <p className="text-sm text-zinc-400 mt-1">
            CPU and memory profiles collected via Pyroscope eBPF
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshKey((k) => k + 1);
            refetch();
          }}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Service Selector */}
        <select
          value={selectedService}
          onChange={(e) => setSelectedService(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
        >
          <option value="">Select a service...</option>
          {(serviceNames ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {/* Profile Type Buttons */}
        <div className="flex items-center gap-1 rounded-md border border-zinc-700 p-0.5">
          {PROFILE_TYPES.map((pt) => {
            const Icon = pt.icon;
            const active = profileType === pt.id;
            return (
              <button
                key={pt.id}
                onClick={() => setProfileType(pt.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {pt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {!selectedService ? (
        /* Empty State */
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-4">
              <Flame className="h-6 w-6 text-orange-400" />
            </div>
            <p className="text-sm text-zinc-400 text-center">
              Select a service to view CPU or memory profiles
            </p>
          </CardContent>
        </Card>
      ) : renderLoading || servicesLoading ? (
        /* Loading State */
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : topFunctions.length === 0 ? (
        /* No Data */
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Flame className="h-8 w-8 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400">
              No profile data found for <span className="font-mono text-zinc-200">{selectedService}</span>
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Profiles may take a few minutes to appear after the agent starts collecting.
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Results: Top Functions Bar Chart */
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-200">
                Top Functions — {PROFILE_TYPES.find((p) => p.id === profileType)?.label ?? 'CPU'}
              </h2>
              <span className="text-xs text-zinc-500">{topFunctions.length} functions</span>
            </div>
            <div className="space-y-1">
              {topFunctions.map((fn, i) => (
                <div key={i} className="group flex items-center gap-3 py-1.5">
                  <span className="w-12 text-right text-xs font-mono text-zinc-500 shrink-0">
                    {fn.percentage.toFixed(1)}%
                  </span>
                  <div className="flex-1 relative h-6">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-orange-500/20 group-hover:bg-orange-500/30 transition-colors"
                      style={{ width: `${(fn.percentage / maxPercentage) * 100}%` }}
                    />
                    <span className="relative z-10 px-2 text-xs font-mono text-zinc-300 leading-6 truncate block">
                      {fn.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                    {fn.selfTicks.toLocaleString()} ticks
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
