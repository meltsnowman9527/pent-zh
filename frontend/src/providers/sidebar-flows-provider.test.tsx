import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowsDocument } from '@/graphql/types';

const mockRefetch = vi.fn(() => Promise.resolve());
const mockUseQuery = vi.fn(() => ({ data: { flows: [] }, refetch: mockRefetch }));
vi.mock('@apollo/client/react', () => ({
    useQuery: (...args: unknown[]) => mockUseQuery(...(args as [])),
}));

import { SidebarFlowsProvider } from './sidebar-flows-provider';

const renderProvider = () =>
    render(
        <SidebarFlowsProvider>
            <div>sidebar</div>
        </SidebarFlowsProvider>,
    );

afterEach(() => {
    mockRefetch.mockClear();
    mockUseQuery.mockClear();
});

describe('SidebarFlowsProvider', () => {
    it('asks for cache-and-network so a warm cache cannot hide a newer list', () => {
        renderProvider();

        // cache-first (the previous override) skipped the request entirely whenever the
        // cache had an entry, so the sidebar list never refreshed on other pages.
        expect(mockUseQuery).toHaveBeenCalledWith(
            FlowsDocument,
            expect.objectContaining({ fetchPolicy: 'cache-and-network', nextFetchPolicy: 'cache-and-network' }),
        );
    });

    it('refetches when the tab regains focus and when it comes back online', () => {
        const { unmount } = renderProvider();

        window.dispatchEvent(new Event('focus'));
        expect(mockRefetch).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('online'));
        expect(mockRefetch).toHaveBeenCalledTimes(2);

        unmount();
        window.dispatchEvent(new Event('focus'));
        expect(mockRefetch).toHaveBeenCalledTimes(2);
    });
});
