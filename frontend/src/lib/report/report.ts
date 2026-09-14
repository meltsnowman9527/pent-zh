import GithubSlugger from 'github-slugger';

import type {
    AssistantFragmentFragment,
    AssistantLogFragmentFragment,
    FlowFragmentFragment,
    TaskFragmentFragment,
} from '@/graphql/types';

import { MessageLogType, ResultFormat, StatusType } from '@/graphql/types';
import { Log } from '@/lib/log';
import { uiText } from '@/locales/zh-CN';

const getStatusEmoji = (status: StatusType): string => {
    switch (status) {
        case StatusType.Created: {
            return '📝';
        }

        case StatusType.Failed: {
            return '❌';
        }

        case StatusType.Finished: {
            return '✅';
        }

        case StatusType.Running: {
            return '⚡';
        }

        case StatusType.Waiting: {
            return '⏳';
        }

        default: {
            return '📝';
        }
    }
};

// Emoji only survive in the markdown export — the PDF renderer swaps the mapped
// ones for text tags (see emojiMap in report-pdf.tsx).
const assistantLogEmojis: Record<MessageLogType, string> = {
    [MessageLogType.Advice]: '💡',
    [MessageLogType.Answer]: '✅',
    [MessageLogType.Ask]: '❓',
    [MessageLogType.Browser]: '🌐',
    [MessageLogType.Done]: '✅',
    [MessageLogType.File]: '📁',
    [MessageLogType.Input]: '👤',
    [MessageLogType.Report]: '📊',
    [MessageLogType.Search]: '🔍',
    [MessageLogType.Terminal]: '🔧',
    [MessageLogType.Thoughts]: '💡',
};

// Same copy-table keys the message list uses for its type tooltips, so a transcript
// exported here and the one on screen name the message types identically.
const assistantLogLabels = {
    [MessageLogType.Advice]: 'Advice',
    [MessageLogType.Answer]: 'Answer',
    [MessageLogType.Ask]: 'Ask',
    [MessageLogType.Browser]: 'Browser',
    [MessageLogType.Done]: 'Done',
    [MessageLogType.File]: 'file',
    [MessageLogType.Input]: 'Input',
    [MessageLogType.Report]: 'Report',
    [MessageLogType.Search]: 'Search',
    [MessageLogType.Terminal]: 'Terminal',
    [MessageLogType.Thoughts]: 'Thoughts',
} as const satisfies Record<MessageLogType, string>;

/**
 * Wraps text in a fence long enough to survive backticks inside the payload — command
 * output routinely contains ``` and would otherwise end the block early.
 */
const toFencedBlock = (text: string, language: string): string => {
    const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longestRun + 1));

    return `${fence}${language}\n${text}\n${fence}`;
};

const shiftMarkdownHeaders = (text: string, shiftBy: number): string => {
    return text.replaceAll(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
        const currentLevel = hashes.length;
        const newLevel = Math.min(currentLevel + shiftBy, 6);
        const newHashes = '#'.repeat(newLevel);

        return `${newHashes} ${content}`;
    });
};

/**
 * Shifts markdown headings down so an embedded document nests under the transcript
 * section instead of competing with it. Fenced code blocks are left alone — a `#`
 * at the start of a shell line is a comment, not a heading.
 */
const shiftMarkdownHeadings = (text: string, shiftBy: number): string => {
    let fenceChar: null | string = null;

    return text
        .split('\n')
        .map((line) => {
            const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

            if (fenceMatch) {
                const markerChar = fenceMatch[1]?.charAt(0) ?? '`';

                if (fenceChar === null) {
                    fenceChar = markerChar;
                } else if (fenceChar === markerChar) {
                    fenceChar = null;
                }

                return line;
            }

            if (fenceChar !== null) {
                return line;
            }

            const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
            const hashes = headingMatch?.[1];

            if (!hashes) {
                return line;
            }

            return `${'#'.repeat(Math.min(hashes.length + shiftBy, 6))} ${headingMatch?.[2] ?? ''}`;
        })
        .join('\n');
};

const createAnchor = (text: string): string => {
    const slugger = new GithubSlugger();

    return slugger.slug(text);
};

/**
 * Terminal captures keep their ANSI control sequences, which a text export renders as
 * literal junk (`[1m`, `[0m`). CSI first — `ESC[` would otherwise match the two-char rule.
 */
/* eslint-disable no-control-regex -- the ESC and BEL control bytes are exactly what must be matched */
const stripAnsiEscapes = (text: string): string =>
    text.replaceAll(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g, '');
/* eslint-enable no-control-regex */

const generateTableOfContents = (tasks: TaskFragmentFragment[], flow?: FlowFragmentFragment | null): string => {
    let toc = '';

    if (flow) {
        const flowEmoji = getStatusEmoji(flow.status);
        toc = `# ${flowEmoji} ${flow.id}. ${flow.title}\n\n`;
    }

    if (!tasks || tasks.length === 0) {
        return toc;
    }

    const sortedTasks = [...tasks].sort((a, b) => +a.id - +b.id);

    sortedTasks.forEach((task) => {
        const taskEmoji = getStatusEmoji(task.status);
        const taskTitle = `${taskEmoji} ${task.id}. ${task.title}`;
        // Anchor must be generated from the exact heading text (emoji included) — rehype-slug
        // computes the same slug from the rendered <h3>, so any mismatch breaks the link.
        const taskAnchor = createAnchor(`${taskEmoji} ${task.id}. ${task.title}`);

        toc += `- [${taskTitle}](#${taskAnchor})\n`;

        if (task.subtasks && task.subtasks.length > 0) {
            const sortedSubtasks = [...task.subtasks].sort((a, b) => +a.id - +b.id);

            sortedSubtasks.forEach((subtask) => {
                const subtaskEmoji = getStatusEmoji(subtask.status);
                const subtaskTitle = `${subtaskEmoji} ${subtask.id}. ${subtask.title}`;
                const subtaskAnchor = createAnchor(`${subtaskEmoji} ${subtask.id}. ${subtask.title}`);
                toc += `  - [${subtaskTitle}](#${subtaskAnchor})\n`;
            });
        }
    });

    return `${toc}\n---\n\n`;
};

export const generateReport = (tasks: TaskFragmentFragment[], flow?: FlowFragmentFragment | null): string => {
    if (!tasks || tasks.length === 0) {
        if (flow) {
            const flowEmoji = getStatusEmoji(flow.status);

            return `# ${flowEmoji} ${flow.id}. ${flow.title}\n\n${uiText('No tasks available for this flow.')}`;
        }

        return uiText('No tasks available for this flow.');
    }

    const sortedTasks = [...tasks].sort((a, b) => +a.id - +b.id);

    let report = generateTableOfContents(tasks, flow);

    sortedTasks.forEach((task, taskIndex) => {
        const taskEmoji = getStatusEmoji(task.status);
        report += `### ${taskEmoji} ${task.id}. ${task.title}\n\n`;

        // Shift the task's own input headings down by 3 so they slot below the H3 task title
        // (H1→H4, H2→H5, etc.) — keeps the report's outline consistent across sections.
        if (task.input?.trim()) {
            const shiftedInput = shiftMarkdownHeaders(task.input, 3);
            report += `${shiftedInput}\n\n`;
        }

        if (task.result?.trim()) {
            report += `---\n\n${task.result}\n\n`;
        }

        if (task.subtasks && task.subtasks.length > 0) {
            const sortedSubtasks = [...task.subtasks].sort((a, b) => +a.id - +b.id);

            sortedSubtasks.forEach((subtask) => {
                const subtaskEmoji = getStatusEmoji(subtask.status);
                report += `#### ${subtaskEmoji} ${subtask.id}. ${subtask.title}\n\n`;

                if (subtask.description?.trim()) {
                    report += `${subtask.description}\n\n`;
                }

                if (subtask.result?.trim()) {
                    report += `---\n\n${subtask.result}\n\n`;
                }
            });
        }

        if (taskIndex < sortedTasks.length - 1) {
            report += '---\n\n';
        }
    });

    return report.trim();
};

const renderAssistantLogSection = (log: AssistantLogFragmentFragment, index: number): string => {
    const emoji = assistantLogEmojis[log.type] ?? '📝';
    const label = assistantLogLabels[log.type] ?? assistantLogLabels[MessageLogType.Thoughts];

    let section = `## ${index + 1}. ${emoji} ${uiText(label)}\n\n`;

    const message = log.message?.trim();

    if (message) {
        // Messages carry their own document structure; nest it under this section.
        section += `${shiftMarkdownHeadings(message, 2)}\n\n`;
    }

    const result = log.result?.trim();

    if (result) {
        const cleaned = stripAnsiEscapes(result);

        // Terminal output is fenced so the report keeps its line breaks and does not
        // interpret raw command output as markdown.
        section +=
            log.resultFormat === ResultFormat.Terminal
                ? `${toFencedBlock(cleaned, 'text')}\n\n`
                : `${shiftMarkdownHeadings(cleaned, 2)}\n\n`;
    }

    return section.trimEnd();
};

/**
 * Assistant-mode flows run a conversation instead of tasks, so they have no task
 * report to assemble. The transcript itself is the report: every message the
 * selected assistant produced, in chronological order, with tool output kept.
 *
 * Message `thinking` is deliberately omitted — it is internal reasoning, it is the
 * bulk of the stored bytes, and the UI keeps it collapsed behind "Show thinking".
 * Use the copy button on an individual message when the reasoning is needed.
 */
export const generateAssistantReport = (
    flow: FlowFragmentFragment,
    assistant?: AssistantFragmentFragment | null,
    logs?: AssistantLogFragmentFragment[] | null,
): string => {
    const flowEmoji = getStatusEmoji(flow.status);
    let report = `# ${flowEmoji} ${flow.id}. ${flow.title}\n\n`;

    if (assistant) {
        report += `**${uiText('Assistant')}**: ${assistant.title}\n\n`;
    }

    const sortedLogs = [...(logs ?? [])].sort((a, b) => +a.id - +b.id);

    if (sortedLogs.length === 0) {
        return `${report}${uiText('No messages found for this assistant')}`;
    }

    report += `**${uiText('Messages')}**: ${sortedLogs.length}\n\n---\n\n`;
    report += sortedLogs.map((log, index) => renderAssistantLogSection(log, index)).join('\n\n---\n\n');

    return report.trim();
};

interface FlowReportInput {
    assistant?: AssistantFragmentFragment | null;
    assistantLogs?: AssistantLogFragmentFragment[] | null;
    flow: FlowFragmentFragment;
    tasks?: null | TaskFragmentFragment[];
}

/**
 * Picks the report shape the flow actually has: task reports for automation flows
 * (task input/result + subtask results) and conversation transcripts for
 * assistant-mode flows.
 */
export const generateFlowReport = ({ assistant, assistantLogs, flow, tasks }: FlowReportInput): string => {
    const taskList = tasks ?? [];

    return taskList.length > 0
        ? generateReport(taskList, flow)
        : generateAssistantReport(flow, assistant, assistantLogs);
};

export const generateFileName = (flow: FlowFragmentFragment): string => {
    const flowId = flow.id;
    const flowTitle = flow.title
        // `\w` is ASCII-only, which turned a Chinese title into a run of underscores;
        // Unicode letters and digits keep the downloaded file recognisable.
        .replaceAll(/[^\p{L}\p{N}\s.-]/gu, '_')
        .replaceAll(/[\s\u2000-\u200B]+/g, '_')
        .toLowerCase()
        .slice(0, 150)
        .replace(/_+$/, '');

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const datetime = `${year}${month}${day}${hours}${minutes}${seconds}`;

    return `report_flow_${flowId}_${flowTitle}_${datetime}`;
};

export const downloadTextFile = (content: string, fileName: string, mimeType = 'text/plain'): void => {
    try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';

        document.body.append(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    } catch (error) {
        Log.error('Failed to download file:', error);
        throw error;
    }
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);

        return true;
    } catch (error) {
        Log.error('Failed to copy to clipboard:', error);

        return false;
    }
};

// Lazy-load the PDF generator so @react-pdf/renderer (~1.5 MB) is fetched
// only when the user actually triggers a PDF export, not on every page that
// imports report utilities (flow.tsx, flow-report.tsx).
export const generatePDFFromMarkdown = async (content: string, fileName: string): Promise<void> => {
    const { generatePDFFromMarkdownNew } = await import('./report-pdf');

    return generatePDFFromMarkdownNew(content, fileName);
};

export const generatePDFBlob = async (content: string): Promise<Blob> => {
    const { generatePDFBlobNew } = await import('./report-pdf');

    return generatePDFBlobNew(content);
};
