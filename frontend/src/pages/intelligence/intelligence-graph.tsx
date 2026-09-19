import {
    forceCenter,
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    type Simulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum,
} from 'd3-force';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface IntelligenceGraphData {
    edges: IntelligenceGraphEdge[];
    nodes: IntelligenceGraphNode[];
}

interface IntelligenceGraphEdge {
    description: string;
    source: string;
    target: string;
    type: string;
}

interface IntelligenceGraphNode {
    description: string;
    id: string;
    label: string;
    severity: string;
    source_id: number;
    source_name: string;
    type: string;
}

interface PanState {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
    description: string;
    source: SimNode | string;
    target: SimNode | string;
    type: string;
}

interface SimNode extends IntelligenceGraphNode, SimulationNodeDatum {}

interface Viewport {
    x: number;
    y: number;
    zoom: number;
}

const maxZoom = 3;
const minZoom = 0.35;

const typeColors: Record<string, string> = {
    advisory: '#06b6d4',
    campaign: '#f97316',
    group: '#ec4899',
    mitigation: '#22c55e',
    software: '#64748b',
    tactic: '#8b5cf6',
    technique: '#6366f1',
    vulnerability: '#ef4444',
    weakness: '#eab308',
};

export default function IntelligenceKnowledgeGraph({ graph }: { graph: IntelligenceGraphData }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const simulationRef = useRef<null | Simulation<SimNode, undefined>>(null);
    const dragNodeRef = useRef<null | SimNode>(null);
    const panRef = useRef<null | PanState>(null);
    const [dimensions, setDimensions] = useState({ height: 600, width: 960 });
    const [selectedNodeId, setSelectedNodeId] = useState<null | string>(null);
    const [selectedType, setSelectedType] = useState('all');
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
    const [, redraw] = useReducer((value) => value + 1, 0);

    const simulationData = useMemo(
        () => ({
            links: graph.edges.map((edge): SimLink => ({ ...edge })),
            nodes: graph.nodes.map((node): SimNode => ({ ...node })),
        }),
        [graph],
    );
    const typeCounts = useMemo(() => {
        const counts = new Map<string, number>();

        for (const node of graph.nodes) {
            counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
        }

        return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
    }, [graph.nodes]);
    const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            if (entry) {
                setDimensions((current) => ({ ...current, width: Math.max(560, Math.round(entry.contentRect.width)) }));
            }
        });
        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const simulation = forceSimulation<SimNode>(simulationData.nodes)
            .force(
                'link',
                forceLink<SimNode, SimLink>(simulationData.links)
                    .id((node) => node.id)
                    .distance(105)
                    .strength(0.35),
            )
            .force('charge', forceManyBody().strength(-185))
            .force('center', forceCenter(dimensions.width / 2, dimensions.height / 2))
            .force('collide', forceCollide<SimNode>().radius(20).strength(0.8))
            .alphaDecay(0.04)
            .on('tick', redraw);
        simulationRef.current = simulation;

        return () => {
            simulation.stop();
            simulationRef.current = null;
        };
    }, [dimensions.height, dimensions.width, simulationData]);

    const isVisible = (node?: SimNode) => !!node && (selectedType === 'all' || node.type === selectedType);

    const zoomAt = (viewX: number, viewY: number, requestedZoom: number) => {
        setViewport((current) => {
            const nextZoom = Math.min(maxZoom, Math.max(minZoom, requestedZoom));

            if (nextZoom === current.zoom) {
                return current;
            }

            const centerX = dimensions.width / 2;
            const centerY = dimensions.height / 2;
            const worldX = centerX + (viewX - current.x - centerX) / current.zoom;
            const worldY = centerY + (viewY - current.y - centerY) / current.zoom;

            return {
                x: viewX - centerX - (worldX - centerX) * nextZoom,
                y: viewY - centerY - (worldY - centerY) * nextZoom,
                zoom: nextZoom,
            };
        });
    };

    const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const viewX = ((event.clientX - bounds.left) / bounds.width) * dimensions.width;
        const viewY = ((event.clientY - bounds.top) / bounds.height) * dimensions.height;
        const factor = Math.exp(-event.deltaY * 0.0015);

        zoomAt(viewX, viewY, viewport.zoom * factor);
    };

    const startPan = (event: React.PointerEvent<SVGRectElement>) => {
        if (event.button !== 0) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: viewport.x,
            startY: viewport.y,
        };
    };

    const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        const node = dragNodeRef.current;

        if (!node) {
            const pan = panRef.current;

            if (!pan || pan.pointerId !== event.pointerId) {
                return;
            }

            const bounds = event.currentTarget.getBoundingClientRect();
            setViewport((current) => ({
                ...current,
                x: pan.startX + ((event.clientX - pan.startClientX) / bounds.width) * dimensions.width,
                y: pan.startY + ((event.clientY - pan.startClientY) / bounds.height) * dimensions.height,
            }));

            return;
        }

        const bounds = event.currentTarget.getBoundingClientRect();
        const viewX = ((event.clientX - bounds.left) / bounds.width) * dimensions.width;
        const viewY = ((event.clientY - bounds.top) / bounds.height) * dimensions.height;
        const centerX = dimensions.width / 2;
        const centerY = dimensions.height / 2;
        node.fx = centerX + (viewX - viewport.x - centerX) / viewport.zoom;
        node.fy = centerY + (viewY - viewport.y - centerY) / viewport.zoom;
    };

    const endDrag = () => {
        panRef.current = null;

        if (dragNodeRef.current) {
            dragNodeRef.current.fx = null;
            dragNodeRef.current.fy = null;
            dragNodeRef.current = null;
            simulationRef.current?.alphaTarget(0);
        }
    };

    if (graph.nodes.length === 0) {
        return (
            <div className="border-border text-muted-foreground flex h-72 items-center justify-center rounded-lg border border-dashed text-sm">
                获取外部知识后将在这里展示实体和关系
            </div>
        );
    }

    return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <div
                className="bg-background relative min-w-0 overflow-hidden rounded-xl border"
                ref={containerRef}
            >
                <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-8rem)] flex-wrap gap-1.5">
                    <TypeFilter
                        active={selectedType === 'all'}
                        label={`全部 ${graph.nodes.length}`}
                        onClick={() => setSelectedType('all')}
                    />
                    {typeCounts.map(([type, count]) => (
                        <TypeFilter
                            active={selectedType === type}
                            key={type}
                            label={`${typeLabel(type)} ${count}`}
                            onClick={() => setSelectedType(type)}
                        />
                    ))}
                </div>
                <div className="absolute top-3 right-3 z-10 flex gap-1">
                    <Button
                        aria-label="缩小图谱"
                        onClick={() => zoomAt(dimensions.width / 2, dimensions.height / 2, viewport.zoom - 0.15)}
                        size="icon-sm"
                        variant="outline"
                    >
                        <Minus />
                    </Button>
                    <Button
                        aria-label="重置图谱缩放"
                        onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}
                        size="icon-sm"
                        variant="outline"
                    >
                        <RotateCcw />
                    </Button>
                    <Button
                        aria-label="放大图谱"
                        onClick={() => zoomAt(dimensions.width / 2, dimensions.height / 2, viewport.zoom + 0.15)}
                        size="icon-sm"
                        variant="outline"
                    >
                        <Plus />
                    </Button>
                </div>
                <svg
                    aria-label="多源安全知识关系图"
                    className="block h-[38rem] w-full touch-none"
                    onPointerCancel={endDrag}
                    onPointerLeave={endDrag}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    onWheel={handleWheel}
                    role="img"
                    viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                >
                    <defs>
                        <marker
                            id="intelligence-arrow"
                            markerHeight="6"
                            markerWidth="6"
                            orient="auto"
                            refX="22"
                            refY="0"
                            viewBox="0 -5 10 10"
                        >
                            <path
                                d="M0,-5L10,0L0,5"
                                fill="currentColor"
                            />
                        </marker>
                    </defs>
                    <rect
                        className="cursor-grab active:cursor-grabbing"
                        fill="transparent"
                        height={dimensions.height}
                        onPointerDown={startPan}
                        width={dimensions.width}
                    />
                    <g
                        transform={`translate(${viewport.x} ${viewport.y}) translate(${dimensions.width / 2} ${dimensions.height / 2}) scale(${viewport.zoom}) translate(${-dimensions.width / 2} ${-dimensions.height / 2})`}
                    >
                        {simulationData.links.map((link, index) => {
                            const source =
                                typeof link.source === 'string'
                                    ? simulationData.nodes.find((node) => node.id === link.source)
                                    : link.source;
                            const target =
                                typeof link.target === 'string'
                                    ? simulationData.nodes.find((node) => node.id === link.target)
                                    : link.target;

                            if (!source || !target) {
                                return null;
                            }

                            const visible = selectedType === 'all' || isVisible(source) || isVisible(target);

                            return (
                                <line
                                    key={`${source.id}-${target.id}-${link.type}-${index}`}
                                    markerEnd="url(#intelligence-arrow)"
                                    opacity={visible ? 0.5 : 0.04}
                                    stroke="var(--muted-foreground)"
                                    strokeWidth={visible ? 1.25 : 0.5}
                                    x1={source.x ?? 0}
                                    x2={target.x ?? 0}
                                    y1={source.y ?? 0}
                                    y2={target.y ?? 0}
                                />
                            );
                        })}
                        {simulationData.nodes.map((node) => {
                            const visible = isVisible(node);
                            const selected = selectedNodeId === node.id;

                            return (
                                <g
                                    className="cursor-grab active:cursor-grabbing"
                                    key={node.id}
                                    onClick={() => setSelectedNodeId(node.id)}
                                    onPointerDown={(event) => {
                                        event.stopPropagation();
                                        dragNodeRef.current = node;
                                        node.fx = node.x;
                                        node.fy = node.y;
                                        simulationRef.current?.alphaTarget(0.25).restart();
                                    }}
                                    opacity={selectedType === 'all' || visible ? 1 : 0.09}
                                    transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
                                >
                                    <circle
                                        fill={typeColors[node.type] ?? '#64748b'}
                                        r={selected ? 12 : 8}
                                        stroke={selected ? 'var(--foreground)' : 'white'}
                                        strokeWidth={selected ? 3 : 1.5}
                                    />
                                    {selected || graph.nodes.length < 80 ? (
                                        <text
                                            className="fill-foreground pointer-events-none text-[9px] font-medium"
                                            dy="20"
                                            textAnchor="middle"
                                        >
                                            {node.id}
                                        </text>
                                    ) : null}
                                    <title>{`${node.id} · ${node.label}\n${typeLabel(node.type)}\n来源：${node.source_name}`}</title>
                                </g>
                            );
                        })}
                    </g>
                </svg>
                <div className="text-muted-foreground bg-background/85 pointer-events-none absolute right-3 bottom-3 rounded-md px-2 py-1 text-[11px] shadow-sm backdrop-blur">
                    滚轮缩放 · 拖拽空白区域移动 · 拖拽节点调整位置
                </div>
            </div>
            <aside className="space-y-4">
                <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium">图谱概览</div>
                    <div className="text-muted-foreground mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                        <div>
                            <div className="text-foreground text-lg font-semibold">{graph.nodes.length}</div>节点
                        </div>
                        <div>
                            <div className="text-foreground text-lg font-semibold">{graph.edges.length}</div>关系
                        </div>
                    </div>
                </div>
                <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium">节点类型</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {typeCounts.map(([type]) => (
                            <span
                                className="flex items-center gap-1.5 text-xs"
                                key={type}
                            >
                                <span
                                    className="size-2.5 rounded-full"
                                    style={{ backgroundColor: typeColors[type] ?? '#64748b' }}
                                />
                                {typeLabel(type)}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="min-h-52 rounded-xl border p-4">
                    <div className="text-sm font-medium">节点详情</div>
                    {selectedNode ? (
                        <div className="mt-3 space-y-3 text-sm">
                            <div>
                                <div className="font-mono text-xs">{selectedNode.id}</div>
                                <div className="mt-1 font-medium">{selectedNode.label}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">{typeLabel(selectedNode.type)}</Badge>
                                <Badge variant="outline">{selectedNode.source_name}</Badge>
                            </div>
                            <p className="text-muted-foreground max-h-48 overflow-auto text-xs leading-5">
                                {selectedNode.description || '该节点没有补充说明。'}
                            </p>
                        </div>
                    ) : (
                        <p className="text-muted-foreground mt-3 text-xs leading-5">
                            点击节点查看稳定编号、说明与数据来源。
                        </p>
                    )}
                </div>
            </aside>
        </div>
    );
}

function TypeFilter({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button
            className={cn(
                'bg-background/90 rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur',
                active && 'border-primary text-primary',
            )}
            onClick={onClick}
            type="button"
        >
            {label}
        </button>
    );
}

function typeLabel(type: string) {
    const labels: Record<string, string> = {
        advisory: '安全公告',
        campaign: '攻击活动',
        group: '攻击组织',
        mitigation: '缓解措施',
        software: '软件与工具',
        tactic: 'ATT&CK 战术',
        technique: 'ATT&CK 技术',
        vulnerability: '漏洞',
        weakness: 'CWE 弱点',
    };

    return labels[type] ?? type;
}
