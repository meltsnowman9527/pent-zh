import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AppHeader, AppHeaderContent, AppHeaderTitle } from '@/components/layouts/app/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FlowForm, type FlowFormValues } from '@/features/flows/flow-form';
import { api, getApiErrorMessage, unwrapApiResponse } from '@/lib/axios';
import { routes } from '@/lib/routes';
import { uiText } from '@/locales/zh-CN';
import { useFlows } from '@/providers/flows-provider';
import { useProviders } from '@/providers/providers-provider';
import { useSystemSettings } from '@/providers/system-settings-provider';

interface ExploitChainList {
    items: ExploitChainRun[];
    total: number;
}

interface ExploitChainRun {
    flow_id: number;
    id: number;
    source_title: string;
    status: 'created' | 'failed' | 'finished' | 'running' | 'waiting';
    target: string;
    title: string;
}

function NewFlow() {
    const navigate = useNavigate();

    const { selectedProvider } = useProviders();
    const { createFlow, createFlowWithAssistant } = useFlows();
    const { settings } = useSystemSettings();

    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingChains, setIsLoadingChains] = useState(true);
    const [flowType, setFlowType] = useState<'assistant' | 'automation'>('automation');
    const [exploitChains, setExploitChains] = useState<ExploitChainRun[]>([]);
    const [exploitChainId, setExploitChainId] = useState('');

    const shouldUseAgents = useMemo(() => {
        return settings?.assistantUseAgents ?? false;
    }, [settings?.assistantUseAgents]);

    const selectedExploitChain = useMemo(
        () => exploitChains.find((chain) => String(chain.id) === exploitChainId),
        [exploitChainId, exploitChains],
    );

    useEffect(() => {
        let active = true;

        void api
            .get<ExploitChainList>('/exploit-chains/')
            .then((response) => {
                if (active) {
                    const runs = unwrapApiResponse(response).items ?? [];
                    setExploitChains(runs.filter((run) => run.status === 'finished'));
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    toast.error('读取漏洞利用链任务失败', {
                        description: getApiErrorMessage(error, '请稍后重试'),
                    });
                }
            })
            .finally(() => {
                if (active) {
                    setIsLoadingChains(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    const handleSubmit = async (values: FlowFormValues) => {
        if (isLoading || !selectedExploitChain) {
            return;
        }

        setIsLoading(true);

        try {
            const graphResponse = await api.get<unknown>(`/exploit-chains/${selectedExploitChain.id}/graph`);
            const graph = unwrapApiResponse(graphResponse);
            const sourceContext = [
                '【渗透测试任务来源】',
                `漏洞利用链任务：${selectedExploitChain.title || `任务 #${selectedExploitChain.flow_id}`}`,
                `目标：${selectedExploitChain.target}`,
                `漏洞利用链记录编号：${selectedExploitChain.id}`,
                `来源扫描：${selectedExploitChain.source_title || '未命名扫描任务'}`,
                '以下是已经完成推理并通过校验的漏洞利用链图谱。请以这些证据为起点开展已授权的渗透测试，不要虚构不存在的资产或漏洞：',
                JSON.stringify(graph),
                '',
                '【本次渗透测试要求】',
                values.message.trim(),
            ].join('\n');
            const linkedValues = { ...values, message: sourceContext };
            const flowId =
                flowType === 'automation'
                    ? await createFlow(linkedValues)
                    : await createFlowWithAssistant(linkedValues);

            if (flowId) {
                navigate(routes.flow(flowId, { tab: flowType }));
            }
        } catch (error) {
            toast.error('无法读取所选漏洞利用链', {
                description: getApiErrorMessage(error, '请选择包含结构化图谱的已完成任务'),
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <AppHeaderTitle>{uiText('New flow')}</AppHeaderTitle>
                </AppHeaderContent>
            </AppHeader>
            <div className="flex min-h-[calc(100dvh-3rem)] items-center justify-center p-4">
                <Card className="w-full max-w-2xl">
                    <CardContent className="flex flex-col gap-4 pt-6">
                        <div className="flex flex-col gap-2 text-center">
                            <h2 className="text-2xl font-semibold">{uiText('Create a new flow')}</h2>
                            <p className="text-muted-foreground">
                                {uiText('Describe what you would like PentAGI to test')}
                            </p>
                        </div>
                        <div className="grid gap-2">
                            <Label>漏洞利用链任务</Label>
                            <Select
                                disabled={isLoading || isLoadingChains}
                                onValueChange={setExploitChainId}
                                value={exploitChainId}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择一个已完成的漏洞利用链任务" />
                                </SelectTrigger>
                                <SelectContent>
                                    {exploitChains.map((chain) => (
                                        <SelectItem
                                            key={chain.id}
                                            value={String(chain.id)}
                                        >
                                            {chain.target} · {chain.title || `任务 #${chain.flow_id}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {isLoadingChains ? (
                                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                                    <Spinner variant="circle" />
                                    正在读取漏洞利用链任务……
                                </div>
                            ) : exploitChains.length === 0 ? (
                                <p className="text-muted-foreground text-xs">
                                    暂无已完成的漏洞利用链任务，请先完成漏洞利用链推理。
                                </p>
                            ) : (
                                <p className="text-muted-foreground text-xs">
                                    新任务将读取所选利用链的资产、漏洞、攻击路径和证据关系。
                                </p>
                            )}
                        </div>
                        <Tabs
                            onValueChange={(value) => setFlowType(value as 'assistant' | 'automation')}
                            value={flowType}
                        >
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger
                                    disabled={isLoading}
                                    value="automation"
                                >
                                    {uiText('Automation')}
                                </TabsTrigger>
                                <TabsTrigger
                                    disabled={isLoading}
                                    value="assistant"
                                >
                                    {uiText('Assistant')}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {isLoading && (
                            <p
                                className="text-muted-foreground text-center text-sm"
                                role="status"
                            >
                                {uiText('Preparing task')}
                            </p>
                        )}
                        <FlowForm
                            defaultValues={{
                                providerName: selectedProvider?.name ?? '',
                                useAgents: shouldUseAgents,
                            }}
                            isDisabled={!selectedExploitChain}
                            isSubmitting={isLoading}
                            onSubmit={handleSubmit}
                            placeholder={
                                !isLoading
                                    ? flowType === 'automation'
                                        ? uiText('Describe what you would like PentAGI to test...')
                                        : uiText('What would you like me to help you with?')
                                    : uiText('Creating a new flow...')
                            }
                            type={flowType}
                        />
                    </CardContent>
                </Card>
            </div>
        </>
    );
}

export default NewFlow;
