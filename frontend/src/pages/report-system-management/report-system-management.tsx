import type { LucideIcon } from 'lucide-react';

import {
    Activity,
    ArrowRight,
    Bot,
    CheckCircle2,
    CircleDashed,
    FileText,
    KeyRound,
    ListChecks,
    Settings2,
    ShieldAlert,
    SlidersHorizontal,
    UserRoundCog,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { AppHeader, AppHeaderContent, AppHeaderTitle } from '@/components/layouts/app/app-header';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusType } from '@/graphql/types';
import { routes } from '@/lib/routes';
import { formatDate } from '@/lib/utils/format';
import { useSidebarFlows } from '@/providers/sidebar-flows-provider';

interface ManagementModule {
    description: string;
    icon: LucideIcon;
    label: string;
    to: string;
}

const managementModules: ManagementModule[] = [
    {
        description: '维护账户资料、登录凭据与个人安全选项。',
        icon: UserRoundCog,
        label: '账户管理',
        to: routes.settings.account,
    },
    {
        description: '配置智能体使用的模型、供应商与连接参数。',
        icon: Bot,
        label: '模型供应商',
        to: routes.settings.providers,
    },
    {
        description: '统一维护系统提示词和各类智能体执行策略。',
        icon: SlidersHorizontal,
        label: '提示词管理',
        to: routes.settings.prompts,
    },
    {
        description: '创建、检查和管理系统 API 访问令牌。',
        icon: KeyRound,
        label: 'API 令牌',
        to: routes.settings.apiTokens,
    },
];

const statusDisplay: Record<StatusType, { label: string; variant: BadgeVariant }> = {
    [StatusType.Created]: { label: '已创建', variant: 'outline' },
    [StatusType.Failed]: { label: '执行失败', variant: 'red' },
    [StatusType.Finished]: { label: '报告就绪', variant: 'green' },
    [StatusType.Running]: { label: '执行中', variant: 'blue' },
    [StatusType.Waiting]: { label: '等待中', variant: 'yellow' },
};

export default function ReportSystemManagement() {
    const { flows } = useSidebarFlows();
    const sortedFlows = [...flows].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
    const finishedCount = flows.filter((flow) => flow.status === StatusType.Finished).length;
    const runningCount = flows.filter((flow) => flow.status === StatusType.Running).length;
    const failedCount = flows.filter((flow) => flow.status === StatusType.Failed).length;

    return (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <AppHeaderTitle icon={<FileText className="size-4" />}>报告与系统管理</AppHeaderTitle>
                </AppHeaderContent>
            </AppHeader>

            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">
                <section className="from-primary/10 via-background to-background overflow-hidden rounded-2xl border bg-gradient-to-r p-5 md:p-7">
                    <div className="max-w-3xl">
                        <Badge variant="blue">统一管理中心</Badge>
                        <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">报告与系统管理</h1>
                        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                            集中查看安全任务报告、跟踪报告生成状态，并管理智能体运行所需的账户、模型、提示词和访问凭据。
                        </p>
                    </div>
                </section>

                <Tabs defaultValue="reports">
                    <TabsList className="grid w-full max-w-sm grid-cols-2">
                        <TabsTrigger value="reports">报告中心</TabsTrigger>
                        <TabsTrigger value="system">系统管理</TabsTrigger>
                    </TabsList>

                    <TabsContent
                        className="mt-5 space-y-5"
                        value="reports"
                    >
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <SummaryCard
                                icon={ListChecks}
                                label="全部任务"
                                value={flows.length}
                            />
                            <SummaryCard
                                icon={CheckCircle2}
                                label="报告就绪"
                                value={finishedCount}
                            />
                            <SummaryCard
                                icon={Activity}
                                label="正在执行"
                                value={runningCount}
                            />
                            <SummaryCard
                                icon={ShieldAlert}
                                label="异常任务"
                                value={failedCount}
                            />
                        </div>

                        <Card>
                            <CardHeader className="flex-row items-start justify-between gap-4">
                                <div className="space-y-1.5">
                                    <CardTitle>任务报告</CardTitle>
                                    <CardDescription>
                                        按任务更新时间排列，已完成的任务可直接打开完整报告。
                                    </CardDescription>
                                </div>
                                <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                >
                                    <Link to={routes.flows}>
                                        全部任务
                                        <ArrowRight />
                                    </Link>
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {sortedFlows.length ? (
                                    <div className="divide-y rounded-lg border">
                                        {sortedFlows.slice(0, 10).map((flow) => {
                                            const status = statusDisplay[flow.status];
                                            const reportReady = flow.status === StatusType.Finished;

                                            return (
                                                <div
                                                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                                                    key={flow.id}
                                                >
                                                    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                                                        <FileText className="text-muted-foreground size-5" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium">{flow.title}</div>
                                                        <div className="text-muted-foreground mt-1 text-xs">
                                                            任务 #{flow.id} · {formatDate(new Date(flow.createdAt))}
                                                        </div>
                                                    </div>
                                                    <Badge
                                                        className="w-fit"
                                                        variant={status.variant}
                                                    >
                                                        {status.label}
                                                    </Badge>
                                                    <Button
                                                        asChild
                                                        size="sm"
                                                        variant={reportReady ? 'default' : 'outline'}
                                                    >
                                                        <Link
                                                            to={
                                                                reportReady
                                                                    ? routes.flowReport(flow.id)
                                                                    : routes.flow(flow.id)
                                                            }
                                                        >
                                                            {reportReady ? '查看报告' : '查看任务'}
                                                        </Link>
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-sm">
                                        <CircleDashed className="size-8" />
                                        <div>
                                            <div className="text-foreground font-medium">暂无任务报告</div>
                                            <div className="mt-1">完成安全评估任务后，报告会集中显示在这里。</div>
                                        </div>
                                        <Button
                                            asChild
                                            size="sm"
                                        >
                                            <Link to={routes.newFlow}>创建任务</Link>
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent
                        className="mt-5 space-y-5"
                        value="system"
                    >
                        <div className="grid gap-4 md:grid-cols-2">
                            {managementModules.map((module) => (
                                <Link
                                    key={module.label}
                                    to={module.to}
                                >
                                    <Card className="group hover:border-primary/50 h-full transition-colors">
                                        <CardHeader className="flex-row items-start gap-4">
                                            <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                                                <module.icon className="size-5" />
                                            </div>
                                            <div className="min-w-0 flex-1 space-y-1.5">
                                                <CardTitle className="flex items-center justify-between gap-2 text-base">
                                                    {module.label}
                                                    <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-1" />
                                                </CardTitle>
                                                <CardDescription className="leading-6">
                                                    {module.description}
                                                </CardDescription>
                                            </div>
                                        </CardHeader>
                                    </Card>
                                </Link>
                            ))}
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Settings2 className="size-4" />
                                    管理说明
                                </CardTitle>
                                <CardDescription>
                                    此页面统一汇总管理入口；具体配置仍在各自的安全设置页面中完成，以保留现有权限校验和操作流程。
                                </CardDescription>
                            </CardHeader>
                        </Card>
                    </TabsContent>
                </Tabs>
            </main>
        </>
    );
}

function SummaryCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
    return (
        <Card>
            <CardContent className="flex items-center gap-4 p-4">
                <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
                    <Icon className="text-muted-foreground size-5" />
                </div>
                <div>
                    <div className="text-2xl font-semibold tabular-nums">{value}</div>
                    <div className="text-muted-foreground text-xs">{label}</div>
                </div>
            </CardContent>
        </Card>
    );
}
