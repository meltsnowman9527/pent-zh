import type { LucideIcon } from 'lucide-react';

import {
    Activity,
    Binoculars,
    Bot,
    BrainCircuit,
    Bug,
    ClipboardCheck,
    FileCheck2,
    GitBranch,
    LibraryBig,
    Network,
    Plug,
    Plus,
    Radar,
    Settings2,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';

import { AppHeader, AppHeaderContent, AppHeaderTitle } from '@/components/layouts/app/app-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CoreAgent {
    actions: string[];
    description: string;
    icon: LucideIcon;
    key: string;
    name: string;
    stage: string;
}

const coreAgents: CoreAgent[] = [
    {
        actions: ['分派任务', '调整优先级', '终止流程'],
        description: '拆解目标、编排执行顺序，并协调各专业智能体之间的上下文和结果。',
        icon: Network,
        key: 'coordinator',
        name: '主协调智能体',
        stage: '全流程编排',
    },
    {
        actions: ['启动发现', '导入资产', '刷新指纹'],
        description: '发现域名、主机、端口、服务和技术组件，形成统一攻击面清单。',
        icon: Radar,
        key: 'asset-discovery',
        name: '资产发现智能体',
        stage: '资产发现',
    },
    {
        actions: ['执行扫描', '复核结果', '调整策略'],
        description: '根据资产与服务特征执行漏洞检测、结果去重和初步风险定级。',
        icon: Bug,
        key: 'vulnerability-scan',
        name: '漏洞扫描智能体',
        stage: '漏洞检测',
    },
    {
        actions: ['同步情报', '查询 CVE', '关联威胁'],
        description: '聚合 CVE、已知利用和外部威胁线索，为漏洞判断补充实时情报。',
        icon: Binoculars,
        key: 'vulnerability-intelligence',
        name: '漏洞情报智能体',
        stage: '情报增强',
    },
    {
        actions: ['生成链路', '重新推理', '解释路径'],
        description: '结合资产、漏洞和权限关系推导多条可能的攻击路径与影响目标。',
        icon: GitBranch,
        key: 'vulnerability-reasoning',
        name: '漏洞推理智能体',
        stage: '链路推理',
    },
    {
        actions: ['评估可行性', '选择路径', '设置边界'],
        description: '对候选利用方式进行可行性、风险与授权边界判断，给出执行决策。',
        icon: BrainCircuit,
        key: 'exploitation-decision',
        name: '利用决策智能体',
        stage: '执行决策',
    },
    {
        actions: ['检索知识', '重建索引', '查看引用'],
        description: '从内部知识库、历史报告和安全资料中检索任务所需的上下文。',
        icon: LibraryBig,
        key: 'knowledge-retrieval',
        name: '知识检索智能体',
        stage: '知识支撑',
    },
    {
        actions: ['开始验证', '暂停执行', '查看证据'],
        description: '在授权和安全约束内执行验证动作，记录命令、响应与验证证据。',
        icon: ShieldCheck,
        key: 'validation-execution',
        name: '验证执行智能体',
        stage: '安全验证',
    },
    {
        actions: ['评估结果', '退回重试', '修正评分'],
        description: '检查阶段产出质量与证据完整性，并将反馈送回前序智能体修正。',
        icon: ClipboardCheck,
        key: 'assessment-feedback',
        name: '评估反馈智能体',
        stage: '质量评估',
    },
    {
        actions: ['生成报告', '补充证据', '导出报告'],
        description: '汇总发现、路径、影响与处置建议，形成可追溯的证据化安全报告。',
        icon: FileCheck2,
        key: 'evidence-reporting',
        name: '证据报告智能体',
        stage: '报告交付',
    },
];

const skills = [
    { description: '识别服务、框架、组件和版本信息', name: '资产指纹识别', scope: '资产发现' },
    { description: '关联漏洞、CVE、利用条件和缓解措施', name: '漏洞关联分析', scope: '漏洞扫描' },
    { description: '基于攻击面生成多路径利用链', name: '攻击链推理', scope: '漏洞推理' },
    { description: '对验证过程中的命令和结果进行结构化留证', name: '证据采集', scope: '验证执行' },
    { description: '将任务证据整理为管理与技术报告', name: '报告编排', scope: '证据报告' },
];

const mcpServers = [
    { capabilities: '资产查询、服务指纹、端口信息', name: '资产清单 MCP', status: '待配置' },
    { capabilities: 'CVE、KEV、威胁情报检索', name: '漏洞情报 MCP', status: '待配置' },
    { capabilities: '隔离执行、命令验证、证据回传', name: '验证沙箱 MCP', status: '待配置' },
];

export default function SettingsAgents() {
    return (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <AppHeaderTitle icon={<Bot className="size-4 shrink-0" />}>智能体与能力</AppHeaderTitle>
                </AppHeaderContent>
            </AppHeader>

            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-semibold tracking-tight">Agent 与能力配置</h1>
                            <Badge variant="secondary">前端预览</Badge>
                        </div>
                        <p className="text-muted-foreground mt-2 text-sm">
                            管理全流程核心智能体、Skill 与 MCP 能力，并查看运行状态和可执行动作。
                        </p>
                    </div>
                    <Button
                        disabled
                        variant="outline"
                    >
                        <Plus />
                        新增自定义智能体
                    </Button>
                </div>

                <Tabs defaultValue="agents">
                    <TabsList className="grid w-full max-w-xl grid-cols-3">
                        <TabsTrigger value="agents">Agent 管理</TabsTrigger>
                        <TabsTrigger value="capabilities">能力配置</TabsTrigger>
                        <TabsTrigger value="runtime">运行状态</TabsTrigger>
                    </TabsList>

                    <TabsContent
                        className="mt-5 space-y-4"
                        value="agents"
                    >
                        <div className="grid gap-4 md:grid-cols-2">
                            {coreAgents.map((agent, index) => (
                                <AgentCard
                                    agent={agent}
                                    index={index}
                                    key={agent.key}
                                />
                            ))}
                        </div>
                    </TabsContent>

                    <TabsContent
                        className="mt-5"
                        value="capabilities"
                    >
                        <Tabs defaultValue="base">
                            <TabsList className="grid w-full max-w-lg grid-cols-3">
                                <TabsTrigger value="base">基础配置</TabsTrigger>
                                <TabsTrigger value="skills">Skill 管理</TabsTrigger>
                                <TabsTrigger value="mcp">MCP 管理</TabsTrigger>
                            </TabsList>
                            <TabsContent
                                className="mt-4"
                                value="base"
                            >
                                <BaseConfiguration />
                            </TabsContent>
                            <TabsContent
                                className="mt-4"
                                value="skills"
                            >
                                <SkillConfiguration />
                            </TabsContent>
                            <TabsContent
                                className="mt-4"
                                value="mcp"
                            >
                                <McpConfiguration />
                            </TabsContent>
                        </Tabs>
                    </TabsContent>

                    <TabsContent
                        className="mt-5"
                        value="runtime"
                    >
                        <RuntimeStatus />
                    </TabsContent>
                </Tabs>
            </main>
        </>
    );
}

function AgentCard({ agent, index }: { agent: CoreAgent; index: number }) {
    const Icon = agent.icon;

    return (
        <Card>
            <CardHeader className="flex-row items-start gap-4">
                <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                    <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{agent.name}</CardTitle>
                        <Badge variant="outline">内置</Badge>
                        <Badge variant="green">已启用</Badge>
                    </div>
                    <CardDescription className="leading-6">{agent.description}</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="bg-muted/40 grid grid-cols-2 gap-3 rounded-lg p-3 text-xs">
                    <div>
                        <span className="text-muted-foreground">流程序号</span>
                        <div className="mt-1 font-medium">{String(index + 1).padStart(2, '0')}</div>
                    </div>
                    <div>
                        <span className="text-muted-foreground">负责阶段</span>
                        <div className="mt-1 font-medium">{agent.stage}</div>
                    </div>
                </div>
                <div>
                    <div className="text-muted-foreground mb-2 text-xs">可执行动作</div>
                    <div className="flex flex-wrap gap-2">
                        {agent.actions.map((action) => (
                            <Badge
                                key={action}
                                variant="secondary"
                            >
                                {action}
                            </Badge>
                        ))}
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <Button
                        disabled
                        size="sm"
                        variant="ghost"
                    >
                        查看详情
                    </Button>
                    <Button
                        disabled
                        size="sm"
                        variant="outline"
                    >
                        <Settings2 />
                        配置
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function BaseConfiguration() {
    const settings = [
        { description: '由主协调智能体根据当前阶段自动选择执行者', label: '协作模式', value: '流水线自动编排' },
        { description: '未单独指定时继承系统供应商配置', label: '默认模型策略', value: '继承系统设置' },
        { description: '控制同一任务可并行运行的智能体数量', label: '最大并行数', value: '3' },
        { description: '超过时限的阶段进入等待或失败状态', label: '阶段超时', value: '30 分钟' },
        { description: '对高风险动作启用人工确认节点', label: '执行审批', value: '高风险动作需确认' },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle>基础配置</CardTitle>
                <CardDescription>配置智能体协作、模型继承、并发和安全边界。</CardDescription>
            </CardHeader>
            <CardContent className="divide-y rounded-lg border">
                {settings.map((setting) => (
                    <div
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                        key={setting.label}
                    >
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{setting.label}</div>
                            <div className="text-muted-foreground mt-1 text-xs">{setting.description}</div>
                        </div>
                        <Button
                            className="justify-between sm:w-56"
                            disabled
                            variant="outline"
                        >
                            {setting.value}
                            <Settings2 />
                        </Button>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

function McpConfiguration() {
    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1.5">
                    <CardTitle>MCP 能力</CardTitle>
                    <CardDescription>接入外部数据源、工具服务和受控执行环境。</CardDescription>
                </div>
                <Button
                    disabled
                    size="sm"
                >
                    <Plus />
                    添加 MCP
                </Button>
            </CardHeader>
            <CardContent className="space-y-3">
                {mcpServers.map((server) => (
                    <div
                        className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
                        key={server.name}
                    >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600">
                            <Plug className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{server.name}</div>
                            <div className="text-muted-foreground mt-1 text-xs">{server.capabilities}</div>
                        </div>
                        <Badge variant="yellow">{server.status}</Badge>
                        <Button
                            disabled
                            size="sm"
                            variant="outline"
                        >
                            配置连接
                        </Button>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

function RuntimeStatus() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>核心智能体运行状态</CardTitle>
                <CardDescription>
                    展示各流程智能体的当前状态、负责阶段与可执行动作；实时状态将在后端接入后更新。
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-hidden rounded-lg border">
                    <div className="bg-muted/50 hidden grid-cols-[minmax(220px,1.4fr)_130px_120px_minmax(280px,2fr)] gap-4 px-4 py-3 text-xs font-medium md:grid">
                        <span>智能体</span>
                        <span>流程阶段</span>
                        <span>状态</span>
                        <span>可执行动作</span>
                    </div>
                    {coreAgents.map((agent, index) => {
                        const Icon = agent.icon;

                        return (
                            <div
                                className="grid gap-3 border-t p-4 first:border-t-0 md:grid-cols-[minmax(220px,1.4fr)_130px_120px_minmax(280px,2fr)] md:items-center md:gap-4"
                                key={agent.key}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                                        <Icon className="size-4" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium">{agent.name}</div>
                                        <div className="text-muted-foreground text-xs">
                                            Agent {String(index + 1).padStart(2, '0')}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-sm">{agent.stage}</div>
                                <Badge
                                    className="w-fit"
                                    variant={index === 0 ? 'blue' : 'green'}
                                >
                                    {index === 0 ? '协调就绪' : '空闲就绪'}
                                </Badge>
                                <div className="flex flex-wrap gap-1.5">
                                    {agent.actions.map((action) => (
                                        <Button
                                            disabled
                                            key={action}
                                            size="xs"
                                            variant="outline"
                                        >
                                            {action}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
                    <Activity className="size-3.5" />
                    状态数据与启动、暂停、重试等动作将在运行接口接入后启用。
                </div>
            </CardContent>
        </Card>
    );
}

function SkillConfiguration() {
    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1.5">
                    <CardTitle>Skill 能力</CardTitle>
                    <CardDescription>为不同智能体装配可复用的专业知识和执行流程。</CardDescription>
                </div>
                <Button
                    disabled
                    size="sm"
                >
                    <Plus />
                    添加 Skill
                </Button>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
                {skills.map((skill) => (
                    <div
                        className="flex items-start gap-3 rounded-lg border p-4"
                        key={skill.name}
                    >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                            <Sparkles className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{skill.name}</span>
                                <Badge variant="outline">{skill.scope}</Badge>
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs leading-5">{skill.description}</p>
                        </div>
                        <Badge variant="secondary">待接入</Badge>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
