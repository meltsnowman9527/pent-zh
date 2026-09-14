import { describe, expect, it } from 'vitest';

import type { AssistantLogFragmentFragment, FlowFragmentFragment } from '@/graphql/types';

import { MessageLogType, ResultFormat, StatusType } from '@/graphql/types';
import { generateAssistantReport, generateFileName, generateFlowReport } from '@/lib/report';
import { uiText } from '@/locales/zh-CN';

const flow = {
    id: '1',
    status: StatusType.Finished,
    title: '网站安全测试计划',
} as FlowFragmentFragment;

const assistant = { id: '3', title: '网站安全测试计划' } as never;

const buildLog = (overrides: Partial<AssistantLogFragmentFragment>): AssistantLogFragmentFragment =>
    ({
        assistantId: '3',
        createdAt: '2026-09-14T05:27:57Z',
        flowId: '1',
        id: '1',
        message: '',
        result: '',
        resultFormat: ResultFormat.Plain,
        thinking: null,
        type: MessageLogType.Answer,
        ...overrides,
    }) as AssistantLogFragmentFragment;

describe('generateAssistantReport', () => {
    it('uses the written report as the document and puts the transcript in the appendix', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({ id: '1', message: '第一条', type: MessageLogType.Input }),
            buildLog({ id: '2', message: '分析过程', type: MessageLogType.Answer }),
            buildLog({
                id: '3',
                message: '分析报告',
                result: '# 网站安全测试计划 安全评估报告\n\n## 一、摘要\n发现了 X。',
                type: MessageLogType.Report,
            }),
        ]);

        // The written report is the document: it comes first, unmodified.
        expect(report.startsWith('# 网站安全测试计划 安全评估报告')).toBe(true);
        expect(report).toContain('## 一、摘要');

        // The transcript follows as evidence, under its own heading.
        expect(report).toContain(`## ${uiText('Appendix: session transcript')}`);
        expect(report.indexOf('## 一、摘要')).toBeLessThan(report.indexOf(uiText('Appendix: session transcript')));
        expect(report).toContain('分析过程');

        // The report entry itself is not repeated as a transcript section.
        expect(report).not.toContain(`## 3. 📊 ${uiText('Report')}`);
    });

    it('says a report has not been written instead of passing the log dump off as one', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({ id: '1', message: '第一条', type: MessageLogType.Input }),
        ]);

        expect(report).toContain(uiText('No analysis report yet — generate one for a structured report.'));
        expect(report).toContain('# ✅ 1. 网站安全测试计划');
    });

    it('lists the transcript in chronological order without thinking', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({ id: '2', message: '第二条', thinking: '内部推理', type: MessageLogType.Answer }),
            buildLog({ id: '1', message: '第一条', type: MessageLogType.Input }),
        ]);

        expect(report).toContain('# ✅ 1. 网站安全测试计划');
        expect(report).toContain(`**${uiText('Assistant')}**: 网站安全测试计划`);
        expect(report).toContain(`**${uiText('Messages')}**: 2`);
        expect(report).toContain(`## 1. 👤 ${uiText('Input')}`);
        expect(report).toContain(`## 2. ✅ ${uiText('Answer')}`);

        // Chronological, not insertion order.
        expect(report.indexOf('第一条')).toBeLessThan(report.indexOf('第二条'));
        expect(report).not.toContain('内部推理');
    });

    it('ignores an empty report entry so a failed generation cannot shadow a retry', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({ id: '1', message: '第一条', type: MessageLogType.Input }),
            buildLog({ id: '2', message: '分析报告', result: '   ', type: MessageLogType.Report }),
        ]);

        expect(report).toContain(uiText('No analysis report yet — generate one for a structured report.'));
    });

    it('fences terminal output and keeps markdown results inline', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({
                id: '1',
                message: '执行命令',
                result: 'a ``` b',
                resultFormat: ResultFormat.Terminal,
                type: MessageLogType.Terminal,
            }),
            buildLog({ id: '2', message: '检索', result: '# 标题', resultFormat: ResultFormat.Markdown }),
        ]);

        expect(report).toContain('````text\na ``` b\n````');
        expect(report).toContain('# 标题');
        expect(report).not.toContain('````text\n# 标题');
    });

    it('nests embedded headings but leaves fenced code alone', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({
                id: '1',
                message: '# 标题\n\n```sh\n# 注释\n```\n\n## 二级标题',
                type: MessageLogType.Answer,
            }),
        ]);

        expect(report).toContain(`## 1. ✅ ${uiText('Answer')}`);
        expect(report).toContain('### 标题');
        expect(report).toContain('#### 二级标题');
        expect(report).toContain('```sh\n# 注释\n```');
    });

    it('drops ANSI colour codes from captured terminal output', () => {
        const report = generateAssistantReport(flow, assistant, [
            buildLog({
                id: '1',
                message: '抓取响应头',
                result: '\u001B[1mX-Powered-By\u001B[0m: Express',
                resultFormat: ResultFormat.Terminal,
                type: MessageLogType.Terminal,
            }),
        ]);

        expect(report).toContain('X-Powered-By: Express');
        expect(report).not.toContain('\u001B');
        expect(report).not.toContain('[1m');
    });

    it('falls back to the empty-state copy when the assistant has no messages', () => {
        const report = generateAssistantReport(flow, assistant, []);

        expect(report).toContain('# ✅ 1. 网站安全测试计划');
        expect(report).toContain(uiText('No messages found for this assistant'));
    });
});

describe('generateFileName', () => {
    it('keeps a non-ASCII flow title in the file name', () => {
        expect(generateFileName(flow)).toMatch(/^report_flow_1_网站安全测试计划_\d{14}$/);
    });
});

describe('generateFlowReport', () => {
    it('prefers the task report when the flow has tasks', () => {
        const report = generateFlowReport({
            assistant,
            assistantLogs: [buildLog({ id: '1', message: '不应出现' })],
            flow,
            tasks: [{ id: '1', input: '任务输入', result: '任务结果', status: StatusType.Finished, title: '任务一' }] as never,
        });

        expect(report).toContain('任务一');
        expect(report).not.toContain('不应出现');
    });

    it('falls back to the assistant transcript when the flow has no tasks', () => {
        const report = generateFlowReport({
            assistant,
            assistantLogs: [buildLog({ id: '1', message: '对话内容' })],
            flow,
            tasks: [],
        });

        expect(report).toContain('对话内容');
    });
});
