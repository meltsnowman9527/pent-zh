import type { FlowFragmentFragment } from '@/graphql/types';

import { Badge } from '@/components/ui/badge';
import { localizeUiErrorText } from '@/lib/errors';
import { uiText } from '@/locales/zh-CN';
import { getUILanguage } from '@/locales/language';

type Job = FlowFragmentFragment['lifecycleJob'] | undefined;

export const isFlowJobPending = (job: Job): boolean => !!job && ['queued', 'running'].includes(job.status);

export function FlowJobStatus({ job }: { job: Job }) {
    if (!job || job.status === 'succeeded') {
        return null;
    }

    const steps: Record<string, string> = {
        cleaning_up: uiText('Cleaning up resources'),
        db: uiText('Preparing task'),
        docker: uiText('Publishing task'),
        input: uiText('Starting task'),
        preparing_docker: uiText('Preparing containers'),
        probing_provider: uiText('Connecting to provider'),
        provider: uiText('Preparing tools'),
        publish: uiText('Starting task'),
        queued: uiText('Queued'),
        recovered: uiText('Recovering'),
        retrying: uiText('Waiting to retry'),
        stopping: uiText('Stopping'),
        workers: uiText('Preparing containers'),
    };
    const kinds: Record<string, string> = {
        create: uiText('Create'),
        delete: uiText('Delete'),
        finish: uiText('Finish'),
        stop: uiText('Stop'),
    };
    const label = job.status === 'failed' ? uiText('Operation failed') : (steps[job.step] ?? uiText('Processing'));

    return (
        <div
            className="min-w-0 space-y-1 text-xs"
            role="status"
        >
            <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>
                {kinds[job.kind] ?? uiText('Tasks')}
                {getUILanguage() === 'zh-CN' ? '：' : ': '}
                {label}
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
