import type { CSSProperties } from 'react';

import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { uiText } from '@/locales/zh-CN';

export function DashboardError({
    className,
    iconClassName,
    style,
}: {
    className?: string;
    iconClassName?: string;
    style?: CSSProperties;
}) {
    return (
        <div
            className={cn('text-muted-foreground flex flex-col items-center justify-center gap-2', className)}
            style={style}
        >
            <AlertCircle className={cn('text-muted-foreground/40 size-6', iconClassName)} />
            <p className="text-sm">{uiText("Couldn't load")}</p>
        </div>
    );
}
