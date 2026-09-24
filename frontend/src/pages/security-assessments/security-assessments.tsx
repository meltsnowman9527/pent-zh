import {
    ArrowRight,
    CheckCircle2,
    CircleDashed,
    GitBranch,
    LoaderCircle,
    Network,
    Play,
    RefreshCw,
    RotateCcw,
    ScanSearch,
    ShieldCheck,
    Sparkles,
    Square,
    XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
    AppHeader,
    AppHeaderAction,
    AppHeaderActions,
    AppHeaderContent,
    AppHeaderTitle,
} from '@/components/layouts/app/app-header';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FlowForm, type FlowFormValues } from '@/features/flows/flow-form';
import { api, getApiErrorMessage, unwrapApiResponse } from '@/lib/axios';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useProviders } from '@/providers/providers-provider';

type AssessmentMode = 'assistant' | 'automation';
type AssessmentRunStatus = 'failed' | 'finished' | 'pending' | 'running' | 'stopped' | 'waiting';
interface AssessmentRunView {
    created_at: string;
    current_stage: string;
    error: string;
    flow_id: null | number;
    id: number;
    mode: AssessmentMode;
    profile: Profile;
    scan_type: ScanType;
    stages: AssessmentStage[];
    status: AssessmentRunStatus;
    target: string;
}
interface AssessmentStage {
    error: string;
    flow_id: number;
    key: string;
    order: number;
    run_id: number;
    status: AssessmentStageStatus;
    title: string;
}
type AssessmentStageStatus = 'failed' | 'finished' | 'pending' | 'running' | 'skipped' | 'stopped' | 'waiting';

interface ListResponse<T> {
    items: T[];
    total: number;
}
type Profile = 'deep' | 'quick' | 'standard';
type ScanType = 'passive' | 'traditional';

const assessmentStages = [
    { icon: Network, label: '资产发现' },
    { icon: ScanSearch, label: '漏洞扫描' },
    { icon: GitBranch, label: '利用链推理' },
    { icon: ShieldCheck, label: '渗透测试' },
];

const runStatusConfig: Record<AssessmentRunStatus, { label: string; variant: BadgeVariant }> = {
    failed: { label: '失败', variant: 'red' },
    finished: { label: '已完成', variant: 'green' },
    pending: { label: '准备中', variant: 'yellow' },
    running: { label: '执行中', variant: 'blue' },
    stopped: { label: '已停止', variant: 'outline' },
    waiting: { label: '等待交互', variant: 'orange' },
};

const stageStatusConfig: Record<AssessmentStageStatus, { label: string; variant: BadgeVariant }> = {
    failed: { label: '失败', variant: 'red' },
    finished: { label: '已完成', variant: 'green' },
    pending: { label: '待执行', variant: 'outline' },
    running: { label: '执行中', variant: 'blue' },
    skipped: { label: '已跳过', variant: 'outline' },
    stopped: { label: '已停止', variant: 'outline' },
    waiting: { label: '等待交互', variant: 'orange' },
};

export default function SecurityAssessments() {
    const navigate = useNavigate();
    const { selectedProvider } = useProviders();
    const [mode, setMode] = useState<AssessmentMode>('automation');
    const [scanType, setScanType] = useState<ScanType>('traditional');
    const [profile, setProfile] = useState<Profile>('standard');
    const [target, setTarget] = useState('');
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [runs, setRuns] = useState<AssessmentRunView[]>([]);
    const [isLoadingRuns, setIsLoadingRuns] = useState(true);
    const [pendingRunId, setPendingRunId] = useState<null | number>(null);
    const [tab, setTab] = useState('create');

    const loadRuns = useCallback(async (showError = false) => {
        try {
            const response = await api.get<ListResponse<AssessmentRunView>>('/security-assessments/');

            setRuns(unwrapApiResponse(response).items ?? []);
        } catch (error) {
            if (showError) {
                toast.error('读取安全评估记录失败', { description: getApiErrorMessage(error, '请稍后重试') });
            }
        } finally {
            setIsLoadingRuns(false);
        }
    }, []);

    useEffect(() => {
        let active = true;

        void api
            .get<ListResponse<AssessmentRunView>>('/security-assessments/')
            .then((response) => {
                if (active) {
                    setRuns(unwrapApiResponse(response).items ?? []);
                }
            })
            .catch(() => undefined)
            .finally(() => {
                if (active) {
                    setIsLoadingRuns(false);
                }
            });
        const timer = window.setInterval(() => void loadRuns(), 5000);

        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [loadRuns]);

    const handleSubmit = async (values: FlowFormValues) => {
        const trimmedTarget = target.trim();

        if (isStarting || !trimmedTarget || !isAuthorized) {
            return;
        }

        if (scanType === 'passive' && values.resourceIds.length !== 1) {
            toast.error('被动发现需要附加一个流量文件', {
                description: '请在输入框左下角选择一个 PCAP、PCAPNG 或 CAP 文件。',
            });

            return;
        }

        setIsStarting(true);

        try {
            const response = await api.post<AssessmentRunView>('/security-assessments/', {
                focus: '',
                instructions: values.message.trim(),
                mode,
                model_provider: values.providerName,
                profile,
                resource_ids: values.resourceIds.map(Number),
                scan_type: scanType,
                target: trimmedTarget,
            });
            const run = unwrapApiResponse(response);

            toast.success('智能体安全评估任务已启动', {
                description: '智能体会依次完成各阶段，可在任务记录中查看进度。',
            });
            await loadRuns();
            setTab('records');

            if (run.flow_id) {
                navigate(routes.flow(run.flow_id, { detailTab: 'tasks', tab: run.mode }));
            }
        } catch (error) {
            toast.error('启动智能体安全评估失败', { description: getApiErrorMessage(error, '请检查配置后重试') });
        } finally {
            setIsStarting(false);
        }
    };

    const controlRun = async (runId: number, action: 'retry' | 'stop') => {
        if (pendingRunId !== null) {
            return;
        }

        setPendingRunId(runId);

        try {
            const response = await api.post<AssessmentRunView>(`/security-assessments/${runId}/${action}`);
            const run = unwrapApiResponse(response);

            toast.success(action === 'stop' ? '已停止智能体安全评估' : '已重新启动智能体安全评估');
            await loadRuns();

            if (action === 'retry' && run.flow_id) {
                navigate(routes.flow(run.flow_id, { detailTab: 'tasks', tab: run.mode }));
            }
        } catch (error) {
            toast.error(action === 'stop' ? '停止编排失败' : '重试编排失败', {
                description: getApiErrorMessage(error, '请稍后重试'),
            });
        } finally {
            setPendingRunId(null);
        }
    };

    return (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <AppHeaderTitle icon={<Sparkles className="size-4 shrink-0" />}>智能体安全评估</AppHeaderTitle>
                </AppHeaderContent>
                <AppHeaderActions>
                    <AppHeaderAction
                        disabled={isLoadingRuns}
                        icon={isLoadingRuns ? <Spinner variant="circle" /> : <RefreshCw />}
                        label="刷新"
                        onClick={() => void loadRuns(true)}
                    />
                </AppHeaderActions>
            </AppHeader>

            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
                <Tabs
                    onValueChange={setTab}
                    value={tab}
                >
                    <TabsList className="grid w-full grid-cols-2 sm:w-80">
                        <TabsTrigger value="create">交给智能体</TabsTrigger>
                        <TabsTrigger value="records">任务记录</TabsTrigger>
                    </TabsList>

                    <TabsContent
                        className="mt-4"
                        value="create"
                    >
                        <Card>
                            <CardContent className="flex flex-col gap-5 pt-6">
                                <div className="flex flex-col gap-2 text-center">
                                    <h1 className="text-2xl font-semibold">交给智能体完成安全评估</h1>
                                    <p className="text-muted-foreground text-sm">
                                        提供目标和要求后，由智能体完成资产发现、漏洞扫描、利用链推理和渗透测试。
                                    </p>
                                </div>

                                <div className="bg-muted/40 flex items-center justify-center gap-2 rounded-lg border px-3 py-3">
                                    {assessmentStages.map(({ icon: Icon, label }, index) => (
                                        <div
                                            className="contents"
                                            key={label}
                                        >
                                            <div className="flex min-w-0 items-center gap-1.5 text-xs sm:text-sm">
                                                <Icon className="text-muted-foreground size-4 shrink-0" />
                                                <span className="truncate">{label}</span>
                                            </div>
                                            {index < assessmentStages.length - 1 ? (
                                                <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-muted-foreground -mt-2 text-center text-xs">
                                    智能体会按顺序推进各阶段，可在任务记录中查看进度、停止或重试。
                                </p>

                                <Tabs
                                    onValueChange={(value) => setMode(value as AssessmentMode)}
                                    value={mode}
                                >
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger
                                            disabled={isStarting}
                                            value="automation"
                                        >
                                            智能体自动执行
                                        </TabsTrigger>
                                        <TabsTrigger
                                            disabled={isStarting}
                                            value="assistant"
                                        >
                                            智能体交互协作
                                        </TabsTrigger>
                                    </TabsList>
                                </Tabs>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="grid gap-2">
                                        <Label>资产发现方式</Label>
                                        <Select
                                            disabled={isStarting}
                                            onValueChange={(value) => setScanType(value as ScanType)}
                                            value={scanType}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="traditional">传统主动发现</SelectItem>
                                                <SelectItem value="passive">流量被动发现 + 主动补全</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>评估强度</Label>
                                        <Select
                                            disabled={isStarting}
                                            onValueChange={(value) => setProfile(value as Profile)}
                                            value={profile}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="quick">快速</SelectItem>
                                                <SelectItem value="standard">标准（推荐）</SelectItem>
                                                <SelectItem value="deep">深入</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="assessment-target">授权目标范围</Label>
                                    <Input
                                        autoComplete="off"
                                        disabled={isStarting}
                                        id="assessment-target"
                                        onChange={(event) => setTarget(event.target.value)}
                                        placeholder="example.com、192.168.1.10 或 192.168.1.0/24"
                                        value={target}
                                    />
                                    <p className="text-muted-foreground text-xs">
                                        {scanType === 'passive'
                                            ? '请在下方输入框的附件菜单中选择一个 PCAP、PCAPNG 或 CAP 流量文件。'
                                            : '填写一个域名、IP、CIDR 网段或 URL。'}
                                    </p>
                                </div>

                                <label className="bg-muted/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                                    <input
                                        checked={isAuthorized}
                                        className="accent-primary mt-0.5 size-4"
                                        disabled={isStarting}
                                        onChange={(event) => setIsAuthorized(event.target.checked)}
                                        type="checkbox"
                                    />
                                    <span>我确认已获得该目标的安全测试授权，并对评估范围负责。</span>
                                </label>

                                <FlowForm
                                    defaultValues={{ providerName: selectedProvider?.name ?? '' }}
                                    isDisabled={!target.trim() || !isAuthorized}
                                    isSubmitting={isStarting}
                                    onSubmit={handleSubmit}
                                    placeholder={
                                        mode === 'automation'
                                            ? '告诉智能体本次评估的重点、限制和预期结果……'
                                            : '告诉智能体本次评估的要求，执行中还可以继续沟通……'
                                    }
                                    type={mode}
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent
                        className="mt-4"
                        value="records"
                    >
                        <div className="flex flex-col gap-4">
                            {isLoadingRuns && runs.length === 0 ? (
                                <Card>
                                    <CardContent className="flex h-40 items-center justify-center">
                                        <Spinner variant="circle" />
                                    </CardContent>
                                </Card>
                            ) : null}

                            {!isLoadingRuns && runs.length === 0 ? (
                                <Card>
                                    <CardContent className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-2 text-center">
                                        <CircleDashed className="size-8 opacity-50" />
                                        <div className="text-sm">暂无任务记录，先把一次安全评估交给智能体。</div>
                                    </CardContent>
                                </Card>
                            ) : null}

                            {runs.map((run) => (
                                <AssessmentRunCard
                                    isBusy={pendingRunId === run.id}
                                    key={run.id}
                                    onOpen={() => {
                                        if (run.flow_id) {
                                            navigate(routes.flow(run.flow_id, { detailTab: 'tasks', tab: run.mode }));
                                        }
                                    }}
                                    onRetry={() => void controlRun(run.id, 'retry')}
                                    onStop={() => void controlRun(run.id, 'stop')}
                                    run={run}
                                />
                            ))}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </>
    );
}

function AssessmentRunCard({
    isBusy,
    onOpen,
    onRetry,
    onStop,
    run,
}: {
    isBusy: boolean;
    onOpen: () => void;
    onRetry: () => void;
    onStop: () => void;
    run: AssessmentRunView;
}) {
    const isActive = !['failed', 'finished', 'stopped'].includes(run.status);

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                        <CardTitle className="truncate text-base">{run.target}</CardTitle>
                        <CardDescription className="mt-1">
                            任务 #{run.id} · {run.mode === 'automation' ? '智能体自动执行' : '智能体交互协作'} ·{' '}
                            {run.scan_type === 'passive' ? '流量被动发现' : '传统主动发现'} ·{' '}
                            {formatDate(run.created_at)}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <RunStatusBadge status={run.status} />
                        <Button
                            disabled={!run.flow_id}
                            onClick={onOpen}
                            size="sm"
                            variant="outline"
                        >
                            <Play />
                            打开工作台
                        </Button>
                        {isActive ? (
                            <Button
                                disabled={isBusy}
                                onClick={onStop}
                                size="sm"
                                variant="outline"
                            >
                                {isBusy ? <Spinner variant="circle" /> : <Square />}
                                停止
                            </Button>
                        ) : null}
                        {run.status === 'failed' || run.status === 'stopped' ? (
                            <Button
                                disabled={isBusy}
                                onClick={onRetry}
                                size="sm"
                            >
                                {isBusy ? <Spinner variant="circle" /> : <RotateCcw />}
                                重试
                            </Button>
                        ) : null}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {run.stages.map((stage) => (
                        <div
                            className={cn(
                                'flex items-center justify-between gap-2 rounded-lg border px-3 py-2',
                                run.current_stage === stage.key && isActive && 'border-primary/60 bg-primary/5',
                            )}
                            key={stage.key}
                        >
                            <span className="truncate text-sm">{stage.title || stage.key}</span>
                            <StageStatusBadge status={stage.status} />
                        </div>
                    ))}
                </div>
                {run.error ? <p className="text-destructive text-xs">最近一次错误：{run.error}</p> : null}
                {!run.error && run.stages.some((stage) => stage.error) ? (
                    <p className="text-destructive text-xs">
                        {run.stages.find((stage) => stage.error)?.title}：
                        {run.stages.find((stage) => stage.error)?.error}
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}

function formatDate(value: string) {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function RunStatusBadge({ status }: { status: AssessmentRunStatus }) {
    const config = runStatusConfig[status] ?? runStatusConfig.pending;
    const Icon = status === 'failed' ? XCircle : status === 'finished' ? CheckCircle2 : LoaderCircle;

    return (
        <Badge variant={config.variant}>
            <Icon className={cn('size-3', ['pending', 'running'].includes(status) && 'animate-spin')} />
            {config.label}
        </Badge>
    );
}

function StageStatusBadge({ status }: { status: AssessmentStageStatus }) {
    const config = stageStatusConfig[status] ?? stageStatusConfig.pending;
    const Icon = status === 'failed' ? XCircle : status === 'finished' ? CheckCircle2 : LoaderCircle;

    return (
        <Badge variant={config.variant}>
            <Icon className={cn('size-3', ['running'].includes(status) && 'animate-spin')} />
            {config.label}
        </Badge>
    );
}
