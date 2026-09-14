import type { LucideIcon } from 'lucide-react';

import {
    BotMessageSquare,
    Brain,
    CheckSquare,
    FileText,
    Globe,
    HelpCircle,
    MessageSquareReply,
    NotepadText,
    Search,
    Terminal,
    User as UserIcon,
} from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageLogType } from '@/graphql/types';
import { cn } from '@/lib/utils';
import { formatName } from '@/lib/utils/format';
import { uiText } from '@/locales/zh-CN';

interface MessageTypeIconProps {
    className?: string;
    tooltip?: string;
    type?: MessageLogType;
}

const messageTypeIcons: Record<MessageLogType, LucideIcon> = {
    [MessageLogType.Advice]: BotMessageSquare,
    [MessageLogType.Answer]: MessageSquareReply,
    [MessageLogType.Ask]: HelpCircle,
    [MessageLogType.Browser]: Globe,
    [MessageLogType.Done]: CheckSquare,
    [MessageLogType.File]: FileText,
    [MessageLogType.Input]: UserIcon,
    [MessageLogType.Report]: NotepadText,
    [MessageLogType.Search]: Search,
    [MessageLogType.Terminal]: Terminal,
    [MessageLogType.Thoughts]: Brain,
};
const defaultIcon = Brain;

// The tooltip defaults to the message type, so it has to go through the copy
// table: `formatName(type)` used to render the raw enum value ("input",
// "answer") right next to a Chinese conversation.
const messageTypeLabels = {
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
} as const;

function FlowMessageTypeIcon({ className, tooltip, type }: MessageTypeIconProps) {
    const Icon = type ? messageTypeIcons[type] || defaultIcon : defaultIcon;
    const iconElement = <Icon className={cn('size-3 shrink-0', className)} />;
    const label = tooltip ? formatName(tooltip) : type ? uiText(messageTypeLabels[type]) : undefined;

    if (!label) {
        return iconElement;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{iconElement}</TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export default FlowMessageTypeIcon;
