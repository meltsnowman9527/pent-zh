import type { ResultOf } from '@graphql-typed-document-node/core';

import type { FlowReportDocument } from '@/graphql/types';

import type { Cassette } from '../cassette.ts';

import { assistantsCassette, WAITING_ASSISTANT } from './assistants.ts';
import { FLOW_A } from './flows.ts';

/**
 * An assistant-mode flow: the seeded flow query carries no tasks, so the report menu
 * can only appear because the assistant transcript does (the automation path is
 * covered by `flows/report.spec.ts`).
 */
const flowReportData: ResultOf<typeof FlowReportDocument> = {
    assistants: [WAITING_ASSISTANT],
    flow: FLOW_A,
    tasks: null,
};

export const assistantFlowReportCassette = (): Cassette =>
    assistantsCassette({
        queries: {
            flowReport: [{ data: flowReportData, variables: { id: '5' } }],
        },
    });
