import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageLogType } from '@/graphql/types';
import { uiText } from '@/locales/zh-CN';

import FlowMessageTypeIcon from './flow-message-type-icon';

const renderIcon = (type: MessageLogType, tooltip?: string) =>
    render(
        <TooltipProvider delayDuration={0}>
            <FlowMessageTypeIcon
                tooltip={tooltip}
                type={type}
            />
        </TooltipProvider>,
    );

const hoverIcon = async () => {
    const user = userEvent.setup();

    // The trigger is the icon itself, so hover the svg the component renders.
    await user.hover(document.querySelector('svg') as SVGElement);
};

// Radix can render the content more than once while animating, so assert on the
// document text instead of a unique element.
const tooltipText = async () => {
    await waitFor(() => {
        expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();
    });

    return document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? '';
};

describe('FlowMessageTypeIcon', () => {
    it('localizes the tooltip instead of printing the raw message type', async () => {
        renderIcon(MessageLogType.Input);
        await hoverIcon();

        const text = await tooltipText();

        expect(text).toContain(uiText('Input'));
        expect(text).not.toContain('Input');
    });

    it('localizes the answer type too', async () => {
        renderIcon(MessageLogType.Answer);
        await hoverIcon();

        const text = await tooltipText();

        expect(text).toContain(uiText('Answer'));
        expect(text).not.toContain('Answer');
    });

    it('keeps an explicit tooltip for callers that pass one', async () => {
        renderIcon(MessageLogType.Terminal, 'terminal');
        await hoverIcon();

        expect(await tooltipText()).toContain('Terminal');
    });
});
