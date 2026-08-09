'use client';

import { useMemo, useState, useCallback, useRef, useEffect, memo } from 'react';
import { cn } from '@/lib/utils';
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  HardDrive,
  Layers,
  User,
  Users,
  Zap,
} from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Position,
  Handle,
  MarkerType,
  getBezierPath,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  ReactFlowProvider,
  Panel,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';

/* ─── Types ────────────────────────────────────────────────────────────── */

interface NodeHealth {
  error_rate_percent: number | null;
  latency_p99_ms: number | null;
  cpu_percent: number | null;
  memory_percent: number | null;
}

interface TopoNode {
  service_id: string;
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  is_root_cause: boolean;
  is_affected: boolean;
  health: NodeHealth;
  owner_team: { name: string } | null;
  oncall_user: { name: string } | null;
}

interface TopoEdge {
  source_service_id: string;
  target_service_id: string;
  dependency_type: string;
  criticality: string;
  traffic: {
    requests_per_minute: number | null;
    error_rate_percent: number | null;
    latency_ms: number | null;
  };
}

interface TopologyMapProps {
  nodes: TopoNode[];
  edges: TopoEdge[];
  hoverDepth: 'full' | 'summary' | 'none';
  interactive: boolean;
  showMascot: boolean;
  mascotMode: 'tips' | 'status' | 'hidden';
  mascotMessage?: string;
}

/* ─── Constants ────────────────────────────────────────────────────────── */

const NODE_WIDTH = 160;
const NODE_HEIGHT = 100;

/* ─── Status color helpers ─────────────────────────────────────────────── */

const STATUS_COLORS = {
  healthy: {
    dot: '#16A34A',
    border: 'rgba(22,163,74,0.2)',
    borderHover: 'rgba(22,163,74,0.4)',
    glow: 'rgba(22,163,74,0.15)',
    sparkBg: '#16A34A',
  },
  degraded: {
    dot: '#FF6B2B',
    border: 'rgba(255,107,43,0.3)',
    borderHover: 'rgba(255,107,43,0.5)',
    glow: 'rgba(255,107,43,0.12)',
    sparkBg: '#FF6B2B',
  },
  down: {
    dot: '#DC2626',
    border: 'rgba(220,38,38,0.35)',
    borderHover: 'rgba(220,38,38,0.6)',
    glow: 'rgba(220,38,38,0.15)',
    sparkBg: '#DC2626',
  },
  unknown: {
    dot: '#64748B',
    border: 'rgba(100,116,139,0.2)',
    borderHover: 'rgba(100,116,139,0.4)',
    glow: 'rgba(100,116,139,0.1)',
    sparkBg: '#64748B',
  },
  // Unaffected healthy nodes show clear green during incidents
  unaffected: {
    dot: '#16A34A',
    border: 'rgba(22,163,74,0.35)',
    borderHover: 'rgba(22,163,74,0.5)',
    glow: 'rgba(22,163,74,0.12)',
    sparkBg: '#16A34A',
  },
  // Orange styling for affected (non-root-cause) nodes
  affected: {
    dot: '#FF6B2B',
    border: 'rgba(255,107,43,0.4)',
    borderHover: 'rgba(255,107,43,0.6)',
    glow: 'rgba(255,107,43,0.18)',
    sparkBg: '#FF6B2B',
  },
  // Red pulsing styling for root cause nodes
  rootCause: {
    dot: '#DC2626',
    border: 'rgba(220,38,38,0.5)',
    borderHover: 'rgba(220,38,38,0.7)',
    glow: 'rgba(220,38,38,0.25)',
    sparkBg: '#DC2626',
  },
} as const;

/* ─── Edge helpers ─────────────────────────────────────────────────────── */

function getEdgeClass(
  edge: TopoEdge,
  sourceStatus?: TopoNode['status'],
  targetStatus?: TopoNode['status'],
): 'ok' | 'degraded' | 'critical' {
  if (
    targetStatus === 'down' ||
    sourceStatus === 'down' ||
    edge.criticality === 'critical'
  ) {
    return 'critical';
  }
  if (
    targetStatus === 'degraded' ||
    sourceStatus === 'degraded' ||
    (edge.traffic.error_rate_percent !== null &&
      edge.traffic.error_rate_percent > 1)
  ) {
    return 'degraded';
  }
  return 'ok';
}

function getParticleCount(edgeClass: 'ok' | 'degraded' | 'critical'): number {
  switch (edgeClass) {
    case 'critical':
      return 3;
    case 'degraded':
      return 2;
    case 'ok':
      return 1;
  }
}

/* ─── Sparkline data generator ─────────────────────────────────────────── */

function generateSparkBars(
  status: TopoNode['status'],
  errorRate: number | null,
): number[] {
  const count = 12;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    if (status === 'down') {
      bars.push(10 + (i / count) * 80 + Math.random() * 10);
    } else if (status === 'degraded') {
      bars.push(15 + (i / count) * 40 + Math.random() * 15);
    } else {
      bars.push(20 + Math.random() * 25);
    }
  }
  return bars;
}

/* ─── Gauge helper ─────────────────────────────────────────────────────── */

function GaugeBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const v = value ?? 0;
  const color =
    v >= 85
      ? 'bg-gradient-to-r from-error to-error/70'
      : v >= 60
        ? 'bg-gradient-to-r from-warning to-warning/50'
        : 'bg-gradient-to-r from-success to-success/50';
  const textColor =
    v >= 85 ? 'text-error' : v >= 60 ? 'text-warning' : 'text-muted-foreground';

  return (
    <div className="mt-2">
      <div className="flex justify-between text-[8px] mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-semibold', textColor)}>
          {value !== null ? `${v.toFixed(2)}%` : '--'}
        </span>
      </div>
      <div className="h-[5px] rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Tooltip Row ──────────────────────────────────────────────────────── */

function TooltipRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between py-[2.5px] text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold', valueClass)}>{value}</span>
    </div>
  );
}

/* ─── Dagre Layout ─────────────────────────────────────────────────────── */

interface ServiceNodeData {
  topoNode: TopoNode;
  hoverDepth: 'full' | 'summary' | 'none';
  interactive: boolean;
  sparkBars: number[];
  hasAffectedNodes: boolean;
  [key: string]: unknown;
}

function getLayoutedElements(
  rfNodes: Node<ServiceNodeData>[],
  rfEdges: Edge[],
): { nodes: Node<ServiceNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));

  rfNodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  rfEdges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  const layoutedNodes = rfNodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges: rfEdges };
}

/* ─── Custom Node Component ────────────────────────────────────────────── */

function ServiceNode({ data, id }: NodeProps<Node<ServiceNodeData>>) {
  const [hovered, setHovered] = useState(false);
  const { topoNode: node, hoverDepth, interactive, sparkBars, hasAffectedNodes } = data;
  const errorRate = node.health.error_rate_percent;
  const latency = node.health.latency_p99_ms;
  const isHighError = errorRate !== null && errorRate > 2;

  // Determine which color set to use based on node role in the incident
  const isUnaffectedHealthy =
    hasAffectedNodes && !node.is_root_cause && !node.is_affected && node.status === 'healthy';
  const colors = node.is_root_cause
    ? STATUS_COLORS.rootCause
    : node.is_affected && !node.is_root_cause
      ? STATUS_COLORS.affected
      : isUnaffectedHealthy
        ? STATUS_COLORS.unaffected
        : STATUS_COLORS[node.status];

  return (
    <div
      className={cn(
        'relative transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        interactive && 'cursor-pointer',
      )}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: node.is_root_cause
          ? hovered ? 'translateY(-3px) scale(1.08)' : 'scale(1.05)'
          : hovered ? 'translateY(-3px) scale(1.03)' : undefined,
      }}
    >
      {/* Target handle (top) — invisible */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent"
      />

      {/* Node card */}
      <div
        className={cn(
          'relative rounded-[10px] px-2.5 py-2 min-w-[110px] max-w-[155px]',
          'bg-card dark:bg-navy-surface',
          'transition-all duration-300',
          // No opacity dimming — healthy nodes stay fully visible
        )}
        style={{
          border: node.is_root_cause
            ? `2px solid ${hovered ? colors.borderHover : colors.border}`
            : node.is_affected
              ? `2px solid ${hovered ? colors.borderHover : colors.border}`
              : `1.5px solid ${hovered ? colors.borderHover : colors.border}`,
          boxShadow: node.is_root_cause
            ? `0 0 30px ${colors.glow}, 0 0 60px rgba(220,38,38,0.08), 0 2px 8px rgba(0,0,0,0.08)`
            : node.is_affected
              ? `0 0 20px ${colors.glow}, 0 2px 8px rgba(0,0,0,0.08)`
              : hovered
                ? '0 8px 24px rgba(0,0,0,0.20)'
                : node.status === 'down'
                  ? `0 0 20px ${colors.glow}, 0 2px 8px rgba(0,0,0,0.08)`
                  : node.status === 'degraded'
                    ? `0 0 15px ${colors.glow}, 0 2px 8px rgba(0,0,0,0.08)`
                    : isUnaffectedHealthy
                      ? '0 1px 4px rgba(0,0,0,0.05)'
                      : '0 2px 8px rgba(0,0,0,0.08)',
          animation: node.is_root_cause
            ? 'rootGlow 3s ease-in-out infinite'
            : undefined,
        }}
      >
        {/* Header row: dot + name */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block w-[7px] h-[7px] rounded-full shrink-0',
              (node.status === 'down' || node.is_root_cause) && 'animate-[blink_1.2s_infinite]',
            )}
            style={{
              backgroundColor: colors.dot,
              boxShadow: `0 0 ${node.is_root_cause ? '12px' : node.status === 'down' ? '10px' : '6px'} ${colors.glow}`,
            }}
          />
          <span
            className={cn(
              'text-[9px] font-bold tracking-[0.01em] truncate max-w-[110px]',
              isUnaffectedHealthy ? 'text-muted-foreground' : 'text-foreground',
            )}
            title={node.name}
          >
            {node.name}
          </span>
        </div>

        {/* Type label */}
        <div className="text-[6.5px] text-muted-foreground mt-0.5 uppercase tracking-[0.06em] font-semibold">
          {node.type}
          {node.is_root_cause && (
            <span className="text-error ml-1 normal-case tracking-normal font-bold">
              Root Cause
            </span>
          )}
          {node.is_affected && !node.is_root_cause && (
            <span className="text-warning ml-1 normal-case tracking-normal">
              Affected
            </span>
          )}
        </div>

        {/* Compact status — details shown on hover */}
        <div className="text-[7.5px] text-muted-foreground mt-1">
          {isHighError
            ? <span className="text-error font-semibold">Err: {(errorRate ?? 0).toFixed(2)}%</span>
            : <span className="text-success font-medium">{errorRate !== null ? `Err: ${errorRate.toFixed(2)}%` : 'Err: —'}</span>
          }
        </div>

        {/* Sparkline bar chart */}
        <div
          className={cn(
            'flex items-end gap-[1px] mt-1.5 pt-0.5 border-t',
            isUnaffectedHealthy ? 'h-[14px]' : 'h-[20px]',
          )}
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          {sparkBars.map((h, i) => (
            <div
              key={i}
              className="flex-1 min-w-[2px] rounded-t-[1.5px] transition-[height] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                height: isUnaffectedHealthy ? `${h * 0.6}%` : `${h}%`,
                backgroundColor: colors.sparkBg,
                opacity: i === sparkBars.length - 1
                  ? (isUnaffectedHealthy ? 0.4 : 1)
                  : node.status === 'down' ? 0.4 : node.status === 'degraded' ? 0.3 : isUnaffectedHealthy ? 0.1 : 0.2,
              }}
            />
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hoverDepth !== 'none' && hovered && (
        <div
          className={cn(
            'absolute left-1/2 bottom-[calc(100%+14px)] -translate-x-1/2',
            'bg-card dark:bg-navy-surface border border-border rounded-[14px]',
            'px-4 py-3.5 min-w-[230px] z-50',
            'shadow-ds-lg backdrop-blur-[16px]',
            'animate-[tipIn_0.25s_cubic-bezier(0.4,0,0.2,1)]',
          )}
        >
          {/* Pointer arrow */}
          <div
            className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 rotate-45 w-2 h-2 bg-card dark:bg-navy-surface border-r border-b border-border"
          />

          {/* Content */}
          <div className="space-y-0">
            <TooltipRow label="Service" value={node.name} />
            {node.owner_team && (
              <TooltipRow label="Owner" value={node.owner_team.name} />
            )}
            {hoverDepth === 'full' && node.oncall_user && (
              <TooltipRow label="On-call" value={node.oncall_user.name} />
            )}

            <div className="h-px bg-border my-1.5" />

            <TooltipRow
              label="Error Rate"
              value={errorRate !== null ? `${errorRate.toFixed(2)}%` : '—'}
              valueClass={
                errorRate !== null && errorRate > 2 ? 'text-error'
                  : errorRate !== null ? 'text-success'
                  : 'text-muted-foreground'
              }
            />
            <TooltipRow
              label="Latency P99"
              value={latency !== null ? `${latency.toFixed(2)}ms` : '—'}
              valueClass={
                latency !== null && latency > 500 ? 'text-error' : undefined
              }
            />

            {/* CPU and Memory: GaugeBar renders label + visual bar — no TooltipRow needed */}
            {hoverDepth === 'full' && (
              <>
                <GaugeBar label="CPU"    value={node.health.cpu_percent} />
                <GaugeBar label="Memory" value={node.health.memory_percent} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Source handle (bottom) — invisible */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent"
      />
    </div>
  );
}

/* ─── Custom Edge Component ────────────────────────────────────────────── */

interface TrafficEdgeData {
  topoEdge: TopoEdge;
  edgeClass: 'ok' | 'degraded' | 'critical';
  label: string;
  [key: string]: unknown;
}

function TrafficEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps<Edge<TrafficEdgeData>>) {
  if (!data) return null;

  const { topoEdge, edgeClass, label } = data;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const particleCount = getParticleCount(edgeClass);

  const strokeColor =
    edgeClass === 'critical'
      ? '#DC2626'
      : edgeClass === 'degraded'
        ? '#FF6B2B'
        : 'hsl(var(--border))';

  const strokeWidth =
    edgeClass === 'critical' ? 2 : edgeClass === 'degraded' ? 1.5 : 1;

  const strokeDasharray = edgeClass === 'ok' ? '4 6' : undefined;

  const particleColor =
    edgeClass === 'critical'
      ? '#DC2626'
      : edgeClass === 'degraded'
        ? '#FF6B2B'
        : 'hsl(var(--muted-foreground))';

  const baseDur =
    edgeClass === 'critical'
      ? 1.4
      : edgeClass === 'degraded'
        ? 1.8
        : 3;

  const pathId = `topo-edge-path-${id}`;

  return (
    <>
      {/* SVG defs for glow filters */}
      <defs>
        <filter id={`glow-${id}`}>
          <feGaussianBlur stdDeviation={edgeClass === 'critical' ? 3 : 2.5} result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {edgeClass === 'critical' && (
          <linearGradient id={`grad-err-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(220,38,38,0.15)" />
            <stop offset="100%" stopColor="rgba(220,38,38,0.5)" />
          </linearGradient>
        )}
        {edgeClass === 'degraded' && (
          <linearGradient id={`grad-deg-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,107,43,0.1)" />
            <stop offset="100%" stopColor="rgba(255,107,43,0.4)" />
          </linearGradient>
        )}
      </defs>

      {/* Edge path */}
      <path
        id={pathId}
        d={edgePath}
        fill="none"
        stroke={
          edgeClass === 'critical'
            ? `url(#grad-err-${id})`
            : edgeClass === 'degraded'
              ? `url(#grad-deg-${id})`
              : strokeColor
        }
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
      >
        {edgeClass === 'ok' && (
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-10"
            dur="2s"
            repeatCount="indefinite"
          />
        )}
      </path>

      {/* Traffic particles */}
      {Array.from({ length: particleCount }).map((_, pi) => (
        <circle
          key={`${id}-p-${pi}`}
          r={edgeClass === 'critical' ? 3.5 - pi * 0.5 : edgeClass === 'degraded' ? 2.5 - pi * 0.3 : 2}
          fill={particleColor}
          opacity={edgeClass === 'ok' ? 0.3 : 0.6}
          filter={edgeClass !== 'ok' ? `url(#glow-${id})` : undefined}
        >
          <animateMotion
            dur={`${baseDur}s`}
            repeatCount="indefinite"
            begin={`${pi * (baseDur / particleCount)}s`}
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}

      {/* Edge label */}
      {label && (
        <foreignObject
          x={labelX - 70}
          y={labelY - 10}
          width={140}
          height={20}
          className="pointer-events-none overflow-visible"
        >
          <div className="flex justify-center">
            <div
              className={cn(
                'text-[6px] font-mono tracking-[0.04em]',
                'px-1.5 py-0.5 rounded-[10px] border backdrop-blur-[4px]',
                'bg-card/85 dark:bg-navy-900/85 whitespace-nowrap',
                edgeClass === 'critical'
                  ? 'text-error border-error/15'
                  : edgeClass === 'degraded'
                    ? 'text-brand border-brand/15'
                    : 'text-muted-foreground border-border',
              )}
            >
              {label}
            </div>
          </div>
        </foreignObject>
      )}
    </>
  );
}

/* ─── Node / Edge type registrations ───────────────────────────────────── */

// Memoize ServiceNode so it only re-renders when its own data changes.
// Without this, every 10s topology refetch re-renders all nodes even when
// only one node's health metrics changed.
const MemoServiceNode = memo(ServiceNode);
const nodeTypes = { service: MemoServiceNode };
const edgeTypes = { traffic: TrafficEdge };

/* ─── Custom Controls (using Panel for guaranteed click handling) ───── */

function CustomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btnClass = 'px-3 py-2 text-sm font-bold hover:bg-muted transition-colors select-none cursor-pointer active:bg-muted/80';
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <Panel position="bottom-left" className="!m-3" style={{ pointerEvents: 'all' }}>
      <div
        className="flex flex-col bg-card border border-border rounded-lg shadow-md overflow-hidden"
        onMouseDown={stop}
        onClick={stop}
      >
        <button
          type="button"
          onMouseDown={stop}
          onClick={(e) => { stop(e); zoomIn({ duration: 200 }); }}
          className={cn(btnClass, 'rounded-t-lg')}
          title="Zoom in"
        >+</button>
        <hr className="border-border" />
        <button
          type="button"
          onMouseDown={stop}
          onClick={(e) => { stop(e); zoomOut({ duration: 200 }); }}
          className={btnClass}
          title="Zoom out"
        >−</button>
        <hr className="border-border" />
        <button
          type="button"
          onMouseDown={stop}
          onClick={(e) => { stop(e); fitView({ padding: 0.2, duration: 300 }); }}
          className={cn(btnClass, 'rounded-b-lg')}
          title="Fit to view"
        >⊞</button>
      </div>
    </Panel>
  );
}

/* ─── Legend ────────────────────────────────────────────────────────────── */

function Legend() {
  const items = [
    { label: 'Healthy', color: '#16A34A' },
    { label: 'Degraded', color: '#FF6B2B' },
    { label: 'Down', color: '#DC2626' },
  ];
  return (
    <div className="absolute bottom-2.5 left-14 z-[4] flex gap-3.5 text-[8px] text-muted-foreground pointer-events-none">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1">
          <span
            className="inline-block w-[7px] h-[7px] rounded-full"
            style={{
              backgroundColor: item.color,
              boxShadow: `0 0 6px ${item.color}33`,
            }}
          />
          {item.label}
        </div>
      ))}
    </div>
  );
}

/* ─── Mascot ───────────────────────────────────────────────────────────── */

function Mascot({
  show,
  mode,
  message,
}: {
  show: boolean;
  mode: 'tips' | 'status' | 'hidden';
  message?: string;
}) {
  if (!show || mode === 'hidden') return null;

  return (
    <div className="absolute bottom-2 right-3 z-[5] flex items-end gap-1.5">
      {message && (
        <div
          className={cn(
            'bg-card dark:bg-navy-surface border border-border',
            'rounded-xl rounded-bl-sm px-2.5 py-2 text-[9px] text-muted-foreground',
            'max-w-[170px] leading-[1.4] shadow-ds-sm backdrop-blur-[8px]',
          )}
        >
          <span dangerouslySetInnerHTML={{ __html: message.replace(/\*\*(.*?)\*\*/g, '<b class="text-brand font-semibold">$1</b>') }} />
        </div>
      )}
      <img
        src="/mascot/mascot-stand.png"
        alt="SREonCall mascot"
        className="w-12 opacity-85 animate-mascot-float"
        style={{
          filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.25))',
        }}
      />
    </div>
  );
}

/* ─── Build edge label string ──────────────────────────────────────────── */

function buildEdgeLabel(edge: TopoEdge): string {
  return [
    edge.dependency_type.toUpperCase(),
    edge.traffic.requests_per_minute !== null
      ? `${edge.traffic.requests_per_minute >= 1000 ? `${(edge.traffic.requests_per_minute / 1000).toFixed(1)}k` : edge.traffic.requests_per_minute} rpm`
      : null,
    edge.traffic.error_rate_percent !== null && edge.traffic.error_rate_percent > 0
      ? `${edge.traffic.error_rate_percent}% err`
      : null,
  ]
    .filter(Boolean)
    .join(' \u00b7 ');
}

/* ─── Inner Flow Component (needs ReactFlowProvider above) ─────────────── */

function TopologyMapInner({
  nodes: topoNodes,
  edges: topoEdges,
  hoverDepth,
  interactive,
  showMascot,
  mascotMode,
  mascotMessage,
}: TopologyMapProps) {
  const showMiniMap = topoNodes.length > 20; // Only show minimap for very large graphs

  // Build a lookup for node statuses
  const nodeStatusMap = useMemo(() => {
    const m = new Map<string, TopoNode['status']>();
    for (const n of topoNodes) {
      m.set(n.service_id, n.status);
    }
    return m;
  }, [topoNodes]);

  // Check if any nodes are affected/root-cause so we can dim unaffected ones
  const hasAffectedNodes = useMemo(
    () => topoNodes.some((n) => n.is_affected || n.is_root_cause),
    [topoNodes],
  );

  // Convert TopoNode[] to React Flow Node[]
  const initialNodes = useMemo<Node<ServiceNodeData>[]>(() => {
    return topoNodes.map((n) => ({
      id: n.service_id,
      type: 'service',
      position: { x: 0, y: 0 }, // Will be set by dagre
      data: {
        topoNode: n,
        hoverDepth,
        interactive,
        sparkBars: generateSparkBars(n.status, n.health.error_rate_percent),
        hasAffectedNodes,
      },
    }));
  }, [topoNodes, hoverDepth, interactive, hasAffectedNodes]);

  // Convert TopoEdge[] to React Flow Edge[]
  const initialEdges = useMemo<Edge<TrafficEdgeData>[]>(() => {
    return topoEdges.map((e, idx) => {
      const edgeClass = getEdgeClass(
        e,
        nodeStatusMap.get(e.source_service_id),
        nodeStatusMap.get(e.target_service_id),
      );
      return {
        id: `edge-${e.source_service_id}-${e.target_service_id}-${idx}`,
        source: e.source_service_id,
        target: e.target_service_id,
        type: 'traffic',
        data: {
          topoEdge: e,
          edgeClass,
          label: buildEdgeLabel(e),
        },
      };
    });
  }, [topoEdges, nodeStatusMap]);

  // Apply dagre layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(initialNodes, initialEdges),
    [initialNodes, initialEdges],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Update nodes/edges when props change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = getLayoutedElements(initialNodes, initialEdges);
    setRfNodes(newNodes);
    setRfEdges(newEdges);
  }, [initialNodes, initialEdges, setRfNodes, setRfEdges]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-card dark:bg-navy-surface rounded-[12px] topology-map-container">
      {/* Scan line */}
      <div
        className="absolute left-0 right-0 h-[2px] z-[2] pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent 10%, rgba(255,107,43,0.2) 50%, transparent 90%)',
          boxShadow: '0 0 8px rgba(255,107,43,0.1)',
          animation: 'scanY 5s linear infinite',
        }}
      />

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={interactive ? onNodesChange : undefined}
        onEdgesChange={interactive ? onEdgesChange : undefined}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={interactive}
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background
          variant={'dots' as any}
          gap={28}
          size={0.5}
          color="hsl(var(--border))"
          style={{ opacity: 0.3 }}
        />
        <CustomControls />
        {showMiniMap && (
          <MiniMap
            position="top-right"
            nodeColor={(node) => {
              const n = node as Node<ServiceNodeData>;
              const status = n.data?.topoNode?.status ?? 'unknown';
              return STATUS_COLORS[status].dot;
            }}
            maskColor="rgba(0,0,0,0.5)"
            className="topology-minimap"
          />
        )}
      </ReactFlow>

      {/* Legend */}
      <Legend />

      {/* Mascot */}
      <Mascot
        show={showMascot}
        mode={mascotMode}
        message={mascotMessage}
      />

      {/* Inline keyframes for animations */}
      <style jsx global>{`
        @keyframes scanY {
          0% { top: -1px; }
          100% { top: 100%; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes rootGlow {
          0%, 100% {
            box-shadow: 0 0 25px rgba(220,38,38,0.12), 0 0 50px rgba(220,38,38,0.05), 0 2px 8px rgba(0,0,0,0.08);
          }
          50% {
            box-shadow: 0 0 35px rgba(220,38,38,0.2), 0 0 70px rgba(220,38,38,0.08), 0 2px 8px rgba(0,0,0,0.08);
          }
        }
        @keyframes tipIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        /* React Flow dark-mode overrides */
        .topology-map-container .react-flow__background {
          background: transparent !important;
        }
        .topology-map-container .react-flow__controls {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 20 !important;
          pointer-events: all !important;
          position: absolute !important;
          bottom: 10px !important;
          left: 10px !important;
        }
        .topology-map-container .react-flow__controls button {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
          width: 28px;
          height: 28px;
          cursor: pointer;
          pointer-events: all !important;
        }
        .topology-map-container .react-flow__controls button:hover {
          background: hsl(var(--accent));
        }
        .topology-map-container .react-flow__controls button svg {
          fill: currentColor;
          max-width: 14px;
          max-height: 14px;
        }
        .topology-map-container .react-flow__minimap {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .topology-map-container .react-flow__node {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .topology-map-container .react-flow__edge-interaction {
          pointer-events: none;
        }

        /* Dark mode specifics */
        .dark .topology-map-container .react-flow__controls {
          background: var(--navy-surface, #161B22);
        }
        .dark .topology-map-container .react-flow__controls button {
          background: var(--navy-surface, #161B22);
        }
        .dark .topology-map-container .react-flow__controls button:hover {
          background: var(--navy-elevated, #1E293B);
        }
        .dark .topology-map-container .react-flow__minimap {
          background: var(--navy-surface, #161B22);
        }
      `}</style>
    </div>
  );
}

/* ─── Main Component ───────────────────────────────────────────────────── */

export function TopologyMap(props: TopologyMapProps) {
  return (
    <ReactFlowProvider>
      <TopologyMapInner {...props} />
    </ReactFlowProvider>
  );
}

export default TopologyMap;
