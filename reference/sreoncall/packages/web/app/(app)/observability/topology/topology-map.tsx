'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
  getBezierPath,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import {
  Globe,
  Network,
  Shield,
  Radio,
  Wifi,
  Zap,
  Server,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TopologyResponse } from './page';

/* ─── Constants ────────────────────────────────────────────────────── */

const NODE_WIDTH = 200;
const NODE_HEIGHT = 100;

const DEVICE_ICONS: Record<string, typeof Server> = {
  router: Globe,
  switch: Network,
  firewall: Shield,
  olt: Radio,
  wireless_ap: Wifi,
  ups: Zap,
  server: Server,
  snmp_device: Activity,
  network_device: Activity,
};

const DEVICE_COLORS: Record<string, string> = {
  router: '#3B82F6',
  switch: '#A855F7',
  firewall: '#EF4444',
  olt: '#F97316',
  wireless_ap: '#06B6D4',
  ups: '#EAB308',
  server: '#22C55E',
  snmp_device: '#64748B',
  network_device: '#64748B',
};

/* ─── Dagre Layout ─────────────────────────────────────────────────── */

interface DeviceNodeData {
  topoNode: TopologyResponse['nodes'][number];
  [key: string]: unknown;
}

function getLayoutedElements(
  rfNodes: Node<DeviceNodeData>[],
  rfEdges: Edge[],
): { nodes: Node<DeviceNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 120 });
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

/* ─── Custom Device Node ───────────────────────────────────────────── */

function DeviceNode({ data }: NodeProps<Node<DeviceNodeData>>) {
  const [hovered, setHovered] = useState(false);
  const { topoNode: node } = data;
  const color = DEVICE_COLORS[node.device_type] || DEVICE_COLORS.snmp_device;
  const Icon = DEVICE_ICONS[node.device_type] || Activity;

  return (
    <div
      className="transition-all duration-200"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ transform: hovered ? 'translateY(-2px) scale(1.02)' : undefined }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent"
      />

      <div
        className={cn(
          'relative rounded-xl px-3.5 py-3 min-w-[160px] max-w-[200px]',
          'bg-card dark:bg-[#161B22]',
          'transition-all duration-200',
        )}
        style={{
          border: `1.5px solid ${hovered ? color : `${color}33`}`,
          boxShadow: hovered
            ? `0 8px 24px rgba(0,0,0,0.2), 0 0 12px ${color}22`
            : `0 2px 8px rgba(0,0,0,0.08)`,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <div
            className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${color}18` }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-foreground truncate leading-tight">
              {node.label}
            </div>
            <div className="text-[9px] text-muted-foreground font-mono truncate">
              {node.ip}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mt-2 text-[8px] text-muted-foreground">
          <span className="capitalize font-medium" style={{ color }}>
            {node.device_type.replace(/_/g, ' ')}
          </span>
          {node.interface_count > 0 && (
            <span>{node.interface_count} ifs</span>
          )}
          {node.bgp_peer_count > 0 && (
            <span>{node.bgp_peer_count} BGP</span>
          )}
        </div>

        {/* Status dot */}
        <div className="absolute top-2.5 right-2.5">
          <span
            className="inline-block w-[6px] h-[6px] rounded-full"
            style={{
              backgroundColor: node.status === 'healthy' ? '#16A34A' : '#64748B',
              boxShadow: node.status === 'healthy'
                ? '0 0 6px rgba(22,163,74,0.5)'
                : '0 0 6px rgba(100,116,139,0.3)',
            }}
          />
        </div>
      </div>

      {/* Tooltip on hover */}
      {hovered && node.sys_descr && (
        <div
          className={cn(
            'absolute left-1/2 bottom-[calc(100%+10px)] -translate-x-1/2 z-50',
            'bg-card dark:bg-[#161B22] border border-border rounded-lg',
            'px-3 py-2 min-w-[220px] max-w-[320px]',
            'shadow-lg text-[10px]',
          )}
        >
          <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 rotate-45 w-2 h-2 bg-card dark:bg-[#161B22] border-r border-b border-border" />
          <div className="text-foreground font-semibold mb-1">{node.label}</div>
          <div className="text-muted-foreground leading-relaxed line-clamp-3">{node.sys_descr}</div>
          {node.sys_location && (
            <div className="text-muted-foreground mt-1">Location: {node.sys_location}</div>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent"
      />
    </div>
  );
}

/* ─── Custom Link Edge ─────────────────────────────────────────────── */

interface LinkEdgeData {
  sourcePort: string;
  targetPort: string;
  [key: string]: unknown;
}

function LinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<LinkEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = [data?.sourcePort, data?.targetPort].filter(Boolean).join(' \u2194 ');

  return (
    <>
      <defs>
        <linearGradient id={`link-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(100,116,139,0.15)" />
          <stop offset="100%" stopColor="rgba(100,116,139,0.4)" />
        </linearGradient>
      </defs>

      <path
        id={`link-path-${id}`}
        d={edgePath}
        fill="none"
        stroke={`url(#link-grad-${id})`}
        strokeWidth={1.5}
        strokeDasharray="6 4"
        strokeLinecap="round"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-10"
          dur="2s"
          repeatCount="indefinite"
        />
      </path>

      {/* Traffic particle */}
      <circle r={2} fill="hsl(var(--muted-foreground))" opacity={0.35}>
        <animateMotion dur="3s" repeatCount="indefinite">
          <mpath href={`#link-path-${id}`} />
        </animateMotion>
      </circle>

      {/* Port label */}
      {label && (
        <foreignObject
          x={labelX - 75}
          y={labelY - 10}
          width={150}
          height={20}
          className="pointer-events-none overflow-visible"
        >
          <div className="flex justify-center">
            <div className="text-[7px] font-mono text-muted-foreground px-1.5 py-0.5 rounded-full border border-border bg-card/85 dark:bg-[#161B22]/85 backdrop-blur-[4px] whitespace-nowrap">
              {label}
            </div>
          </div>
        </foreignObject>
      )}
    </>
  );
}

/* ─── Node/Edge type maps ──────────────────────────────────────────── */

const nodeTypes = { device: DeviceNode };
const edgeTypes = { link: LinkEdge };

/* ─── Legend ────────────────────────────────────────────────────────── */

function Legend() {
  const items = [
    { label: 'Router', color: DEVICE_COLORS.router },
    { label: 'Switch', color: DEVICE_COLORS.switch },
    { label: 'Firewall', color: DEVICE_COLORS.firewall },
    { label: 'OLT', color: DEVICE_COLORS.olt },
    { label: 'AP', color: DEVICE_COLORS.wireless_ap },
    { label: 'Server', color: DEVICE_COLORS.server },
  ];
  return (
    <div className="absolute bottom-2.5 left-3.5 z-[4] flex gap-3 text-[9px] text-muted-foreground">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1">
          <span
            className="inline-block w-[7px] h-[7px] rounded-full"
            style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}33` }}
          />
          {item.label}
        </div>
      ))}
    </div>
  );
}

/* ─── Inner Flow Component ─────────────────────────────────────────── */

function NetworkTopologyInner({ data }: { data: TopologyResponse }) {
  const showMiniMap = data.nodes.length > 8;

  const initialNodes = useMemo<Node<DeviceNodeData>[]>(() => {
    return data.nodes.map((n) => ({
      id: n.id,
      type: 'device',
      position: { x: 0, y: 0 },
      data: { topoNode: n },
    }));
  }, [data.nodes]);

  const initialEdges = useMemo<Edge<LinkEdgeData>[]>(() => {
    return data.edges.map((e, idx) => ({
      id: `link-${idx}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'link',
      data: {
        sourcePort: e.source_port,
        targetPort: e.target_port,
      },
    }));
  }, [data.edges]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(initialNodes, initialEdges),
    [initialNodes, initialEdges],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    const { nodes: n, edges: e } = getLayoutedElements(initialNodes, initialEdges);
    setRfNodes(n);
    setRfEdges(e);
  }, [initialNodes, initialEdges, setRfNodes, setRfEdges]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-card dark:bg-[#0D1117] rounded-xl border border-border network-topology-container">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        nodesDraggable
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Background
          variant={'dots' as any}
          gap={28}
          size={0.5}
          color="hsl(var(--border))"
          style={{ opacity: 0.3 }}
        />
        <Controls showInteractive={false} className="network-topo-controls" />
        {showMiniMap && (
          <MiniMap
            position="top-right"
            nodeColor={(node: Node<DeviceNodeData>) => {
              const dt = node.data?.topoNode?.device_type ?? 'snmp_device';
              return DEVICE_COLORS[dt] || DEVICE_COLORS.snmp_device;
            }}
            maskColor="rgba(0,0,0,0.5)"
          />
        )}
      </ReactFlow>

      <Legend />

      <style jsx global>{`
        .network-topology-container .react-flow__background {
          background: transparent !important;
        }
        .network-topology-container .react-flow__controls {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .network-topology-container .react-flow__controls button {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
          width: 24px;
          height: 24px;
        }
        .network-topology-container .react-flow__controls button:hover {
          background: hsl(var(--accent));
        }
        .network-topology-container .react-flow__controls button svg {
          fill: currentColor;
        }
        .network-topology-container .react-flow__minimap {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
        }
        .network-topology-container .react-flow__node {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .network-topology-container .react-flow__edge-interaction {
          pointer-events: none;
        }
        .dark .network-topology-container .react-flow__controls {
          background: #161B22;
        }
        .dark .network-topology-container .react-flow__controls button {
          background: #161B22;
        }
        .dark .network-topology-container .react-flow__controls button:hover {
          background: #1E293B;
        }
        .dark .network-topology-container .react-flow__minimap {
          background: #161B22;
        }
      `}</style>
    </div>
  );
}

/* ─── Exported Component ───────────────────────────────────────────── */

export default function NetworkTopologyMap({ data }: { data: TopologyResponse }) {
  return (
    <ReactFlowProvider>
      <NetworkTopologyInner data={data} />
    </ReactFlowProvider>
  );
}
