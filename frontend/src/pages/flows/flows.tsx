import type { ColumnDef } from '@tanstack/react-table';

import { useMutation, useQuery } from '@apollo/client/react';
import { ArchiveRestore, Ellipsis, Eye, GitFork, Pause, Pencil, PencilLine, Plus, Star, Trash } from 'lucide-react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { FlowStatusIcon } from '@/components/icons/flow-status-icon';
import { ProviderIcon } from '@/components/icons/provider-icon';
import {
    AppHeader,
    AppHeaderAction,
    AppHeaderActions,
    AppHeaderContent,
    AppHeaderTitle,
} from '@/components/layouts/app/app-header';
import ConfirmationDialog from '@/components/shared/confirmation-dialog';
import { ErrorState } from '@/components/shared/error-state';
import { InlineEditInput } from '@/components/shared/inline-edit';
import { LoadingState } from '@/components/shared/loading-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FlowJobStatus, isFlowJobPending } from '@/features/flows/flow-job-status';
import {
    DeletedFlowsDocument,
    RenameFlowDocument,
    ResultType,
    StatusType,
    type TerminalFragmentFragment,
} from '@/graphql/types';
import { useTableState } from '@/hooks/use-table-state';
import { localizeUiErrorText } from '@/lib/errors';
import { routes } from '@/lib/routes';
import { mergeHrefWithSearchParams } from '@/lib/url-params';
import { formatDate } from '@/lib/utils/format';
import { uiText } from '@/locales/zh-CN';
import { useFavorites } from '@/providers/favorites-provider';
import { type Flow, useFlows } from '@/providers/flows-provider';

const statusConfig: Record<
    StatusType,
    { label: string; variant: 'default' | 'destructive' | 'outline' | 'secondary' }
> = {
    [StatusType.Created]: {
        label: uiText('Created'),
        variant: 'outline',
    },
    [StatusType.Failed]: {
        label: uiText('Failed'),
        variant: 'destructive',
    },
    [StatusType.Finished]: {
        label: uiText('Finished'),
        variant: 'secondary',
    },
    [StatusType.Running]: {
        label: uiText('Running'),
        variant: 'default',
    },
    [StatusType.Waiting]: {
        label: uiText('Waiting'),
        variant: 'outline',
    },
};

const idColumn: ColumnDef<Flow> = {
    accessorKey: 'id',
    cell: ({ row }) => <div className="font-mono text-sm">{row.getValue('id')}</div>,
    enableHiding: false,
    header: ({ column }) => (
        <DataTableColumnHeader
            column={column}
            title="ID"
        />
    ),
    maxSize: 80,
    meta: { searchable: true },
    minSize: 60,
    size: 70,
};

const titleColumn: ColumnDef<Flow> = {
    accessorKey: 'title',
    cell: ({ row }) => <div className="truncate font-medium">{row.getValue('title') as string}</div>,
    enableHiding: false,
    header: ({ column }) => (
        <DataTableColumnHeader
            column={column}
            title={uiText('Title')}
        />
    ),
    meta: { searchable: true },
    minSize: 200,
    size: 300,
};

const statusCellColumn: ColumnDef<Flow> = {
    accessorKey: 'status',
    cell: ({ row }) => {
        const status = row.getValue('status') as StatusType;
        const config = statusConfig[status];

        return (
            <Badge variant={config.variant}>
                <FlowStatusIcon
                    className="size-3"
                    status={status}
                />
                {config.label}
            </Badge>
        );
    },
    header: ({ column }) => (
        <DataTableColumnHeader
            column={column}
            title={uiText('Status')}
        />
    ),
    maxSize: 130,
    meta: { searchable: true },
    minSize: 80,
    size: 100,
};

function Flows() {
    const navigate = useNavigate();
    const location = useLocation();
    const { deleteFlow, finishFlow, flows, flowsError, isLoading, purgeFlow, refetch, restoreFlow } = useFlows();
    const { isFavoriteFlow, toggleFavoriteFlow } = useFavorites();
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [deletingFlow, setDeletingFlow] = useState<Flow | null>(null);
    const [finishingFlowIds, setFinishingFlowIds] = useState<Set<string>>(new Set());
    const [deletingFlowIds, setDeletingFlowIds] = useState<Set<string>>(new Set());
    const [editingFlowId, setEditingFlowId] = useState<null | string>(null);
    const editingInputRef = useRef<HTMLInputElement>(null);
    const [renameFlowMutation, { loading: isRenameLoading }] = useMutation(RenameFlowDocument);

    // Recycle bin. The query only runs while the bin is open, and it polls like
    // the main list so a flow whose delete job is still finishing shows up
    // without a manual refresh.
    const [showDeleted, setShowDeleted] = useState(false);
    const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);
    const [restoringFlow, setRestoringFlow] = useState<Flow | null>(null);
    const [isPurgeDialogOpen, setIsPurgeDialogOpen] = useState(false);
    const [purgingFlow, setPurgingFlow] = useState<Flow | null>(null);
    const { data: deletedFlowsData, loading: isDeletedLoading } = useQuery(DeletedFlowsDocument, {
        pollInterval: 5000,
        skip: !showDeleted,
    });
    const deletedFlows = useMemo(() => deletedFlowsData?.deletedFlows ?? [], [deletedFlowsData?.deletedFlows]);
    const isRecycleBin = showDeleted;
    const tableFlows = isRecycleBin ? deletedFlows : flows;
    const tableLoading = isRecycleBin ? isDeletedLoading && deletedFlows.length === 0 : isLoading;

    const handleFlowRestoreDialogOpen = useCallback((flow: Flow) => {
        setRestoringFlow(flow);
        setIsRestoreDialogOpen(true);
    }, []);

    const handleFlowPurgeDialogOpen = useCallback((flow: Flow) => {
        setPurgingFlow(flow);
        setIsPurgeDialogOpen(true);
    }, []);

    const handleFlowRestore = async () => {
        if (!restoringFlow) {
            return;
        }

        const success = await restoreFlow(restoringFlow);

        if (success) {
            setRestoringFlow(null);
        }
    };

    const handleFlowPurge = async () => {
        if (!purgingFlow) {
            return;
        }

        const success = await purgeFlow(purgingFlow);

        if (success) {
            setPurgingFlow(null);
        }
    };

    const { filter, pageIndex: currentPage, setFilter, setPage: handlePageChange } = useTableState();

    const handleFlowOpen = useCallback(
        (flowId: string) => {
            navigate(mergeHrefWithSearchParams(routes.flow(flowId), new URLSearchParams(location.search)));
        },
        [navigate, location.search],
    );

    const handleFlowDeleteDialogOpen = useCallback((flow: Flow) => {
        setDeletingFlow(flow);
        setIsDeleteDialogOpen(true);
    }, []);

    const handleFlowRenameStart = useCallback((flow: Flow) => {
        setEditingFlowId(flow.id);
    }, []);

    const handleFlowDelete = async () => {
        if (!deletingFlow) {
            return;
        }

        setDeletingFlowIds((previousIds) => new Set(previousIds).add(deletingFlow.id));

        try {
            const success = await deleteFlow(deletingFlow);

            if (success) {
                setDeletingFlow(null);
            }
        } finally {
            setDeletingFlowIds((previousIds) => {
                const newIds = new Set(previousIds);
                newIds.delete(deletingFlow.id);

                return newIds;
            });
        }
    };

    const handleFlowRenameSave = useCallback(async () => {
        const newTitle = editingInputRef.current?.value.trim();

        if (!editingFlowId || !newTitle) {
            return;
        }

        try {
            const { data } = await renameFlowMutation({
                variables: {
                    flowId: editingFlowId,
                    title: newTitle,
                },
            });

            if (data?.renameFlow === ResultType.Success) {
                toast.success(uiText('Flow renamed successfully'));
                setEditingFlowId(null);
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? localizeUiErrorText(error.message) : uiText('Failed to rename flow');
            toast.error(errorMessage);
        }
    }, [editingFlowId, renameFlowMutation]);

    const handleFlowRenameCancel = useCallback(() => {
        setEditingFlowId(null);
    }, []);

    const handleFlowFinish = useCallback(
        async (flow: Flow) => {
            setFinishingFlowIds((previousIds) => new Set(previousIds).add(flow.id));

            try {
                await finishFlow(flow);
            } finally {
                setFinishingFlowIds((previousIds) => {
                    const newIds = new Set(previousIds);
                    newIds.delete(flow.id);

                    return newIds;
                });
            }
        },
        [finishFlow],
    );

    const columns: ColumnDef<Flow>[] = useMemo(
        () => [
            idColumn,
            {
                accessorKey: 'title',
                cell: ({ row }) => {
                    const flow = row.original;
                    const isEditing = editingFlowId === flow.id;
                    const title = row.getValue('title') as string;

                    if (isEditing) {
                        return (
                            <div onClick={(e) => e.stopPropagation()}>
                                <InlineEditInput
                                    autoFocus
                                    busy={isRenameLoading}
                                    defaultValue={title}
                                    inputRef={editingInputRef}
                                    onCancel={handleFlowRenameCancel}
                                    onSave={handleFlowRenameSave}
                                    placeholder={uiText('Flow title')}
                                />
                            </div>
                        );
                    }

                    return <div className="truncate font-medium">{title}</div>;
                },
                enableHiding: false,
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Title')}
                    />
                ),
                meta: { searchable: true },
                minSize: 200,
                size: 300,
            },
            {
                // Same badge as the recycle bin, plus the durable-job override: a
                // flow whose create/delete job is still queued or retrying shows
                // that instead of a status it does not have yet.
                accessorKey: 'status',
                cell: ({ row }) => {
                    if (row.original.lifecycleJob && row.original.lifecycleJob.status !== 'succeeded') {
                        return <FlowJobStatus job={row.original.lifecycleJob} />;
                    }

                    const status = row.getValue('status') as StatusType;
                    const config = statusConfig[status];

                    return (
                        <Badge variant={config.variant}>
                            <FlowStatusIcon
                                className="size-3"
                                status={status}
                            />
                            {config.label}
                        </Badge>
                    );
                },
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Status')}
                    />
                ),
                maxSize: 130,
                meta: { searchable: true },
                minSize: 80,
                size: 100,
            },
            {
                // accessorFn returns the provider name as a plain string so it
                // participates in the DataTable global filter (search input).
                // The cell renderer still reads the original provider object
                // directly through `row.original`, so the icon + label stay
                // intact.
                accessorFn: (row) => row.provider?.name ?? '',
                cell: ({ row }) => {
                    const flow = row.original;

                    return (
                        <div className="flex items-center gap-2">
                            <ProviderIcon
                                className="size-4"
                                provider={flow.provider}
                            />
                            <span className="text-sm">{flow.provider?.name || 'N/A'}</span>
                        </div>
                    );
                },
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Provider')}
                    />
                ),
                id: 'provider',
                maxSize: 150,
                meta: { searchable: true },
                minSize: 80,
                size: 100,
                sortingFn: (rowA, rowB) => {
                    const nameA = rowA.original.provider?.name || '';
                    const nameB = rowB.original.provider?.name || '';

                    return nameA.localeCompare(nameB);
                },
            },
            {
                // accessorFn joins all terminal images into one string for the
                // global search; the cell still derives its presentation from
                // the original array on `row.original`, and sortingFn keeps
                // ordering by count (more intuitive than alphabetical).
                accessorFn: (row) => (row.terminals ?? []).map((t) => t.image).join(' '),
                cell: ({ row }) => {
                    const flow = row.original;
                    const terminals = flow.terminals || [];

                    if (terminals.length === 0) {
                        return <span className="text-muted-foreground text-sm">{uiText('No terminals')}</span>;
                    }

                    const isAnyConnected = terminals.some((t: TerminalFragmentFragment) => t.connected);
                    const images = [...new Set(terminals.map((t: TerminalFragmentFragment) => t.image))];

                    return (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-2 overflow-hidden">
                                    {isAnyConnected ? (
                                        <CheckCircle2 className="size-4 shrink-0 text-green-500" />
                                    ) : (
                                        <XCircle className="text-muted-foreground size-4 shrink-0" />
                                    )}
                                    <span className="truncate text-sm">{images.join(', ')}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <div className="flex flex-col gap-1">
                                    {terminals.map((terminal: TerminalFragmentFragment) => (
                                        <div
                                            className="flex items-center gap-2"
                                            key={terminal.id}
                                        >
                                            <span className="text-xs">{terminal.image}</span>
                                            <span className="text-muted-foreground text-xs">
                                                ({terminal.connected ? uiText('Connected') : uiText('Disconnected')})
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    );
                },
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Terminals')}
                    />
                ),
                id: 'terminals',
                maxSize: 220,
                meta: { searchable: true },
                minSize: 160,
                size: 180,
                sortingFn: (rowA, rowB) => {
                    const terminalsA = rowA.original.terminals || [];
                    const terminalsB = rowB.original.terminals || [];

                    return terminalsA.length - terminalsB.length;
                },
            },
            {
                accessorKey: 'createdAt',
                cell: ({ row }) => {
                    const dateString = row.getValue('createdAt') as string;

                    return <div className="text-sm">{formatDate(new Date(dateString))}</div>;
                },
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Created')}
                    />
                ),
                maxSize: 140,
                meta: { columnMenuLabel: uiText('Created') },
                minSize: 100,
                size: 120,
                sortingFn: (rowA, rowB) => {
                    const dateA = new Date(rowA.getValue('createdAt') as string);
                    const dateB = new Date(rowB.getValue('createdAt') as string);

                    return dateA.getTime() - dateB.getTime();
                },
            },
            {
                accessorKey: 'updatedAt',
                cell: ({ row }) => {
                    const dateString = row.getValue('updatedAt') as string;

                    return <div className="text-sm">{formatDate(new Date(dateString))}</div>;
                },
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Updated')}
                    />
                ),
                maxSize: 140,
                meta: { columnMenuLabel: 'Updated' },
                minSize: 100,
                size: 120,
                sortingFn: (rowA, rowB) => {
                    const dateA = new Date(rowA.getValue('updatedAt') as string);
                    const dateB = new Date(rowB.getValue('updatedAt') as string);

                    return dateA.getTime() - dateB.getTime();
                },
            },
            {
                cell: ({ row }) => {
                    const flow = row.original;
                    const isRunning = ![StatusType.Failed, StatusType.Finished].includes(flow.status);

                    return (
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Toggle
                                aria-label={uiText('Toggle favorite')}
                                className="border-none data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-yellow-500 data-[state=on]:*:[svg]:stroke-yellow-500"
                                onClick={async (event) => {
                                    event.stopPropagation();
                                    await toggleFavoriteFlow(flow.id);
                                }}
                                pressed={isFavoriteFlow(flow.id)}
                                size="sm"
                                variant="outline"
                            >
                                <Star />
                            </Toggle>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        aria-label={uiText('Open menu')}
                                        className="size-8 p-0"
                                        onClick={(e) => e.stopPropagation()}
                                        variant="ghost"
                                    >
                                        <Ellipsis />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="min-w-24"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <DropdownMenuItem onClick={() => handleFlowOpen(flow.id)}>
                                        <Eye />
                                        {uiText('View')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleFlowRenameStart(flow)}>
                                        <PencilLine className="size-3" />
                                        {uiText('Rename')}
                                    </DropdownMenuItem>
                                    {isRunning && (
                                        <DropdownMenuItem
                                            disabled={
                                                finishingFlowIds.has(flow.id) ||
                                                (isFlowJobPending(flow.lifecycleJob) &&
                                                    flow.lifecycleJob?.kind !== 'create')
                                            }
                                            onClick={() => handleFlowFinish(flow)}
                                        >
                                            {finishingFlowIds.has(flow.id) ||
                                            (isFlowJobPending(flow.lifecycleJob) &&
                                                flow.lifecycleJob?.kind !== 'create') ? (
                                                <>
                                                    <Spinner variant="circle" />
                                                    {uiText('Finishing...')}
                                                </>
                                            ) : (
                                                <>
                                                    <Pause />
                                                    {uiText('Finish')}
                                                </>
                                            )}
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        disabled={
                                            deletingFlowIds.has(flow.id) ||
                                            (isFlowJobPending(flow.lifecycleJob) &&
                                                flow.lifecycleJob?.kind !== 'create')
                                        }
                                        onClick={() => handleFlowDeleteDialogOpen(flow)}
                                    >
                                        {deletingFlowIds.has(flow.id) ||
                                        (isFlowJobPending(flow.lifecycleJob) &&
                                            flow.lifecycleJob?.kind !== 'create') ? (
                                            <>
                                                <Spinner variant="circle" />
                                                {uiText('Deleting...')}
                                            </>
                                        ) : (
                                            <>
                                                <Trash />
                                                {uiText('Delete')}
                                            </>
                                        )}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    );
                },
                enableHiding: false,
                header: () => null,
                id: 'actions',
                maxSize: 100,
                meta: { preventRowClick: true },
                minSize: 90,
                size: 96,
            },
        ],
        [
            deletingFlowIds,
            editingFlowId,
            finishingFlowIds,
            handleFlowDeleteDialogOpen,
            handleFlowFinish,
            handleFlowOpen,
            handleFlowRenameCancel,
            handleFlowRenameSave,
            handleFlowRenameStart,
            isFavoriteFlow,
            isRenameLoading,
            toggleFavoriteFlow,
        ],
    );

    // Recycle-bin columns: no favourites, no rename/finish/delete, and the row
    // itself is not navigable — a deleted flow has no detail page.
    const deletedColumns: ColumnDef<Flow>[] = useMemo(
        () => [
            idColumn,
            titleColumn,
            statusCellColumn,
            {
                accessorKey: 'deletedAt',
                cell: ({ row }) => {
                    const dateString = row.getValue('deletedAt') as null | string;

                    return <div className="text-sm">{dateString ? formatDate(new Date(dateString)) : '—'}</div>;
                },
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={uiText('Deleted at')}
                    />
                ),
                maxSize: 140,
                meta: { columnMenuLabel: uiText('Deleted at') },
                minSize: 100,
                size: 120,
                sortingFn: (rowA, rowB) => {
                    const dateA = new Date((rowA.getValue('deletedAt') as null | string) ?? 0);
                    const dateB = new Date((rowB.getValue('deletedAt') as null | string) ?? 0);

                    return dateA.getTime() - dateB.getTime();
                },
            },
            {
                cell: ({ row }) => (
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            onClick={(event) => {
                                event.stopPropagation();
                                handleFlowRestoreDialogOpen(row.original);
                            }}
                            size="sm"
                            variant="outline"
                        >
                            <ArchiveRestore />
                            {uiText('Restore')}
                        </Button>
                        <Button
                            onClick={(event) => {
                                event.stopPropagation();
                                handleFlowPurgeDialogOpen(row.original);
                            }}
                            size="sm"
                            variant="outline"
                        >
                            <Trash />
                            {uiText('Delete permanently')}
                        </Button>
                    </div>
                ),
                enableHiding: false,
                header: () => null,
                id: 'restore',
                maxSize: 260,
                meta: { preventRowClick: true },
                minSize: 220,
                size: 240,
            },
        ],
        [handleFlowPurgeDialogOpen, handleFlowRestoreDialogOpen],
    );

    const renderRowContextMenu = useCallback(
        (flow: Flow) => {
            const isRunning = ![StatusType.Failed, StatusType.Finished].includes(flow.status);

            return (
                <>
                    <ContextMenuItem onClick={async () => toggleFavoriteFlow(flow.id)}>
                        <Star />
                        {isFavoriteFlow(flow.id) ? uiText('Remove from favorites') : uiText('Add to favorites')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => handleFlowOpen(flow.id)}>
                        <Eye />
                        {uiText('View')}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleFlowRenameStart(flow)}>
                        <Pencil />
                        {uiText('Rename')}
                    </ContextMenuItem>

                    {isRunning && (
                        <ContextMenuItem
                            disabled={
                                finishingFlowIds.has(flow.id) ||
                                (isFlowJobPending(flow.lifecycleJob) && flow.lifecycleJob?.kind !== 'create')
                            }
                            onClick={() => handleFlowFinish(flow)}
                        >
                            <Pause />
                            {finishingFlowIds.has(flow.id) ||
                            (isFlowJobPending(flow.lifecycleJob) && flow.lifecycleJob?.kind !== 'create')
                                ? uiText('Finishing...')
                                : uiText('Finish')}
                        </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        disabled={
                            deletingFlowIds.has(flow.id) ||
                            (isFlowJobPending(flow.lifecycleJob) && flow.lifecycleJob?.kind !== 'create')
                        }
                        onClick={() => handleFlowDeleteDialogOpen(flow)}
                    >
                        <Trash />
                        {deletingFlowIds.has(flow.id) ||
                        (isFlowJobPending(flow.lifecycleJob) && flow.lifecycleJob?.kind !== 'create')
                            ? uiText('Deleting...')
                            : uiText('Delete')}
                    </ContextMenuItem>
                </>
            );
        },
        [
            deletingFlowIds,
            finishingFlowIds,
            handleFlowDeleteDialogOpen,
            handleFlowFinish,
            handleFlowOpen,
            handleFlowRenameStart,
            isFavoriteFlow,
            toggleFavoriteFlow,
        ],
    );

    const handleRowClick = useCallback(
        (flow: Flow) => {
            if (editingFlowId !== flow.id) {
                handleFlowOpen(flow.id);
            }
        },
        [editingFlowId, handleFlowOpen],
    );

    const pageHeader = (
        <AppHeader>
            <AppHeaderContent>
                <AppHeaderTitle icon={<GitFork className="size-4 shrink-0" />}>{uiText('Flows')}</AppHeaderTitle>
            </AppHeaderContent>
            <AppHeaderActions>
                <AppHeaderAction
                    icon={isRecycleBin ? <GitFork /> : <ArchiveRestore />}
                    label={isRecycleBin ? uiText('Back to flows') : uiText('Recycle bin')}
                    onClick={() => setShowDeleted((previous) => !previous)}
                    variant="outline"
                />
                <AppHeaderAction
                    icon={<Plus />}
                    label={uiText('New Flow')}
                    onClick={() => navigate(routes.newFlow)}
                    variant="secondary"
                />
            </AppHeaderActions>
        </AppHeader>
    );

    if (tableLoading) {
        return (
            <>
                {pageHeader}
                <div className="flex flex-1 flex-col gap-4 p-4">
                    <LoadingState
                        description={uiText('Please wait while we fetch your conversation flows')}
                        title={isRecycleBin ? uiText('Loading deleted flows...') : uiText('Loading flows...')}
                    />
                </div>
            </>
        );
    }

    // Error surface only when there's no data — a failed background refetch must not blank a working list.
    if (!isRecycleBin && flowsError && flows.length === 0) {
        return (
            <>
                {pageHeader}
                <div className="flex flex-1 flex-col gap-4 p-4">
                    <ErrorState
                        message={flowsError.message}
                        onRetry={refetch}
                        title={uiText('Error loading flows')}
                    />
                </div>
            </>
        );
    }

    if (isRecycleBin && deletedFlows.length === 0) {
        return (
            <>
                {pageHeader}
                <div className="flex flex-1 flex-col gap-4 p-4">
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ArchiveRestore />
                            </EmptyMedia>
                            <EmptyTitle>{uiText('No deleted flows')}</EmptyTitle>
                            <EmptyDescription>
                                {uiText('Deleted flows are listed here and can be restored.')}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                </div>
            </>
        );
    }

    if (!isRecycleBin && flows.length === 0) {
        return (
            <>
                {pageHeader}
                <div className="flex flex-1 flex-col gap-4 p-4">
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <GitFork />
                            </EmptyMedia>
                            <EmptyTitle>{uiText('No flows found')}</EmptyTitle>
                            <EmptyDescription>
                                {uiText('Get started by creating your first conversation flow')}
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button
                                onClick={() => navigate(routes.newFlow)}
                                variant="secondary"
                            >
                                <Plus />
                                {uiText('New Flow')}
                            </Button>
                        </EmptyContent>
                    </Empty>
                </div>
            </>
        );
    }

    return (
        <>
            {pageHeader}
            <div className="flex flex-col gap-4 p-4 pt-0">
                <DataTable<Flow>
                    columns={isRecycleBin ? deletedColumns : columns}
                    data={tableFlows}
                    empty={{ entityName: isRecycleBin ? 'deleted flows' : 'flows' }}
                    filterPlaceholder={uiText('Filter flows...')}
                    filterValue={filter}
                    isVirtualized
                    onFilterChange={setFilter}
                    onPageChange={handlePageChange}
                    onRowClick={isRecycleBin ? undefined : handleRowClick}
                    pageIndex={currentPage}
                    renderRowContextMenu={isRecycleBin ? undefined : renderRowContextMenu}
                />

                <ConfirmationDialog
                    cancelText={uiText('Cancel')}
                    confirmText={uiText('Delete')}
                    handleConfirm={handleFlowDelete}
                    handleOpenChange={setIsDeleteDialogOpen}
                    isOpen={isDeleteDialogOpen}
                    itemName={deletingFlow?.title}
                    itemType={uiText('flow')}
                />

                <ConfirmationDialog
                    cancelText={uiText('Cancel')}
                    confirmIcon={<ArchiveRestore />}
                    confirmText={uiText('Restore')}
                    confirmVariant="default"
                    description={uiText(
                        'The flow returns to the list with its history. Files and vector memory removed during deletion are not restored.',
                    )}
                    handleConfirm={handleFlowRestore}
                    handleOpenChange={setIsRestoreDialogOpen}
                    isOpen={isRestoreDialogOpen}
                    itemName={restoringFlow?.title}
                    itemType={uiText('flow')}
                    title={uiText('Restore {name}', { name: restoringFlow?.title ?? '' })}
                />

                <ConfirmationDialog
                    cancelText={uiText('Cancel')}
                    confirmPhrase={purgingFlow?.title ?? ''}
                    confirmText={uiText('Delete permanently')}
                    description={uiText(
                        'The flow and every record that belongs to it — tasks, tool calls, logs, screenshots and job history — are deleted from the database. This cannot be undone.',
                    )}
                    handleConfirm={handleFlowPurge}
                    handleOpenChange={setIsPurgeDialogOpen}
                    isOpen={isPurgeDialogOpen}
                    itemName={purgingFlow?.title}
                    itemType={uiText('flow')}
                    title={uiText('Delete permanently {name}', { name: purgingFlow?.title ?? '' })}
                />
            </div>
        </>
    );
}

export default Flows;
