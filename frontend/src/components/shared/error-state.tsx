import { AlertCircle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { localizeUiErrorText } from '@/lib/errors';
import { uiText } from '@/locales/zh-CN';

interface ErrorStateProps {
    message?: null | string;
    onRetry?: () => unknown;
    title: string;
}

export function ErrorState({ message, onRetry, title }: ErrorStateProps) {
    // 后端错误文本是机器标识时先映射成中文说明；映射过的原文放进折叠区，保留排查所需的原始诊断。
    const localized = message ? localizeUiErrorText(message) : null;
    const rawDetail = message && localized !== message ? message : null;

    return (
        <Empty role="alert">
            <EmptyHeader>
                <EmptyMedia>
                    <AlertCircle className="text-destructive size-12" />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
                {localized ? <EmptyDescription>{localized}</EmptyDescription> : null}
                {rawDetail ? (
                    <details className="text-muted-foreground mt-2 text-left text-xs">
                        <summary className="cursor-pointer select-none">{uiText('Show raw diagnostics')}</summary>
                        <pre className="mt-2 max-w-full overflow-x-auto break-all whitespace-pre-wrap">{rawDetail}</pre>
                    </details>
                ) : null}
            </EmptyHeader>
            {onRetry ? (
                <EmptyContent>
                    <Button
                        onClick={() => onRetry()}
                        variant="secondary"
                    >
                        <RefreshCw />
                        {uiText('Try again')}
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    );
}
