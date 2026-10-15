import { describe, expect, it } from 'vitest';

import { MockWorld } from '../world.ts';
import { ASSISTANT_ANSWER, WAITING_ASSISTANT } from './assistants.ts';
import { assistantFlowReportCassette } from './flows-assistant-report.ts';

const world = () => new MockWorld(assistantFlowReportCassette());

describe('assistant-mode report cassette', () => {
    it('answers the report query with the flow, its assistant and no tasks', () => {
        const data = world().matchGraphQL('flowReport', { id: '5' })?.data as
            | undefined
            | { assistants: null | unknown[]; flow: null | { title: string }; tasks: null | unknown[] };

        expect(data?.tasks ?? []).toEqual([]);
        expect(data?.assistants).toHaveLength(1);
        expect(data?.assistants?.[0]).toMatchObject({ id: WAITING_ASSISTANT.id });
        expect(data?.flow?.title).toBe('E2E Alpha');
    });

    it('serves the transcript the report is built from', () => {
        const logs = (
            world().matchGraphQL('assistantLogs', { assistantId: WAITING_ASSISTANT.id, flowId: '5' })?.data as
                | undefined
                | { assistantLogs: Array<{ result: string }> }
        )?.assistantLogs;

        expect(logs).toHaveLength(1);
        expect(logs?.[0]?.result).toBe(ASSISTANT_ANSWER);
    });
});
