import type { FlowFragmentFragment } from '@/graphql/types';

import { Badge } from '@/components/ui/badge';
import { localizeUiErrorText } from '@/lib/errors';
import { uiText } from '@/locales/zh-CN';

type Job = FlowFragmentFragment['lifecycleJob'] | undefined;

export const isFlowJobPending = (job: Job): boolean => !!job && ['queued', 'running'].includes(job.status);

export function FlowJobStatus({ job }: { job: Job }) {
    if (!job || job.status === 'succeeded') {
        return null;
    }

    const steps: Record<string, string> = {
        cleaning_up: '清理资源',
        db: '准备任务',
        docker: '发布任务',
        input: '启动任务',
        preparing_docker: '准备容器',
        probing_provider: '连接模型服务',
        provider: '准备工具',
        publish: '启动任务',
        queued: '等待处理',
        recovered: '恢复处理中',
        retrying: '等待重试',
        stopping: '正在停止',
        workers: '准备容器',
    };
    const kinds: Record<string, string> = { create: '创建', delete: '删除', finish: '结束', stop: '停止' };
    const label = job.status === 'failed' ? '处理失败' : (steps[job.step] ?? '处理中');

    return (
        <div
            className="min-w-0 space-y-1 text-xs"
            role="status"
        >
            <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>
                {kinds[job.kind] ?? '任务'}：{label}
            </Badge>
            {job.error ? (
                <details className="text-muted-foreground max-w-md break-words">
                    <summary className="cursor-pointer">{localizeUiErrorText(job.error)}</summary>
                    <p>
                        {uiText('Show raw diagnostics')} · {job.correlationId}
                    </p>
                    <pre className="max-h-32 overflow-auto break-all whitespace-pre-wrap">{job.error}</pre>
                </details>
            ) : null}
        </div>
    );
}
