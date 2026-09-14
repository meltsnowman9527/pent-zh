import { useMutation, useQuery, useSubscription } from '@apollo/client/react';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import type { FlowFormValues } from '@/features/flows/flow-form';
import type { FlowFragmentFragment, FlowsQuery } from '@/graphql/types';

import {
    CreateAssistantDocument,
    CreateFlowDocument,
    DeletedFlowsDocument,
    DeleteFlowDocument,
    FinishFlowDocument,
    FlowCreatedDocument,
    FlowDeletedDocument,
    FlowsDocument,
    FlowUpdatedDocument,
    RestoreFlowDocument,
} from '@/graphql/types';
import { localizeUiErrorText } from '@/lib/errors';
import { Log } from '@/lib/log';
import { uiText } from '@/locales/zh-CN';

export type Flow = FlowFragmentFragment;

interface FlowsContextValue {
    createFlow: (values: FlowFormValues) => Promise<null | string>;
    createFlowWithAssistant: (values: FlowFormValues) => Promise<null | string>;
    deleteFlow: (flow: Flow) => Promise<boolean>;
    finishFlow: (flow: Flow) => Promise<boolean>;
    flows: Array<Flow>;
    flowsData: FlowsQuery | undefined;
    flowsError: Error | undefined;
    isLoading: boolean;
    refetch: () => unknown;
    restoreFlow: (flow: Flow) => Promise<boolean>;
}

const FlowsContext = createContext<FlowsContextValue | undefined>(undefined);

interface FlowsProviderProps {
    children: React.ReactNode;
}

export function FlowsProvider({ children }: FlowsProviderProps) {
    const {
        data: flowsData,
        error: flowsError,
        loading,
        refetch,
    } = useQuery(FlowsDocument, {
        notifyOnNetworkStatusChange: true,
        pollInterval: 5000,
    });

    useEffect(() => {
        const refresh = () => {
            void refetch().catch(() => undefined);
        };

        window.addEventListener('online', refresh);
        window.addEventListener('focus', refresh);

        return () => {
            window.removeEventListener('online', refresh);
            window.removeEventListener('focus', refresh);
        };
    }, [refetch]);
    const flows = useMemo(() => flowsData?.flows ?? [], [flowsData?.flows]);
    // Full-page spinner only while there's nothing to show yet: a background refetch
    // (reconnect sweep) keeps the rendered list, and a retry after a failed initial load
    // shows the spinner rather than flashing the "No flows found" empty state.
    const isLoading = loading && flows.length === 0;

    useSubscription(FlowCreatedDocument);
    useSubscription(FlowDeletedDocument);
    useSubscription(FlowUpdatedDocument);

    const [createFlowMutation] = useMutation(CreateFlowDocument);
    const [createAssistantMutation] = useMutation(CreateAssistantDocument);
    const [deleteFlowMutation] = useMutation(DeleteFlowDocument);
    const [finishFlowMutation] = useMutation(FinishFlowDocument);
    const [restoreFlowMutation] = useMutation(RestoreFlowDocument);

    const createFlow = useCallback(
        async (values: FlowFormValues) => {
            const { message, providerName, resourceIds } = values;

            const input = message.trim();
            const modelProvider = providerName.trim();

            if (!input || !modelProvider) {
                return null;
            }

            try {
                const { data } = await createFlowMutation({
                    variables: {
                        input,
                        modelProvider,
                        resourceIds: resourceIds?.length ? resourceIds : undefined,
                    },
                });

                if (data?.createFlow?.id) {
                    return data.createFlow.id;
                }

                return null;
            } catch (error) {
                const description =
                    error instanceof Error
                        ? localizeUiErrorText(error.message)
                        : uiText('An error occurred while creating flow');
                toast.error(uiText('Failed to create flow'), {
                    description,
                });
                Log.error('Error creating flow:', error);

                return null;
            }
        },
        [createFlowMutation],
    );

    const createFlowWithAssistant = useCallback(
        async (values: FlowFormValues) => {
            const { message, providerName, resourceIds, useAgents } = values;

            const input = message.trim();
            const modelProvider = providerName.trim();

            if (!input || !modelProvider) {
                return null;
            }

            try {
                const { data } = await createAssistantMutation({
                    variables: {
                        flowId: '0',
                        input,
                        modelProvider,
                        resourceIds: resourceIds?.length ? resourceIds : undefined,
                        useAgents,
                    },
                });

                if (data?.createAssistant?.flow?.id) {
                    return data.createAssistant.flow.id;
                }

                return null;
            } catch (error) {
                const description =
                    error instanceof Error
                        ? localizeUiErrorText(error.message)
                        : uiText('An error occurred while creating assistant');
                toast.error(uiText('Failed to create assistant'), {
                    description,
                });
                Log.error('Error creating assistant:', error);

                return null;
            }
        },
        [createAssistantMutation],
    );

    const deleteFlow = useCallback(
        async (flow: Flow) => {
            const { id: flowId, title } = flow;

            if (!flowId) {
                return false;
            }

            const flowDescription = `${title || uiText('Unknown')} (ID: ${flowId})`;

            const loadingToastId = toast.loading(uiText('Deleting flow...'), {
                description: flowDescription,
            });

            try {
                await deleteFlowMutation({
                    refetchQueries: [FlowsDocument],
                    variables: { flowId },
                });

                toast.success('删除请求已受理，清理完成后将移除任务', {
                    description: flowDescription,
                    id: loadingToastId,
                });

                return true;
            } catch (error) {
                const errorMessage =
                    error instanceof Error
                        ? localizeUiErrorText(error.message)
                        : uiText('An error occurred while deleting flow');
                toast.error(errorMessage, {
                    description: flowDescription,
                    id: loadingToastId,
                });
                Log.error('Error deleting flow:', error);

                return false;
            }
        },
        [deleteFlowMutation],
    );

    const finishFlow = useCallback(
        async (flow: Flow) => {
            const { id: flowId, title } = flow;

            if (!flowId) {
                return false;
            }

            const flowDescription = `${title || uiText('Unknown')} (ID: ${flowId})`;

            const loadingToastId = toast.loading(uiText('Finishing flow...'), {
                description: flowDescription,
            });

            try {
                await finishFlowMutation({
                    refetchQueries: [FlowsDocument],
                    variables: { flowId },
                });

                toast.success('结束请求已受理，正在清理资源', {
                    description: flowDescription,
                    id: loadingToastId,
                });

                return true;
            } catch (error) {
                const errorMessage =
                    error instanceof Error
                        ? localizeUiErrorText(error.message)
                        : uiText('An error occurred while finishing flow');
                toast.error(errorMessage, {
                    description: flowDescription,
                    id: loadingToastId,
                });
                Log.error('Error finishing flow:', error);

                return false;
            }
        },
        [finishFlowMutation],
    );

    const restoreFlow = useCallback(
        async (flow: Flow) => {
            const { id: flowId, title } = flow;

            if (!flowId) {
                return false;
            }

            const flowDescription = `${title || uiText('Unknown')} (ID: ${flowId})`;

            const loadingToastId = toast.loading(uiText('Restoring flow...'), {
                description: flowDescription,
            });

            try {
                await restoreFlowMutation({
                    refetchQueries: [DeletedFlowsDocument, FlowsDocument],
                    variables: { flowId },
                });

                toast.success(uiText('Flow restored'), {
                    description: flowDescription,
                    id: loadingToastId,
                });

                return true;
            } catch (error) {
                const errorMessage =
                    error instanceof Error
                        ? localizeUiErrorText(error.message)
                        : uiText('An error occurred while restoring flow');
                toast.error(errorMessage, {
                    description: flowDescription,
                    id: loadingToastId,
                });
                Log.error('Error restoring flow:', error);

                return false;
            }
        },
        [restoreFlowMutation],
    );

    const value = useMemo(
        () => ({
            createFlow,
            createFlowWithAssistant,
            deleteFlow,
            finishFlow,
            flows,
            flowsData,
            flowsError,
            isLoading,
            refetch,
            restoreFlow,
        }),
        [
            createFlow,
            createFlowWithAssistant,
            deleteFlow,
            finishFlow,
            flows,
            flowsData,
            flowsError,
            isLoading,
            refetch,
            restoreFlow,
        ],
    );

    return <FlowsContext.Provider value={value}>{children}</FlowsContext.Provider>;
}

export function useFlows() {
    const context = useContext(FlowsContext);

    if (context === undefined) {
        throw new Error('useFlows must be used within FlowsProvider');
    }

    return context;
}
