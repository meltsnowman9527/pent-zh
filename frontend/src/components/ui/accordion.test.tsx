import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';

const renderAccordion = (actions?: React.ReactNode) =>
    render(
        <Accordion type="single">
            <AccordionItem value="agents">
                <AccordionTrigger actions={actions}>Adviser</AccordionTrigger>
                <AccordionContent>panel</AccordionContent>
            </AccordionItem>
        </Accordion>,
    );

describe('AccordionTrigger actions', () => {
    it('renders the action as a sibling of the trigger, not inside it', async () => {
        // A button nested inside the trigger's own button is invalid markup and axe
        // reports `nested-interactive`; the action must stay in the header row.
        const onClick = vi.fn();

        renderAccordion(
            <button
                onClick={onClick}
                type="button"
            >
                Test
            </button>,
        );

        const trigger = screen.getByRole('button', { name: 'Adviser' });
        expect(within(trigger).queryByRole('button', { name: 'Test' })).toBeNull();

        const action = screen.getByRole('button', { name: 'Test' });
        expect(trigger.contains(action)).toBe(false);
        expect(trigger.parentElement?.contains(action)).toBe(true);

        await userEvent.click(action);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('still toggles the panel from the trigger when an action is present', async () => {
        renderAccordion(
            <button
                type="button"
            >
                Test
            </button>,
        );

        const trigger = screen.getByRole('button', { name: 'Adviser' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await userEvent.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
});
