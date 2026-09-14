import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/providers/user-provider', () => ({
    useUser: () => ({
        authInfo: { user: { mail: 'me@example.com', name: 'Test User', type: 'local' } },
        logout: vi.fn(),
    }),
}));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ setTheme: vi.fn(), theme: 'system' }) }));
vi.mock('@/providers/favorites-provider', () => ({
    useFavorites: () => ({ addFavoriteFlow: vi.fn(), favoriteFlowIds: [], removeFavoriteFlow: vi.fn() }),
}));
const mockSidebarFlows: { flows: unknown[] } = { flows: [] };
vi.mock('@/providers/sidebar-flows-provider', () => ({ useSidebarFlows: () => mockSidebarFlows }));
vi.mock('@/features/resources/use-resources-upload', () => ({
    useResourcesUpload: () => ({ fileInputKey: 'k', fileInputProps: {}, openFilePicker: vi.fn() }),
}));

import { SidebarProvider } from '@/components/ui/sidebar';

import { MainSidebar } from './main-sidebar';

function FromProbe() {
    const location = useLocation();

    return <span data-testid="from">{(location.state as null | { from?: string })?.from ?? 'none'}</span>;
}

function renderSidebar() {
    return render(
        <MemoryRouter initialEntries={['/dashboard']}>
            <SidebarProvider>
                <MainSidebar />
            </SidebarProvider>
            <Routes>
                <Route
                    element={<div>dashboard</div>}
                    path="/dashboard"
                />
                <Route
                    element={<FromProbe />}
                    path="/settings"
                />
                <Route
                    element={<FromProbe />}
                    path="/settings/account"
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe('MainSidebar settings entry points', () => {
    it('the Settings link carries the current path as the return origin', async () => {
        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByRole('link', { name: '设置' }));

        expect(screen.getByTestId('from')).toHaveTextContent('/dashboard');
    });

    it('the Profile menu item carries the current path as the return origin', async () => {
        const user = userEvent.setup();
        renderSidebar();

        await user.click(screen.getByRole('button', { name: /Test User/ }));
        await user.click(screen.getByRole('menuitem', { name: '账户信息' }));

        expect(screen.getByTestId('from')).toHaveTextContent('/dashboard');
    });
});

describe('MainSidebar recent flow numbering', () => {
    afterEach(() => {
        mockSidebarFlows.flows = [];
    });

    it('numbers the recent entries instead of printing the raw flow id', () => {
        mockSidebarFlows.flows = [
            { createdAt: '2026-09-14T02:00:00Z', id: '7', title: '最新任务' },
            { createdAt: '2026-09-12T02:00:00Z', id: '4', title: '较早任务' },
        ];

        renderSidebar();

        // Each entry renders its number twice (collapsed rail + expanded badge).
        expect(screen.getAllByText('1')).toHaveLength(2);
        expect(screen.getAllByText('2')).toHaveLength(2);
        expect(screen.queryByText('7')).not.toBeInTheDocument();
        expect(screen.queryByText('4')).not.toBeInTheDocument();
    });
});
