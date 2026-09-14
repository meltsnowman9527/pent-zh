import type { ReactNode } from 'react';

import { skipToken, useQuery } from '@apollo/client/react';
import { ChevronDown, Ellipsis, FileSymlink, FileText, LayoutTemplate, Pencil, Save, Trash } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { AppHeader, AppHeaderAction, AppHeaderActions, AppHeaderContent } from '@/components/layouts/app/app-header';
import ConfirmationDialog from '@/components/shared/confirmation-dialog';
import {
    DetailNavigationButtons,
    DetailNavigationSheet,
    DetailNavigationToolbar,
} from '@/components/shared/detail-navigation';
import { DetailSplitLayout } from '@/components/shared/detail-split-layout';
import { ErrorState } from '@/components/shared/error-state';
import { InlineEditInput, useInlineEdit } from '@/components/shared/inline-edit';
import { type EditorViewMode, EditorViewModeToggle, MarkdownEditorField } from '@/components/shared/markdown-editor';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/shared/unsaved-changes';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTemplateDetailNavigation } from '@/features/templates/use-template-detail-navigation';
import { FlowTemplateDocument } from '@/graphql/types';
import { useAppForm } from '@/hooks/use-app-form';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { isNotFoundError } from '@/lib/errors';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { uiText } from '@/locales/zh-CN';
import { type Template, useTemplates } from '@/providers/templates-provider';

const formSchema = z.object({
    text: z
        .string()
        .trim()
        .min(1, { message: uiText('Text is required') }),
    title: z
        .string()
        .trim()
        .min(1, { message: uiText('Title is required') }),
});

type FormValues = z.infer<typeof formSchema>;

const PRESETS_TITLE = uiText('Preset templates');

const PRESET_TEMPLATES: { text: string; title: string }[] = [
    {
        text: `对 Web 应用执行全面的安全测试：{{TARGET_URL}}

行动方案：
1. 应用探查：遍历全部页面与功能，梳理接口与输入点
2. 逐接口漏洞测试：
   - 路径穿越：尝试读取 /etc/passwd，重点关注文件下载/上传功能
   - XSS：注入唯一标记，扫描响应，构造符合上下文的 payload
   - SQL 注入：对输入使用 sqlmap，必要时用 tamper 脚本绕过 WAF
   - 命令注入：用时间盲注检测，尝试 commix
   - SSRF：用 Interactsh 做带外验证，重点关注文件上传/PDF 生成接口
   - XXE：测试 XML 上传与 Office 文档
   - 不安全文件上传：测试可执行扩展名、双扩展名与空字节注入
   - CSRF：测试令牌校验与 POST 转 GET
3. 认证与会话：测试认证缺陷、会话固定与弱口令策略
4. 业务逻辑：识别越权、价格篡改与流程绕过
5. 报告：记录全部发现，附复现步骤与验证性利用证据`,
        title: 'Web 应用安全测试',
    },
    {
        text: `对目标网络执行基础设施侦察：{{TARGET_NETWORK}}

行动方案：
1. 网络发现：用 nmap ping 扫描识别存活主机，绘制网络拓扑
2. 端口扫描：全端口扫描（1-65535），识别所有开放服务
3. 服务枚举：识别服务版本与操作系统信息
4. 漏洞扫描：对发现的服务执行自动化漏洞扫描
5. SSL/TLS 分析：检查证书有效性、弱加密套件与协议漏洞
6. 服务指纹抓取：收集详细服务信息用于后续利用研究
7. 网络拓扑图：绘制已发现基础设施的可视化地图
8. 报告：按优先级列出主机、服务与潜在攻击路径`,
        title: '网络基础设施发现与测绘',
    },
    {
        text: `对指定域执行 Active Directory 安全测试：{{DOMAIN_NAME}}

行动方案：
1. 初始访问：测试密码喷洒、AS-REP roasting 与 Kerberoastable 账户
2. 域枚举：枚举用户、组、计算机、GPO 与信任关系
3. 权限提升：识别配置错误的 ACL、可利用的组成员关系与委派问题
4. 凭据收集：在 SYSVOL 中查找凭据、检查 AD 属性中的口令，条件允许时导出 NTDS.dit
5. 横向移动：测试 pass-the-hash、pass-the-ticket 与 overpass-the-hash
6. 持久化：识别黄金票据、白银票据与 DCSync 权限的利用机会
7. 域管路径：绘制从当前权限到域管理员的攻击路径
8. 报告：记录攻击链、失陷账户与 AD 配置中的安全缺口`,
        title: 'Active Directory 渗透测试',
    },
    {
        text: `对 API 执行全面的安全测试：{{API_BASE_URL}}

行动方案：
1. API 发现：梳理所有接口、HTTP 方法与参数
2. 认证测试：测试认证缺陷、令牌篡改与 JWT 漏洞
3. 授权测试：测试对象级授权缺陷（BOLA/IDOR）与功能级授权绕过
4. 输入校验：测试注入类攻击（SQL、NoSQL、命令、XXE）与批量赋值漏洞
5. 速率限制：测试是否缺少限流与暴力破解防护
6. 业务逻辑：测试过度数据暴露、缺少资源限制与 API 不安全消费
7. 安全配置：检查 CORS 策略、安全响应头与详细报错信息
8. GraphQL 专项（如适用）：测试 introspection、查询深度限制与批量攻击
9. 报告：记录 API 漏洞并附 curl/Postman 复现证据`,
        title: 'API 安全测试',
    },
    {
        text: `对 AWS 基础设施执行安全审计：{{AWS_ACCOUNT_ID or DOMAIN}}

行动方案：
1. 侦察：识别 S3 存储桶、EC2 实例与公网端点，并通过 DNS 枚举服务
2. S3 安全：测试存储桶权限、公开访问、ACL 配置错误与桶策略
3. IAM 评估：审查角色与策略，检查权限过大与长期未使用的凭据
4. EC2 安全：扫描开放的安全组，测试实例元数据服务（169.254.169.254）与 IMDSv2
5. 网络安全：审查 VPC 配置、安全组、NACL 与公网子网
6. 数据库暴露：检查 RDS 公网可访问性、安全组与加密设置
7. Lambda：测试函数 URL 暴露、环境变量泄漏与 IAM 角色权限
8. CloudTrail 与日志：确认日志已启用，检查安全监控盲区
9. 报告：按优先级给出云安全发现与 AWS 专项整改建议`,
        title: '云基础设施安全审计（AWS）',
    },
    {
        text: `对 WordPress 站点执行安全测试：{{WORDPRESS_URL}}

行动方案：
1. 版本识别：识别 WordPress 核心版本、主题与已启用插件
2. 插件漏洞：枚举已安装插件，用 WPScan 与 Sploitus 检查已知 CVE
3. 主题漏洞：识别主题版本并检索已知利用
4. 用户枚举：通过 REST API、作者归档与登录响应枚举有效用户名
5. 认证测试：测试弱口令、暴力破解防护与双因素绕过
6. 文件上传：测试媒体上传限制与任意文件上传漏洞
7. XML-RPC：检查是否启用，测试 pingback SSRF 与暴力破解放大
8. SQL 注入：测试搜索功能、自定义查询参数与插件输入点
9. XSS 测试：测试评论、搜索、联系表单与自定义字段
10. 配置问题：检查 wp-config.php 暴露、目录列举与敏感文件访问
11. 报告：记录 WordPress 专项漏洞与利用步骤`,
        title: 'WordPress 安全测试',
    },
    {
        text: `对组织执行外部攻击面评估：{{ORGANIZATION_NAME or DOMAIN}}

行动方案：
1. 资产发现：枚举域名、子域（subfinder、amass）、IP 段与 ASN 信息
2. 证书透明度：检索 crt.sh 发现子域与被遗忘的资产
3. 端口扫描：扫描所有已发现资产的开放端口与服务
4. Web 指纹识别：识别技术栈、CMS、框架与服务器版本
5. 邮件安全：测试 SPF、DKIM、DMARC 记录与邮件伪造可能性
6. 云资产发现：检索暴露的 S3 桶、Azure Blob 与公网数据库
7. 敏感数据暴露：在 GitHub、GitLab、Pastebin 检索泄漏的凭据与 API Key
8. 第三方集成：识别 SaaS 应用、API 端点与合作伙伴集成
9. 漏洞优先级：识别面向互联网的关键漏洞
10. 报告：给出完整的外部攻击面地图与按风险排序的发现`,
        title: '外部攻击面评估',
    },
    {
        text: `从当前立足点执行内网渗透测试：{{INITIAL_ACCESS_LEVEL}}

行动方案：
1. 网络侦察：ARP 扫描，识别网段并绘制内网架构
2. 服务发现：对内网主机全端口扫描，识别关键服务器
3. SMB/NetBIOS 枚举：测试空会话、枚举共享与匿名访问
4. 凭据攻击：LLMNR/NBT-NS 投毒（Responder）、中继攻击与密码喷洒
5. 漏洞利用：利用未修补服务、默认凭据与已知 CVE
6. 权限提升：利用本地漏洞、配置错误的服务与弱权限
7. 横向移动：pass-the-hash、令牌模拟与信任关系利用
8. 数据外带：定位敏感数据位置，测试数据防泄漏控制
9. 持久化：建立持久访问机制
10. 报告：记录内网安全现状、攻击路径可视化与整改优先级`,
        title: '内网渗透测试',
    },
    {
        text: `对移动应用的后端 API 执行安全测试：{{API_URL}}

行动方案：
1. 流量分析：分析 App 流量，提取 API 端点与认证方式
2. 认证机制：测试 OAuth 流程、JWT 实现、刷新令牌处理与证书绑定绕过
3. 接口测试：对已发现接口测试 BOLA/IDOR 与功能级授权缺陷
4. 数据校验：测试 API 参数的注入攻击与文件上传接口
5. 业务逻辑：测试会员功能绕过、订阅校验与应用内购买校验
6. 会话管理：测试令牌过期、并发会话处理与会话固定
7. 敏感数据：检查个人信息暴露、响应中过多数据与硬编码密钥
8. 速率限制：测试登录暴力破解防护、API 限流与账号锁定
9. 深链：测试深链劫持、Intent 重定向（Android）与 URL Scheme 滥用（iOS）
10. 报告：记录移动端专项漏洞与缓解建议`,
        title: '移动应用安全测试（后端 API）',
    },
    {
        text: `评估 DevOps 基础设施与 CI/CD 流水线安全：{{ORGANIZATION}}

行动方案：
1. 代码仓库安全：扫描 GitHub/GitLab 提交历史中的密钥、API Key 与凭据
2. CI/CD 配置：审查 Jenkins/GitLab CI/GitHub Actions 配置，测试流水线定义中的注入
3. 容器安全：扫描 Docker 镜像漏洞，测试容器逃逸，检查镜像来源
4. 密钥管理：测试密钥存储（HashiCorp Vault、AWS Secrets Manager），检查硬编码密钥
5. 访问控制：审查仓库权限、流水线访问、部署密钥与服务账号
6. 制品安全：扫描构建产物，测试制品仓库访问控制（Nexus、Artifactory）
7. Kubernetes 安全：审查 Pod 安全策略、RBAC、网络策略与暴露的 Dashboard
8. 基础设施即代码：审查 Terraform/Ansible 的配置错误与权限过大的 IAM 角色
9. 监控与日志：确认安全日志，测试日志篡改，检查监控盲区
10. 报告：给出 DevOps 安全发现与安全流水线建议`,
        title: 'DevOps 与 CI/CD 流水线安全',
    },
    {
        text: `对数据库执行安全评估：{{DATABASE_TYPE}}，地址 {{HOST:PORT}}

行动方案：
1. 访问测试：测试默认凭据、弱口令与匿名访问
2. 网络暴露：确认数据库不应面向互联网，检查防火墙规则
3. 认证：测试认证机制、用户枚举与口令策略
4. 授权：审查用户权限，测试权限提升与过大授权
5. 注入测试：应用层 SQL 注入，测试存储过程注入
6. 配置审查：检查危险配置项（xp_cmdshell、LOAD DATA、file_priv）
7. 加密：确认静态数据加密与连接 SSL/TLS，检查明文敏感数据
8. 备份安全：测试备份文件访问、备份加密与恢复流程
9. 审计日志：确认审计日志已启用，测试日志篡改与保留策略
10. 报告：给出数据库专项安全发现与加固建议`,
        title: '数据库安全评估',
    },
];

const renderTemplateItem = (item: Template, isCurrent: boolean): ReactNode => (
    <span className={cn('min-w-0 flex-1 truncate', isCurrent && 'font-medium')}>{item.title}</span>
);

// One React element serves every `/templates/:templateId`, so without a key the form instance — which sets
// `keepDirtyValues` so a subscription resync cannot wipe an unsaved body — carried one template's edited text
// onto the next template and Save wrote it to the wrong row. Keying by id gives each entity its own form, the
// way knowledge.tsx already keys <KnowledgeForm>. It also stops `/templates/new` inheriting an abandoned draft.
function Template() {
    const { templateId } = useParams<{ templateId?: string }>();

    return (
        <TemplateForm
            key={templateId ?? 'new'}
            templateId={templateId}
        />
    );
}

function TemplateForm({ templateId }: { templateId?: string }) {
    const navigate = useNavigate();
    const { createTemplate, deleteTemplate, updateTemplate } = useTemplates();

    const { isDesktop, isMobile } = useBreakpoint();
    const isNew = templateId === 'new';

    const templateNav = useTemplateDetailNavigation(isNew ? null : templateId);

    const [expandedPresetIndex, setExpandedPresetIndex] = useState<null | number>(null);
    const [isPresetsOpen, setIsPresetsOpen] = useState(false);
    const [isReplaceConfirmOpen, setIsReplaceConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [pendingPreset, setPendingPreset] = useState<null | { text: string; title: string }>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [viewMode, setViewMode] = useState<EditorViewMode>('rich');

    const {
        handleDropdownCloseAutoFocus,
        inputRef: editingInputRef,
        isEditing: isEditingTitle,
        startEdit: handleTemplateRenameStart,
        stopEdit: handleTemplateRenameCancel,
    } = useInlineEdit({ resetKey: templateId });

    const {
        data: templateData,
        error: templateError,
        loading: isLoadingTemplate,
        refetch: refetchTemplate,
    } = useQuery(FlowTemplateDocument, templateId && !isNew ? { variables: { templateId } } : skipToken);

    const template = templateData?.flowTemplate;
    // A real load failure that left nothing to show, as opposed to a genuine not-found: the page
    // renders it as an in-page ErrorState + Retry instead of the "not found" card. Mirrors flow.
    const templateLoadError = templateError && !template && !isNotFoundError(templateError) ? templateError : undefined;

    // `values` re-syncs the form whenever the cache refreshes (an inline rename, a refetch), while
    // `keepDirtyValues` preserves the user's in-flight edits — without it an external re-emit would
    // silently wipe an unsaved body. Mirrors knowledge-form.
    const initialValues = useMemo<FormValues>(
        () => ({
            text: templateData?.flowTemplate?.text ?? '',
            title: templateData?.flowTemplate?.title ?? '',
        }),
        [templateData?.flowTemplate],
    );

    const form = useAppForm<FormValues>({
        defaultValues: initialValues,
        resetOptions: { keepDirtyValues: true },
        schema: formSchema,
        values: initialValues,
    });

    const { control, formState, getValues, handleSubmit: handleFormSubmit, reset, setValue } = form;
    const { isDirty, isValid } = formState;

    const hasUnsavedChanges = isDirty;
    const templateName = templateData?.flowTemplate?.title ?? null;

    const handleTemplateRenameSave = useCallback(async () => {
        const newTitle = editingInputRef.current?.value.trim();
        const template = templateData?.flowTemplate;

        if (!templateId || !newTitle || !template) {
            return;
        }

        if (newTitle === template.title) {
            handleTemplateRenameCancel();

            return;
        }

        setIsRenaming(true);

        try {
            // Send the server's current `text`, not the form's, so renaming the title never persists the
            // user's unsaved body edits — those stay dirty in the form (kept by `keepDirtyValues`) until they save.
            await updateTemplate(templateId, { text: template.text, title: newTitle });
            toast.success(uiText('Template renamed successfully'));
            handleTemplateRenameCancel();
        } catch {
            // Error already handled in provider with toast
        } finally {
            setIsRenaming(false);
        }
    }, [editingInputRef, handleTemplateRenameCancel, templateId, templateData?.flowTemplate, updateTemplate]);

    const handleTemplateDelete = useCallback(async () => {
        if (!templateId) {
            return;
        }

        setIsDeleting(true);

        try {
            await deleteTemplate(templateId);
            navigate(routes.templates, { replace: true });
        } catch {
            // Error already handled in provider with toast
        } finally {
            setIsDeleting(false);
        }
    }, [templateId, deleteTemplate, navigate]);

    const performSave = useCallback(
        async (values: FormValues): Promise<boolean> => {
            setIsSaving(true);

            try {
                if (isNew) {
                    await createTemplate(values.title, values.text);
                } else if (templateId) {
                    await updateTemplate(templateId, { text: values.text, title: values.title });
                    // See knowledge-form.tsx: the form-level `resetOptions` are merged into every manual
                    // reset, so a post-save reset inherits `keepDirtyValues` unless it opts out.
                    reset(values, { keepDefaultValues: false, keepDirtyValues: false });
                }

                return true;
            } catch {
                // Error already handled in provider with toast
                return false;
            } finally {
                setIsSaving(false);
            }
        },
        [isNew, templateId, createTemplate, updateTemplate, reset],
    );

    const handleSaveFromGuard = useCallback(async (): Promise<boolean> => {
        if (isSaving || !isValid) {
            return false;
        }

        const parsed = formSchema.safeParse(getValues());

        return parsed.success ? performSave(parsed.data) : false;
    }, [getValues, isSaving, isValid, performSave]);

    const guard = useUnsavedChangesGuard({
        isDirty,
        isFormValid: isValid,
        onSave: handleSaveFromGuard,
    });

    const handleSubmit = async (values: FormValues) => {
        if (isSaving) {
            return;
        }

        if ((await performSave(values)) && isNew) {
            // A fresh template stays dirty until we leave; skip the guard's blocker so this post-save
            // navigation doesn't trap the user in the unsaved-changes dialog.
            guard.skipNextBlock();
            navigate(routes.templates);
        }
    };

    const handleApplyPreset = useCallback(
        (preset: { text: string; title: string }) => {
            const current = getValues();
            const hasContent = (current.title?.trim().length ?? 0) > 0 || (current.text?.trim().length ?? 0) > 0;

            if (hasContent) {
                setPendingPreset(preset);
                setIsReplaceConfirmOpen(true);
            } else {
                setValue('title', preset.title, { shouldDirty: true, shouldValidate: true });
                setValue('text', preset.text, { shouldDirty: true, shouldValidate: true });
            }
        },
        [getValues, setValue],
    );

    const handleConfirmReplacePreset = useCallback(() => {
        if (pendingPreset) {
            setValue('title', pendingPreset.title, { shouldDirty: true, shouldValidate: true });
            setValue('text', pendingPreset.text, { shouldDirty: true, shouldValidate: true });
            setPendingPreset(null);
        }
    }, [pendingPreset, setValue]);

    const hasTemplate = !!templateData?.flowTemplate;
    const isTemplatePending = !isNew && !hasTemplate;
    const isTemplateMissing = !isNew && !isLoadingTemplate && !hasTemplate;

    const pageHeader = (
        <>
            <AppHeader>
                <AppHeaderContent>
                    <Breadcrumb className="min-w-0 flex-1">
                        <BreadcrumbList className="min-w-0 flex-nowrap">
                            <BreadcrumbItem className="min-w-0 gap-2">
                                {isEditingTitle && hasTemplate ? (
                                    <InlineEditInput
                                        busy={isRenaming}
                                        className="w-64 max-w-full min-w-0 flex-1"
                                        defaultValue={templateName ?? ''}
                                        inputRef={editingInputRef}
                                        onCancel={handleTemplateRenameCancel}
                                        onSave={handleTemplateRenameSave}
                                        placeholder={uiText('Template title')}
                                    />
                                ) : hasTemplate ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <BreadcrumbPage
                                                className="max-w-64 min-w-0 cursor-text truncate select-none"
                                                onDoubleClick={handleTemplateRenameStart}
                                            >
                                                {templateName ?? uiText('Template')}
                                            </BreadcrumbPage>
                                        </TooltipTrigger>
                                        <TooltipContent>{uiText('Double-click to rename')}</TooltipContent>
                                    </Tooltip>
                                ) : (
                                    <BreadcrumbPage className="min-w-0 truncate">
                                        {isNew ? uiText('New template') : (templateName ?? uiText('Template'))}
                                    </BreadcrumbPage>
                                )}
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                </AppHeaderContent>
                {!isTemplateMissing && (
                    <AppHeaderActions>
                        {!isNew && !isMobile && (
                            <DetailNavigationToolbar<Template>
                                controller={templateNav}
                                renderItem={renderTemplateItem}
                                sheetIcon={<FileText className="size-4" />}
                                sheetTitle={uiText('Templates')}
                            />
                        )}
                        <AppHeaderAction
                            disabled={isTemplatePending || (!isNew && !hasUnsavedChanges)}
                            form="template-form"
                            icon={<Save />}
                            label={isNew ? uiText('Create') : uiText('Save')}
                            loading={isSaving}
                            type="submit"
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    aria-label={uiText('Template actions')}
                                    className="size-8 p-0"
                                    variant="ghost"
                                >
                                    <Ellipsis />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                className="min-w-24"
                                onCloseAutoFocus={handleDropdownCloseAutoFocus}
                            >
                                {!isNew && (
                                    <>
                                        {isMobile && (
                                            <>
                                                <DropdownMenuItem
                                                    className="cursor-default hover:bg-transparent focus:bg-transparent"
                                                    onSelect={(event) => event.preventDefault()}
                                                >
                                                    <FileText />
                                                    {uiText('Templates')}
                                                    <div className="-my-1.5 -mr-2 ml-auto flex items-center">
                                                        <DetailNavigationButtons<Template>
                                                            controller={templateNav}
                                                            sheetTitle={uiText('Templates')}
                                                            size="sm"
                                                        />
                                                    </div>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                            </>
                                        )}
                                        <DropdownMenuItem
                                            disabled={isTemplatePending}
                                            onClick={handleTemplateRenameStart}
                                        >
                                            <Pencil />
                                            {uiText('Rename')}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                )}
                                <DropdownMenuItem
                                    className="cursor-default gap-4 hover:bg-transparent focus:bg-transparent"
                                    onSelect={(event) => event.preventDefault()}
                                >
                                    {uiText('View')}
                                    <EditorViewModeToggle
                                        className="-my-1.5 -mr-2 ml-auto"
                                        mode={viewMode}
                                        onModeChange={setViewMode}
                                        rawTooltip={uiText('Edit the raw template')}
                                    />
                                </DropdownMenuItem>
                                {!isNew && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            disabled={isDeleting || isTemplatePending}
                                            onClick={() => setIsDeleteDialogOpen(true)}
                                        >
                                            {isDeleting ? (
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
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </AppHeaderActions>
                )}
            </AppHeader>
            {isMobile && !isNew && (
                <DetailNavigationSheet<Template>
                    controller={templateNav}
                    renderItem={renderTemplateItem}
                    sheetIcon={<FileText className="size-4" />}
                    sheetTitle={uiText('Templates')}
                />
            )}
        </>
    );

    const presetsList = (onApplied?: () => void) => (
        <div className="flex w-full min-w-0 flex-col gap-2 p-2">
            {PRESET_TEMPLATES.map((preset, index) => (
                <Collapsible
                    className="w-full min-w-0"
                    key={index}
                    onOpenChange={(open) => setExpandedPresetIndex(open ? index : null)}
                    open={expandedPresetIndex === index}
                >
                    <Card className="w-full min-w-0">
                        <div className="flex w-full min-w-0">
                            <Button
                                className={cn(
                                    'h-auto min-w-0 flex-1 justify-start rounded-none rounded-tl-[0.6875rem] px-3 py-2 text-left text-start',
                                    expandedPresetIndex !== index ? 'rounded-bl-[0.6875rem]' : 'whitespace-normal',
                                )}
                                onClick={() => {
                                    handleApplyPreset(preset);
                                    onApplied?.();
                                }}
                                variant="ghost"
                            >
                                <span className={cn('min-w-0', expandedPresetIndex !== index && 'truncate')}>
                                    {preset.title}
                                </span>
                            </Button>
                            <CollapsibleTrigger asChild>
                                <Button
                                    aria-label={uiText('Show details for {name}', { name: preset.title })}
                                    className={cn(
                                        'h-auto shrink-0 rounded-none rounded-tr-[0.6875rem] border-l px-2 py-2',
                                        expandedPresetIndex !== index && 'rounded-br-[0.6875rem]',
                                    )}
                                    variant="ghost"
                                >
                                    <ChevronDown
                                        className={cn(
                                            'transition-transform',
                                            expandedPresetIndex === index && 'rotate-180',
                                        )}
                                    />
                                </Button>
                            </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent>
                            <CardContent className="border-t px-3 py-2">
                                <p className="text-muted-foreground text-sm break-words whitespace-pre-wrap">
                                    {preset.text}
                                </p>
                            </CardContent>
                        </CollapsibleContent>
                    </Card>
                </Collapsible>
            ))}
        </div>
    );

    const presetsPanel = isDesktop ? (
        <div className="bg-card overflow-hidden rounded-lg border">
            <div className="border-b px-4 py-3">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                    {PRESETS_TITLE}
                    <Badge
                        className="ml-auto font-normal tabular-nums"
                        variant="secondary"
                    >
                        {PRESET_TEMPLATES.length}
                    </Badge>
                </h4>
                <p className="text-muted-foreground mt-1 text-xs">
                    {uiText('Click a preset to fill the form, or expand it to preview the content.')}
                </p>
            </div>
            {presetsList()}
        </div>
    ) : (
        <Popover
            onOpenChange={setIsPresetsOpen}
            open={isPresetsOpen}
        >
            <PopoverTrigger asChild>
                <Button
                    className="w-full justify-start"
                    size="sm"
                    variant="secondary"
                >
                    <LayoutTemplate />
                    {PRESETS_TITLE}
                    <Badge
                        className="ml-auto h-5 font-normal tabular-nums"
                        variant="outline"
                    >
                        {PRESET_TEMPLATES.length}
                    </Badge>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) overflow-y-auto overscroll-contain p-0"
            >
                {presetsList(() => setIsPresetsOpen(false))}
            </PopoverContent>
        </Popover>
    );

    const introBlock = (
        <div className="flex flex-col gap-2 text-center">
            <h2 className="text-2xl font-semibold">
                {isNew ? uiText('Create a new template') : uiText('Edit template')}
            </h2>
            <p className="text-muted-foreground">{uiText('Add a title and content, or start from a preset.')}</p>
        </div>
    );

    const titleField = (
        <FormField
            control={control}
            name="title"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{uiText('Title')}</FormLabel>
                    <FormControl>
                        <Input
                            autoFocus={isNew}
                            disabled={isSaving}
                            placeholder={uiText('A short name for this template')}
                            {...field}
                        />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );

    const textEditor = (
        <FormField
            control={control}
            name="text"
            render={({ field }) => (
                <FormItem className="flex min-h-0 flex-1 flex-col">
                    <FormControl>
                        <MarkdownEditorField
                            aria-label={uiText('Template content')}
                            disabled={isSaving}
                            mode={viewMode}
                            onBlur={field.onBlur}
                            onChange={field.onChange}
                            placeholder={uiText('Describe the task, or start from a preset')}
                            ref={field.ref}
                            value={field.value}
                        />
                    </FormControl>
                    {/* Full-height field: the invalid state shows as the editor's red border (via aria-invalid),
                        not text below it (no room in the flex layout). Kept sr-only for screen readers. */}
                    <FormMessage className="sr-only" />
                </FormItem>
            )}
        />
    );

    if (!isNew && isLoadingTemplate && !template) {
        return (
            <div className={isDesktop ? 'flex h-[100dvh] min-h-0 flex-col' : 'flex min-h-[100dvh] flex-col'}>
                {pageHeader}
                <div className="flex flex-1 items-center justify-center">
                    <Spinner variant="circle" />
                </div>
            </div>
        );
    }

    if (templateLoadError) {
        return (
            <div className={isDesktop ? 'flex h-[100dvh] min-h-0 flex-col' : 'flex min-h-[100dvh] flex-col'}>
                {pageHeader}
                <div className="flex flex-1 flex-col gap-4 p-4">
                    <ErrorState
                        message={templateLoadError.message}
                        onRetry={() => refetchTemplate()}
                        title={uiText('Error loading template')}
                    />
                </div>
            </div>
        );
    }

    if (!isNew && !isLoadingTemplate && !template) {
        return (
            <div className={isDesktop ? 'flex h-[100dvh] min-h-0 flex-col' : 'flex min-h-[100dvh] flex-col'}>
                {pageHeader}
                <div className="flex flex-1 items-center justify-center p-4">
                    <Card className="w-full max-w-2xl">
                        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
                            <h2 className="text-xl font-semibold">{uiText('Template not found')}</h2>
                            <p className="text-muted-foreground">
                                {uiText('The template you are looking for does not exist.')}
                            </p>
                            <Button onClick={() => navigate(routes.templates)}>{uiText('Back to Templates')}</Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className={isDesktop ? 'flex h-[100dvh] min-h-0 flex-col' : 'flex min-h-[100dvh] flex-col'}>
            {pageHeader}
            <Form {...form}>
                <form
                    className="flex min-h-0 flex-1 flex-col"
                    id="template-form"
                    noValidate
                    onSubmit={handleFormSubmit(handleSubmit)}
                >
                    {isDesktop ? (
                        <DetailSplitLayout
                            content={textEditor}
                            panel={
                                <>
                                    {introBlock}
                                    {titleField}
                                    {presetsPanel}
                                </>
                            }
                        />
                    ) : (
                        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                            {introBlock}
                            {titleField}
                            {presetsPanel}
                            {textEditor}
                        </div>
                    )}
                </form>
            </Form>
            <ConfirmationDialog
                confirmIcon={<FileSymlink />}
                confirmText={uiText('Replace')}
                confirmVariant="default"
                description={uiText('Current form has content. Replace with the selected preset?')}
                handleConfirm={handleConfirmReplacePreset}
                handleOpenChange={(open) => {
                    if (!open) {
                        setPendingPreset(null);
                    }

                    setIsReplaceConfirmOpen(open);
                }}
                isOpen={isReplaceConfirmOpen}
                title={uiText('Replace content?')}
            />
            <ConfirmationDialog
                cancelText={uiText('Cancel')}
                confirmText={uiText('Delete')}
                handleConfirm={handleTemplateDelete}
                handleOpenChange={setIsDeleteDialogOpen}
                isOpen={isDeleteDialogOpen}
                itemName={templateName ?? undefined}
                itemType={uiText('template')}
            />
            <UnsavedChangesDialog
                canSave={isValid}
                handleCancel={guard.handleCancel}
                handleDiscard={guard.handleDiscard}
                handleOpenChange={guard.handleOpenChange}
                handleSaveAndLeave={guard.handleSaveAndLeave}
                isOpen={guard.isOpen}
                isSavingFromDialog={guard.isSavingFromDialog}
            />
        </div>
    );
}

export default Template;
