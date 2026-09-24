import type { ComponentType } from 'react';

import {
    FlowDocument,
    FlowTemplateDocument,
    KnowledgeDocumentDocument,
    SettingsProvidersDocument,
} from '@/graphql/types';
import { uiText } from '@/locales/zh-CN';

import { apolloTitle } from './apollo-title';
import { formatPromptId } from './format-prompt-id';
import { type RouteParams } from './render-title';

export interface RouteTitleHandle {
    title: TitleResolver;
}

/**
 * A `handle.title` value can be one of three forms:
 *   - `string` — fully static, known at build time.
 *   - `(params) => string` — derived synchronously from URL params.
 *   - `ComponentType<{ params }>` — reactive (e.g. subscribes to Apollo
 *     cache for resource-driven titles). Must be produced by `apolloTitle()`
 *     so the marker it attaches lets `DocumentTitle` distinguish a component
 *     from a `(params) => string` resolver at runtime. A hand-rolled component
 *     function will be misdetected as a resolver and called with raw params —
 *     always route reactive titles through `apolloTitle()`.
 */
export type TitleResolver = ((params: RouteParams) => string) | ComponentType<{ params: RouteParams }> | string;

/**
 * Single source of truth for every route's document `<title>`. `app.tsx`
 * imports nothing from Apollo for title purposes — it only spreads handles
 * from this registry onto the matching <Route>.
 */
export const routeTitles = {
    account: { title: uiText('Account') },
    agents: { title: '智能体与能力' },
    apiTokens: { title: uiText('API Tokens') },
    dashboard: { title: uiText('Dashboard') },
    exploitChains: { title: '漏洞利用链推理' },
    flow: {
        title: apolloTitle({
            document: FlowDocument,
            select: (data, { flowId }) =>
                data?.flow?.title && flowId
                    ? uiText('Flow #{id} — {title}', { id: flowId, title: data.flow.title })
                    : uiText('Flow'),
            variables: ({ flowId }) => (flowId ? { id: flowId } : null),
        }),
    },
    flowReport: { title: uiText('Flow report') },
    flows: { title: uiText('Flows') },
    intelligence: { title: '外部威胁情报' },
    knowledge: {
        title: apolloTitle({
            document: KnowledgeDocumentDocument,
            select: (data, { knowledgeId }) =>
                knowledgeId === 'new'
                    ? uiText('New knowledge')
                    : data?.knowledgeDocument?.question || uiText('Knowledge'),
            variables: ({ knowledgeId }) => (!knowledgeId || knowledgeId === 'new' ? null : { id: knowledgeId }),
        }),
    },
    knowledges: { title: uiText('Knowledges') },
    login: { title: uiText('Login') },
    newFlow: { title: uiText('New flow') },
    oauth: { title: 'OAuth' },
    prompt: {
        title: (params: RouteParams) => (params.promptId ? formatPromptId(params.promptId) : uiText('Prompt')),
    },
    prompts: { title: uiText('Prompts') },

    provider: {
        title: apolloTitle({
            document: SettingsProvidersDocument,
            select: (data, { providerId }) => {
                if (providerId === 'new') {
                    return uiText('New provider');
                }

                const provider = data?.settingsProviders.userDefined?.find(
                    (candidate) => String(candidate.id) === providerId,
                );

                return provider?.name || uiText('Provider');
            },
            variables: ({ providerId }) => (providerId === 'new' ? null : {}),
        }),
    },

    providers: { title: uiText('Providers') },

    reportSystemManagement: { title: '报告与系统管理' },
    resources: { title: uiText('Resources') },
    securityAssessments: { title: '安全评估编排' },

    template: {
        title: apolloTitle({
            document: FlowTemplateDocument,
            select: (data, { templateId }) =>
                templateId === 'new' ? uiText('New template') : data?.flowTemplate?.title || uiText('Template'),
            variables: ({ templateId }) => (!templateId || templateId === 'new' ? null : { templateId }),
        }),
    },

    templates: { title: uiText('Templates') },
    vulnerabilityScans: { title: '资产与漏洞管理' },
} as const satisfies Record<string, RouteTitleHandle>;
