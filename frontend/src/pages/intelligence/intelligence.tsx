import {
    AlertTriangle,
    BookOpen,
    CalendarClock,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    FileUp,
    Network,
    Plus,
    Radar,
    RefreshCw,
    Search,
    Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
    AppHeader,
    AppHeaderAction,
    AppHeaderActions,
    AppHeaderContent,
    AppHeaderTitle,
} from '@/components/layouts/app/app-header';
import ConfirmationDialog from '@/components/shared/confirmation-dialog';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResourcesUpload } from '@/features/resources/use-resources-upload';
import { api, getApiErrorMessage, unwrapApiResponse } from '@/lib/axios';
import { useResources } from '@/providers/resources-provider';

import IntelligenceKnowledgeGraph, { type IntelligenceGraphData } from './intelligence-graph';

interface IntelligenceItem {
    cve_id: string;
    external_id: string;
    id: number;
    item_type: string;
    modified_at: null | string;
    product: string;
    published_at: null | string;
    severity: string;
    source_id: number;
    source_url: string;
    summary: string;
    title: string;
    updated_at: string;
    vendor: string;
    weakness: string;
}

interface IntelligenceOverview {
    items: IntelligenceItem[];
    sources: IntelligenceSource[];
    stats: {
        critical: number;
        enabled: number;
        failed_sources: number;
        items: number;
        relations: number;
        sources: number;
    };
}

interface IntelligenceSource {
    builtin: boolean;
    created_at: string;
    description: string;
    enabled: boolean;
    format: 'auto' | 'cwe' | 'json' | 'rss' | 'stix';
    id: number;
    item_count: number;
    last_error: string;
    last_sync_at: null | string;
    name: string;
    next_sync_at: null | string;
    schedule: Schedule;
    status: 'failed' | 'pending' | 'ready' | 'syncing';
    updated_at: string;
    url: string;
}

type Schedule = 'daily' | 'hourly' | 'manual' | 'weekly';

const scheduleLabels: Record<Schedule, string> = {
    daily: '每天',
    hourly: '每小时',
    manual: '仅手动',
    weekly: '每周',
};

const emptyOverview: IntelligenceOverview = {
    items: [],
    sources: [],
    stats: { critical: 0, enabled: 0, failed_sources: 0, items: 0, relations: 0, sources: 0 },
};

function formatDate(value: null | string) {
    if (!value) {
        return '尚未更新';
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function Intelligence() {
    const [activeView, setActiveView] = useState<'graph' | 'internal' | 'items' | 'sources'>('sources');
    const [overview, setOverview] = useState<IntelligenceOverview>(emptyOverview);
    const [graph, setGraph] = useState<IntelligenceGraphData>({ edges: [], nodes: [] });
    const [graphError, setGraphError] = useState('');
    const [isGraphLoading, setIsGraphLoading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncingAll, setIsSyncingAll] = useState(false);
    const [syncingSourceId, setSyncingSourceId] = useState<null | number>(null);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isSavingSource, setIsSavingSource] = useState(false);
    const [sourceName, setSourceName] = useState('');
    const [sourceURL, setSourceURL] = useState('');
    const [sourceFormat, setSourceFormat] = useState<'auto' | 'cwe' | 'json' | 'rss' | 'stix'>('auto');
    const [sourceSchedule, setSourceSchedule] = useState<Schedule>('daily');
    const [sourceToDelete, setSourceToDelete] = useState<IntelligenceSource | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const upload = useResourcesUpload();
    const { resources } = useResources();

    const internalMaterials = useMemo(
        () => resources.filter((resource) => resource.path.startsWith('intelligence-internal/') && !resource.isDir),
        [resources],
    );

    const loadOverview = useCallback(async (showError = true) => {
        try {
            const response = await api.get<IntelligenceOverview>('/intelligence/');
            setOverview(unwrapApiResponse(response));
        } catch (error) {
            if (showError) {
                toast.error('加载多源漏洞知识失败', { description: getApiErrorMessage(error, '请稍后重试') });
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadGraph = useCallback(async () => {
        setIsGraphLoading(true);
        setGraphError('');

        try {
            const response = await api.get<IntelligenceGraphData>('/intelligence/graph?limit=400');
            setGraph(unwrapApiResponse(response));
        } catch (error) {
            setGraphError(getApiErrorMessage(error, '无法读取知识图谱'));
        } finally {
            setIsGraphLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;

        void api
            .get<IntelligenceOverview>('/intelligence/')
            .then((response) => {
                if (active) {
                    setOverview(unwrapApiResponse(response));
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    toast.error('加载多源漏洞知识失败', {
                        description: getApiErrorMessage(error, '请稍后重试'),
                    });
                }
            })
            .finally(() => {
                if (active) {
                    setIsLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    const syncAll = async () => {
        setIsSyncingAll(true);

        try {
            const response = await api.post<{ collected: number; failed: number }>('/intelligence/sync');
            const result = unwrapApiResponse(response);
            toast.success(`智能体知识库已更新 ${result.collected} 条漏洞知识`, {
                description: result.failed
                    ? `${result.failed} 个来源获取失败，请查看来源状态。`
                    : '所有启用的来源已更新。',
            });
            await loadOverview(false);

            if (activeView === 'graph') {
                await loadGraph();
            }
        } catch (error) {
            toast.error('获取失败', { description: getApiErrorMessage(error, '无法连接外部情报源') });
        } finally {
            setIsSyncingAll(false);
        }
    };

    const syncOne = async (source: IntelligenceSource) => {
        setSyncingSourceId(source.id);

        try {
            const response = await api.post<{ collected: number }>(`/intelligence/sources/${source.id}/sync`);
            const result = unwrapApiResponse(response);
            toast.success(`${source.name} 已更新到智能体知识库`, {
                description: `获取并整理了 ${result.collected} 条记录。`,
            });
            await loadOverview(false);

            if (activeView === 'graph') {
                await loadGraph();
            }
        } catch (error) {
            toast.error(`${source.name} 获取失败`, { description: getApiErrorMessage(error, '请检查来源地址') });
            await loadOverview(false);
        } finally {
            setSyncingSourceId(null);
        }
    };

    const updateSource = async (
        source: IntelligenceSource,
        update: Partial<Pick<IntelligenceSource, 'enabled' | 'schedule'>>,
    ) => {
        const previous = overview;
        setOverview((current) => ({
            ...current,
            sources: current.sources.map((candidate) =>
                candidate.id === source.id ? { ...candidate, ...update } : candidate,
            ),
        }));

        try {
            await api.put(`/intelligence/sources/${source.id}`, update);
            await loadOverview(false);
        } catch (error) {
            setOverview(previous);
            toast.error('更新来源失败', { description: getApiErrorMessage(error, '请稍后重试') });
        }
    };

    const deleteSource = async (source: IntelligenceSource) => {
        try {
            await api.delete(`/intelligence/sources/${source.id}`);
            toast.success(`已删除来源“${source.name}”`);
            await loadOverview(false);
        } catch (error) {
            toast.error('删除来源失败', { description: getApiErrorMessage(error, '请稍后重试') });
        }
    };

    const createSource = async () => {
        if (!sourceName.trim() || !sourceURL.trim()) {
            toast.error('请填写来源名称和地址');

            return;
        }

        setIsSavingSource(true);

        try {
            await api.post('/intelligence/sources', {
                format: sourceFormat,
                name: sourceName.trim(),
                schedule: sourceSchedule,
                url: sourceURL.trim(),
            });
            setIsAddOpen(false);
            setSourceName('');
            setSourceURL('');
            toast.success('已添加外部情报源');
            await loadOverview(false);
        } catch (error) {
            toast.error('添加来源失败', { description: getApiErrorMessage(error, '请检查地址后重试') });
        } finally {
            setIsSavingSource(false);
        }
    };

    const uploadInternalMaterials = async (files: File[]) => {
        if (!files.length) {
            return;
        }

        try {
            await api.post('/resources/mkdir', { path: 'intelligence-internal' });
        } catch {
            // The folder already exists. The upload endpoint will still validate ownership and destination.
        }

        await upload.uploadFiles(files, { dir: 'intelligence-internal' });
    };

    return (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <AppHeaderTitle icon={<Radar className="size-4 shrink-0" />}>外部威胁情报</AppHeaderTitle>
                </AppHeaderContent>
                <AppHeaderActions>
                    <AppHeaderAction
                        icon={<Plus />}
                        label="添加来源"
                        onClick={() => setIsAddOpen(true)}
                        variant="outline"
                    />
                    <AppHeaderAction
                        icon={<RefreshCw />}
                        label="更新智能体知识库"
                        loading={isSyncingAll}
                        onClick={() => void syncAll()}
                    />
                </AppHeaderActions>
            </AppHeader>

            <main className="flex min-w-0 flex-col gap-6 overflow-x-hidden p-4 lg:p-6">
                <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">外部威胁情报知识管理</h1>
                        <p className="text-muted-foreground mt-1 text-sm">
                            管理智能体使用的情报来源和内部材料，为智能体持续补充结构化安全知识。
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline">知识 {overview.stats.items}</Badge>
                        <Badge variant="outline">关系 {overview.stats.relations}</Badge>
                        <Badge variant="blue">
                            来源 {overview.stats.enabled}/{overview.stats.sources}
                        </Badge>
                        <Badge variant="red">高风险 {overview.stats.critical}</Badge>
                        <Badge variant="secondary">内部材料 {internalMaterials.length}</Badge>
                    </div>
                </section>

                <Tabs
                    onValueChange={(value) => {
                        const view = value as typeof activeView;
                        setActiveView(view);

                        if (view === 'graph') {
                            void loadGraph();
                        }
                    }}
                    value={activeView}
                >
                    <TabsList className="grid w-full max-w-2xl grid-cols-4">
                        <TabsTrigger value="sources">情报源</TabsTrigger>
                        <TabsTrigger value="items">情报知识库</TabsTrigger>
                        <TabsTrigger value="internal">内部材料</TabsTrigger>
                        <TabsTrigger value="graph">关系图谱</TabsTrigger>
                    </TabsList>
                </Tabs>

                {activeView === 'sources' ? (
                    <Card>
                        <CardHeader className="flex-row items-start justify-between gap-4">
                            <div>
                                <CardTitle>采集来源</CardTitle>
                                <CardDescription>
                                    为智能体配置 KEV、NVD、ATT&CK、CWE、厂商公告与自定义数据源。
                                </CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {isLoading ? (
                                <div className="flex min-h-28 items-center justify-center">
                                    <Spinner variant="circle" />
                                </div>
                            ) : overview.sources.length === 0 ? (
                                <div className="border-border text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
                                    还没有采集来源
                                </div>
                            ) : (
                                overview.sources.map((source) => (
                                    <SourceRow
                                        key={source.id}
                                        onDelete={() => setSourceToDelete(source)}
                                        onScheduleChange={(schedule) => void updateSource(source, { schedule })}
                                        onSync={() => void syncOne(source)}
                                        onToggle={(enabled) => void updateSource(source, { enabled })}
                                        source={source}
                                        syncing={syncingSourceId === source.id}
                                    />
                                ))
                            )}
                        </CardContent>
                    </Card>
                ) : null}

                {activeView === 'items' ? (
                    <ThreatKnowledgeManager
                        isLoading={isLoading}
                        overview={overview}
                    />
                ) : null}

                {activeView === 'internal' ? (
                    <Card>
                        <CardHeader>
                            <CardTitle>提供给智能体的内部材料</CardTitle>
                            <CardDescription>
                                上传内部报告、通告、处置记录等材料，供智能体在任务中读取和分析。
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <input
                                className="hidden"
                                multiple
                                onChange={(event) => {
                                    void uploadInternalMaterials(Array.from(event.target.files ?? []));
                                    event.target.value = '';
                                }}
                                ref={fileInputRef}
                                type="file"
                            />
                            <button
                                className="border-border hover:bg-muted/40 flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 transition-colors"
                                disabled={upload.isUploading}
                                onClick={() => fileInputRef.current?.click()}
                                type="button"
                            >
                                <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
                                    {upload.isUploading ? <Spinner variant="circle" /> : <FileUp className="size-5" />}
                                </div>
                                <div className="text-sm font-medium">
                                    {upload.isUploading ? '正在上传材料……' : '选择文件上传'}
                                </div>
                                <div className="text-muted-foreground text-xs">单个文件最大 300 MB，每次最多 2 GB</div>
                            </button>
                            {internalMaterials.length > 0 ? (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {internalMaterials.slice(0, 12).map((file) => (
                                        <Badge
                                            key={file.id}
                                            variant="outline"
                                        >
                                            {file.name}
                                        </Badge>
                                    ))}
                                    {internalMaterials.length > 12 ? (
                                        <Badge variant="secondary">另有 {internalMaterials.length - 12} 个文件</Badge>
                                    ) : null}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                ) : null}

                {activeView === 'graph' ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Network className="size-5" />
                                多源情报知识图谱
                            </CardTitle>
                            <CardDescription>
                                展示 ATT&CK 技术与战术、组织与软件、缓解措施，以及 CVE 与 CWE 之间的真实关系。
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isGraphLoading ? (
                                <div className="flex h-72 items-center justify-center">
                                    <Spinner variant="circle" />
                                </div>
                            ) : graphError ? (
                                <div className="border-destructive/30 text-destructive flex h-72 items-center justify-center rounded-lg border border-dashed text-sm">
                                    {graphError}
                                </div>
                            ) : (
                                <IntelligenceKnowledgeGraph graph={graph} />
                            )}
                        </CardContent>
                    </Card>
                ) : null}
            </main>

            <Dialog
                onOpenChange={setIsAddOpen}
                open={isAddOpen}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>添加外部安全知识源</DialogTitle>
                        <DialogDescription>支持通用 JSON、RSS / Atom、STIX 2.x 和 MITRE CWE XML。</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="source-name">来源名称</Label>
                            <Input
                                id="source-name"
                                onChange={(event) => setSourceName(event.target.value)}
                                placeholder="例如：厂商安全公告"
                                value={sourceName}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="source-url">来源地址</Label>
                            <Input
                                id="source-url"
                                onChange={(event) => setSourceURL(event.target.value)}
                                placeholder="https://example.com/security-feed.json"
                                type="url"
                                value={sourceURL}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>数据格式</Label>
                                <Select
                                    onValueChange={(value) => setSourceFormat(value as typeof sourceFormat)}
                                    value={sourceFormat}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="auto">自动识别</SelectItem>
                                        <SelectItem value="json">JSON</SelectItem>
                                        <SelectItem value="rss">RSS / Atom</SelectItem>
                                        <SelectItem value="stix">STIX 2.x（ATT&CK）</SelectItem>
                                        <SelectItem value="cwe">MITRE CWE XML / ZIP</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>更新频率</Label>
                                <Select
                                    onValueChange={(value) => setSourceSchedule(value as Schedule)}
                                    value={sourceSchedule}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(scheduleLabels).map(([value, label]) => (
                                            <SelectItem
                                                key={value}
                                                value={value}
                                            >
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            disabled={isSavingSource}
                            onClick={() => void createSource()}
                        >
                            {isSavingSource ? <Spinner variant="circle" /> : <Plus />}添加来源
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmationDialog
                confirmText="删除"
                description="删除后，该来源已经获取的漏洞知识也会一并移除。"
                handleConfirm={async () => {
                    if (sourceToDelete) {
                        await deleteSource(sourceToDelete);
                    }
                }}
                handleOpenChange={(open) => {
                    if (!open) {
                        setSourceToDelete(null);
                    }
                }}
                isOpen={sourceToDelete !== null}
                itemName={sourceToDelete?.name}
                itemType="情报源"
                title="删除情报源"
            />
        </>
    );
}

function itemTypeLabel(type: string) {
    const labels: Record<string, string> = {
        advisory: '安全公告',
        campaign: '攻击活动',
        group: '攻击组织',
        mitigation: '缓解措施',
        software: '软件与工具',
        tactic: 'ATT&CK 战术',
        technique: 'ATT&CK 技术',
        vulnerability: '漏洞',
        weakness: 'CWE 弱点',
    };

    return labels[type] ?? type;
}

function ThreatKnowledgeManager({ isLoading, overview }: { isLoading: boolean; overview: IntelligenceOverview }) {
    const [query, setQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [pageIndex, setPageIndex] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const sourceById = useMemo(
        () => new Map(overview.sources.map((source) => [source.id, source])),
        [overview.sources],
    );
    const typeOptions = useMemo(() => {
        const counts = new Map<string, number>();

        for (const item of overview.items) {
            counts.set(item.item_type, (counts.get(item.item_type) ?? 0) + 1);
        }

        return [...counts.entries()].sort(([left], [right]) => itemTypeLabel(left).localeCompare(itemTypeLabel(right)));
    }, [overview.items]);
    const filteredItems = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();

        return overview.items.filter((item) => {
            if (sourceFilter !== 'all' && String(item.source_id) !== sourceFilter) {
                return false;
            }

            if (typeFilter !== 'all' && item.item_type !== typeFilter) {
                return false;
            }

            if (!normalizedQuery) {
                return true;
            }

            const sourceName = sourceById.get(item.source_id)?.name ?? '';
            const searchable = [item.external_id, item.cve_id, item.title, item.summary, item.weakness, sourceName]
                .join(' ')
                .toLocaleLowerCase();

            return searchable.includes(normalizedQuery);
        });
    }, [overview.items, query, sourceById, sourceFilter, typeFilter]);
    const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
    const safePageIndex = Math.min(pageIndex, pageCount - 1);
    const visibleItems = filteredItems.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize);
    const rangeStart = filteredItems.length === 0 ? 0 : safePageIndex * pageSize + 1;
    const rangeEnd = Math.min((safePageIndex + 1) * pageSize, filteredItems.length);
    const representedSources = new Set(overview.items.map((item) => item.source_id)).size;

    return (
        <Card>
            <CardHeader className="gap-4 border-b">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <BookOpen className="size-5" />
                            外部威胁情报知识库
                        </CardTitle>
                        <CardDescription className="mt-1.5">
                            知识库共 {overview.stats.items.toLocaleString()} 条；当前管理最近同步的{' '}
                            {overview.items.length} 条，覆盖 {representedSources} 个来源。
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">当前清单 {overview.items.length}</Badge>
                        <Badge variant="blue">来源 {representedSources}</Badge>
                        <Badge variant="secondary">关系 {overview.stats.relations.toLocaleString()}</Badge>
                    </div>
                </div>
                <div className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_13rem_13rem]">
                    <div className="relative">
                        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                        <Input
                            className="pl-9"
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPageIndex(0);
                            }}
                            placeholder="搜索编号、名称、摘要或关联标识"
                            value={query}
                        />
                    </div>
                    <Select
                        onValueChange={(value) => {
                            setSourceFilter(value);
                            setPageIndex(0);
                        }}
                        value={sourceFilter}
                    >
                        <SelectTrigger aria-label="按情报来源筛选">
                            <SelectValue placeholder="全部来源" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部来源</SelectItem>
                            {overview.sources.map((source) => (
                                <SelectItem
                                    key={source.id}
                                    value={String(source.id)}
                                >
                                    {source.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        onValueChange={(value) => {
                            setTypeFilter(value);
                            setPageIndex(0);
                        }}
                        value={typeFilter}
                    >
                        <SelectTrigger aria-label="按知识域筛选">
                            <SelectValue placeholder="全部知识域" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部知识域</SelectItem>
                            {typeOptions.map(([type, count]) => (
                                <SelectItem
                                    key={type}
                                    value={type}
                                >
                                    {itemTypeLabel(type)}（{count}）
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {typeOptions.map(([type, count]) => (
                        <Badge
                            key={type}
                            variant={typeFilter === type ? 'blue' : 'outline'}
                        >
                            {itemTypeLabel(type)} {count}
                        </Badge>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>情报对象</TableHead>
                            <TableHead className="w-[18rem]">数据来源</TableHead>
                            <TableHead className="hidden w-[15rem] lg:table-cell">关联线索</TableHead>
                            <TableHead className="w-16 text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {visibleItems.map((item) => {
                            const source = sourceById.get(item.source_id);
                            const identifier = item.external_id || item.cve_id || item.title;
                            const description = item.title && item.title !== identifier ? item.title : item.summary;
                            const clues = [...new Set([item.cve_id, item.weakness].filter(Boolean))].filter(
                                (value) => value !== identifier,
                            );

                            return (
                                <TableRow key={item.id}>
                                    <TableCell className="max-w-[42rem] py-4 align-top">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-sm font-semibold">{identifier}</span>
                                        </div>
                                        <div className="text-muted-foreground mt-1.5 line-clamp-2 text-xs leading-5">
                                            {description || '暂无说明'}
                                        </div>
                                    </TableCell>
                                    <TableCell className="py-4 align-top">
                                        <div className="text-sm font-medium">{source?.name ?? '未知来源'}</div>
                                        {source ? (
                                            <div className="text-muted-foreground mt-1 text-xs">
                                                {source.format.toUpperCase()} · 已收录{' '}
                                                {source.item_count.toLocaleString()} 条
                                            </div>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="hidden py-4 align-top lg:table-cell">
                                        {clues.length ? (
                                            <div className="flex flex-wrap gap-1.5">
                                                {clues.map((clue) => (
                                                    <Badge
                                                        key={clue}
                                                        variant="outline"
                                                    >
                                                        {clue}
                                                    </Badge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">暂无直接标识</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="py-4 text-right align-top">
                                        {item.source_url ? (
                                            <Button
                                                asChild
                                                size="icon-sm"
                                                variant="ghost"
                                            >
                                                <a
                                                    aria-label={`打开 ${identifier} 的原始来源`}
                                                    href={item.source_url}
                                                    rel="noreferrer"
                                                    target="_blank"
                                                >
                                                    <ExternalLink />
                                                </a>
                                            </Button>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {!isLoading && filteredItems.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    className="text-muted-foreground h-32 text-center"
                                    colSpan={4}
                                >
                                    {overview.items.length === 0
                                        ? '点击“更新智能体知识库”开始采集外部威胁情报'
                                        : '没有符合当前筛选条件的情报知识'}
                                </TableCell>
                            </TableRow>
                        ) : null}
                    </TableBody>
                </Table>
                {isLoading ? (
                    <div className="flex h-32 items-center justify-center">
                        <Spinner variant="circle" />
                    </div>
                ) : null}
                {!isLoading && filteredItems.length > 0 ? (
                    <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-muted-foreground text-xs">
                            显示 {rangeStart}–{rangeEnd}，共 {filteredItems.length} 条匹配结果
                        </div>
                        <div className="flex items-center gap-2">
                            <Select
                                onValueChange={(value) => {
                                    setPageSize(Number(value));
                                    setPageIndex(0);
                                }}
                                value={String(pageSize)}
                            >
                                <SelectTrigger
                                    aria-label="每页显示数量"
                                    className="h-8 w-24"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="20">20 条/页</SelectItem>
                                    <SelectItem value="50">50 条/页</SelectItem>
                                    <SelectItem value="100">100 条/页</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                aria-label="上一页"
                                disabled={safePageIndex === 0}
                                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                                size="icon-sm"
                                variant="outline"
                            >
                                <ChevronLeft />
                            </Button>
                            <span className="min-w-16 text-center text-xs">
                                {safePageIndex + 1} / {pageCount}
                            </span>
                            <Button
                                aria-label="下一页"
                                disabled={safePageIndex >= pageCount - 1}
                                onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                                size="icon-sm"
                                variant="outline"
                            >
                                <ChevronRight />
                            </Button>
                        </div>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}

// eslint-disable-next-line perfectionist/sort-modules
function sourceStatus(source: IntelligenceSource): { label: string; variant: BadgeVariant } {
    if (!source.enabled) {
        return { label: '已停用', variant: 'secondary' };
    }

    if (source.status === 'failed') {
        return { label: '获取失败', variant: 'red' };
    }

    if (source.status === 'syncing') {
        return { label: '获取中', variant: 'blue' };
    }

    if (source.status === 'ready') {
        return { label: '正常', variant: 'green' };
    }

    return { label: '待获取', variant: 'yellow' };
}

// Kept beside the source-management markup below; the knowledge manager above owns the larger tab section.
// eslint-disable-next-line perfectionist/sort-modules
function SourceRow({
    onDelete,
    onScheduleChange,
    onSync,
    onToggle,
    source,
    syncing,
}: {
    onDelete: () => void;
    onScheduleChange: (schedule: Schedule) => void;
    onSync: () => void;
    onToggle: (enabled: boolean) => void;
    source: IntelligenceSource;
    syncing: boolean;
}) {
    const status = sourceStatus(source);

    return (
        <div className="border-border flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{source.name}</span>
                    {source.builtin ? <Badge variant="blue">内置</Badge> : null}
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Badge variant="outline">{source.item_count} 条</Badge>
                </div>
                {source.description ? (
                    <div className="text-muted-foreground mt-1 text-xs">{source.description}</div>
                ) : null}
                <div className="text-muted-foreground mt-1 truncate text-xs">{source.url}</div>
                {source.last_error ? (
                    <div className="text-destructive mt-2 flex items-center gap-1 text-xs">
                        <AlertTriangle className="size-3.5" />
                        {source.last_error}
                    </div>
                ) : (
                    <div className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
                        <CalendarClock className="size-3.5" />
                        上次更新：{formatDate(source.last_sync_at)}
                    </div>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    disabled={!source.enabled}
                    onValueChange={(value) => onScheduleChange(value as Schedule)}
                    value={source.schedule}
                >
                    <SelectTrigger className="w-28">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(scheduleLabels).map(([value, label]) => (
                            <SelectItem
                                key={value}
                                value={value}
                            >
                                {label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Switch
                    aria-label={`${source.name}启用状态`}
                    checked={source.enabled}
                    onCheckedChange={onToggle}
                />
                <Button
                    disabled={syncing}
                    onClick={onSync}
                    size="icon"
                    variant="outline"
                >
                    {syncing ? <Spinner variant="circle" /> : <RefreshCw />}
                    <span className="sr-only">更新智能体知识库</span>
                </Button>
                <Button
                    aria-label="删除来源"
                    disabled={source.builtin}
                    onClick={onDelete}
                    size="icon"
                    title={source.builtin ? '内置来源可以停用，但不能删除' : '删除来源'}
                    variant="ghost"
                >
                    <Trash2 />
                </Button>
            </div>
        </div>
    );
}

export default Intelligence;
