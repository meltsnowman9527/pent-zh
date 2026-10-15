import { Replace } from 'lucide-react';

import ConfirmationDialog from '@/components/shared/confirmation-dialog';
import { uiText } from '@/locales/zh-CN';

export interface OverwriteConflict {
    destination: string;
    /** Display name extracted from `destination` for the confirm dialog. */
    destinationName: string;
}

interface OverwriteDialogProps {
    /**
     * Overrides the auto-generated confirm button label. Defaults to
     * `uiText('Replace')` for a single conflict and `uiText('Replace all')` for a batch.
     */
    confirmText?: string;
    /**
     * Conflicts collected from a batch operation. Empty array keeps the dialog hidden.
     * For a single conflict the message names the conflicting item; for many it falls
     * back to a count-based summary (Finder-style uiText('Apply to all')).
     */
    conflicts: OverwriteConflict[];
    /**
     * Optional override for the description body. When omitted, the component
     * renders the canonical Finder-style copy that names the single conflicting
     * item or the count for a batch.
     */
    description?: string;
    onCancel: () => void;
    onReplaceAll: () => Promise<unknown> | unknown;
    /** Optional override for the dialog title. Defaults to `uiText('Replace existing item?')`. */
    title?: string;
}

const buildDefaultDescription = (conflicts: OverwriteConflict[]): string | undefined => {
    const single = conflicts.length === 1 ? conflicts[0] : undefined;

    if (single) {
        return uiText('An item named {name} already exists at {path}. Do you want to replace it?', {
            name: single.destinationName,
            path: `/${single.destination}`,
        });
    }

    if (conflicts.length > 1) {
        return uiText('{count} items already exist at the destination. Do you want to replace all of them?', {
            count: conflicts.length,
        });
    }

    return undefined;
};

const buildDefaultConfirmText = (count: number): string => (count > 1 ? uiText('Replace all') : uiText('Replace'));

/**
 * Shared uiText('Replace or cancel') confirmation for destructive overwrite flows
 * (move / copy / pull / attach / promote, …). The hook owns the conflict
 * state; this component only renders the prompt and forwards the user's
 * decision back through the callbacks. A batch decision (Replace all) is
 * applied to every pending conflict in one shot — this matches the OS
 * file-manager UX and keeps the user from being prompted N times for the
 * same destination directory.
 */
export function OverwriteDialog({
    confirmText,
    conflicts,
    description,
    onCancel,
    onReplaceAll,
    title = uiText('Replace existing item?'),
}: OverwriteDialogProps) {
    return (
        <ConfirmationDialog
            cancelText={uiText('Cancel')}
            confirmIcon={<Replace />}
            confirmText={confirmText ?? buildDefaultConfirmText(conflicts.length)}
            confirmVariant="destructive"
            description={description ?? buildDefaultDescription(conflicts)}
            handleConfirm={async () => {
                await onReplaceAll();
            }}
            handleOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onCancel();
                }
            }}
            isOpen={conflicts.length > 0}
            title={title}
        />
    );
}
