import { getReturnUrlParam } from '@/lib/utils/auth';

// Build URLs from here instead of hardcoding route strings.

function withQuery(path: string, params: Record<string, string | undefined>): string {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (value != null) {
            search.set(key, value);
        }
    }

    const query = search.toString();

    return query ? `${path}?${query}` : path;
}

export const routes = {
    dashboard: '/dashboard',
    exploitChains: '/exploit-chains',

    flow: (id: number | string, { detailTab, tab }: { detailTab?: string; tab?: string } = {}) =>
        withQuery(`/flows/${id}`, { detailTab, tab }),

    flowReport: (id: number | string) => `/flows/${id}/report`,
    flows: '/flows',
    intelligence: '/intelligence',

    knowledge: (id: number | string) => `/knowledges/${id}`,
    knowledges: '/knowledges',
    login: (fromPath?: string) => `/login${fromPath ? getReturnUrlParam(fromPath) : ''}`,
    newFlow: '/flows/new',
    newKnowledge: '/knowledges/new',
    newTemplate: '/templates/new',

    oauthResult: '/oauth/result',
    resources: '/resources',
    root: '/',

    securityAssessments: '/security-assessments',
    settings: {
        account: '/settings/account',
        apiTokens: '/settings/api-tokens',
        newProvider: ({ id, type }: { id?: string; type?: string } = {}) =>
            withQuery('/settings/providers/new', { id, type }),
        prompt: (name: string) => `/settings/prompts/${name}`,
        prompts: '/settings/prompts',
        provider: (id: string) => `/settings/providers/${id}`,
        providers: '/settings/providers',
        root: '/settings',
    },

    template: (id: number | string) => `/templates/${id}`,

    templates: '/templates',
    vulnerabilityScans: '/vulnerability-scans',
} as const;
