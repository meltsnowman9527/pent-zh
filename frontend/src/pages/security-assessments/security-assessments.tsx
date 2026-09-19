import { ArrowRight, GitBranch, Network, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AppHeader, AppHeaderContent, AppHeaderTitle } from '@/components/layouts/app/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FlowForm, type FlowFormValues } from '@/features/flows/flow-form';
import { api, getApiErrorMessage, unwrapApiResponse } from '@/lib/axios';
import { routes } from '@/lib/routes';
import { useProviders } from '@/providers/providers-provider';

type AssessmentMode = 'assistant' | 'automation';
interface AssessmentRun {
    flow_id: number;
    id: number;
}
type Profile = 'deep' | 'quick' | 'standard';

type ScanType = 'passive' | 'traditional';

const assessmentStages = [
    { icon: Network, label: '资产发现' },
    { icon: ScanSearch, label: '漏洞扫描' },
    { icon: GitBranch, label: '利用链推理' },
    { icon: ShieldCheck, label: '渗透测试' },
];

export default function SecurityAssessments() {
    const navigate = useNavigate();
    const { selectedProvider } = useProviders();
    const [mode, setMode] = useState<AssessmentMode>('automation');
    const [scanType, setScanType] = useState<ScanType>('traditional');
    const [profile, setProfile] = useState<Profile>('standard');
    const [target, setTarget] = useState('');
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isStarting, setIsStarting] = useState(false);

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
            const response = await api.post<AssessmentRun>('/security-assessments/', {
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

            navigate(routes.flow(run.flow_id, { detailTab: 'tasks', tab: mode }));
        } catch (error) {
            toast.error('启动安全评估失败', { description: getApiErrorMessage(error, '请检查配置后重试') });
        } finally {
            setIsStarting(false);
        }
    };

    return (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <AppHeaderTitle icon={<Sparkles className="size-4 shrink-0" />}>安全评估编排</AppHeaderTitle>
                </AppHeaderContent>
            </AppHeader>

            <div className="flex min-h-[calc(100dvh-3rem)] items-center justify-center p-4">
                <Card className="w-full max-w-2xl">
                    <CardContent className="flex flex-col gap-5 pt-6">
                        <div className="flex flex-col gap-2 text-center">
                            <h1 className="text-2xl font-semibold">新建安全评估编排</h1>
                            <p className="text-muted-foreground text-sm">
                                配置一次，按顺序完成资产发现、漏洞扫描、利用链推理和渗透测试。
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
                            启动后进入任务工作台，可查看各阶段任务、智能体活动、工具调用、终端和证据文件。
                            交互助手会在关键操作前等待你的决定。
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
                                    自动执行
                                </TabsTrigger>
                                <TabsTrigger
                                    disabled={isStarting}
                                    value="assistant"
                                >
                                    交互助手
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
                                    ? '补充本次评估重点、限制和预期结果……'
                                    : '告诉助手本次评估的要求，执行中还可以继续沟通……'
                            }
                            type={mode}
                        />
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
