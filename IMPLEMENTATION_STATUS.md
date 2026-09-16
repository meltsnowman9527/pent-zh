# 当前改造进度

## 本批范围

只完善任务查询阻塞修复与前端中文化，不新增五阶段业务模块。

- P0 第 3、5 条（本次新增）：新增 `flow_jobs` 持久作业表（迁移 `20260913_180000_flow_jobs`，含 `flow_jobs_flow_idx`、`flow_jobs_pending_idx` 与 `(flow_id, kind)` 的部分唯一索引）。创建任务改为**先落库再返回**：请求内只做一次 `flows` 插入和一次作业插入，随后的模型探测、工具执行器与容器准备全部交给后台作业执行器；删除（结束任务流程）同样先入队，清理完成前不返回"已完成"。停止（中断）仍是请求内等待，但同样写入作业记录。
- P0 第 3 条（分段耗时与关联标识）：每个作业带 `correlation_id`（如 `create-1a2b3c4d`），`segments` 记录 db / provider（模型响应）/ workers / docker（容器准备）/ publish / input 各段的毫秒数，每完成一段就写回作业行；成功与失败各输出一条带全部分段的结构化日志，可直接按 correlation_id 检索。
- P0 第 5 条（重试与恢复）：作业最多尝试 3 次，失败按次数线性退避后重新入队，失败原因写入作业行；启动时把上次进程遗留的 `running` 作业改回 `queued` 并继续执行（`RecoverInterruptedFlowJobs`），执行器只依赖作业行与 payload，不依赖进程内状态。创建最终失败时把流程置为 `failed` 并保留该行（不静默删除），同时推送一次 `FlowUpdated`，让界面能看到失败而不是"什么都没发生"。
- P0 第 5 条（重复提交）：同一用户在 30 秒窗口内提交相同任务文本与相同模型服务时复用正在初始化的那个流程；数据库侧 `(flow_id, kind)` 部分唯一索引让并发重复作业直接失败，不会执行两次清理或两次初始化。

- 将任务控制器的生命周期操作锁与任务注册表锁分离。模型初始化、停止和清理等待期间，任务列表和查询可以继续响应。写操作仍按原顺序执行，本批不承诺缩短模型响应时间或完成全部异步任务调度。
- 并发测试覆盖创建自动任务、创建交互助手、停止、结束、重命名期间的查询响应，另验证结束失败后可重试及并发结束不会重复关闭任务。
- 中文化分批推进，设置区已整体完成：
  - 第一批：主侧栏、登录、修改密码、新建任务页、任务输入表单、模板与资源选择器、密码可见性、侧栏图标提示，以及任务操作的默认通知。
  - 第二批：设置区侧栏、账户页、模型服务列表页；表格组件（空状态、筛选框、列选择、分页、每页行数）与确认对话框（含文件覆盖确认），并同步更新全部对话框调用方传入中文操作名与对象名。
  - 第三批：单个模型服务配置页、API 令牌页、提示词模板页与单个提示词页，包含表单校验提示、推理参数说明、价格与附加请求体字段、测试结果徽标、令牌与提示词的增删改提示。
  - 第四批：仪表盘整体（页签与时间范围、指标卡、用量与工具调用表格、四张图表与执行明细），以及共用指标卡、图表卡与错误态的固定文案。图表本地化包含图例名称、日期轴与提示（改为中文日期格式）、“该时间段暂无数据”、任务流程/任务/子任务占位标题。
  - 第五批：任务流程详情区与列表页。包含流程页签（智能体/任务/终端/文件/截图/搜索/向量库/仪表盘/交互助手/自动执行）、各面板的搜索框与空状态、智能体日志与消息提示语、任务与子任务视图、工具与向量库日志、截图面板、文件页（含上传/拉取/附加资源/收录到资源库弹窗）、任务流程列表页与详情页（重命名、收藏、结束、导出 MD/PDF、报告页）。
  - 第六批：知识库、资源与模板三个区域。包含知识文档列表与详情头部（重命名、匿名化、视图切换、原始 Markdown 提示）、知识表单控件（文档/答案/指南类型、代码语言、内容与说明、校验提示、匿名化结果提示）、资源页（列设置、文件夹优先、相对时间、新建文件夹、上传、打开、重命名或移动、复制路径提示）、模板页与模板表单（预设模板入口、表单标题与内容校验、重命名、删除）。
  - 第七批：Markdown 编辑器工具栏与表格操作（文字样式、加粗/斜体/删除线、行内代码与代码块、引用、分割线、清除格式、撤销/重做、列表与标题菜单、链接与图片编辑表单及其限制说明、插入表格与增删行列/表头行/列对齐/清空内容、行列操作菜单），账户的邮箱与姓名修改表单，文件管理器的复制/移动/新建文件夹弹窗（含相对路径说明与覆盖提示），以及公共小组件的对话框与抽屉关闭按钮、面包屑、内联编辑、页面加载、路由错误边界、自动补全空态、文件拖放区、搜索框、日历、侧栏提示。补齐了此前遗漏的零散文案：资源页与模板页的「新建知识/新建模板」按钮、提示词原始模板编辑提示、跨字段长度校验消息（`{label} must be {max} characters or fewer` 等三条）与模型服务名称长度校验消息。
- 第八批（补漏，含 .ts 侧与模板字面量）：第一至七批的扫描口径只看 `.tsx` 的 JSX 文本与常见属性，漏掉了 `.ts` 文件与反引号模板字面量里的用户可见文案。本批补齐：浏览器标签页标题（`lib/route-titles/index.ts` 的路由标题注册表）、路由标题的 `Flow #{id} — {title}`、API 层错误回退文案与表单校验提示（`lib/axios.ts`、`upload-validation.ts`）、文件与资源操作的 toast（上传/删除/复制/移动/新建目录/拉取/收录到资源库的成功与失败提示及其 `{count}`/`{path}` 参数化描述）、查询框与排序/清除排序、选择行与清除输入的无障碍名、Markdown 编辑器的「文字样式：」「列表：」标题与任务项复选框名、表格对齐菜单（左对齐/居中/右对齐）、文件管理器根分组标签（上传目录）、提示词页的变量跳转与「提示词不存在」空态、提示词重置确认句、模型服务类型不可用的提示。JSON 与 GraphQL 查询、日志前缀、协议名（OAuth）、键盘修饰键（Cmd/Ctrl）、类型名与数据值仍保持英文原样。
- 第九批（错误文案与后端错误码映射）：第一至八批的扫描漏掉了 `providers/`、`hooks/`、`lib/` 三个目录（扫描范围按 `pages|components|features` 过滤），导致大量 toast 失败文案与 OAuth 登录错误仍是英文。本批补上：`providers/flow-provider`（发送消息/停止任务流程/创建、调用、停止、删除交互助手失败）、`providers/user-provider`（退出登录失败、加载用户信息失败、弹窗被拦截、已取消身份认证、身份认证超时）、`providers/resources-provider`、`providers/favorites-provider`、`providers/flows-provider`，以及文件与资源操作 hook 的失败回退文案（加载容器文件/删除文件/收录到资源库/上传文件/附加资源/从容器拉取/复制、移动、删除资源/创建目录）与 `getApiErrorMessage` 的默认回退。同时新增**后端错误码 → 中文说明**的统一映射（`lib/errors.ts` 的 `localizeApiErrorText`），`lib/axios.ts` 的 `resolveApiErrorMessage` 在调用方未登记错误码时用同一张表兜底，`ErrorState` 展示中文说明并把映射过的原始文本放进「查看原始诊断」折叠区，符合计划里“错误按稳定错误码映射为中文、原始诊断放可展开详情”的要求。
- 第十批（残留英文补漏）：第九批的扫描只覆盖“`>` 后紧跟单词”的 JSX 文本节点，漏掉了两类位置——被行内 `<code>` 切成多段的描述句（`</code>` 之后的英文尾巴不在匹配范围内），以及显示在徽标/下拉项里的英文状态标签。本批修复 7 处：模型用量卡片标题（`flow-dashboard-overview`，文案表里早有词条只是没接）、文件页“无匹配”空态（改为复用整句模板 `No {entity} match {query}. Try a different query.`）、附加资源与从容器拉取两个弹窗的整段说明（按 `<code>` 位置拆成三段落词条）、详情导航的“显示全部匹配”提示、API 令牌的 active/revoked/expired 显示标签（值仍用 `TokenStatusEnum`，只改展示），以及复制消息时生成的 Markdown 小标题“思考/结果”。
- 中文文案集中在 `frontend/src/locales/zh-CN.ts`，键为英文原文或英文句模板，支持 `{name}` 形式的参数占位（`uiText(key, params)`）；模型名称、接口字段、路由、用户输入与机器可读状态值（如提示词状态 `Custom`/`Default`/`N/A` 的存储值）保持原义，仅展示文案经文案表转换。
- 账户页的注册时间改用 `date-fns` 中文区域并显示为“yyyy年M月”。

## 验证记录（2026-09-13）

- 第一批修改文件 ESLint、格式检查通过；TypeScript 和 Vite 生产构建通过。
- 前端全套测试初跑：1348 通过，17 失败。其中 16 项来自两个 Linux 脚本测试文件，在 Windows 上无法直接执行 shell 脚本；另一项是密码显示按钮旧英文断言。
- 第二、三批完成后重新运行：1349 通过，16 失败，失败项全部为 `e2e/ci-codegen-gate.unit.test.ts` 与 `e2e/tools/review-sandbox.unit.test.ts` 在 Windows 上的环境限制；ESLint（`--max-warnings 0`，src 与 e2e 全量）退出码 0；`tsc -b` 通过。
- 中文化改动同步更新了断言：`data-table.test.tsx`、`settings-providers.test.tsx`、`settings-account.test.tsx`、`settings-sidebar.test.tsx`、`settings-provider.test.tsx` 改为经 `uiText(...)` 取期望文案，避免把中文写死在测试里。`settings-provider.test.tsx` 的展开辅助函数也必须用同一文案，否则会在第二次展开时误判为已折叠。
- Docker 构建内的控制器包 `go test -race` 通过。修改前源码曾在创建、停止、结束、重命名四项查询响应测试中复现阻塞。
- 独立复核（本机）：把 `backend/pkg/controller/flows.go` 还原为修改前版本后，`go test -race ./pkg/controller -run TestFlowRegistryResponsiveDuringSlowMutation` 在创建、创建助手、停止、结束、重命名五项全部失败；使用当前工作区版本运行整个 controller 包结果为 `ok pentagi/pkg/controller 1.082s`。
- 第四批（仪表盘）同样通过 ESLint、`tsc -b` 与全量测试；仪表盘目录没有测试文件，故无需调整断言。
- 第五批（任务流程详情区）通过 ESLint、`tsc -b` 与全量测试（1349 通过 / 16 项 Windows 环境限制）；`flow-scroll-to-latest.test.tsx`、`flow-report.test.tsx` 的期望文案改为经文案表取值，交互助手列表的删除按钮改为带参数的文案 `Delete {name}`。
- 第六批（知识库、资源、模板）通过 ESLint、`tsc -b` 与全量测试（1349 通过 / 16 项 Windows 环境限制）；`knowledge-form.test.tsx`、`knowledge-form-helpers.test.tsx`、`knowledge.test.tsx` 的期望文案改为经文案表取值。注意 `knowledge-form.test.tsx` 用桩组件替换了 `KnowledgeHeader`，桩里的「Anonymize」按钮文案也要走同一文案表，否则断言与桩不一致。
- 第七批（编辑器工具栏、账户表单、文件管理器弹窗与公共小组件）通过 ESLint（`--max-warnings 0`，src 与 e2e 全量）、`tsc -b` 与全量测试（1349 通过 / 16 项 Windows 环境限制）；断言同步改为经文案表取值：`route-error-boundary.test.tsx`（原文案为正则匹配，改为整句文案）、`detail-navigation-toolbar.test.tsx`（上一/下一按钮）、`settings-account.test.tsx`、`knowledge-form-helpers.test.tsx`（长度校验消息改为带参数的复合模板）、`knowledge.test.tsx`、`inline-edit-input.test.tsx`（仅按钮名，`{ key: 'Enter' }` 这类键盘事件值必须保持英文，不能被替换）。
- 第七批执行中的两次返工记入教训：一是批量替换脚本在**属性位置**把 `="Upload files"` 这类值换成裸表达式 `uiText(...)`，丢掉引号后产生语法错误（`vite build` 才会暴露，`tsc -b` 与 ESLint 都放过）；二是把「数据位置」的字面量也一并替换，导致提示词状态的类型联合与 `=== 'Custom'` 比较被破坏，并出现 `uiText(uiText(...))` 双层包裹。已按位置回退为字面量，并把 `uiText(uiText(...))` 全部折叠。结论：文案替换必须区分展示位置与数据/比较位置，且每次替换后都要跑一次生产构建，不能只看 `tsc`。
- 第八批（补漏）通过 ESLint（`--max-warnings 0`）、`tsc -b` 与全量测试（1349 通过 / 16 项 Windows 环境限制）。断言同步改为经文案表取值：`upload-validation.test.ts`（三条上传校验消息改为带参数模板）、`input-search.test.tsx`（清除按钮无障碍名）、`markdown-editor-extensions.test.ts`（任务项复选框名）、`markdown-editor-extensions.test.ts`/`upload-validation.test.ts` 的 `@/locales/zh-CN` 导入排序、`detail-navigation-sheet.test.tsx`（空态改为带参数文案）。工具栏下拉按钮的断言不再写死正则，而是用 `uiText('List: {label}', { label: '' })` 取出本地化前缀再拼正则，中文改动不会造成测试与实现脱节。
- 第八批暴露的口径缺陷：只扫 `.tsx` 会漏掉三类用户可见文案——`.ts` 文件（路由标题注册表、API 层、上传校验、资源/文件操作 hook）、反引号模板字面量（toast 描述、无障碍名、确认句）、以及把选项名拼进 aria-label 的位置。统计剩余英文时必须同时扫 `.ts` 与 `.tsx`，并对模板字面量与字符串字面量分别匹配。
- 第九批（错误文案与错误码映射）通过 ESLint（`--max-warnings 0`）、`tsc -b` 与全量测试（**1371 通过 / 16 项 Windows 环境限制**，比第八批多 22 项通过，来自新增的 `lib/errors.test.ts` 契约测试）。契约：`KNOWN_API_ERROR_MESSAGES` 里每个已登记错误码都必须翻成中文（`it.each(Object.keys(...))` 检查包含中日韩字符且不等于原键），未登记的错误文本必须原样返回且 `hasLocalizedApiErrorText` 为 false——忘了翻译新错误码或把中文文案又包一层，测试都会红。
- 第九批踩到的坑记录：替换脚本扫到了文案表文件自身，把键 `'An error occurred while creating assistant'` 写成了表达式 `uiText('...')`，造成自引用 import（TS2440）与重复键（TS1117）；同时产生了 `uiText(uiText('X'))` 双重包裹。规则：批量替换必须排除 `locales/`，且每次替换后折叠一次双重包裹并跑 `tsc -b`。
- 部署复核：`pentagi` 容器于 2026-09-13 16:37:37 重建（第九批），运行 `pentagi-local:latest`；容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `4850c27f6af2354f3c28f8f7a419f7eb`）；https://localhost:8443 返回 200；容器静态文件中可检索到「查看原始诊断」「需要登录后继续」「加载资源失败」「上传文件失败」「已取消身份认证」「服务内部错误」。
- 测试通道说明（2026-09-13）：`e2e/ci-codegen-gate.unit.test.ts` 与 `e2e/tools/review-sandbox.unit.test.ts` 直接驱动 `#!/usr/bin/env bash` 脚本与 GNU `find`/`touch`，Windows 上无法执行（无 shebang 支持、缺 GNU 工具，且长文件名用例触发 MAX_PATH）。两处已改为 `describe.skipIf(process.platform === 'win32')`：Windows 本地 `pnpm test` 现在报 **1371 通过 / 16 跳过 / 0 失败（退出码 0）**，不再出现容易被误判成回归的 `TypeError`；Linux 上照旧执行。在 `node:22-bookworm` 容器里对同一份源码实测这两个文件为 **2 passed / 16 passed**（vitest 4.1.9），CI 侧本来就跑在 `ubuntu-latest`（`.github/workflows/ci.yml`）。注意 Windows 工作区的 `.sh` 被 autocrlf 存成 CRLF，拷进 Linux 前需先转 LF；Linux 检出本身是 LF，无需处理。
- P0 作业化验证（2026-09-13）：在 `golang:1.26.5-bookworm` 容器内 `go test -race ./pkg/controller ./pkg/server/services ./pkg/graph/...` 全部通过。新增用例覆盖：分段耗时与进度写入（`rec.Step` 在执行前就把步骤写进作业行）、失败两次后第三次成功（作业回到 queued 且保留失败原因）、超过最大次数后置 failed 并把流程标记为 failed（并推送一次 FlowUpdated）、重启恢复（`running` → `queued` 且被执行器跑完）、重复提交复用同一流程、同一流程并发重复作业被唯一索引拒绝、结束操作在请求返回后才执行清理。查询响应性用例改为覆盖 db 插入（create/assistant）、停止、后台清理与重命名五条路径。
- 部署复核：`pentagi` 容器于 2026-09-13 17:18:49 重建（第十批）；容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `56adcc7cbed48967c6dbfba73ef91128`），`zh-CN-CZO_8hL0.js` 两侧 md5 均为 `5bca86389bdf231db2333c39c156b5ec`；https://localhost:8443 返回 200；容器产物中可检索到「显示全部匹配的」「浏览运行中的容器」「从全局资源库中选择文件或文件夹」「按模型与模型服务统计用量」「已撤销」「已过期」「单击文件夹行上的箭头」与整句模板「中没有匹配」；`pentagidb` 中仍有 3 个任务流程与 1 条模型服务配置。镜像构建内的 `go test -race ./pkg/controller` 通过。
- 部署复核：`pentagi` 容器于 2026-09-13 16:26:08 重建（第八批），运行 `pentagi-local:latest`；容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `ceaf97c0c6d117a5888fdb6d3ec4e02e`）；https://localhost:8443 返回 200；容器静态文件（`zh-CN-CZO_8hL0.js`）中可检索到「资源已复制」「已复制到剪贴板」「上传目录」「左对齐」「上传失败」「任务流程 #」「删除{count}」「文件数量过多」。
- 部署复核：`pentagi` 容器于 2026-09-13 16:11:37 重建（第七批），运行 `pentagi-local:latest`；容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `40cc62c280e066ebf4817668016dd9f7`）；https://localhost:8443 返回 200；容器静态文件（`zh-CN-CZO_8hL0.js`）中可检索到「文字样式」「插入表格」「覆盖复制」「最多 50 个字符」「上一个」。此前 15:40:33 的重建（第六批），运行 `pentagi-local:latest`；容器静态文件中可检索到「语义搜索」「预设模板」。此前 15:29:26 的重建（第五批），运行 `pentagi-local:latest`；容器静态文件中可检索到「该任务流程已结束」「滚动到最新消息」。此前 15:17:55 的重建（第四批），运行 `pentagi-local:latest`；容器静态文件中可检索到「任务流程活动趋势」「该时间段暂无数据」。此前 15:10:33 的重建（第三批），运行 `pentagi-local:latest`；容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致；容器静态文件中可检索到「推理配置」「模型服务测试结果」等新文案；https://localhost:8443 返回 200；`pentagidb` 中保留原有 provider 配置与历史任务。

## 复核批次（2026-09-14）

本批是对现有中文化与任务生命周期改动的复核修复，不扩展五阶段业务范围。改动先在工作区完成，随后随本批记录一并提交。

- 后端（`backend/pkg/controller`、`backend/pkg/database`、`backend/pkg/graph`、`backend/pkg/server/services`）：
  - 创建任务改为一次原子写入：新增 sqlc 查询 `CreateFlowWithJob`（CTE 同时插入 `flows` 与 `flow_jobs`），作业插入失败不会再留下无法启动的任务行。
  - 提交锁与生命周期锁分离（`submitMX` 与 `lifecycleMX`），队列拥堵不再拖住创建请求。
  - 删除改为持久后台作业（`DeleteFlow`）：GraphQL 与 REST 都只入队，REST 返回 202 Accepted，清理完成后由作业推送 `FlowUpdated`。
  - 结束/清理在进程重启后仍可执行，缺少 worker 时直接清理已记录的容器，重复清理幂等。
  - 领取与重试门控下沉到 SQL：`running` 不能被二次领取，`retrying` 需等待退避间隔，`stop` 作业仅在 `recovered` 步骤可恢复。
  - 新增 `Flow.lifecycleJob`（`FlowLifecycleJob`）字段与解析器，供界面显示排队、清理、重试与失败原因。
- 前端（`frontend/src`）：
  - 新增 `features/flows/flow-job-status.tsx`（含测试），任务列表与详情页显示后台作业状态；结束/删除提示改为“请求已受理…”，列表增加轮询与 online/focus 重取，避免清理期间重复提交。
  - 后端英文错误统一经 `localizeUiErrorText` 映射为中文，`ErrorState` 把原始诊断收进「查看原始诊断」；日期格式统一为中文区域。
  - 中文化补漏（本批新发现并修复，均为此前扫描口径遗漏的位置）：`ariaLabel`/`description`/`hint` 等属性值 4 处；由数据驱动的显示值 5 处（知识文档与模板的占位标题、终端连接状态、手工/智能体徽标、任务/子任务/交互助手计数）；zod 校验消息 5 条；上传、删除、复制的多选 toast 与上传目标文案；终端 Cmd/Ctrl 提示；拖拽数量徽标；提示词重置确认句与插入变量提示；模型服务复制名；额外请求体说明；资源拖放区说明与体积提示。
  - 移除三处只产出英文的复数化辅助函数（`pluralizeItems`、`pluralizeItemsEnglish`）及其测试，改为经文案表取整句。
- 验证（2026-09-14）：
  - 前端：`pnpm test` **1372 通过 / 16 跳过 / 0 失败**（比上一批少 2 项，来自删除的英文复数化用例）；`eslint --max-warnings 0` 退出码 0；`tsc -b` 通过；`vite build` 通过。
  - 后端：容器内 `go test -race ./pkg/controller ./pkg/server/services ./pkg/graph/... ./pkg/database` 通过。
  - 数据库：真实 PostgreSQL 上迁移至 `20260913_180000_flow_jobs` 成功；原子创建失败回滚、运行中作业不可二次领取、清理失败保留任务、重试等待时间等用例通过。
  - 部署：`pentagi-local:latest` 重新构建，并于 10:41:48 替换 `pentagi` 容器；容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `8c7dd0201561411a48b49697442bc991`）。
  - 入口改为 HTTP：`.env` 中 `SERVER_USE_SSL=false`，`PUBLIC_URL`/`CORS_ORIGINS` 改为 `http://localhost:8443`；`http://localhost:8443` 返回 200，HTTPS 不再监听。登录 Cookie 的 `Secure` 标志由 `c.Request.TLS != nil` 决定，HTTP 下自动省略，登录不受影响。
  - 仍未做：浏览器逐页走查（中文变长造成的截断、换行、按钮宽度与图标按钮布局）、报告/PDF 固定标题核对、读屏实测、p95 响应基线与慢模型/慢 Docker/故障注入验收。
  - 复现日志：`build/frontend-tests-verify.log`、`build/frontend-build-verify.log`、`build/backend-review-tests-verify.log`、`build/db-integration-verify.log`、`build/application-build-verify.log`（`build/` 不入库）。真库集成测试的可运行迁移脚本放在 `backend/tmp/migrate-review/main.go`（同样不入库）。

### 用户反馈修复（2026-09-14 下午）

- 概览「分析」的周/月/季切换在界面上"点了没反应"：后端按 period 正确切到 7/30/90 天窗口，但 SQL 只返回**有数据的日期**（`GROUP BY DATE(created_at)`，不补零），而库里全部数据都在 9 月 12 日，因此三个区间返回完全相同的单点。新增 `frontend/src/pages/dashboard/analytics-period.ts`（含测试）：按所选区间生成连续日期轴并把缺失日期补 0；区间外的返回行不会被丢弃。同时在周期切换旁显示「最近 7/30/90 天」。空状态仍以原始返回行数为准，不会把"无活动"画成一条零线。
- 任务流程列表新增「序号」列（`frontend/src/pages/flows/flow-row-number.ts` 含测试）：删除流程是软删除（`deleted_at`），ID 由 PostgreSQL 序列分配且不复用，因此删除后编号会出现空档（当前库里 1、2 已软删除，只剩 3，新建流程会得到 4）。序号列显示当前页、当前排序/筛选下的连续行号，物理 `id` 列保持不变，报告与证据引用不受影响。这是展示层改动，不是数据库语义变更。
- 侧边栏「最近任务流程」（以及「收藏的任务流程」）同样改为显示序号：此前 `FlowMenuItem` 直接打印 `flow.id`，两处都会显示如 `#3` 的物理编号。现在按各自列表的显示顺序编号（最近列表 1＝最新，收藏列表 1＝最新），折叠态与展开态的角标都改；`main-sidebar.test.tsx` 新增用例断言渲染的是 1、2 而不是原始 id 7、4。链接仍指向真实 `flow.id`，导航不受影响。
- 验证：`pnpm test` **1383 通过 / 16 跳过 / 0 失败**（新增 11 项）；`eslint --max-warnings 0` 退出码 0；`tsc -b` 通过；`vite build` 通过；`pentagi-local:latest` 重建并于 11:09:20 替换 `pentagi` 容器，容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `918598e5522fe61b6c1de65c50354d15`），`http://localhost:8443` 返回 200。

### 回收站与恢复（2026-09-14 下午）

删除是软删除（`flows.deleted_at`），此前没有任何恢复入口，用户一旦删错只能放弃。本批补上回收站：

- 后端：新增 sqlc 查询 `GetDeletedFlows` / `GetUserDeletedFlows` / `RestoreFlow` / `RestoreUserFlow`（用 `sqlc generate` 重新生成 `pkg/database`，未手改生成文件）；GraphQL 新增 `deletedFlows` 查询与 `restoreFlow` 变更，`Flow` 类型增加 `deletedAt`（供界面显示删除时间）；恢复走 `flows.delete` 权限，非管理员的所有权校验内联在 `RestoreUserFlow` 的 UPDATE 条件里（被删除的流程对 `GetFlow` 不可见，无法沿用 `validatePermissionWithFlowID`）。恢复后推送一次 `FlowUpdated`。
- 前端：任务流程页头部新增「回收站 / 返回任务流程」切换；回收站列表只有序号、ID、标题、状态、删除时间与「恢复」按钮，行不可点击、无右键菜单（已删除流程没有详情页）；恢复前有确认对话框，明确写出"删除时已清理的容器文件与向量记忆不会恢复"。
- 验证：真库集成测试新增 2 个用例（回收站列出软删除流程并可恢复、恢复正常流程与越权恢复都被拒绝），`TestFlowJobsAgainstRealPostgres` 共 17 个子测试全部通过；`go test -race` 覆盖 controller / services / graph / database / converter 全部通过。接口实测：插入一条合成软删除流程 → `deletedFlows` 列出（含 `deletedAt`）→ `restoreFlow` 返回 success → 回收站不再包含它、正常列表出现它 → 重复恢复返回 `flow N is not in the recycle bin` → 删除合成数据。用户自己的 1、2 号流程仍留在回收站，可自行恢复。
- 边界：恢复只还原记录与历史（可查看、可导出报告），不会重建容器与向量记忆；`deleted_at` 由序列化的物理 `id` 无关，恢复后不会改变原有编号。

### 彻底删除（2026-09-14 下午）

回收站此前只能恢复、不能释放空间，本批补上不可逆的彻底删除：

- 后端：sqlc 新增 `PurgeFlow` / `PurgeUserFlow`（`DELETE FROM flows WHERE id = $1 [AND user_id = $2] AND deleted_at IS NOT NULL RETURNING *`，同样由 sqlc 生成）。子表全部是 `ON DELETE CASCADE`（容器、任务、子任务、工具调用、消息链、消息日志、截图、助手、各类日志、作业记录共 13 处外键），所以一条 DELETE 就会连带清空，无需手写清理。GraphQL 新增 `purgeFlow` 变更，权限沿用 `flows.delete`，所有权校验同样内联在 DELETE 条件里；非回收站内的流程返回 `flow N is not in the recycle bin`。
- 前端：`ConfirmationDialog` 增加可选的 `confirmPhrase`（输入指定文本才能点确认，用于不可撤销操作）。回收站每行在「恢复」旁增加「彻底删除」，确认框要求输入流程标题，并说明任务、工具调用、日志、截图与作业历史都会从数据库删除。
- 验证：真库集成测试新增 2 个用例（彻底删除后行与作业历史都消失、越权与未删除流程都被拒）→ `TestFlowJobsAgainstRealPostgres` 共 19 个子测试通过；后端 `go test -race` 全绿；前端新增 `confirmation-dialog.test.tsx`（3 项：短语不匹配时确认按钮禁用、去空格后匹配、未配置短语时不出现输入框）。接口实测：合成一条在回收站、一条未删除 → 彻底删除未删除的被拒 → 回收站内的删除成功且库中行数为 0 → 清理合成数据。为不留下测试造成的编号空档，事后把 `flows_id_seq` 复位到 4（现有最大 id 为 3），下一个新建流程仍是 4。

### 撤销序号列并清空任务数据（2026-09-14）

- **撤销序号**：按用户要求，任务流程列表与回收站的「序号」列已移除，侧边栏「最近任务流程 / 收藏的任务流程」也恢复显示原始 `flow.id`；`frontend/src/pages/flows/flow-row-number.ts` 及其测试、`Row number` 文案词条一并删除。此前的「新增序号列」「侧边栏改用序号」两条记录自本条起失效，界面统一使用数据库 ID。回收站、恢复、彻底删除三项功能保持不变。
- **清空任务数据**：按用户要求删除数据库中的全部任务数据。执行顺序为先备份、再走应用自身的删除路径（而非直接 SQL），以保证容器与向量记忆一并清理：
  1. 备份：删除前先用 `pg_dump` 全库备份到 `build/`（约 9.4 MB，`build/` 不入库）。该文件已按用户要求于同日删除，因此本次清库**不可回退**。
  2. 删除：对唯一在用的 #3 调 `deleteFlow`（持久作业 2 秒内完成清理并进入回收站），随后对回收站中的 #1、#2、#3 逐个调 `purgeFlow`。
  3. 结果：`flows` / `tasks` / `subtasks` / `toolcalls` / `msglogs` / `msgchains` / `screenshots` / `containers` / `assistants` / `flow_jobs` 全部为 **0 行**；`langchain_pg_embedding` 中 `doc_type='memory'` 的向量记忆为 **0 条**。
  4. 保留：`users`(1)、`providers`(1)、`user_preferences`(1) 等账户与模型服务配置未受影响；`favoriteFlows` 为空，无需清理。
  5. 接口复核：`flows`、`deletedFlows`、`usageStatsByPeriod` 均返回空数组。
- **编号复位为 1**：清库后确认「删除数据不会重置自增序列」（PostgreSQL 的 `flows_id_seq` 只增不减，此前又因测试被复位到 4）。用户要求真正的全新开始，故按应用自身路径删除测试期间创建的唯一流程 #4（交互助手模式，先 `deleteFlow` 清理容器再 `purgeFlow` 删行），随后 `ALTER SEQUENCE flows_id_seq RESTART WITH 1`。复核：flows / assistants / containers / tasks / msglogs 均为 0，向量记忆 0 条，无遗留任务容器，下一个新建流程为 **ID 1**。账户（users=1）、模型服务（providers=1）、用户偏好均保留。
- **修复「删除流程不清理知识文档」**：清点全库时发现 `langchain_pg_embedding` 还留着 3 条属于已删除流程 #3 的知识文档（`doc_type` 为 answer/guide/code）。根因是删除流程只调 `DeleteFlowMemoryDocuments`（条件为 `doc_type='memory'`），而知识库列表的条件是 `doc_type NOT IN ('memory')`，所以这些文档仍会出现在知识库页面。已把该查询改为 `DeleteFlowDocuments`（按 `cmetadata->>'flow_id'` 删除该流程的**全部**向量文档，长期记忆与知识条目一并清理；手工在知识库创建、没有 `flow_id` 的文档不受影响），删除作业与彻底删除流程都会调用它。同时删除了那 3 条残留（`langchain_pg_embedding` 现为 0 行）。
  - 验证：真库集成测试新增 1 个用例（带 `flow_id` 的文档被删、没有 `flow_id` 的手工文档保留）→ `TestFlowJobsAgainstRealPostgres` 共 **20 个子测试**通过；后端 `go test -race` 全绿；`backend/docs/database.md` 已同步说明。

### 详情页切页回来不刷新（2026-09-14 晚）

- 现象：创建交互助手后切到其他页面，助手其实**已经回复**（`assistantlogs` 有 input/answer 两条、`msgchains` 有 system/human/ai 一次完整往返、容器在跑、流程处于 `waiting` 等待用户确认），但回到任务流程详情页什么都看不到、状态也停在旧值，看起来像"卡死"。
- 根因：详情页的三个查询 `FlowDocument` / `AssistantsDocument` / `AssistantLogsDocument` 都用 `cache-first` + `nextFetchPolicy: 'cache-first'`，消息与状态更新只依赖 14 个 WebSocket 订阅；而 `FlowProvider` 只包在流程详情路由上，切页即卸载并关闭订阅。于是**离开页面期间产生的数据不会进入 Apollo 缓存**，返回时 `cache-first` 命中旧缓存就不再发请求，界面停留在空/旧数据。列表页此前已用 `cache-and-network` + 5 秒轮询，详情页没有跟上。
- 修复：三个查询改为 `fetchPolicy/nextFetchPolicy: 'cache-and-network'`——先用缓存秒开，同时向服务端取一次真值。`FlowDocument` 同时承载自动模式的消息记录，所以自动模式"消息不刷新"一并修复。
- 验证：`pnpm test` 1383 通过 / 16 跳过 / 0 失败；`eslint`、`tsc -b`、生产构建通过；镜像重建并部署（容器 13:40:48），`http://localhost:8443` 返回 200，容器内 `index.html` 与本地 `dist` 一致（md5 `463529d3bfa22203f5e4041e0d5b5c0c`）。
- 同类问题一并修掉（侧边栏）：`SidebarFlowsProvider` 是全局挂载、位于流程路由之外，而轮询只存在于包流程路由的 `FlowsProvider` 上，之前它又用 `cache-first`，所以在仪表盘/设置/知识库等页面停留较久时，侧边栏「最近任务流程」会偏旧。现改为 `cache-and-network`（缓存秒开 + 每次挂载向服务端核对），并新增 `online`/`focus` 时 `refetch`——不加全局轮询，避免非流程页面持续请求。全量排查结果：前端所有显式 `fetchPolicy` 覆盖中，只剩这一处是 `cache-first`（`resources-provider` 的 `cache-only` 是刻意设计：它从 REST 灌缓存并监听 WS 重连），全局默认本就是 `cache-and-network`。
  - 测试：新增 `sidebar-flows-provider.test.tsx`（2 项：必须请求 `cache-and-network` 而不能是 `cache-first`；`focus`/`online` 触发 `refetch`，卸载后不再触发）。
- 验证：`pnpm test` **1385 通过 / 16 跳过 / 0 失败**；`eslint`、`tsc -b`、生产构建通过；镜像重建并部署（容器 13:50:17），`http://localhost:8443` 返回 200，容器内 `index.html` 与本地 `dist` 一致（md5 `e007eb81ef2a3e1b5d41be0ec2b4f253`）。

### 中文化补漏：筛选菜单与消息类型（2026-09-14 晚）

用户反馈两处残留英文：任务流程列表的筛选/列设置区域，以及交互助手的消息类型（Input/Answer）。三处根因分别是：

- **列下拉菜单回退成列 id**：`DataTable` 的标签取 `meta.columnMenuLabel ?? column.id`，而任务流程页只有 Created / Deleted at 两列写了标签（`updatedAt` 还是裸英文 `'Updated'`），其余列直接回退成列 id，于是「列设置」与「搜索范围」两个菜单里出现 `provider` / `terminals` / `status` / `updatedAt` 等英文。已给全部列补 `uiText(...)` 标签并修掉 `'Updated'`。同类问题一并修复：知识库（`'Type'`/`'Question'`/`'Flags'` 也是裸英文）、模板、提示词、模型服务、API 令牌页缺标签的列。
- **空状态把英文名词插进中文**：`empty={{ entityName: 'flows' }}` 被拼进「暂无{entity}」「{entity}中没有匹配…」等中文句子，显示为「暂无flows」。已改为 `uiText('Flows')` / `uiText('deleted flows')` 等；影响任务流程、知识库、模板、智能体/工具提示词四处（API 令牌与模型服务此前已是 `uiText`）。
- **消息类型 tooltip 取枚举值**：`FlowMessageTypeIcon` 的 tooltip 默认 `type` 再经 `formatName`，所以助手消息的类型悬浮提示显示 Input/Answer/Advice 等英文。已改为经文案表（新增 Input/Answer/Advice/Ask/Browser/Done/Thoughts 词条；File/Report/Search/Terminal 复用已有词条），显式传入 tooltip 的调用方行为不变。

防回归：

- 新增 `e2e/table-copy-hygiene.unit.test.ts`：扫描 `src` 下非测试文件，禁止 `columnMenuLabel: '…'`、`entityName: '…'`、`filterPlaceholder="…"` 这类绕过文案表的裸字面量（`columnMenuLabel` 漏写还会静默回退成列 id，因此一并守住）。
- 新增 `flow-message-type-icon.test.tsx`：断言 Input/Answer 的悬浮提示为中文且不含英文枚举值，显式 tooltip 仍按调用方文案显示。

验证：`pnpm test` **1389 通过 / 16 跳过 / 0 失败**；`eslint`、`tsc -b`、生产构建通过；镜像重建并部署（容器 14:00:41），`http://localhost:8443` 返回 200，容器内 `index.html` 与本地 `dist` 一致（md5 `10d923bda53e80ae33002a590e4c18e7`）。

### 提示词模板与知识库语言（2026-09-14 晚）

用户反馈两点：新建提示词模板时看到的全是英文；知识库里生成的内容是英文。

- **模板预设汉化**：`frontend/src/pages/templates/template.tsx` 内置的 11 个预设模板（标题 + 正文）整体译为中文，保留 `{{TARGET_URL}}`、`{{DOMAIN_NAME}}` 等占位符与「行动方案 1..N」结构。这不只是显示问题——预设正文就是插入任务框的任务描述，中文描述会让语言检测（`language_chooser`）判定为中文，进而让 engagement log、报告与知识库都走中文。
- **知识库内容语言改为跟随流程语言**：此前所有向量库（答案 / 指南 / 代码 / 长期记忆 / 知识图谱）都被强制英文，依据是上游"英文索引、跨流程共享"的设计。本部署是单一中文使用者，且向量模型（百炼 `qwen3.7-text-embedding`）中文效果良好，因此把策略改为：**向量库的写入内容与查询都使用该流程的语言（`{{.Lang}}`）**，前提是"写什么语言就用什么语言查"——否则存进去也检索不到。改动落点：
  - 提示词：`searcher` / `memorist` / `enricher` / `coder` / `pentester` / `installer` / `assistant` 的 `<language_policy>` 及其末尾"Follow the LANGUAGE POLICY"清单条目。
  - 工具参数说明（模型实际读到的字段文档）：`backend/pkg/tools/args.go` 中 `SearchInMemory.Questions`、`SearchGuide/StoreGuide`、`SearchAnswer/StoreAnswer`、`SearchCode/StoreCode`（含 `Explanation`/`Description`/`Question`）、`GraphitiSearch.Query` 共 12 处，从"必须英文"改为"使用系统提示声明的流程语言"。
  - **保持不变（仍为英文）**：外部搜索引擎查询（其索引以英文为主）、运行命令、源码与标识符，以及 agent 之间传递的 `result`/`question` 技术载荷。
  - 影响：库里此前的英文条目将无法被中文查询命中（当前向量库为空，无历史负担）；若以后要混用中英文，需要同时用两种语言写入与查询。
- **顺带修复**：详情导航面板的标题此前是把 `sheetTitle="Templates"/"Flows"/"Knowledges"` 直接渲染（含两处 aria-label），现改为 `uiText(...)`；`table-copy-hygiene` 守卫新增 `sheetTitle="…"` 规则，并把该用例超时放宽到 30 秒（全量并行时读文件偶发超过默认 5 秒，曾误报一次超时失败，并非真实违规）。

验证：`pnpm test` **1389 通过 / 16 跳过 / 0 失败**；`eslint`、`tsc -b`、生产构建通过；后端 `go build ./...` 与 `go test ./pkg/templates/... ./pkg/tools/...` 及 `go test -race`（controller / services / graph / database / converter / knowledge）全部通过；镜像重建并部署（容器 14:40:18），`http://localhost:8443` 返回 200，容器内 `dist` 与本地一致（md5 `9314d60119c2a820645178f9571a473f`）；前端产物可检索到中文预设（「Web 应用安全测试」「内网渗透测试」「行动方案」等）。**接口复核**：调用 `settingsPrompts` 取回运行中实例下发的 searcher / memorist / pentester 提示词，确认包含新的「follows the engagement language」策略且已不含旧的 `indexed in English`。

### 交互助手模式导出报告（2026-09-14 晚）

用户问「任务跑完能导出 md/pdf 报告，现在找不到了，是要说明什么才会触发吗」。排查结论是**与提示词无关**：报告入口由 `frontend/src/pages/flows/flow.tsx` 的 `!!(flowData?.tasks ?? [])?.length && <FlowReportDropdown />` 控制，只对**自动化模式**渲染；报告正文也全部来自 task（`generateReport(tasks, flow)` 拼 task 的 input/result 与 subtask 的 description/result，后端在**任务结束**时写入 `report` 类型 msglog）。而当前库里唯一的流程 #1 是**交互助手模式**（1 个助手、219 条 assistantlogs、0 task、0 msglog），因此按钮根本不出现，强行导出也会是空报告。

本次改动（两种模式都能导出）：

- 新增 `generateAssistantReport`（把助手会话逐条转成 Markdown）与统一分派器 `generateFlowReport`：**有 task 走原任务报告，没有 task 走会话记录**，网页、复制、MD、PDF 四条出口共用同一个内容生成器。
- 报告结构：`# <状态emoji> <流程ID>. <标题>` → `**交互助手**: <助手名>` → `**消息数**: N` → 逐条 `## 序号. <类型emoji> <类型名>`。保留每条消息的 `message` 与 `result`（`resultFormat=terminal` 的结果用代码块包裹）。**不导出 `thinking`**：它是模型内部推理，界面本身折叠在「显示思考」后面，且在 flow #1 里占了 98 万字节中的绝大部分。
- 可读性修复（顺带）：会话正文里的 Markdown 标题整体下移两级（`#`→`###`）以免和消息小节抢层级，并**跳过代码块内**的 `#`（shell 注释不是标题）；终端结果里的 ANSI 颜色转义在导出时剔除，此前会以 `[1m`/`[0m` 字面量出现在报告里。
- 导出入口：门槛改为「有 task **或**有助手消息」；网页视图与 PDF 走 `/flows/:id/report?assistantId=<助手ID>`，独立报告页的 GraphQL 文档新增 `assistants` 字段，用于取助手名并支持直接打开该 URL。
- 文件名：`generateFileName` 原先用 `\w` 清洗标题，中文标题会被替换成一串下划线（`report_flow_1__<时间戳>.md`），现改为保留 `\p{L}\p{N}`，中文标题能出现在文件名里。
- **走查中发现的真实缺陷（已修）**：GraphQL 把 `ID` 序列化成 **JSON 数字**（实测 `{"assistants":[{"id":3,...}]}`），而报告页从 URL 参数拿到的 `assistantId` 是**字符串**，`item.id === reportAssistantId` 恒为 false，于是网页视图与 PDF 里缺了「交互助手: xxx」那一行（MD 下载路径两侧同源所以正常）。现两侧统一 `String()` 比较，并加了回归测试（数据用数字 id、URL 用字符串）。

验证：

- `vitest` **1399 通过 / 16 跳过 / 0 失败**（新增 `lib/report/report.test.ts` 8 项：会话顺序、终端 fence、ANSI 剔除、标题下移但代码块不动、空态、分派、文件名；`flow-report.test.tsx` 4 项：任务报告、助手报告、URL 数字 id 匹配、加载失败）。
- `eslint --max-warnings 0`、`tsc -b`、生产构建通过；镜像重建并部署（容器 15:36:36），`http://localhost:8443` 返回 200，容器内 `index.html` 与本地 `dist` 一致（md5 `1b791ee9e9a908d760e41e7687c56a5c`），产物中可检索到 `assistantId`。
- **真机走查**（Playwright 驱动已部署实例，真实后端 + flow #1 真实数据）：助手模式流程顶部出现「报告」按钮，菜单为 打开网页视图/复制到剪贴板/下载 MD/下载 PDF；网页视图标题层级为 H1 流程 → H2 消息 → H3/H4 正文，DOM 中确认 `**交互助手**` 行已渲染；MD 导出 126,513 字符、PDF 704,511 字节，PDF 结构复核为 100 页 / 7,294 处文字绘制 / 6 个内嵌字体子集（排除「空白 PDF 换个后缀」的情况）。
- 说明：`frontend/e2e/specs/**` 里的按钮名当时仍是英文（`Report`、`Download MD` 等），与中文化后的界面不一致，mocked e2e 套件因此不能直接用作回归手段（本次改用真实部署走查）。该遗留已列入「P0/P0A 验收补齐」批次修复，见下节。

### P0/P0A 验收补齐：受理时延基线、故障注入、全站走查（2026-09-14 晚）

用户选择的下一批工作是「先补回归门禁与 P0 验收，P1 及之后不急」。

**1. 受理路径 p95 基线（后端，`backend/pkg/controller/flows_latency_test.go`）**

新增测试，用注入式故障测「请求受理」这一段（不含后台执行完成时间），并断言计划里的 2 秒目标：

- `TestFlowAcceptanceLatencyUnderSlowInitialization`：在**一个慢初始化作业持有生命周期锁**（模拟慢模型 / 慢 Docker 的准备阶段）的同时，对读列表、读单个流程、创建、结束、删除各跑 120 次；给假数据库每次调用注入 2ms 往返延迟，任务文本逐次不同以绕开 30 秒内的重复提交去重。实测（`-race`）：

  | 操作 | p50 | p95 | p99 |
  |---|---|---|---|
  | 创建受理 | 7.27ms | **7.54ms** | 7.66ms |
  | 结束受理 | 4.72ms | **4.97ms** | 5.04ms |
  | 删除受理 | 4.57ms | **4.69ms** | 4.76ms |
  | 读（GetFlow+ListFlows，n=240） | 7.5µs | **16.3µs** | 28.1µs |

  即：慢初始化在飞行中时，受理路径 p95 仍比 2 秒预算低两个数量级。
- **真实栈读路径 p95**（Playwright 驱动已部署实例，用 App 自己的 GraphQL 文档 + 会话 Cookie，每个查询预热 3 次后测 30 次，只读、无副作用）：`flows` p95 7.6ms、`flow`（详情，响应 378KB）p95 34.4ms、`assistants` p95 7.3ms、`assistantLogs`（219 条、响应 1.17MB）p95 50.5ms、`knowledgeDocuments` 5.4ms、`providers` 4.8ms、`flowsStatsTotal` 4.6ms、`flowsStatsByPeriod` 6.2ms、`usageStatsTotal` 6.9ms、`toolcallsStatsTotal` 7.6ms、SPA 外壳 `GET /` 4.2ms。**结论：当前成本由响应体大小主导（详情页 378KB、会话 1.17MB），不在锁或数据库上。**
- **故障注入测试并发现两个已知限制（已用测试钉住，未在本批修复）**：
  - `TestSlowInitializationDelaysOtherLifecycleRequests`：`executeCreate` 在初始化期间持有 `lifecycleMX`，所以**慢初始化会阻塞另一个流程的「停止」请求**（停止是请求内等待的）。
  - `TestSingleFlightRunnerSerializesLifecycleJobs`：`flowJobRunner.loop` 单飞执行作业，所以**一个流程的慢初始化会推迟另一个流程的生命周期作业**（创建/结束/删除的排队）。
  - 两者都不影响**查询**（计划书的验收口径是「创建/删除不阻塞其他任务查询」，该口径本身成立）。修复方向：把 provider/docker 准备移出生命周期锁，或把作业执行改成「每流程串行 + 跨流程有限并发」；属于下一批的独立改动。

**2. 全站页面走查与无障碍（P0A 验收）**

用 Playwright 驱动已部署实例，登录后逐路由走查 27 条路由（含流程详情 9 个页签、报告页、设置各页），每页检查：中文截断/挤压、文档横向溢出、axe（wcag2a/2aa/21a/21aa/22aa，critical+serious）、控制台与页面错误，并截图存档。

- 结果：**0 处截断、0 处横向溢出、0 个控制台/页面错误**；登录页在**未登录上下文**单独复扫（走查时会因已登录被重定向到 /flows/new），同样干净。
- 响应式复核：桌面 1440×900 之外，另在 390×844（手机）、768×800、1280×800 三个断点扫 10 条最容易挤的路径（任务列表、仪表盘、流程详情与其 Dashboard/Files 页签、报告页、模型服务详情、模板新建、资源、知识库），**同样 0 处截断、0 处横向溢出**——中文变长没有挤坏布局。
- 修复了 4 个真实无障碍缺陷（均为 axe critical/serious，且未被现有豁免覆盖）：
  1. `/templates/new`：11 个预设折叠按钮只有图标，无无障碍名（`button-name`）→ 加 `aria-label`（新增文案词条 `Show details for {name}`）。
  2. `/settings/providers/:id` 与 `/new`：13 个智能体折叠标题把「测试」按钮嵌在折叠按钮内部（`nested-interactive`）→ 给共享 `AccordionTrigger` 增加 `actions` 插槽，测试按钮移到标题行内、折叠按钮之外的真实 `<button>`（原先用 `span role="button"` 绕开无效嵌套，现一并去掉）。截图复核布局仍为「名称 …… ⌄ [测试]」。
  3. `/settings/prompts/:name`：变量出现次数徽标 `opacity-70` 导致对比度 3.41:1（`color-contrast`）→ 去掉透明并把该装饰性数字标记 `aria-hidden`（次数已在按钮无障碍名里）。
  4. 报告页 `<pre>` 代码块不可聚焦（`scrollable-region-focusable`）→ Markdown 渲染器的 `pre` 加 `tabIndex={0}`（原来只在「带搜索高亮」时才替换 `pre`，现改为始终生效）。
- 剩余项（**已知债务，本次未修**）：`aria-valid-attr-value` 出现在 `/dashboard` 与 `/flows/new` 的模式切换上——根因是把 `Tabs` 当分段选择器用却不渲染 `TabsContent`，`aria-controls` 指向不存在的元素；`/dashboard` 早已在 `e2e/routes.ts` 里豁免，`/flows/new` 同源同因，修法是改用单选组（radiogroup）或补上内容区；报告页的 `link-name` 来自智能体抓取的网页正文里两个空链接，属于内容而非界面控件；流程详情的 `color-contrast` 与 `scrollable-region-focusable` 已在既有豁免清单里。

验证：`eslint --max-warnings 0`、`tsc -b`、生产构建通过；前端全量 `vitest` **1399 通过 / 16 跳过 / 0 失败**；镜像重建并部署（容器 16:12:07，构建过程内含 `go test -race ./pkg/controller`，新增的时延测试在其中通过），`http://localhost:8443` 返回 200，容器内 `index.html` 与本地 `dist` 一致（md5 `718172aeda642b6a4551f7ff123e9e3b`）；修复后用 axe 复扫三条路由均为 0 违规。

### mock e2e 回归门禁修复（2026-09-14 晚）

`frontend/e2e/specs/**` 的断言写于中文化之前，界面改成 `uiText()` 之后整套 **mocked e2e 已无法作为门禁**（按钮名 `Report`/`Download MD` 等都已不存在）。本批把它修回可用状态：

- **机械部分**：写了一个 codemod，把 29 个 spec 里 229 处「标签/文本字面量」在**确认是文案表词条**的前提下改写成 `uiText('...')`（只匹配 `getByRole(..., { name: 'X' })` 与 `getByText|getByLabel|getByPlaceholder|getByTitle|getByAltText('X')` 两种形态，X 必须是既有词条，因此夹具数据如 `E2E Alpha` 不会被误包）。首轮 85 通过 / 97 失败。
- **判断部分**（不是机械替换能解决的，逐条修）：页签名数组与 `hasText` 过滤也要经文案表；中文标签更短会与别的控件**子串撞名**（`登录` 同时命中两个 OAuth 按钮），改为 `exact: true` 或缩小作用域；富文本编辑器的无障碍名、删除确认标题（`删除{对象}`）、图表中文日期轴、每行复选框的 `Select {name}` 等按实际渲染取值。
- **顺带发现：测试数据没跟上产品改动**（不是断言过期）——`650a0b8`（`FlowDocument` 改 `cache-and-network`）让重挂载重新拉取，cassette 只回了 3 条种子消息、丢了流式帧；`360f7c7`（列表加 `refetchQueries` + `pollInterval: 5000`）让陈旧列表覆盖订阅增量，已结束的流程又变回运行中。两处都改**夹具**（按 cassette 既有的「带标记的答案优先」机制加一条），没有放松断言。
- **两处刻意不放松的语义改动**：① 仪表盘周期切换原先断言「周视角看不到 Jan 15」，`fillPeriodDays` 之后月窗口包含周窗口，该断言已不可能成立，改为断言坐标轴确实扩展到 12 月（周窗口永远显示不出的标签）；② 生命周期 toast 由英文词条改为断言应用真正渲染的中文（原因见下条产品缺陷）。
- **顺带修掉它查出的 3 处产品缺陷（可见英文/绕过文案表）**：
  1. `flows-provider.tsx` 的「删除/结束已受理」两个 toast 直接写中文字面量、绕过文案表（`'Flow deleted successfully'`/`'Flow finished successfully'` 两个词条成了孤儿，且词条值与真实语义不符）→ 把词条值更新为准确文案并改回 `uiText(...)`，渲染文本不变。
  2. 资源复制/移动对话框与文件管理器的「复制」「移动」「复制到…」「移动到…」四处**裸英文字面量**（中文界面里显示英文）→ 全部走文案表，新增 `Copy to…`/`Move to…` 词条；同类问题还有流程文件「另存为资源」对话框的 `primaryLabel="Save"`。
  3. `table-copy-hygiene.unit.test.ts` 新增 `primaryLabel="…"` 规则并加了 `file-manager-actions.test.ts`（默认标签必须是文案表值），把这一类绕过守住。
- **抗抖动**：全量并行下 `@cross` 套件等待「流程页终端就绪」（`.xterm`）用的默认 5 秒超时偶发失败（16 次里 1 次），改为统一的 `ROUTE_READY_TIMEOUT = 15s`（等待就绪不是行为断言）；单跑该 spec 44/44 通过，确认不是真实回归。
- 新增**助手模式报告**的 e2e 用例（本次功能改动的契约）：`e2e/specs/flows/report-assistant.spec.ts` 4 条——无任务但有会话时出现「报告」菜单、独立报告页渲染会话、下载 MD 含会话且不含「暂无任务」空态、PDF 路由带 `assistantId`；另加 cassette 单测验证夹具覆盖报告页所需的两个查询。

验证：`pnpm.cmd exec playwright test -c e2e/playwright.config.ts` → **186 通过 / 0 失败**（3.7 分钟，含配置自己 `pnpm run build` 的生产构建）；`tsc -b`、`eslint --max-warnings 0` 通过；前端全量 `vitest` **1406 通过 / 16 跳过 / 0 失败**。

仍留在门禁里的**已知豁免**（未新增、未放宽）：文件管理器行内复选框/展开键的 `target-size`（密度决策）、消息时间与 ID 的 `color-contrast`、仪表盘与新建流程页把 `Tabs` 当分段选择器导致的 `aria-valid-attr-value`、报告页正文里智能体抓取网页带来的空链接 `link-name`。这几项都记在 `e2e/routes.ts` 的豁免清单或上面的「剩余项」里。

### 交互助手会话的「分析报告」生成（2026-09-14 晚）

用户反馈：交互助手导出的东西"根本就不是报告，算是流程输出"，要求像项目报告/学术报告那样写清背景、调研、技术、问题与结论。原因是此前助手模式**没有任何报告生成环节**——导出内容只是把 219 条会话消息按时间顺序拼起来（自动化模式有 reporter agent 写任务报告，助手模式没有对应物）。

本次新增一条后端报告生成链路（不改动自动化模式的既有报告逻辑）：

- **材料整理（有界、可测）**：`backend/pkg/reports/assistant_report.go` 的 `BuildMaterial` 把会话按**证据种类**重组——用户输入、助手分析与结论（主要信源，尽量留全文）、调研与检索（意图 + 结果摘录）、终端与文件（意图 + 输出摘录，保留尾部因为报错在末尾）、其他记录；**丢弃 `thinking`**（模型中间过程，不是证据，且占绝大部分字节）。整份材料按节预算（合计 48KB：输入 4K / 回复 24K / 检索 6K / 工具 10K）在条目间均分并逐条截断，超限处标注「已截断」，会话再长也不会把提示词撑爆或静默丢失。
- **写作提示词**：`backend/pkg/templates/reports/assistant_reporter.tmpl`（**刻意不放在 `prompts/`**，因为 prompts/ 下每个文件都会成为设置页可覆盖的默认提示词，而报告撰写器不应被用户提示词覆盖）。提示词强制七段结构（摘要 / 背景与目标 / 调研与信息收集 / 技术方案与实施 / 遇到的问题与解决 / 结论与成果 / 风险与后续建议）、按主题重组而非按时间复述、只用材料中的事实（缺失写「材料未体现」、推测必须标注）、技术标识保留原文、**禁用表格**（PDF 不支持）、正文 ≤2500 字、失败也要如实写。
- **调用与落库**：`reports.Generate` 读流程/助手/会话 → 组织材料 → 渲染提示词 → 用**助手自己的 provider**（`ProviderController.GetProvider`）以 `simple` 档模型做一次调用 → 结果以 `report` 类型写入 `assistantlogs`（`result_format=markdown`，标题按流程语言取「分析报告 / Analysis report」）。**同一会话重复生成是原地覆盖**，不会堆多份；库里没有真实报告时才会新建。
- **GraphQL**：`generateAssistantReport(flowId, assistantId): AssistantReport!`（gqlgen 重新生成，权限沿用 `assistants.edit` 的流程级校验）。
- **前端**：报告内容生成器改为「**有报告就用报告当正文 + 会话记录作为《附录：会话记录（原始证据）》**；没有报告则保留会话记录并在顶部标注尚未生成」。入口两处：流程详情「报告」下拉（生成/重新生成，成功后自动刷新会话日志）与独立报告页右上按钮；网页视图/复制/MD/PDF 四条出口都读同一份内容，因此生成后导出即为报告。

验证：

- 后端 `pkg/reports` 单测（材料分组与顺序、thinking 不被采用、超预算截断并标注、多字节截断不产生乱码、提示词含语言与结构、已有报告可被找回而不是新建）全部通过；`go build ./...`、`go test ./pkg/graph/... ./pkg/reports/...` 通过。
- 前端单测 **1409 通过 / 16 跳过 / 0 失败**（`report.test.ts` 新增「报告优先 + 附录」「未生成报告时明确标注」「空报告行不算数」等用例）；`tsc -b`、`eslint --max-warnings 0` 通过。
- **真机验证**（对已部署实例、flow #1 的真实 219 条会话调用一次）：11.5 秒生成 4202 字符报告，标题《网站安全测试计划》渗透测试报告，七节齐全；「遇到的问题与解决」按 现象→原因→处理→结果 列了 8 条（含脚本被重置、meta 跳转无效、回调不可达、隧道失效、12 链接冻结、属性冲突、`pkill` 自匹配等真实过程）；「结论与成果」区分已确认与尚需验证并给出 flag；「风险与后续建议」含评级与四条修复建议。报告页渲染顺序为 报告正文 → 附录会话记录，MD 导出 130,738 字符以报告开头，PDF 728,646 字节且 `%PDF-` 有效。


### P0 并发限制与 PDF/键盘无障碍补齐（2026-09-15）

- 生命周期同步从全局互斥改为**按 flow_id 串行**：同一流程的创建、停止、结束、删除、助手创建与重命名仍保持顺序；慢模型或慢 Docker 初始化不再阻塞另一流程的停止。
- 后台作业执行器从单飞改为**最多 4 个不同流程并发**，调度器为每个流程维护 FIFO 队列；同一流程不会并发执行生命周期作业，不同流程不再无条件排队。竞态测试覆盖“慢初始化时另一流程停止立即完成”“不同流程并发、同一流程串行”。
- PDF 导出补齐 Markdown 表格：此前 `table` token 被忽略，现渲染灰底粗体表头、边框、中文换行和单元格；长表按 14 行分段，每个跨页分段重复表头并禁止行内分页。用 42 行中英文样例实际生成 3 页 PDF，逐页渲染检查确认无裁切、越界、重叠、分页残边，续页均有表头。
- 键盘/辅助技术树实测发现密码可见性按钮被 `tabIndex=-1` 排除，已修复并加回归测试。开发版真实 Tab 顺序为“登录账号 → 密码 → 显示密码 → 登录”，控件中文名称在辅助技术树中完整可见。
- 当前自动化电脑接口仅开放浏览器，且本机未安装 NVDA，无法读取 NVDA/讲述人的真实语音输出；因此不把“真实读屏器语音验收”虚报为完成。当前已完成 axe、浏览器辅助技术树与纯键盘检查，NVDA 语音走查仍需在本机人工执行。

验证：`go test -race ./pkg/controller ./pkg/graph/... ./pkg/reports/...` 通过；PDF/登录相关定向前端测试通过，`tsc -b` 与 ESLint 通过。前端全量并行测试为 1409 通过 / 16 跳过 / 2 个既有时序用例偶发失败，两个失败文件隔离重跑 22/22 通过。

## 扫描口径说明

统计“还剩多少英文文案”时必须扫描 `frontend/src` 下的**全部**非测试 `.ts` 与 `.tsx`（只扫 `.tsx` 会漏掉路由标题注册表、API 层、上传校验与资源/文件操作 hook 里的用户可见文案），并把已出现的 `uiText(...)` 调用遮蔽后再匹配，不能跳过已接入文案表的文件：早期版本跳过这些文件，导致 `flow-files.tsx`、`flow-assistant-messages.tsx`、`flows.tsx` 等已接入文案表的文件里剩余的英文没有被统计，进度被高估。匹配要覆盖五类：JSX 文本节点（单行与多行）、常见属性值（含自定义属性）、字符串字面量、**反引号模板字面量**（toast 描述、无障碍名、确认句大量藏在这里），以及把选项名拼进 `aria-label` 的位置。另外两类第九批仍未覆盖，统计时不能省：一是被行内 `<code>` 切开的描述句，`>` 规则只能匹配紧跟标签后的第一段，`</code>` 之后的英文尾巴要单独搜索；二是徽标、下拉项里由数据驱动的显示标签（如令牌状态 `active`/`revoked`/`expired`），它们不是“大写单词开头的句子”，需要按“界面可能出现的英文单词”回查。匹配 `>` 时还要排除箭头函数与注释：前一字符是 `=` 或 `-` 的候选要剔除，否则 `() => ...` 与行内注释里的英文会淹没结果。加入新文案时，词条去重要同时检查 `'Key':` 与裸标识符 `Key:` 两种写法，否则会写出重复键，`tsc` 会以 TS1117 报错。

替换位置比词条数量更容易出错，每次批量替换后必须区分并按位置处理：

- **展示位置**（JSX 文本、`aria-label`/`placeholder`/`title`/`label`/`description` 等属性值、`toast.*` 与表单校验消息）→ 换成 `uiText(...)`。
- **数据位置**（类型联合、`===`/`!==`/`case`/`.includes()` 比较值、对象里的存储字段、GraphQL 错误码、路由、测试夹具、键盘事件 `{ key: 'Enter' }`）→ **保持英文原值**，只翻译渲染出来的那一份。
- 属性值替换要保引号与花括号：`label="Upload files"` 应写成 `label={uiText('Upload files')}`，直接替换字面量会得到 `label=uiText('Upload files')`，这种语法错误 `tsc -b` 与 ESLint 不报，只有 `vite build` 会失败，所以每批都必须跑一次生产构建。
- 批量替换脚本可能对同一文件跑两次，产生 `uiText(uiText('Key'))` 双层包裹，结果取不到词条而返回原键；替换后要全库折叠一次。

## 已修复的工具问题

`scripts/update.ps1` 以 UTF-8 无 BOM 保存，本机只有 Windows PowerShell 5.1，它会按 ANSI 代码页读取无 BOM 脚本，导致中文提示与 `{ }` 结构被解析器判错，脚本实际上无法直接运行。已在脚本头部写入 UTF-8 BOM，解析检查通过后按原流程完成构建与部署。该文件今后必须保持 UTF-8 BOM 保存。

## 尚未完成

- 全站中文化：JSX 文本节点层面的界面文案已清完（第十批关闭了最后 7 处：模型用量卡片标题、文件页无匹配空态、附加资源与从容器拉取两个弹窗的整段说明、详情导航提示、API 令牌状态标签、复制消息的 Markdown 小标题）。118 个非测试源文件接入文案表（`frontend/src/locales/zh-CN.ts`，约 970 条词条），23 个测试文件改为经 `uiText(...)` 取期望文案。第三方库自身抛出的英文错误不在此范围。按第九批修正后的口径（`frontend/src` 下全部非测试 `.ts` 与 `.tsx`，遮蔽 `uiText(...)` 后匹配 JSX 文本、多行文本、常见属性、字符串字面量与反引号模板字面量，范围含 `providers/`、`hooks/`、`lib/`）剩余英文逐条确认后，全部属于**不应翻译**的四类：品牌与产品名（PentAGI、GraphQL Playground、Swagger UI、Kimi/MiniMax/Qwen 等模型服务商名）、类型与数据值（`Promise`、`None`、GraphQL 错误码、GraphQL 查询文本、`Record<string, boolean>`）、日志与示例（`Redirection failed:`、`GraphQL WebSocket closed`、示例 URL、字体名、`Cmd`/`Ctrl` 等按键名）、模板页内置的 11 个预设模板名称与正文（生成提示词用内容）。技术参数名 `Top K`/`Top P` 与协议名 `OAuth` 同样保留英文。
- P0A 验收项：① 页面走查**已完成**（见「P0/P0A 验收补齐」：27 条路由 + 390/768/1280 三断点，0 截断 / 0 溢出 / 0 控制台错误，修掉 4 处 axe critical/serious 并加了回归测试）；② 报告 PDF 已确认为完整文档，Markdown 表格及跨页重复表头也已用 3 页样例逐页视觉核对；③ 无障碍已完成 axe、未登录上下文复扫、浏览器辅助技术树与纯键盘顺序检查，并修复密码可见性按钮不可 Tab 聚焦的问题。受当前电脑接口限制，**NVDA/讲述人真实语音输出仍需人工走查**。计划里的“错误码映射为中文说明、原始诊断放可展开详情”已实现（见 `lib/errors.ts` 与 `ErrorState`），但后端新增错误码时需要同步登记，否则会退回展示英文原文。
- 任务创建与删除的后台作业机制已落地（P0 第 3、5 条）：创建、停止、结束、删除都有持久作业行、分段耗时与关联标识、失败重试与重启恢复；受理路径 p95 基线与慢模型/慢 Docker/故障注入**已补测**（创建 7.54ms / 结束 4.97ms / 删除 4.69ms / 读 16.3µs，真实栈读路径 p95 ≤ 50.5ms）。原先的两个跨流程限制已于 2026-09-15 修复：生命周期锁按流程隔离，后台调度最多并发处理 4 个不同流程，同时维持单流程 FIFO。
- 资产发现/漏洞扫描、漏洞收集、利用链推理、渗透测试、报告输出的业务改造与对应页面：**均未开始**（旧计划书 P1–P6 的编号已废弃，改用 `docs/research-platform/PLAN.md` 的 A–H 阶段划分）。原始运行日志和第三方错误内容不属于静态文案替换范围。

## 研究平台后续开发基线（2026-09-15 核对）

实施依据为 [后续开发方案](docs/research-platform/PLAN.md) 与 [开发契约](docs/research-platform/CONTRACTS.md)。保留与 DeepSeek Harness 讨论的产品要点；原 P1–P5 方案转为历史需求来源，后续开发使用 A–H 编号。

- 当前代码基线：`codex/research-development` / `f4e300a`；此后本轮仅修订文档。
- 当前迁移目录有 32 个既有文件；研究域迁移、research_*.sql、研究生成查询均不存在。
- `backend/pkg/research`、`backend/pkg/tools/policy.go`、`backend/cmd/migrate`、迁移演练脚本均不存在；阶段状态机、研究执行策略、目标范围守卫待开发。
- 撤回此前“9 个迁移、65 张表、358 个查询、T2–T4 完成及相关测试通过”的完成记录。当前无对应实现，不能复现所列测试；不推断其他工作目录是否曾有代码。
- 历史 `20250331_200137_assistant_mode.sql` 的 Down 仍先删 assistants 再删 assistantlogs，未修复；后续单独修正并验证。
- 本轮没有执行数据库迁移、构建部署或运行新增业务测试；数据库是否曾有额外变更未核验，不能凭文档断言开发库/应用库状态。
- 已有 P0/P0A 和通用报告代码保留，具体历史测试记录见上文。新阶段回归应覆盖受影响的 tools/controller/报告功能。
- 文档契约已整理但尚未通过代码验证；A–H 实现均待开始。下一批按 PLAN §9.1 执行 A-01 至 A-07，先交付核心任务、范围、证据、调度和策略。
- Neo4j 及可视化、Zeek 优先、三入口共用状态、Skill/MCP、多智能体反馈、独立靶场和软著材料继续保留。实验、真值集和人工工时统计不纳入当前实施；业务审计和证据门槛保留。

后续记录格式：开发项 / 提交与实际文件 / 验收命令及结果 / 未完成项 / 是否迁移或部署。设计写完、代码写完、测试通过和部署完成分别记录。

## 文档修订（2026-09-16）

**开发项**：按第二、三轮评审意见校正研究平台设计文档，产出 `docs/research-platform/PLAN.md` v1.2 与 `docs/research-platform/CONTRACTS.md` v1.2，并把报告引用从行号改为章节/表号锚点（附件身份登记入库，需求原文不入库）。本轮只改文档与引用材料，未改任何代码。

**实际文件**：设计内容修改两份（`docs/research-platform/PLAN.md`、`docs/research-platform/CONTRACTS.md`）；新增 `docs/research-platform/references/README.md`（脱敏：只含附件编号、文件名、大小、SHA-256、章节 ↔ 行号对照）与 `docs/research-platform/references/extract_midterm_docx.py`（改为参数化、去掉本机绝对路径）；并同步更新本实施状态记录。需求原文 `midterm-report-extracted.md` 与 `requirements-checklist.md` **不进入本次提交**，仅本机保留，已写入 `.git/info/exclude`（连同 `tmp/`）。

**改动内容**

- 两份文档互相对齐：表名统一为 `research_projects`/`project_scopes`/`outbox_events`；A7 补 `verification_facts`；K 阶段输出名改为 `knowledge_documents`；任务状态补 `queued`、`completed → running` 重算（新建运行修订）与 `terminated` 不可逆终态，并补完整任务状态转移表；阶段转移补 `pending → ready` 与 `skipped → ready`。
- `research.*` 权限种子由 A9 移入 A1，使 A 阶段 API 与 B 阶段页面在第一批即可授权（PLAN §4 与 CONTRACTS §6 同步）。
- 对照代码修正事实：`DisableFunction.Context` 的 oneof 在 `backend/pkg/tools/tools.go:59`（此前误写 `:49`）；compose 表述改为"同一可选 compose 栈（`docker-compose-graphiti.yml`，未配置 Compose profiles），需拆分启动单元或增加 profile"；goose 版本解析改为格式风险描述，并注明 `20250103_1215631_*.sql` 的 7 位时间位位于版本号之后的名称部分、不影响解析（版本仍取 `20250103`）；A1–A9 示例文件名全部换成合法 14 位时间戳（`20260916100000_research_core.sql` … `20260924100000_research_privileges_indexes.sql`）。
- 补回评审中漏掉的约束与映射：阶段内 PentAGI 对象只读且不得以 `subtask_id` 作键、证据沿用 `pkg/flowfiles`；CONTRACTS 新增 §5.4 执行边界与出站限制（三处容器命令面、研究 runner 禁挂完整 socket、出站白名单须在 E 阶段完成）；PLAN 新增 §8.1 报告八模块与五权限域覆盖矩阵、§6 Skill/MCP 与现有注册表映射、§8 中文化数字/日期与路由登记、§1.4"未来扩展影响记录"（不建 `activity_log`、不加 `ground_truth_ref`，不留占位字段）。
- 报告引用改为章节/表号锚点：`报告 §7.1`、`报告表 6.4` 等；确需行号时写"`REF-MIDTERM-0830` 抽取版本行 N"。`docs/research-platform/references/README.md` 登记附件编号、文件名、大小、SHA-256（`916915D6…0274`）与章节 ↔ 行号对照；抽取脚本改为参数化并去掉本机路径后入库。需求原文与逐条清单不入库：两份文件写入 `.git/info/exclude`，仅本机保留（原因：本地提交对象仍可能被误推、合并或打包）。同时修正了原 `报告 123` 的错误锚点——该行号落在目录区，实际规则位于 §4.2.3（抽取版本行 416）。
- 第三轮复核修正（对应评审 5 条核心问题）：① 撤回"所有容器命令收敛到两个咽喉点"的表述——进程内容器命令面实为 `ContainerCreate`、`ContainerExecCreate`、`ContainerExecAttach` 三处，且 `DOCKER_INSIDE=true` 时宿主 `docker.sock` 会挂进 worker 容器、可直接访问 Docker daemon，故改为"三处命令面整体受控 + 研究 runner 禁挂完整 socket，必要时用受限 Docker API 代理"；② 网络部分改为"按任务独立网络只解决任务间不串扰，不限制公网/宿主/局域网"，出站白名单（目标 IP/CIDR、端口、协议、DNS 一致性、重定向再校验）提前到 E 阶段主动扫描前完成；③ E 阶段出口条件由"研究流程无法调用 `terminal`/`file`"改为"模型不能直接调用通用 `terminal`/`file`，允许网关白名单命令与受限证据文件接口"；④ `terminated` 改为**不可逆终态**，`completed` 重算改为**新建运行修订并关联原任务**，不重开完成快照；⑤ 报告引用改为章节/表号锚点并脱敏入库（需求原文不入库，见上一条）。

**验收命令及结果**（只读核对，未执行构建、迁移或测试）

- 迁移与表：`backend/migrations/sql/*.sql` 共 32 个文件、26 张既有表，无重复版本；研究域迁移与 `backend/pkg/research` 均不存在。
- 工具与死代码：`pkg/tools/registry.go` 有 42 个工具名常量；`Functions.Disabled` 只有定义（`tools.go:41`）与 `SetFunctions`（`tools.go:442-444`）赋值，全 `pkg/` 无读取点。
- 容器命令面（**只核对代码位置，不能证明不存在旁路**）：`pkg/docker/client.go` 有 `ContainerCreate`（`:433` 起）、`ContainerExecCreate`（`:907`）、`ContainerExecAttach`（`:915`）三处；现有 exec 调用方为 `terminal.go:225/269`、`tools.go:656/665`、`server/services/flow_files.go:1336/1345`，`executor.go:242`（`customExecutor.Execute`）是工具分发点。此前文档称"两个咽喉点覆盖所有容器命令出口"与代码不符（漏算 `ContainerCreate` 与 `ContainerExecAttach`），已改写为三处命令面并整体受控。另核实 `DOCKER_INSIDE=true` 且未设 `DOCKER_INSIDE_HOST` 时，宿主 `docker.sock` 会被 bind-mount 进 worker 容器（`pkg/docker/client.go:337-342`，判定见 `Config.WorkerDockerSocket()`，`pkg/config/config.go:402-423`；默认 `DOCKER_INSIDE=false` 见 `:34`）。旁路是否存在需等 E 阶段负向测试，本项不是设计正确性验收。
- compose：`docker-compose-graphiti.yml` 含 `neo4j`（第 12 行）与 `graphiti`（第 60 行），文件中无 `profiles:` 键。
- 文档自检：两份文档均为纯 LF；替换后 `\d{8}_100000` 匹配数为 0；A1–A9 文件名全部为 14 位；`git check-ignore` 确认需求原文与 `tmp/` 被本地排除，`git status` 待提交列表中不含它们。

**未完成项**

- `activity_log` 与 `ground_truth_ref` 按 D1 不做，不留占位字段；反转成本见 PLAN §1.4。
- A9 批次名是否改为 `20260924100000_research_indexes.sql`，待定。
- `docs/research-platform/references/` 的 README 为脱敏版本；需求原文只在本机保留，若后续需要变更来源（新版本附件），先更新 README 的附件编号与哈希，再复核全部引用。
- 出站限制、socket 禁挂与"白名单命令/受限证据接口"三项均为设计约束，需在 E 阶段用负向测试落地验证（本轮只改文档）。

**是否迁移或部署**：均否，本轮仅文档修订。

## 部署方式

只使用原 Compose 项目及其数据库等配套服务。`scripts/update.ps1` 从当前源码构建并替换同名 `pentagi` 应用；不新增第二套展示容器，不制作旧版备份。当前部署实况与复核命令见 `DEPLOYMENT.md`。

版本管理：所有改动只提交到本机分支 `codex/research-development`，不推送到远端仓库，`main` 与 origin 保持原样；需要历史快照或回退时用本地分支上的提交。
