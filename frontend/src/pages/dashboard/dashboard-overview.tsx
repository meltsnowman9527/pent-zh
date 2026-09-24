import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useQuery } from '@apollo/client/react';
import {
    AlertTriangle,
    ArrowRight,
    Boxes,
    CheckCircle2,
    ClipboardList,
    FileText,
    GitBranch,
    GitFork,
    Globe2,
    ListTodo,
    Network,
    Play,
    Radar,
    ScanSearch,
    Server,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { FlowFragmentFragment } from '@/graphql/types';
import type { ApiResponse } from '@/lib/axios';

import { FlowStatusBadge } from '@/components/icons/flow-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { FlowsDocument, StatusType } from '@/graphql/types';
import { api, unwrapApiResponse } from '@/lib/axios';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { formatDate, formatNumber } from '@/lib/utils/format';

interface AssessmentRun {
    created_at: string;
    current_stage: string;
    id: number;
    stages: AssessmentStage[];
    status: string;
    target: string;
    updated_at?: string;
}

interface AssessmentStage {
    key: string;
    order: number;
    status: AssessmentStageStatus;
    title: string;
}

type AssessmentStageStatus = 'failed' | 'finished' | 'pending' | 'running' | 'skipped' | 'stopped' | 'waiting';

interface AssetService {
    port: number;
    product: string;
    service: string;
    state: string;
    transport: string;
}

interface DiscoveredAsset {
    id: number;
    last_scan_at: null | string;
    services: AssetService[];
    status: string;
}

interface ExploitChainGraph {
    nodes: Array<{
        id: string;
        label: string;
        severity?: string;
        type: string;
    }>;
}

interface ItemList<T> {
    items: T[];
    total: number;
}

interface ResearchRun {
    created_at: string;
    id: number;
    status: string;
    target?: string;
    title?: string;
    updated_at: string;
}

interface WorkspaceData {
    assessments: AssessmentRun[];
    assets: DiscoveredAsset[];
    chains: ResearchRun[];
    graphs: ExploitChainGraph[];
    scans: ResearchRun[];
}

const emptyWorkspaceData: WorkspaceData = {
    assessments: [],
    assets: [],
    chains: [],
    graphs: [],
    scans: [],
};

const defaultPipelineStages: AssessmentStage[] = [
    { key: 'discovery', order: 1, status: 'pending', title: '资产发现' },
    { key: 'scan', order: 2, status: 'pending', title: '漏洞扫描' },
    { key: 'chain', order: 3, status: 'pending', title: '利用链推理' },
    { key: 'pentest', order: 4, status: 'pending', title: '安全验证' },
];

const pipelineIcons: Record<string, LucideIcon> = {
    chain: GitBranch,
    discovery: Radar,
    pentest: ShieldCheck,
    scan: ScanSearch,
};

const quickEntries: Array<{ description: string; icon: LucideIcon; label: string; to: string }> = [
    { description: '创建智能体任务', icon: Play, label: '发起任务', to: routes.newFlow },
    { description: '编排完整检测流程', icon: Sparkles, label: '安全评估', to: routes.securityAssessments },
    { description: '发现资产与服务', icon: Radar, label: '资产发现', to: routes.vulnerabilityScans },
    { description: '分析攻击路径', icon: GitBranch, label: '利用链推理', to: routes.exploitChains },
    { description: '查看外部风险线索', icon: Globe2, label: '威胁情报', to: routes.intelligence },
    { description: '汇总报告与配置', icon: FileText, label: '报告管理', to: routes.reportSystemManagement },
];

export function DashboardOverview() {
    const { data: flowsData, loading: flowsLoading } = useQuery(FlowsDocument);
    const flows = useMemo(() => flowsData?.flows ?? [], [flowsData?.flows]);
    const [workspace, setWorkspace] = useState<WorkspaceData>(emptyWorkspaceData);
    const [workspaceLoading, setWorkspaceLoading] = useState(true);

    useEffect(() => {
        let active = true;

        const loadWorkspace = async () => {
            const results = await Promise.allSettled([
                api.get<ItemList<DiscoveredAsset>>('/vulnerability-scans/assets'),
                api.get<ItemList<ResearchRun>>('/vulnerability-scans/'),
                api.get<ItemList<ResearchRun>>('/exploit-chains/'),
                api.get<ItemList<AssessmentRun>>('/security-assessments/'),
            ]);

            if (!active) {return;}

            const read = <T,>(index: number, fallback: T): T => {
                const result = results[index];

                if (!result || result.status !== 'fulfilled') {return fallback;}

                try {
                    return unwrapApiResponse(result.value as ApiResponse<T>);
                } catch {
                    return fallback;
                }
            };

            const assets = read<ItemList<DiscoveredAsset>>(0, { items: [], total: 0 }).items;
            const scans = read<ItemList<ResearchRun>>(1, { items: [], total: 0 }).items;
            const chains = read<ItemList<ResearchRun>>(2, { items: [], total: 0 }).items;
            const assessments = read<ItemList<AssessmentRun>>(3, { items: [], total: 0 }).items;
            const graphResults = await Promise.allSettled(
                chains.map((chain) => api.get<ExploitChainGraph>(`/exploit-chains/${chain.id}/graph`)),
            );

            if (!active) {return;}

            const graphs = graphResults.flatMap((result) => {
                if (result.status !== 'fulfilled') {return [];}

                try {
                    return [unwrapApiResponse(result.value)];
                } catch {
                    return [];
                }
            });

            setWorkspace({ assessments, assets, chains, graphs, scans });
            setWorkspaceLoading(false);
        };

        void loadWorkspace();

        return () => {
            active = false;
        };
    }, []);

    const metrics = useMemo(() => buildCoreMetrics(workspace), [workspace]);
    const latestAssessment = useMemo(
        () =>
            [...workspace.assessments].sort(
                (left, right) =>
                    new Date(right.updated_at ?? right.created_at).getTime() -
                    new Date(left.updated_at ?? left.created_at).getTime(),
            )[0],
        [workspace.assessments],
    );
    const latestScan = useMemo(
        () =>
            [...workspace.scans].sort(
                (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
            )[0],
        [workspace.scans],
    );
    const currentTarget = latestAssessment?.target || latestScan?.target || '尚未设置目标';
    const recentFlows = useMemo(
        () =>
            [...flows]
                .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
                .slice(0, 4),
        [flows],
    );
    const recentReports = useMemo(
        () =>
            flows
                .filter((flow) => flow.status === StatusType.Finished)
                .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
                .slice(0, 4),
        [flows],
    );
    const failedCount = flows.filter((flow) => flow.status === StatusType.Failed).length;
    const waitingCount = flows.filter((flow) => flow.status === StatusType.Waiting).length;
    const unscannedAssetCount = workspace.assets.filter(
        (asset) => asset.status === 'active' && !asset.last_scan_at,
    ).length;
    const todoItems = [
        { count: waitingCount, label: '等待处理的任务', tone: 'text-amber-500' },
        { count: failedCount, label: '执行失败的任务', tone: 'text-red-500' },
        { count: unscannedAssetCount, label: '尚未扫描的资产', tone: 'text-blue-500' },
        { count: metrics.highRiskCount, label: '高危漏洞需复核', tone: 'text-orange-500' },
    ];

    return (
        <div className="flex flex-col gap-6">
            <section className="space-y-4">
                <SectionHeading
                    description="聚合当前检测目标、攻击面和关键风险信息。"
                    title="核心指标"
                />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                    <CoreMetricCard
                        className="sm:col-span-2 xl:col-span-2"
                        description="当前优先检测范围"
                        icon={Network}
                        loading={workspaceLoading}
                        title="当前目标"
                        value={currentTarget}
                        valueClassName="truncate text-lg"
                    />
                    <CoreMetricCard
                        description="已纳入工作区"
                        icon={Boxes}
                        loading={workspaceLoading}
                        title="资产数"
                        value={formatNumber(workspace.assets.length)}
                    />
                    <CoreMetricCard
                        description="资产开放服务"
                        icon={Server}
                        loading={workspaceLoading}
                        title="开放端口"
                        value={formatNumber(metrics.openPortCount)}
                    />
                    <CoreMetricCard
                        description={metrics.technologyPreview || '暂无识别结果'}
                        icon={GitFork}
                        loading={workspaceLoading}
                        title="技术栈"
                        value={formatNumber(metrics.technologies.length)}
                    />
                    <CoreMetricCard
                        description={`其中高危 ${formatNumber(metrics.highRiskCount)}`}
                        icon={ShieldAlert}
                        loading={workspaceLoading}
                        title="漏洞 / 高危"
                        value={`${formatNumber(metrics.vulnerabilityCount)} / ${formatNumber(metrics.highRiskCount)}`}
                    />
                </div>
            </section>

            <section className="space-y-4">
                <SectionHeading
                    action={
                        <Button
                            asChild
                            size="sm"
                            variant="outline"
                        >
                            <Link to={routes.securityAssessments}>
                                查看全部流水线
                                <ArrowRight />
                            </Link>
                        </Button>
                    }
                    description="跟踪最近一次安全评估从资产发现到安全验证的流转位置。"
                    title="检测流水线"
                />
                <PipelineCard
                    assessment={latestAssessment}
                    loading={workspaceLoading}
                />
            </section>

            <section className="space-y-4">
                <SectionHeading
                    description="集中处理待办、继续最近任务并快速访问常用能力。"
                    title="工作区"
                />
                <div className="grid gap-4 xl:grid-cols-3">
                    <WorkspaceCard
                        description="按当前状态自动汇总"
                        icon={ListTodo}
                        title="待办事项"
                    >
                        <div className="space-y-2">
                            {workspaceLoading || flowsLoading ? (
                                <LoadingBlock />
                            ) : (
                                todoItems.map((item) => (
                                    <div
                                        className="bg-muted/40 flex items-center rounded-lg px-3 py-2.5"
                                        key={item.label}
                                    >
                                        <AlertTriangle className={cn('mr-2 size-4', item.tone)} />
                                        <span className="text-sm">{item.label}</span>
                                        <span className={cn('ml-auto font-semibold tabular-nums', item.tone)}>
                                            {item.count}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </WorkspaceCard>
                    <WorkspaceCard
                        description="最近更新的智能体任务"
                        icon={ClipboardList}
                        title="最近任务"
                    >
                        <FlowList
                            emptyText="暂无任务"
                            flows={recentFlows}
                            loading={flowsLoading}
                            report={false}
                        />
                    </WorkspaceCard>
                    <WorkspaceCard
                        description="最近生成的安全报告"
                        icon={FileText}
                        title="最近报告"
                    >
                        <FlowList
                            emptyText="暂无已完成报告"
                            flows={recentReports}
                            loading={flowsLoading}
                            report
                        />
                    </WorkspaceCard>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">快捷入口</CardTitle>
                        <CardDescription>快速发起或跟进常用安全工作。</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        {quickEntries.map(({ description, icon: Icon, label, to }) => (
                            <Link
                                className="hover:border-primary/50 hover:bg-muted/40 group rounded-xl border p-4 transition-colors"
                                key={label}
                                to={to}
                            >
                                <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                                    <Icon className="size-4" />
                                </div>
                                <div className="mt-3 flex items-center gap-1 text-sm font-medium">
                                    {label}
                                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                                </div>
                                <div className="text-muted-foreground mt-1 text-xs">{description}</div>
                            </Link>
                        ))}
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}

function buildCoreMetrics(workspace: WorkspaceData) {
    const ports = new Set<string>();
    const technologies = new Set<string>();
    const vulnerabilities = new Map<string, string>();

    for (const asset of workspace.assets) {
        for (const service of asset.services ?? []) {
            if (!service.state || service.state.toLowerCase() === 'open')
                {ports.add(`${asset.id}:${service.transport}:${service.port}`);}

            const technology = service.product.trim() || service.service.trim();

            if (technology) {technologies.add(technology);}
        }
    }

    for (const graph of workspace.graphs) {
        for (const node of graph.nodes ?? []) {
            if (node.type !== 'vulnerability' && node.type !== 'cve') {continue;}

            vulnerabilities.set(node.label.trim().toLowerCase() || node.id, node.severity?.toLowerCase() ?? 'unknown');
        }
    }

    const technologyList = [...technologies].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const highRiskCount = [...vulnerabilities.values()].filter((severity) =>
        ['critical', 'high'].includes(severity),
    ).length;

    return {
        highRiskCount,
        openPortCount: ports.size,
        technologies: technologyList,
        technologyPreview: technologyList.slice(0, 3).join('、'),
        vulnerabilityCount: vulnerabilities.size,
    };
}

function CoreMetricCard({
    className,
    description,
    icon: Icon,
    loading,
    title,
    value,
    valueClassName,
}: {
    className?: string;
    description: string;
    icon: LucideIcon;
    loading: boolean;
    title: string;
    value: number | string;
    valueClassName?: string;
}) {
    return (
        <Card className={className}>
            <CardContent className="flex h-full min-h-32 flex-col p-4">
                <div className="flex items-center justify-between text-sm font-medium">
                    {title}
                    <Icon className="text-muted-foreground size-4" />
                </div>
                {loading ? (
                    <LoadingBlock />
                ) : (
                    <>
                        <div
                            className={cn('mt-4 text-2xl font-semibold tabular-nums', valueClassName)}
                            title={String(value)}
                        >
                            {value}
                        </div>
                        <div
                            className="text-muted-foreground mt-auto truncate pt-2 text-xs"
                            title={description}
                        >
                            {description}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function FlowList({
    emptyText,
    flows,
    loading,
    report,
}: {
    emptyText: string;
    flows: FlowFragmentFragment[];
    loading: boolean;
    report: boolean;
}) {
    if (loading) {return <LoadingBlock />;}

    if (!flows.length)
        {return (
            <div className="text-muted-foreground flex min-h-36 items-center justify-center text-sm">{emptyText}</div>
        );}

    return (
        <div className="space-y-1">
            {flows.map((flow) => (
                <Link
                    className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
                    key={flow.id}
                    to={report ? routes.flowReport(flow.id) : routes.flow(flow.id)}
                >
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{flow.title || `任务 #${flow.id}`}</div>
                        <div className="text-muted-foreground mt-0.5 text-xs">
                            {formatDate(new Date(flow.updatedAt))}
                        </div>
                    </div>
                    {report ? <Badge variant="green">已生成</Badge> : <FlowStatusBadge status={flow.status} />}
                </Link>
            ))}
        </div>
    );
}

function LoadingBlock() {
    return (
        <div className="text-muted-foreground flex min-h-20 items-center justify-center">
            <Spinner
                className="size-5"
                variant="circle"
            />
        </div>
    );
}

function PipelineCard({ assessment, loading }: { assessment?: AssessmentRun; loading: boolean }) {
    const stages = assessment?.stages?.length
        ? [...assessment.stages].sort((left, right) => left.order - right.order)
        : defaultPipelineStages;

    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1.5">
                    <CardTitle className="text-base">
                        {assessment ? `评估 #${assessment.id}` : '等待检测任务'}
                    </CardTitle>
                    <CardDescription>
                        {assessment ? `目标：${assessment.target}` : '发起安全评估后，将在这里显示实时流转位置。'}
                    </CardDescription>
                </div>
                {assessment ? <PipelineStatus status={assessment.status} /> : null}
            </CardHeader>
            <CardContent>
                {loading ? (
                    <LoadingBlock />
                ) : (
                    <div className="grid gap-3 md:grid-cols-4 md:gap-0">
                        {stages.map((stage, index) => {
                            const Icon = pipelineIcons[stage.key] ?? ShieldCheck;
                            const active = assessment?.current_stage === stage.key;
                            const finished = stage.status === 'finished' || stage.status === 'skipped';
                            const failed = stage.status === 'failed' || stage.status === 'stopped';

                            return (
                                <div
                                    className="relative flex items-center gap-3 px-2 py-2 md:flex-col md:text-center"
                                    key={stage.key}
                                >
                                    {index < stages.length - 1 ? (
                                        <div
                                            className={cn(
                                                'absolute top-7 left-[calc(50%+26px)] hidden h-0.5 w-[calc(100%-52px)] md:block',
                                                finished ? 'bg-emerald-500' : 'bg-border',
                                            )}
                                        />
                                    ) : null}
                                    <div
                                        className={cn(
                                            'bg-background relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full border-2',
                                            active &&
                                                'border-primary bg-primary/10 text-primary ring-primary/15 ring-4',
                                            finished && 'border-emerald-500 bg-emerald-500 text-white',
                                            failed && 'border-red-500 bg-red-500/10 text-red-500',
                                        )}
                                    >
                                        {finished ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium">{stage.title || stage.key}</div>
                                        <div className="text-muted-foreground mt-0.5 text-xs">
                                            {stageStatusLabel(stage.status, active)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function PipelineStatus({ status }: { status: string }) {
    const config: Record<string, { label: string; variant: 'blue' | 'green' | 'orange' | 'outline' | 'red' }> = {
        failed: { label: '执行失败', variant: 'red' },
        finished: { label: '已完成', variant: 'green' },
        pending: { label: '准备中', variant: 'outline' },
        running: { label: '执行中', variant: 'blue' },
        stopped: { label: '已停止', variant: 'outline' },
        waiting: { label: '等待交互', variant: 'orange' },
    };
    const current = config[status] ?? { label: '准备中', variant: 'outline' as const };

    return <Badge variant={current.variant}>{current.label}</Badge>;
}

function SectionHeading({ action, description, title }: { action?: ReactNode; description: string; title: string }) {
    return (
        <div className="flex items-end justify-between gap-4">
            <div>
                <h2 className="text-base font-semibold">{title}</h2>
                <p className="text-muted-foreground mt-1 text-sm">{description}</p>
            </div>
            {action}
        </div>
    );
}

function stageStatusLabel(status: AssessmentStageStatus, active: boolean) {
    if (active && status === 'waiting') {return '等待交互';}

    if (active) {return '当前阶段';}

    const labels: Record<AssessmentStageStatus, string> = {
        failed: '执行失败',
        finished: '已完成',
        pending: '待执行',
        running: '执行中',
        skipped: '已跳过',
        stopped: '已停止',
        waiting: '等待交互',
    };

    return labels[status];
}

function WorkspaceCard({
    children,
    description,
    icon: Icon,
    title,
}: {
    children: ReactNode;
    description: string;
    icon: LucideIcon;
    title: string;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4" />
                    {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}
