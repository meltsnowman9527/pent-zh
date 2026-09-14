import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { uiText } from '@/locales/zh-CN';

const queryResults = vi.hoisted(() => ({
    assistantLogs: { data: undefined, loading: false } as Record<string, unknown>,
    flow: { data: undefined, error: undefined, loading: false } as Record<string, unknown>,
}));

// The flow query is the only one that opts into `errorPolicy: 'all'`, so the options
// object is what tells the two queries apart here.
vi.mock('@apollo/client/react', () => ({
    skipToken: Symbol('skipToken'),
    useMutation: () => [vi.fn().mockResolvedValue({ data: undefined }), { loading: false }],
    useQuery: (_document: unknown, options?: { errorPolicy?: string }) =>
        options?.errorPolicy === 'all' ? queryResults.flow : queryResults.assistantLogs,
}));

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock('react-router-dom', () => ({
    useParams: () => ({ flowId: '42' }),
    useSearchParams: () => [searchParams.current],
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/components/shared/markdown', () => ({
    default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('@/lib/report', () => ({
    findAssistantReport: (logs?: Array<{ result?: string; type: string; }>) =>
        (logs ?? []).filter((log) => log.type === 'report' && log.result).at(-1) ?? null,
    generateFileName: () => 'report',
    generateFlowReport: ({ assistant, assistantLogs, flow, tasks }: Record<string, unknown>) => {
        const taskList = (tasks ?? []) as unknown[];
        const logs = (assistantLogs ?? []) as unknown[];
        const assistantTitle = (assistant as undefined | { title: string })?.title;
        const suffix = assistantTitle ? ` (${assistantTitle})` : '';

        return taskList.length > 0
            ? `${(flow as { title: string }).title}: ${taskList.length} tasks`
            : `${(flow as { title: string }).title}: ${logs.length} assistant logs${suffix}`;
    },
    generatePDFFromMarkdown: vi.fn().mockResolvedValue(undefined),
}));

const { default: FlowReport } = await import('./flow-report');

describe('FlowReport load states', () => {
    it('renders the task report when a partial error arrives alongside a usable flow', () => {
        queryResults.flow = {
            data: { flow: { id: '42', title: 'Recon' }, tasks: [{ id: '1' }] },
            error: new Error('failed to fetch tasks'),
            loading: false,
        };

        render(<FlowReport />);

        expect(screen.getByTestId('markdown')).toHaveTextContent('Recon: 1 tasks');
        expect(screen.queryByText(uiText('Failed to load flow data'))).not.toBeInTheDocument();
    });

    it('renders the assistant transcript for a flow without tasks', () => {
        queryResults.flow = {
            data: {
                assistants: [{ id: '7', title: 'Recon assistant' }],
                flow: { id: '42', title: 'Recon' },
                tasks: null,
            },
            error: undefined,
            loading: false,
        };
        queryResults.assistantLogs = {
            data: { assistantLogs: [{ id: '1' }, { id: '2' }] },
            loading: false,
        };

        render(<FlowReport />);

        expect(screen.getByTestId('markdown')).toHaveTextContent('Recon: 2 assistant logs (Recon assistant)');
    });

    it('matches the assistant named in the URL even though the API returns a numeric id', () => {
        // The server serialises `ID` as a JSON number; the URL always carries text.
        queryResults.flow = {
            data: {
                assistants: [{ id: 7, title: 'Recon assistant' }],
                flow: { id: 42, title: 'Recon' },
                tasks: [],
            },
            error: undefined,
            loading: false,
        };
        searchParams.current = new URLSearchParams('assistantId=7');

        render(<FlowReport />);

        expect(screen.getByTestId('markdown')).toHaveTextContent('Recon: 2 assistant logs (Recon assistant)');
    });

    it('reports a failure when the flow itself is missing', () => {
        searchParams.current = new URLSearchParams();
        queryResults.flow = { data: { flow: null, tasks: null }, error: new Error('boom'), loading: false };

        render(<FlowReport />);

        expect(screen.getByText(uiText('Failed to load flow data'))).toBeInTheDocument();
    });
});
