'use client';

import { memo, useMemo, useEffect, useState } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps';
import { Card, CardContent } from '@/components/ui/Card';
import { useUIStore } from '@/lib/stores/ui.store';

const GEO_URL = '/data/countries-110m.json';

interface CheckPoint {
  id: string;
  name: string;
  last_status: 'up' | 'down' | 'degraded' | null;
  url: string | null;
  host: string | null;
  hostname: string | null;
  uptime_24h: number;
  last_response_time_ms: number | null;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_city: string | null;
  geo_country: string | null;
}

interface ChecksWorldMapProps {
  checks: CheckPoint[];
}

// Platform primary
const PRIMARY = '#FF6B2B';
const PRIMARY_DIM = '#C2410C';   // orange-700

const PALETTE = {
  light: {
    land: '#FFF7ED',              // orange-50
    landStroke: 'rgba(251,146,60,0.5)',  // orange-400 @ 50%
    landStrokeGlow: '#FB923C',
    probeStroke: '#FFFFFF',
    labelColor: '#475569',
    statBg: 'rgba(255,255,255,0.92)',
    statBorder: 'rgba(251,146,60,0.2)',
  },
  dark: {
    land: '#1C1108',              // dark warm
    landStroke: 'rgba(255,107,43,0.4)',  // primary @ 40%
    landStrokeGlow: '#FF6B2B',
    probeStroke: '#0D1117',
    labelColor: '#CBD5E1',
    statBg: 'rgba(13,17,23,0.92)',
    statBorder: 'rgba(255,107,43,0.2)',
  },
};

const STATUS = {
  up:       { color: '#16A34A', label: 'UP' },
  down:     { color: '#DC2626', label: 'DOWN' },
  degraded: { color: '#EAB308', label: 'DEGRADED' },
};

function ChecksWorldMap({ checks }: ChecksWorldMapProps) {
  const themePreference = useUIStore((s) => s.theme);
  const [isDark, setIsDark] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; check: CheckPoint } | null>(null);

  useEffect(() => {
    if (themePreference === 'dark') setIsDark(true);
    else if (themePreference === 'light') setIsDark(false);
    else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setIsDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [themePreference]);

  const palette = isDark ? PALETTE.dark : PALETTE.light;

  // Only plot checks that have geo coordinates
  const geoChecks = useMemo(
    () => checks.filter((c) => c.geo_lat != null && c.geo_lon != null),
    [checks],
  );

  // Compute label offsets to avoid overlapping labels for nearby endpoints
  const labelOffsets = useMemo(() => {
    const offsets = new Map<string, { dx: number; dy: number; anchor: string }>();
    const sorted = [...geoChecks].sort((a, b) => (a.geo_lon ?? 0) - (b.geo_lon ?? 0));
    const placed: Array<{ lon: number; lat: number; id: string }> = [];

    for (const check of sorted) {
      const lon = check.geo_lon!;
      const lat = check.geo_lat!;
      let dx = 0;
      let dy = -16;
      let anchor = 'middle';

      // Check proximity to already-placed labels
      const nearby = placed.filter(
        (p) => Math.abs(p.lon - lon) < 8 && Math.abs(p.lat - lat) < 6
      );

      if (nearby.length === 1) {
        // Offset to the right
        dx = 14;
        dy = -4;
        anchor = 'start';
      } else if (nearby.length === 2) {
        // Offset to the left
        dx = -14;
        dy = -4;
        anchor = 'end';
      } else if (nearby.length >= 3) {
        // Offset below
        dx = 0;
        dy = 18;
        anchor = 'middle';
      }

      offsets.set(check.id, { dx, dy, anchor });
      placed.push({ lon, lat, id: check.id });
    }
    return offsets;
  }, [geoChecks]);

  const upCount = checks.filter((c) => c.last_status === 'up').length;
  const downCount = checks.filter((c) => c.last_status === 'down').length;
  const degradedCount = checks.filter((c) => c.last_status === 'degraded').length;
  const avgMs = useMemo(() => {
    const valid = checks.filter((c) => c.last_response_time_ms != null);
    if (valid.length === 0) return null;
    return Math.round(valid.reduce((s, c) => s + (c.last_response_time_ms ?? 0), 0) / valid.length);
  }, [checks]);

  if (checks.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0 sm:p-0">
        <div
          className="relative"
          onMouseLeave={() => setTooltip(null)}
        >
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ scale: 120, center: [20, 30] }}
            width={960}
            height={400}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          >
            <defs>
              {/* Orange glow filter for country borders */}
              <filter id="border-glow" x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur in="SourceGraphic" stdDeviation={isDark ? 1.2 : 0.6} result="blur" />
                <feFlood floodColor={palette.landStrokeGlow} floodOpacity={isDark ? 0.5 : 0.3} result="color" />
                <feComposite in="color" in2="blur" operator="in" result="glow" />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Per-status glow gradients */}
              {Object.entries(STATUS).map(([key, { color }]) => (
                <radialGradient key={key} id={`glow-${key}`}>
                  <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </radialGradient>
              ))}
              <radialGradient id="glow-none">
                <stop offset="0%" stopColor="#64748B" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#64748B" stopOpacity={0} />
              </radialGradient>
            </defs>

            {/* Countries */}
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={palette.land}
                    stroke={palette.landStroke}
                    strokeWidth={0.7}
                    filter="url(#border-glow)"
                    style={{
                      default: { outline: 'none' },
                      hover: {
                        outline: 'none',
                        fill: isDark ? '#2A1A0A' : '#FED7AA',
                        stroke: PRIMARY,
                        strokeWidth: 1,
                      },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Real endpoint markers */}
            {geoChecks.map((check) => {
              const status = check.last_status ?? 'none';
              const color = STATUS[status as keyof typeof STATUS]?.color ?? '#64748B';
              const isDown = status === 'down';
              return (
                <Marker
                  key={check.id}
                  coordinates={[check.geo_lon!, check.geo_lat!]}
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect();
                    if (rect) {
                      setTooltip({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        check,
                      });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Glow */}
                  <circle r={isDown ? 24 : 18} fill={`url(#glow-${status})`} />
                  {/* Pulse ring for down checks */}
                  {isDown && (
                    <circle r={12} fill="none" stroke={color} strokeWidth={1.5} opacity={0.4}>
                      <animate attributeName="r" values="8;16" dur="1.5s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.5;0" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* Ring */}
                  <circle r={8} fill="none" stroke={color} strokeWidth={1} opacity={0.3} />
                  {/* Dot */}
                  <circle
                    r={5}
                    fill={color}
                    stroke={palette.probeStroke}
                    strokeWidth={2}
                    className="cursor-pointer"
                  />
                  {/* Label with collision-aware positioning */}
                  {(() => {
                    const offset = labelOffsets.get(check.id) || { dx: 0, dy: -16, anchor: 'middle' };
                    return (
                      <text
                        textAnchor={offset.anchor as any}
                        x={offset.dx}
                        y={offset.dy}
                        style={{
                          fontSize: 7.5,
                          fontFamily: 'Inter, system-ui, sans-serif',
                          fontWeight: 600,
                          fill: palette.labelColor,
                          paintOrder: 'stroke',
                          stroke: isDark ? '#0D1117' : '#FFFFFF',
                          strokeWidth: 3,
                          strokeLinejoin: 'round',
                        }}
                      >
                        {check.name.length > 20 ? check.name.slice(0, 18) + '…' : check.name}
                      </text>
                    );
                  })()}
                </Marker>
              );
            })}
          </ComposableMap>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm"
              style={{
                left: Math.min(tooltip.x + 12, 960 - 180),
                top: tooltip.y - 60,
                background: palette.statBg,
                borderColor: palette.statBorder,
                color: palette.labelColor,
                minWidth: 150,
              }}
            >
              <div className="font-semibold text-[12px]" style={{ color: isDark ? '#F1F5F9' : '#0F172A' }}>
                {tooltip.check.name}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS[tooltip.check.last_status as keyof typeof STATUS]?.color ?? '#64748B' }}
                />
                {STATUS[tooltip.check.last_status as keyof typeof STATUS]?.label ?? 'UNKNOWN'}
                {tooltip.check.last_response_time_ms != null && (
                  <span className="ml-auto font-mono">{tooltip.check.last_response_time_ms}ms</span>
                )}
              </div>
              {tooltip.check.geo_city && (
                <div className="mt-0.5 opacity-70">
                  {tooltip.check.geo_city}{tooltip.check.geo_country ? `, ${tooltip.check.geo_country}` : ''}
                </div>
              )}
              <div className="mt-0.5 opacity-70">
                Uptime 24h: {tooltip.check.uptime_24h.toFixed(1)}%
              </div>
            </div>
          )}

          {/* Bottom stats overlay */}
          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between">
            <div
              className="flex items-center gap-3 rounded-md px-2.5 py-1 text-[10px] font-medium backdrop-blur-sm"
              style={{
                background: palette.statBg,
                border: `1px solid ${palette.statBorder}`,
                color: palette.labelColor,
              }}
            >
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATUS.up.color }} />
                {upCount} up
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATUS.down.color }} />
                {downCount} down
              </span>
              {degradedCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATUS.degraded.color }} />
                  {degradedCount} degraded
                </span>
              )}
            </div>
            <div
              className="rounded-md px-2.5 py-1 text-[10px] font-medium backdrop-blur-sm"
              style={{
                background: palette.statBg,
                border: `1px solid ${palette.statBorder}`,
                color: palette.labelColor,
              }}
            >
              Avg: <span className="font-bold font-mono" style={{ color: STATUS[downCount > 0 ? 'down' : 'up'].color }}>
                {avgMs != null ? `${avgMs}ms` : '—'}
              </span>
              <span className="mx-1.5 opacity-30">|</span>
              {geoChecks.length} endpoint{geoChecks.length !== 1 ? 's' : ''} mapped
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(ChecksWorldMap);
