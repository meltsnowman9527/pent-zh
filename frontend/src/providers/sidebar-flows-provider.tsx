import { useQuery } from '@apollo/client/react';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

import type { FlowFragmentFragment } from '@/graphql/types';

import { FlowsDocument } from '@/graphql/types';

export type Flow = FlowFragmentFragment;

interface SidebarFlowsContextValue {
    flows: Array<Flow>;
}

const SidebarFlowsContext = createContext<SidebarFlowsContextValue | undefined>(undefined);

interface SidebarFlowsProviderProps {
    children: ReactNode;
}

export function SidebarFlowsProvider({ children }: SidebarFlowsProviderProps) {
    // Subscriptions are handled by FlowsProvider in FlowsLayout — which only exists
    // on the flow routes. Everywhere else (dashboard, settings, knowledge, …) this
    // query is the only thing keeping the sidebar list current, so it must not be
    // cache-first: that override made it skip the request whenever the cache had an
    // entry, and a flow created or deleted in the meantime never showed up until a
    // full page reload. cache-and-network renders the cached list instantly and
    // still refreshes it on every mount.
    const { data: flowsData, refetch } = useQuery(FlowsDocument, {
        fetchPolicy: 'cache-and-network',
        nextFetchPolicy: 'cache-and-network',
    });

    // No polling here on purpose: refreshing when the tab regains focus (or the
    // browser comes back online) covers "left the app open on another page" without
    // adding a global 5s poll. The flows list keeps its own poll while mounted.
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

    const value = useMemo(
        () => ({
            flows,
        }),
        [flows],
    );

    return <SidebarFlowsContext.Provider value={value}>{children}</SidebarFlowsContext.Provider>;
}

export function useSidebarFlows() {
    const context = useContext(SidebarFlowsContext);

    if (context === undefined) {
        throw new Error('useSidebarFlows must be used within SidebarFlowsProvider');
    }

    return context;
}
