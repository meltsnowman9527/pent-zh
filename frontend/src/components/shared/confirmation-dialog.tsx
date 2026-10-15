import type { ReactElement } from 'react';

import { Trash2 } from 'lucide-react';
import { cloneElement, isValidElement, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { uiText } from '@/locales/zh-CN';

type ConfirmationDialogIconProps = ReactElement<React.SVGProps<SVGSVGElement>>;

interface ConfirmationDialogProps {
    cancelIcon?: ConfirmationDialogIconProps;
    cancelText?: string;
    cancelVariant?: 'default' | 'destructive' | 'ghost' | 'outline' | 'secondary';
    confirmIcon?: ConfirmationDialogIconProps;
    /**
     * When set, the dialog asks for this exact text before the confirm button
     * enables — for actions that cannot be undone.
     */
    confirmPhrase?: string;
    confirmText?: string;
    confirmVariant?: 'default' | 'destructive' | 'ghost' | 'outline' | 'secondary';
    description?: string;
    /** May be sync or async. If async, the dialog keeps itself open and shows a spinner until the promise settles. */
    handleConfirm: () => Promise<void> | void;
    handleOpenChange: (isOpen: boolean) => void;
    isOpen: boolean;
    itemName?: string;
    itemType?: string;
    title?: string;
}

function ConfirmationDialog({
    cancelIcon,
    cancelText = uiText('Cancel'),
    cancelVariant = 'outline',
    confirmIcon = <Trash2 />,
    confirmPhrase,
    confirmText = uiText('Confirm'),
    confirmVariant = 'destructive',
    description,
    handleConfirm,
    handleOpenChange,
    isOpen,
    itemName = uiText('this one'),
    itemType = uiText('item'),
    title,
}: ConfirmationDialogProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [typedPhrase, setTypedPhrase] = useState('');
    const [wasOpen, setWasOpen] = useState(isOpen);

    // Never carry a half-typed phrase into the next time the dialog opens.
    // Adjusting state during render is the recommended way to react to a prop
    // change; an effect would add a second commit and the lint rules forbid
    // calling setState there.
    if (wasOpen !== isOpen) {
        setWasOpen(isOpen);
        setTypedPhrase('');
    }

    const isPhraseMatched = !confirmPhrase || typedPhrase.trim() === confirmPhrase;
    const phraseInputId = 'confirmation-phrase';

    // The default confirm verb is "no custom verb": a bare confirm gets the generic
    // title instead of one naming the object being acted on.
    const verb = confirmText.trim();
    const resolvedTitle =
        title ?? (verb && verb !== uiText('Confirm') ? `${verb}${itemType}` : uiText('Confirm Action'));

    // The object name is highlighted, so the sentence is split around its placeholder
    // instead of interpolated: keep `{name}` unsubstituted and cut the template there.
    const [promptBefore, promptAfter] = uiText('Are you sure you want to {verb} {name} ({type})?', {
        type: itemType,
        verb,
    }).split('{name}');

    const defaultDescription = description ?? (
        <>
            {promptBefore}
            <strong className="text-foreground font-semibold">{itemName}</strong>
            {promptAfter}
        </>
    );

    const processIcon = (icon?: ConfirmationDialogIconProps): ConfirmationDialogIconProps | null => {
        if (!icon) {
            return null;
        }

        if (isValidElement(icon)) {
            const { className = '', ...restProps } = icon.props;

            return cloneElement(icon, {
                ...restProps,
                className: cn('size-4', className),
            });
        }

        return icon;
    };

    const handleConfirmClick = async () => {
        if (isProcessing || !isPhraseMatched) {
            return;
        }

        setIsProcessing(true);

        try {
            await handleConfirm();
            handleOpenChange(false);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Dialog
            onOpenChange={(nextOpen) => {
                if (isProcessing) {
                    return;
                }

                handleOpenChange(nextOpen);
            }}
            open={isOpen}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{resolvedTitle}</DialogTitle>
                    <DialogDescription>{defaultDescription}</DialogDescription>
                </DialogHeader>

                {confirmPhrase ? (
                    <div className="grid gap-2">
                        <Label htmlFor={phraseInputId}>
                            {uiText('Type {phrase} to confirm', { phrase: confirmPhrase })}
                        </Label>
                        <Input
                            autoComplete="off"
                            disabled={isProcessing}
                            id={phraseInputId}
                            onChange={(event) => setTypedPhrase(event.target.value)}
                            value={typedPhrase}
                        />
                    </div>
                ) : null}

                <DialogFooter>
                    <Button
                        disabled={isProcessing}
                        onClick={() => handleOpenChange(false)}
                        variant={cancelVariant}
                    >
                        {processIcon(cancelIcon)}
                        {cancelText}
                    </Button>
                    <Button
                        disabled={isProcessing || !isPhraseMatched}
                        onClick={() => {
                            void handleConfirmClick();
                        }}
                        variant={confirmVariant}
                    >
                        {isProcessing ? <Spinner variant="circle" /> : processIcon(confirmIcon)}
                        {confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default ConfirmationDialog;
