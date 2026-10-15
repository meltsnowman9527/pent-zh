import { FlowStatusIcon } from '@/components/icons/flow-status-icon';
import { Badge } from '@/components/ui/badge';
import { StatusType } from '@/graphql/types';
import { uiText } from '@/locales/zh-CN';

const STATUS_LABELS: Record<StatusType, string> = {
    [StatusType.Created]: uiText('Created'),
    [StatusType.Failed]: uiText('Failed'),
    [StatusType.Finished]: uiText('Finished'),
    [StatusType.Running]: uiText('Running'),
    [StatusType.Waiting]: uiText('Waiting'),
};

export function FlowStatusBadge({ className, status }: { className?: string; status: StatusType }) {
    return (
        <Badge
            className={className}
            variant="outline"
        >
            <FlowStatusIcon
                className="size-3"
                status={status}
            />
            {STATUS_LABELS[status]}
        </Badge>
    );
}
