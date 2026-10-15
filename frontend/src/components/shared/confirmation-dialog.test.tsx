import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ConfirmationDialog from './confirmation-dialog';

const openDialog = (props: Partial<React.ComponentProps<typeof ConfirmationDialog>> = {}) => {
    const handleConfirm = vi.fn();
    const handleOpenChange = vi.fn();

    render(
        <ConfirmationDialog
            confirmText="彻底删除"
            handleConfirm={handleConfirm}
            handleOpenChange={handleOpenChange}
            isOpen
            {...props}
        />,
    );

    return { handleConfirm, handleOpenChange };
};

describe('ConfirmationDialog confirmPhrase', () => {
    it('keeps confirm disabled until the exact phrase is typed', async () => {
        const user = userEvent.setup();
        const { handleConfirm } = openDialog({ confirmPhrase: '网站基础安全检查' });

        const confirm = screen.getByRole('button', { name: '彻底删除' });
        expect(confirm).toBeDisabled();

        await user.type(screen.getByRole('textbox'), '网站基础安全检查计划');
        expect(confirm).toBeDisabled();

        await user.clear(screen.getByRole('textbox'));
        await user.type(screen.getByRole('textbox'), '网站基础安全检查');
        expect(confirm).toBeEnabled();

        await user.click(confirm);
        expect(handleConfirm).toHaveBeenCalledTimes(1);
    });

    it('ignores surrounding whitespace but not a different phrase', async () => {
        const user = userEvent.setup();
        openDialog({ confirmPhrase: 'flow-42' });

        const confirm = screen.getByRole('button', { name: '彻底删除' });

        await user.type(screen.getByRole('textbox'), '  flow-42  ');
        expect(confirm).toBeEnabled();
    });

    it('asks for no phrase when none is configured', () => {
        openDialog();

        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '彻底删除' })).toBeEnabled();
    });
});
