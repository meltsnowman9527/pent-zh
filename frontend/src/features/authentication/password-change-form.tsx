import { type ComponentProps, useState } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { FormSubmitButton } from '@/components/ui/form-submit-button';
import { InputPassword } from '@/components/ui/input-password';
import { useAppForm } from '@/hooks/use-app-form';
import { api, resolveApiErrorMessage } from '@/lib/axios';
import { cn } from '@/lib/utils';
import { uiText } from '@/locales/zh-CN';

const passwordChangeSchema = z
    .object({
        confirmPassword: z.string().min(1, { message: uiText('Confirm your password') }),
        currentPassword: z.string().min(1, { message: uiText('Current password is required') }),
        newPassword: z
            .string()
            .min(8, { message: uiText('Password must be at least 8 characters') })
            // bcrypt, which hashes it server-side, refuses anything longer than 72 bytes.
            .refine((password) => new TextEncoder().encode(password).length <= 72, {
                message: uiText('Password must not exceed 72 characters'),
            })
            .refine(
                (password) => {
                    if (password.length > 15) {
                        return true;
                    }

                    return (
                        password.length >= 8 &&
                        /[0-9]/.test(password) &&
                        /[a-z]/.test(password) &&
                        /[A-Z]/.test(password) &&
                        /[!@#$&*]/.test(password)
                    );
                },
                {
                    message: uiText(
                        'Password must be either longer than 15 characters, or at least 8 characters with a number, lowercase, uppercase, and special character (!@#$&*)',
                    ),
                },
            ),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: uiText("Passwords don't match"),
        path: ['confirmPassword'],
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
        message: uiText('New password must be different from current password'),
        path: ['newPassword'],
    });

const ERROR_BY_CODE: Record<string, string> = {
    'Users.ChangePasswordCurrentUser.InvalidCurrentPassword': uiText('Current password is incorrect'),
    'Users.ChangePasswordCurrentUser.InvalidNewPassword': uiText('New password does not meet requirements'),
    'Users.ChangePasswordCurrentUser.InvalidPassword': uiText('Password validation failed'),
    'Users.NotFound': uiText('User not found'),
};

interface PasswordChangeFormProps {
    buttonSize?: ComponentProps<typeof Button>['size'];
    layout?: 'horizontal' | 'vertical';
    onCancel?: () => void;
    onSkip?: () => void;
    onSuccess?: () => void;
}

type PasswordChangeFormValues = z.infer<typeof passwordChangeSchema>;

export function PasswordChangeForm({
    buttonSize = 'default',
    layout = 'horizontal',
    onCancel,
    onSkip,
    onSuccess,
}: PasswordChangeFormProps) {
    const [error, setError] = useState<null | string>(null);

    const form = useAppForm<PasswordChangeFormValues>({
        defaultValues: {
            confirmPassword: '',
            currentPassword: '',
            newPassword: '',
        },
        schema: passwordChangeSchema,
    });

    const handleSubmit = async (values: PasswordChangeFormValues) => {
        setError(null);

        try {
            await api.put('/user/password', {
                confirm_password: values.confirmPassword,
                current_password: values.currentPassword,
                password: values.newPassword,
            });

            form.reset();
            toast.success(uiText('Password successfully changed'));

            onSuccess?.();
        } catch (err: unknown) {
            setError(resolveApiErrorMessage(err, ERROR_BY_CODE, uiText('Failed to change password')));
        }
    };

    const isVertical = layout === 'vertical';

    const skipButton = onSkip && (
        <Button
            className={cn('text-muted-foreground', isVertical && 'w-full')}
            onClick={onSkip}
            size={buttonSize}
            type="button"
            variant="ghost"
        >
            {uiText('Skip for now')}
        </Button>
    );
    const cancelButton = onCancel && (
        <Button
            className={cn(isVertical && 'w-full')}
            onClick={onCancel}
            size={buttonSize}
            type="button"
            variant="outline"
        >
            {uiText('Cancel')}
        </Button>
    );
    const submitButton = (
        <FormSubmitButton
            className={cn(isVertical && 'w-full')}
            size={buttonSize}
        >
            <span>{uiText('Update Password')}</span>
        </FormSubmitButton>
    );

    return (
        <Form {...form}>
            <form
                className="flex flex-col gap-4"
                noValidate
                onSubmit={form.handleSubmit(handleSubmit)}
            >
                <FormField
                    control={form.control}
                    name="currentPassword"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{uiText('Current Password')}</FormLabel>
                            <FormControl>
                                <InputPassword
                                    {...field}
                                    placeholder={uiText('Enter your current password')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="newPassword"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{uiText('New Password')}</FormLabel>
                            <FormControl>
                                <InputPassword
                                    {...field}
                                    placeholder={uiText('Enter your new password')}
                                />
                            </FormControl>
                            <FormDescription className="text-xs">
                                密码需至少 16 个字符，或至少 8 个字符且包含数字、大小写字母和特殊字符（!@#$&*）。
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{uiText('Confirm New Password')}</FormLabel>
                            <FormControl>
                                <InputPassword
                                    {...field}
                                    placeholder={uiText('Confirm your new password')}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {error && <div className="text-destructive text-sm">{error}</div>}

                {isVertical ? (
                    <div className="flex flex-col gap-2 pt-2">
                        {submitButton}
                        {cancelButton}
                        {skipButton}
                    </div>
                ) : (
                    <div className="flex justify-end gap-2 pt-2">
                        {skipButton}
                        {cancelButton}
                        {submitButton}
                    </div>
                )}
            </form>
        </Form>
    );
}
