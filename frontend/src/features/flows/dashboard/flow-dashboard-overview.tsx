import { useQuery } from '@apollo/client/react';
import { Activity, CircleDollarSign, Cpu, GitFork } from 'lucide-react';
import { useMemo } from 'react';

import { MetricCard, UsageStatsRow } from '@/components/dashboard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import FlowAgentIcon from '@/features/flows/agents/flow-agent-icon';
import {
    AgentType,
    FlowStatsByFlowDocument,
    ToolcallsStatsByFlowDocument,
    ToolcallsStatsByFunctionForFlowDocument,
    UsageStatsByAgentTypeForFlowDocument,
    UsageStatsByFlowDocument,
    UsageStatsByModelAgentsForFlowDocument,
} from '@/graphql/types';
import { formatCost, formatDuration, formatNumber, formatTokenCount } from '@/lib/utils/format';
import { uiText } from '@/locales/zh-CN';

export function FlowDashboardOverview({ flowId }: { flowId: string }) {
    const {
        data: usageData,
        error: usageError,
        loading: usageLoading,
    } = useQuery(UsageStatsByFlowDocument, {
        variables: { flowId },
    });
    const { data: usageByAgentData } = useQuery(UsageStatsByAgentTypeForFlowDocument, {
        variables: { flowId },
    });
    const { data: usageByModelAgentsData } = useQuery(UsageStatsByModelAgentsForFlowDocument, {
        variables: { flowId },
    });
    const {
        data: toolcallsData,
        error: toolcallsError,
        loading: toolcallsLoading,
    } = useQuery(ToolcallsStatsByFlowDocument, {
        variables: { flowId },
    });
    const { data: toolcallsByFunctionData } = useQuery(ToolcallsStatsByFunctionForFlowDocument, {
        variables: { flowId },
    });
    const {
        data: flowStatsData,
        error: flowStatsError,
        loading: flowStatsLoading,
    } = useQuery(FlowStatsByFlowDocument, {
        variables: { flowId },
    });

    const usage = usageData?.usageStatsByFlow;
    const toolcalls = toolcallsData?.toolcallsStatsByFlow;
    const flowStats = flowStatsData?.flowStatsByFlow;

    const totalCost = usage ? usage.totalUsageCostIn + usage.totalUsageCostOut : 0;
    const totalTokens = usage ? usage.totalUsageIn + usage.totalUsageOut : 0;

    const agentTypeRows = useMemo(() => {
        const seen = new Set<string>();

        return (usageByAgentData?.usageStatsByAgentTypeForFlow ?? [])
            .filter((item) => {
                if (seen.has(item.agentType)) {
                    return false;
                }

                seen.add(item.agentType);

                return true;
            })
            .map((item) => ({
                label: item.agentType,
                stats: item.stats,
            }));
    }, [usageByAgentData]);

    const modelAgentRows = useMemo(() => {
        const seen = new Set<string>();

        return (usageByModelAgentsData?.usageStatsByModelAgentsForFlow ?? []).filter((item) => {
            const key = `${item.model}|${item.provider}`;

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);

            return true;
        });
    }, [usageByModelAgentsData]);

    const toolcallsByFunction = useMemo(() => {
        const seen = new Set<string>();

        return [...(toolcallsByFunctionData?.toolcallsStatsByFunctionForFlow ?? [])]
            .filter((item) => {
                if (seen.has(item.functionName)) {
                    return false;
                }

                seen.add(item.functionName);

                return true;
            })
            .sort((a, b) => b.totalCount - a.totalCount);
    }, [toolcallsByFunctionData]);

    const anyLoading =
        (usageLoading && !usageData) || (toolcallsLoading && !toolcallsData) || (flowStatsLoading && !flowStatsData);

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <MetricCard
                    description={`Subtasks: ${flowStats?.totalSubtasksCount ?? 0} · Assistants: ${flowStats?.totalAssistantsCount ?? 0}`}
                    error={!!flowStatsError && !flowStatsData}
                    icon={<GitFork className="text-muted-foreground size-4" />}
                    loading={anyLoading}
                    title={uiText('Tasks')}
                    value={flowStats ? formatNumber(flowStats.totalTasksCount) : '0'}
                />
                <MetricCard
                    description={`Duration: ${toolcalls ? formatDuration(toolcalls.totalDurationSeconds) : '—'}`}
                    error={!!toolcallsError && !toolcallsData}
                    icon={<Activity className="text-muted-foreground size-4" />}
                    loading={anyLoading}
                    title={uiText('Tool Calls')}
                    value={toolcalls ? formatNumber(toolcalls.totalCount) : '0'}
                />
                <MetricCard
                    description={uiText('Input + Output tokens')}
                    error={!!usageError && !usageData}
                    icon={<Cpu className="text-muted-foreground size-4" />}
                    loading={anyLoading}
                    title={uiText('Tokens')}
                    value={formatTokenCount(totalTokens)}
                />
                <MetricCard
                    description={uiText('LLM spending for this flow')}
                    error={!!usageError && !usageData}
                    icon={<CircleDollarSign className="text-muted-foreground size-4" />}
                    loading={anyLoading}
                    title={uiText('Cost')}
                    value={formatCost(totalCost)}
                />
            </div>

            {!!modelAgentRows.length && (
                <Card>
                    <CardHeader>
                        <CardTitle>{uiText('Usage by Model & Provider')}</CardTitle>
                        <CardDescription>
                            {uiText('LLM token usage and costs grouped by model and provider, with agent types used')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table aria-label={uiText('Usage by Model & Provider')}>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-40 whitespace-nowrap">{uiText('Model')}</TableHead>
                                    <TableHead className="whitespace-nowrap">{uiText('Provider')}</TableHead>
                                    <TableHead className="w-36 whitespace-nowrap">{uiText('Agents')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">
                                        {uiText('Tokens In')}
                                    </TableHead>
                                    <TableHead className="text-right whitespace-nowrap">
                                        {uiText('Tokens Out')}
                                    </TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{uiText('Cache In')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">
                                        {uiText('Cache Out')}
                                    </TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{uiText('Cost In')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{uiText('Cost Out')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">
                                        {uiText('Total Cost')}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {modelAgentRows.map((row) => (
                                    <TableRow key={`${row.model}|${row.provider}`}>
                                        <TableCell className="font-medium">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="block w-40 truncate">{row.model}</span>
                                                </TooltipTrigger>
                                                <TooltipContent>{row.model}</TooltipContent>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell>{row.provider}</TableCell>
                                        <TableCell>
                                            <div className="flex w-36 flex-wrap gap-1">
                                                {row.agentTypes.map((agentType) => (
                                                    <FlowAgentIcon
                                                        className="size-3.5"
                                                        key={agentType}
                                                        tooltip={agentType}
                                                        type={agentType as AgentType}
                                                    />
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatTokenCount(row.stats.totalUsageIn)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatTokenCount(row.stats.totalUsageOut)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatTokenCount(row.stats.totalUsageCacheIn)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatTokenCount(row.stats.totalUsageCacheOut)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCost(row.stats.totalUsageCostIn)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCost(row.stats.totalUsageCostOut)}
                                        </TableCell>
                                        <TableCell className="text-right font-semibold">
                                            {formatCost(row.stats.totalUsageCostIn + row.stats.totalUsageCostOut)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {!!agentTypeRows.length && (
                <Card>
                    <CardHeader>
                        <CardTitle>{uiText('Usage by Agent Type')}</CardTitle>
                        <CardDescription>
                            {uiText('LLM token usage and costs per agent type in this flow')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table aria-label={uiText('Usage by Agent Type')}>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{uiText('Agent Type')}</TableHead>
                                    <TableHead className="text-right">{uiText('Tokens In')}</TableHead>
                                    <TableHead className="text-right">{uiText('Tokens Out')}</TableHead>
                                    <TableHead className="text-right">{uiText('Cache In')}</TableHead>
                                    <TableHead className="text-right">{uiText('Cache Out')}</TableHead>
                                    <TableHead className="text-right">{uiText('Cost In')}</TableHead>
                                    <TableHead className="text-right">{uiText('Cost Out')}</TableHead>
                                    <TableHead className="text-right">{uiText('Total Cost')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {agentTypeRows.map((row) => (
                                    <UsageStatsRow
                                        key={row.label}
                                        label={row.label}
                                        stats={row.stats}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {!!toolcallsByFunction.length && (
                <Card>
                    <CardHeader>
                        <CardTitle>{uiText('Tool Calls by Function')}</CardTitle>
                        <CardDescription>
                            {uiText('Execution statistics per tool function in this flow')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table aria-label={uiText('Tool Calls by Function')}>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{uiText('Function')}</TableHead>
                                    <TableHead>{uiText('Type')}</TableHead>
                                    <TableHead className="text-right">{uiText('Count')}</TableHead>
                                    <TableHead className="text-right">{uiText('Total Duration')}</TableHead>
                                    <TableHead className="text-right">{uiText('Avg Duration')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {toolcallsByFunction.map((item) => (
                                    <TableRow key={item.functionName}>
                                        <TableCell className="font-medium">{item.functionName}</TableCell>
                                        <TableCell>
                                            <Badge variant={item.isAgent ? 'secondary' : 'outline'}>
                                                {item.isAgent ? uiText('Agent') : uiText('Tool')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">{formatNumber(item.totalCount)}</TableCell>
                                        <TableCell className="text-right">
                                            {formatDuration(item.totalDurationSeconds)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatDuration(item.avgDurationSeconds)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
