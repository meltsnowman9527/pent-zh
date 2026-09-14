import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Accordion({ ...props }: React.ComponentProps<typeof AccordionPrimitive.Root>) {
    return (
        <AccordionPrimitive.Root
            data-slot="accordion"
            {...props}
        />
    );
}

function AccordionContent({ children, className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
    return (
        <AccordionPrimitive.Content
            className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
            data-slot="accordion-content"
            {...props}
        >
            <div className={cn('pt-0 pb-4', className)}>{children}</div>
        </AccordionPrimitive.Content>
    );
}

function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
    return (
        <AccordionPrimitive.Item
            className={cn('border-b', className)}
            data-slot="accordion-item"
            {...props}
        />
    );
}

function AccordionTrigger({
    actions,
    children,
    className,
    ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
    /**
     * Controls that belong to the header row but must not live inside the trigger:
     * a button nested in the trigger's own button is invalid markup and hides both
     * from assistive technology (axe `nested-interactive`).
     */
    actions?: React.ReactNode;
}) {
    return (
        <AccordionPrimitive.Header className="flex items-center">
            <AccordionPrimitive.Trigger
                className={cn(
                    'flex flex-1 items-center justify-between py-4 text-left text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180',
                    className,
                )}
                data-slot="accordion-trigger"
                {...props}
            >
                {children}
                <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200" />
            </AccordionPrimitive.Trigger>
            {actions}
        </AccordionPrimitive.Header>
    );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
