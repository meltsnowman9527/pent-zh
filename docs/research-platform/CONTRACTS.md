# 研究平台开发契约（待实现与验证）


版本：v1.2 · 日期：2026-09-16 · 配套文档：`docs/research-platform/PLAN.md`
状态：本文定义后续代码应满足的契约，当前无研究平台实现。A 阶段通过数据库/API/并发测试后冻结相应语义；之后语义变更需版本与迁移记录。原"已实现"与测试通过声明已撤回。

**v1.2 变更（2026-09-16）**：A1 表名与 PLAN 统一（`research_projects`/`project_scopes`/`outbox_events`）、`research.*` 权限种子移入 A1；补齐任务状态转移（`queued`、`completed → running` 重算）与阶段转移缺口（`pending → ready`、`skipped → ready`）；修正 `DisableFunction.Context` 取值（对齐现有 oneof，本版不新增 API 取值）；K 阶段输出名改为 `knowledge_documents`；新增 §5.4 执行边界与出站限制（三处容器命令面不等于"容器命令唯一出口"、研究 runner 禁挂完整 Docker socket、出站白名单必须在 E 阶段完成）；`terminated` 改为不可逆终态、`completed` 重算新建运行修订；补阶段内对象只读与 `subtask_id` 禁用、证据沿用 `pkg/flowfiles`；报告引用改为章节/表号锚点（附件编号 `REF-MIDTERM-0830`，需求原文不入库）；生成工具版本落地的要求。

---

## 1. 对象标识规则


| 规则 | 内容 |
|---|---|
| 主键 | 稳定数值主键；采用仓库兼容的 BIGINT IDENTITY，具体语法在迁移评审时确定；不假定现有表全部使用 BIGSERIAL |
| 展示编号 | 每类对象有 `code`，按项目内唯一、人类可读：资产 `A-0001`、漏洞知识 `VUL-0001`、资产漏洞实例 `AV-0001`、候选链 `CH-0001`、验证任务 `VT-0001`、证据 `EV-0001`、报告 `RP-0001` |
| 禁止作为身份 | IP 地址、主机名、CVE 编号、端口不得作为唯一身份（报告 §4.2.3；`REF-MIDTERM-0830` 抽取版本行 416）；CVE 只是 `vulnerabilities` 的属性，资产漏洞实例用 `(asset_id, vulnerability_id, context)` 表达 |
| 稳定外部引用 | `asset_identifiers`（序列号、云资源 ID、MAC、主机名、厂商设备 ID）带来源与置信度；归并后仍保留成员观测 |
| 版本字段 | 可编辑业务对象含 revision 与时间戳/软删除；不可变证据、审计、事件、发布快照采用追加记录及明确保留策略 |
| 图节点标识 | Neo4j 节点属性 `pg_id`（= PostgreSQL 主键）、`project_id`、`revision`、`source_revision` |

---

## 2. 状态词表（报告 ↔ 方案 ↔ 界面 ↔ 数据库）


> 这是唯一的状态定义处。界面标签统一走 `uiText` 文案表。
> 引用来源：正文引用优先写章节/表号（如 `报告 §7.1`、`报告表 6.4`）；确需行号时写"`REF-MIDTERM-0830` 抽取版本行 N"。附件编号、文件名、大小、SHA-256 与章节 ↔ 行号对照见 `docs/research-platform/references/README.md`。需求原文与逐条清单**不入库**（仅本机保留，已被 `.git/info/exclude` 排除），需要原文时按附件编号索取并按哈希核对。

### 2.1 研究任务 `research_tasks.status`

`draft` 草稿 · `queued` 等待调度 · `running` 运行中 · `awaiting_approval` 等待审批 · `awaiting_input` 等待人工补充 · `paused` 暂停 · `error` 异常 · `terminated` 已终止 · `completed` 已完成
（对应报告表 7.2 运行状态，保留 `completed` 与业务判断状态分离）

**计划允许的任务状态转移**（与阶段一样，只由 `pkg/research` 写入）

| 从 | 到 | 触发条件 |
|---|---|---|
| `draft` | `queued` | 任务创建并提交调度 |
| `draft` / `queued` | `running` | 首个阶段开始执行；交互助手或分步页面可直接启动，省去排队 |
| `running` | `completed` | 所有必要产物通过校验且无运行中作业 |
| `running` | `awaiting_input` / `awaiting_approval` | 阶段进入对应等待态 |
| `running` | `paused` | 人工暂停，或反馈轮次超限转人工 |
| `running` | `error` | 阶段失败且无自动恢复路径 |
| `running` | `terminated` | 人工终止或授权失效 |
| `awaiting_input` / `awaiting_approval` / `paused` | `running` | 补齐输入、批准或显式恢复后重新调度；恢复须重检授权、窗口、审批与目标状态 |
| `completed` | `running` | 上游修订变化或复测要求触发重算：**创建新的 `stage_run` 与 `OutputRevision` 并关联原任务**，新运行进入新修订；原完成运行、已完成产物与已发布报告快照保持只读，不新增未规划的 task_runs 表 |
| `error` | `running` | 人工修复后重试（同一任务的新 `stage_run`） |

`skipped` 不等于检测成功；阶段失败 → 任务 `error`；阶段等待 → 任务对应等待态；已发布报告不因任务重算而被改写。

`terminated` 是**不可逆终态**，不提供回到 `running` 的边；需要继续工作时创建新任务并关联被终止的原任务，原任务的产物与审计保持只读。

### 2.2 阶段 `research_stages.status`

`pending` 未开始 · `ready` 可执行 · `blocked` 前置不足 · `running` 执行中 · `awaiting_input` 需补充输入 · `awaiting_approval` 等待审批 · `succeeded` 已完成 · `failed` 失败 · `skipped` 已跳过 · `stale` 需重算 · `cancelling` 停止中 · `cancelled` 已停止
判定规则：`succeeded` 只有在产出物与校验全部满足时才允许写入；模型不能直接置位。

**计划允许的状态转移**（待新增 pkg/research 服务作为唯一写入方）

| 从 | 到 | 触发条件 |
|---|---|---|
| `pending` | `ready` | 依赖产物与修订已满足，阶段可执行但尚未触发（显式标记，供页面区分"未开始"与"可执行"） |
| `pending` / `ready` / `stale` | `running` | 依赖产物/修订满足；允许无发现等经规则确认的跳过结果；主动动作授权前置通过 |
| `running` | `succeeded` | 服务校验产物、项目归属、输入修订和证据门槛后写入有效 OutputRevision |
| `running` | `failed` | 处理器返回错误，或该阶段没有注册处理器（`capability_unavailable`） |
| `running` | `awaiting_input` | 处理器返回 `AwaitInput`（缺输入/缺证据） |
| `running` | `awaiting_approval` | 处理器返回 `AwaitApproval` |
| `running` | `blocked` | 缺有效授权或授权过期，分别使用 precondition_missing / authorization_expired，写 deny 审计 |
| `succeeded` | `stale` | 上游阶段重算（原因码 `upstream_recomputed`） |
| `failed` / `blocked` / `awaiting_*` | `ready` | 人工重试或补齐前置后 |
| 任意非终态 | `skipped` | 人工请求跳过且服务确认该节点可跳过，记录原因；不能跳过授权/审批校验 |
| `skipped` | `ready` | 人工撤销跳过，或上游重算后该节点重新具备执行意义 |
| `running` | `cancelling` | 持久化停止请求或输入版本失效，通知执行器 |
| `cancelling` | `cancelled` | 已确认执行停止或完成必要恢复；未确认时保持停止中并报警 |
| `cancelled` | `ready` | 显式恢复且重新检查依赖、授权、审批；新建运行尝试 |

`stale → running` 与 `stale → ready → running` 等价：前者由编排器自动重算，后者由人工触发；`running → blocked` 只能由服务层授权前置写入，处理器不能直接置位。

### 2.3 资产

- 记录状态 `assets.status`：`draft` 待核验 · `active` 已确认 · `merged` 已归并 · `retired` 已停用
- 属性/观测状态 `observations.status`：`observed` 已观察到 · `not_observed` 未观察到 · `no_response` 工具无响应 · `unknown` 字段未知 · `confirmed_absent` 人工确认不存在 · `stale` 过期 · `conflict` 冲突
  （报告 §7.2 要求这几种语义不得合并）
- 可达性 `reachability.kind`：`discovery` 资产发现可达 · `network` 网络连接可达 · `service` 服务访问可达
- 可达性状态 `reachability.state`：`observable` 可观测 · `network_reachable` 网络可达 · `service_reachable` 服务可达 · `restricted` 受限可达 · `historical` 历史可达 · `pending` 待确认 · `unreachable` 不可达
- 归并：`asset_merges.strategy` = `strong_key` | `scored` | `manual`；含分项得分、算法版本、成员观测，支持拆分

### 2.4 漏洞知识

- `knowledge_revisions.status`：`draft` · `published` · `superseded` · `conflict`
- 版本解析 `affected_ranges.parse_status`：`parsed` · `partial` · `unknown` · `unsupported`
- 来源冲突：同一对象多来源不一致时保留全部来源，`intel_snapshots` 记录原始快照与哈希

### 2.5 候选与检测（报告表 4.2 / 4.3）

- 候选筛选 `asset_vulnerabilities.candidate_state`：
  `to_detect` 待检测 · `need_asset_attributes` 待补充资产属性 · `excluded` 已排除 · `need_review` 待复核
- 漏洞判定 `asset_vulnerabilities.detection_state`：
  `candidate` 待确认（报告"待确认"）· `confirmed` 已确认 · `not_detected` 未检出 · `conflict` 冲突 · `stale` 过期
- 报告三态映射：已确认→`confirmed`；未检出→`not_detected`；待确认→`candidate`（`conflict`/`stale` 为本方案扩展，需在报告口径中说明）
- `not_detected` 前置条件（报告表 4.3，必须机器校验）：目标、能力版本、必要凭据、业务窗口、检测步骤全部满足，且保存 `detection_coverage` 快照

### 2.6 条件与链路（报告 §6.2–6.3）

- 条件 `conditions.state`：`satisfied` 满足 · `partially_satisfied` 部分满足 · `unsatisfied` 不满足 · `unknown` 未知 · `conflict` 冲突
- 链路衔接 `chain_edges.linkage`：`full` 完全衔接 · `partial` 部分衔接 · `mismatch` 不匹配 · `unknown` 未知
- 候选链 `candidate_chains.status`：`candidate` 候选 · `needs_evidence` 待补证 · `submitted` 已提交验证 · `verified` 已由验证支持 · `refuted` 已被否定 · `expired` 数据过期
- 评分：`chain_scores` 分列可信度分项与风险分项，权重存 `policy_versions.rules`（版本化）

### 2.7 验证（报告表 6.4）

- 运行状态 `verification_tasks.run_status`：`draft` · `blocked` 依赖未满足 · `ready` · `awaiting_approval` · `running` · `succeeded` · `failed` · `aborted` · `blocked_by_policy`
- 判断状态 `verification_results.conclusion`（七类，固定）：
  `verified` 已验证成立 · `conditions_met_not_executed` 条件成立但未执行高风险动作 · `conditions_failed` 条件不成立 · `insufficient_evidence` 证据不足 · `blocked_by_constraint` 受约束阻断 · `execution_failed` 执行失败 · `needs_human_review` 需人工复核
- 判定约束：工具返回成功/退出码/模型置信度只写 `execution_records`，不写 `conclusion`；`verified` 需同时满足关键前置条件有证据支持、目标侧观察与机理一致、必要证据完整
- 事实四分类（报告 §6.7）：`verification_facts.fact_type` = `condition` | `execution` | `effect` | `constraint`

### 2.8 审批与执行

- `approvals.status`：`pending` · `approved` · `rejected` · `withdrawn` · `expired`
- 绑定字段：`target`、`params_hash`、`capability_version`、`policy_version`、`expires_at`、`approver_id`；参数/策略/能力变更即失效
- R3 需 `approver_id` 两名且互不相同、且不等于申请人（程序校验）
- `policy_decisions.decision`：`allow` · `deny` · `downgrade` · `require_approval` · `terminate`；每次拒绝也写审计
- 风险等级 `capabilities.risk_tier`：`R0` 离线分析 · `R1` 被动/只读 · `R2` 低扰动可逆 · `R3` 隔离仿真状态改变 · `R4` 禁止实际执行（仅离线推演）

### 2.9 证据

- `evidence.review_status`：`collected` · `parsed` · `reviewed` · `rejected`
- `evidence.integrity`：`sha256` 必填；`source_type` = `tool_output` | `target_observation` | `config_snapshot` | `log` | `screenshot` | `external_document` | `human_input`
- 原始与解析分离：`evidence` 指向不可变 blob，解析结果存 `evidence_parsed`，模型摘要单列并标注

### 2.10 报告与整改

- `report_versions.status`：`draft` · `in_review` · `published` · `retest`
- `remediations.state`：`new` · `unchanged` · `closed` · `reopened`
- 发布前置：`report_versions` 冻结 SQL 修订号、文件哈希集合、规则/提示词/模型/模板版本；存在未处置冲突或缺关键证据时禁止发布

### 2.11 失败原因码 `reason_code`（所有阶段 API 必返回）

`ok` · `precondition_missing` · `scope_denied` · `authorization_expired` · `business_window_closed` · `capability_unavailable` · `capability_not_approved` · `approval_required` · `approval_expired` · `policy_denied` · `parse_failed` · `version_unknown` · `evidence_insufficient` · `source_conflict` · `projection_lagging` · `data_stale` · `timeout` · `truncated` · `partial_completion` · `execution_failed` · `recovery_failed` · `no_valid_path` · `feedback_limit_reached` · `human_review_required`

---

## 3. 阶段接口契约


统一响应信封（所有阶段 API）：

```json
{
  "status": "awaiting_approval",
  "reason_code": "one of §2.11",
  "reason_text": "中文说明（界面直接显示）",
  "input_revision": {"assets": 12, "knowledge": 7, "policy": 3},
  "output_revision": {"assets": 13},
  "evidence_ids": [101, 102],
  "next_actions": [{"action": "run_stage", "stage": "M", "label": "重新匹配"}],
  "blocked_by": [{"kind": "missing_input", "object": "assets", "detail": "版本字段缺失 3 条"}]
}
```

| 阶段 | 输入 | 确定性处理 | 输出 | 主要事件 |
|---|---|---|---|---|
| K | 知识源配置、上传资料、内部反馈事件 | 采集、解析归一、实体归并、版本范围解析、来源冲突、快照与版本、图谱边 | `knowledge_revisions`、`vulnerabilities`、`affected_ranges`、`conditions`、`detection_features`、`device_constraints`、`knowledge_documents` | `knowledge.updated`、`graph.projection` |
| A | 范围/授权、被动观测（Zeek 优先）、导入文件（pcap/Nmap XML/台账）、补全策略 | 观测标准化、实体归并、可达性判定、缺口清单 | `assets`、`asset_identifiers`、`observations`、`services`、`components`、`reachability`、`asset_merges` | `asset.updated`、`evidence.added` |
| M | 资产组件、知识修订、既有条件证据 | CPE/PURL 匹配 → 版本判定 → 条件核验 → 缺口分类 → 候选状态机 | `asset_vulnerabilities`（候选）、`detection_items`、`shared_detections`、`detection_dependencies` | `match.updated` |
| S | 待检测记录、已审核能力、执行约束 | 任务依赖、共享检测合并、技能选择、受控执行、证据回填、覆盖快照、三态判定 | `scan_jobs`、`findings`、`asset_vulnerabilities`（判定）、`evidence` | `scan.progress`、`finding.updated` |
| R | 冻结事实快照、搜索参数（版本化） | 子图提取、规则校验、有界搜索、剪枝去环、签名去重、分项评分 | `candidate_chains`、`chain_nodes`、`chain_edges`、`chain_scores`、`chain_analysis_runs` | `chain.updated` |
| V | 经复核候选链、验证任务图、授权与审批、能力版本 | 依赖调度、网关复核、受控执行、前中后基线、证据判定、七类结论 | `verification_tasks`、`verification_runs`、`verification_results`、`verification_facts`、`feedback_events` | `verification.progress`、`feedback.created`、`approval.*` |
| P | 冻结快照、审核状态、模板版本 | 字段装配、引用校验、脱敏、快照与版本、发布门禁 | `report_versions`、`report_sections`、`report_evidence_refs`、`remediations`、`retests` | `report.*` |

**阶段事件主题（GraphQL 订阅）**：`task.updated`、`stage.updated`、`job.progress`、`asset.updated`、`match.updated`、`scan.progress`、`finding.updated`、`chain.updated`、`verification.progress`、`approval.requested`、`approval.decided`、`evidence.added`、`feedback.created`、`knowledge.updated`、`graph.projection`、`report.updated`。

---

## 4. 一致性与幂等契约


1. **写接口**：接收 `idempotency_key`；数据库以 `(project_id, operation_type, idempotency_key)` 唯一去重（`idempotency_keys` 表）。
2. **事务 + outbox**：业务写入与 outbox 事件在同一事务；消费者按 `event_id` 幂等，指数退避，进入死信可见。
3. **投影**：pgvector 与 Neo4j 均为投影；投影失败不回滚正式事实；界面显示投影版本与积压。
4. **软删除**：被证据或报告引用的版本禁止物理删除（外键 + 服务校验）。
5. **范围过滤**：所有查询在服务层强制 `project_id`，按 ID 直查也必须复核归属；跨项目负向测试必须存在。
6. **状态转换**：只允许后端规则服务执行，记录 `from_state`、`to_state`、`rule_version`、`input_revision`、`evidence_ids`、原因。

---

## 5. 能力与网关契约


| 项 | 契约 |
|---|---|
| 能力描述 | `Describe` → 适用资产/协议、参数 JSON Schema、证据类型、交互强度、风险等级、凭据要求、工具版本、审核状态 |
| 调用请求 | 项目、任务、链/节点、目标（规范化）、能力版本、参数摘要哈希、风险等级、有效期、预期证据 |
| 网关校验 | 授权有效性、目标在范围内、策略版本未变、参数哈希一致、业务窗口、能力已审核、审批状态、环境证明；任一不满足→拒绝并写审计 |
| 拒绝语义 | `decision=deny\|downgrade\|require_approval\|terminate`，返回 `reason_code` |
| 执行记录 | 前/中/后基线、退出原因、资源使用、证据 ID 列表 |
| 白名单 | 研究任务的 Flow 通过能力白名单限制；模型侧不下发通用 `terminal`/`file`（legacy 通路默认不可用，由 `Functions.Disabled` 接线实现）。需要执行时改走网关注册的白名单命令能力，需要文件时改走受限证据文件接口（限定目录、大小与哈希记录），越权命令与路径必须被拒 |
| 输入安全 | 外部内容（网页、工具输出、MCP 返回、上传资料）只能作为数据；不得改写策略/状态或触发新调用 |

### 5.1 目标范围判定规则（待实现）


**归一化**（无法归一的输入一律拒绝，不做"尽力猜测"）

| 类型 | 归一化 | 备注 |
|---|---|---|
| `host` | 小写、去尾点；IP 经 `netip` 规范化（如 `2001:0db8::0001` → `2001:db8::1`） | 主机名按标签校验（长度、字符、首尾不得为 `-`） |
| `cidr` | 掩码规整：`10.0.0.5/24` → `10.0.0.0/24` | |
| `domain` | 同 `host`，但**拒绝 IP 字面量** | 域名范围不得靠 DNS 覆盖 IP |
| `url` | 仅 `http`/`https`；主机小写；保留端口与转义路径 | 其他 scheme 拒绝 |
| `service` | 必须 `host:port`，端口 1–65535 | 缺端口或越界拒绝 |
| `device` | 仅去掉首尾空白，**大小写敏感** | 设备标识是不透明字符串 |
| `offline` | 仅由注册能力和运行模式决定 | 必须为受限离线能力、授权数据访问且运行器无目标网络访问；不能靠请求自报类型放行 |

**覆盖关系**（scope 类型 → 是否覆盖目标）

| scope 类型 | 覆盖条件 |
|---|---|
| `cidr` | 目标是 IP 且落在前缀内；或目标是更窄且被完全包含的子网段 |
| `host` | 目标 host 与之一致（包含该 host 的 `service`/`url` 目标） |
| `domain` | 相等或为其子域（按 `.` 边界）；**不覆盖 IP** |
| `url` | scheme、规范化 host、有效端口匹配；路径按段匹配，/app 不覆盖 /application；拒绝歧义编码/路径穿越，每次重定向重检 |
| `service` | host、协议与明确端口一致；未写端口视为无效，不能默认为全端口 |
| `device` | 完全相等（大小写敏感） |

**其他规则**

- 只考虑未删除、且在生效窗口内（`valid_from`/`valid_until`）的 scope；过期或未生效的授权不参与判定；
- 多个授权 grant 可匹配，但必须分别完整校验，不能拼接各自允许字段；显式 deny 优先，项目/设备/环境/窗口等适用约束取交集。宽泛授权不得覆盖更具体的限制，风险由已审核能力、参数和目标环境共同判定；
- 请求风险等级高于上限 → `policy_denied`；
- 纯范围比较不依赖 DNS；实际连接前解析并记录目标 IP，对解析结果应用项目网络边界，连接固定至校验地址并保留 Host/SNI。重定向与重新连接重新校验；检测 DNS 重绑定、IPv4/IPv6 混合结果与网段越界；
- 拒绝原因码：`scope_denied`（不在范围）、`policy_denied`（风险等级超限）、`precondition_missing`（目标无法归一化）；
- 业务窗口在任何主动能力开放前实现后端校验，UI 编辑器可后置。窗口使用时区+时间段表达，恢复与每次执行均重检；限频覆盖运行器、目标、网段和安全域，额度取所有适用限制。

### 5.2 能力策略（待实现）


`Functions.Disabled` 原本存在于 REST 模型、数据库列与作业 payload，但**解析后从未被读取**。后续按以下契约接线：

| 项 | 语义 |
|---|---|
| 匹配键 | `Disabled[].Name` = 工具名（如 `terminal`、`file`） |
| 生效范围 | `Context` 为空 → **对所有智能体上下文生效**；非空 → 仅列出的上下文生效；上下文比较不区分大小写 |
| 生效位置 | ① `Tools()`：被禁能力**不再下发给模型**；② `Execute()`：即使模型仍报出该名称，也**拒绝执行**并返回明确提示 |
| 审计 | 每次拒绝写一条 `tool.denied`（结果 `deny`，原因 `function_disabled`，含工具名、流程 ID 与被截断的参数） |
| 向后兼容 | 旧通用流程保留现有行为；研究上下文缺失策略直接拒绝，必须显式传入允许集合并有测试 |
| 上下文标签 | 现有 `DisableFunction.Context` 的 oneof 固定为 9 个取值：`agent`、`adviser`、`coder`、`searcher`、`generator`、`memorist`、`enricher`、`reporter`、`assistant`（`backend/pkg/tools/tools.go:59`）。`primary_agent`、`pentester`、`installer`、`refiner` 是 AgentType 取值（`pkg/graph/model/models_gen.go:737-748`），**不是** Context 取值；本版不新增 API 取值：研究允许集合与 `Functions.Disabled` 只用上述 9 个，`agent` 覆盖 primary agent 与派生执行代理，`assistant` 覆盖交互助手。若确需更细标签，单独提交 oneof 扩展（迁移 + REST 校验 + 表驱动测试） |

**研究任务默认拒绝**：由服务端按项目/阶段/能力审核结果生成允许集合，并从根 Flow 传到所有子代理与 Assistant。Functions.Disabled 作为兼容附加限制，不能充当白名单。工具枚举与 Execute 都检查；用户自定义 HTTP/MCP 也经过同一网关。审计只保存脱敏参数摘要，不用简单截断替代凭据清理。

Skill 管理保存描述、输入输出、版本、适用阶段与绑定能力；Skill 文本本身不授予执行权。MCP 优先 Streamable HTTP，兼容所需旧 SSE；stdio 在独立受限进程中运行。工具发现只产生候选能力，新版本/新增工具需重新审核；所有能力限制目的地址与凭据使用。R2 以上必须审核；R0/R1 也不能绕过网络与数据权限。

### 5.3 审计动作目录（计划实现）


| 动作 | 触发点 | 结果 |
|---|---|---|
| `research.task.create` | 创建研究任务 | `ok` |
| `research.stage.start` | 阶段开始（含尝试次数与触发来源） | `ok` |
| `research.stage.succeed` / `research.stage.fail` | 阶段成功 / 失败 | `ok` / `error` |
| `research.stage.wait` | 阶段进入等待（缺输入/缺审批） | `ok` |
| `research.stage.block` | 缺有效授权被阻断 | `deny` |
| `research.stage.retry` | 人工重试（记录下游转 stale 数量） | `ok` |
| `research.task.complete` | 全部阶段完成 | `ok` |
| `research.gate.allow` / `research.gate.deny` | 范围与风险等级判定 | `ok` / `deny` |
| `tool.denied` | 被禁能力调用被拒 | `deny` |

后续阶段（能力网关、审批、报告发布、证据访问）按同一张表继续登记，命名形如 `<域>.<动作>`。

### 5.4 执行边界与容器网络（待实现）


- **应用内容器命令面必须整体受控**：`ContainerCreate`（`pkg/docker/client.go:433` 起，容器的启动命令）、`ContainerExecCreate`（`:907`）与 `ContainerExecAttach`（`:915`）三处；现有 exec 调用方为 `terminal.go:225/269`、`tools.go:656/665`、`server/services/flow_files.go:1336/1345`（每对 Create+Attach）。只在 `executor.go` 设卡时，任何新增通路都会绕过网关。**但这只收敛了进程内路径，不等于"容器命令唯一出口"**：`DOCKER_INSIDE=true` 且未设 `DOCKER_INSIDE_HOST` 时，宿主 `docker.sock` 会被 bind-mount 进 worker 容器（`pkg/docker/client.go:337-342`、`Config.WorkerDockerSocket()`），容器内进程可直接访问 Docker daemon 并绕过上述三处。
- **研究 runner 的 socket 策略（硬约束）**：研究任务容器不得挂载完整 Docker socket——`DOCKER_INSIDE=false` 且 `DOCKER_SOCKET` 为空（`pkg/config/config.go:34,36,402-423`）；确需容器化能力时改用受限 Docker API 代理（按项目/能力过滤的可白名单数据集 + 审计），或用 `DOCKER_INSIDE_HOST` 指向受限 daemon 端点。负向测试必须覆盖：① 模型不能直接调用通用 `terminal`/`file`（允许的是网关白名单命令与受限证据文件接口，越权命令与路径被拒）；② 容器内无法访问 Docker daemon；③ 网关之外没有容器命令出口。
- **容器不是权限边界（三种 socket 挂载情况必须区分）**：PentAGI 应用容器固定挂载宿主 `docker.sock`（`docker-compose.yml:206,211`）；worker 容器仅在 `DOCKER_INSIDE=true` 且未设 `DOCKER_INSIDE_HOST` 时挂载（`pkg/docker/client.go:337-342`）；研究 runner **禁止挂载**（见上一条硬约束）。三种情况都意味着容器以 root 运行、不能作为权限边界，网关校验必须在宿主侧完成，不能依赖容器内用户、文件权限或网络命名空间。
- **网络与出站限制**：按任务创建的独立 Docker 网络只解决研究任务之间不串扰，**不能限制公网、宿主和局域网访问**。主动扫描前必须在宿主侧完成出站控制：目标 IP/CIDR、端口与协议白名单（由 §5.1 的范围判定结果生成）、DNS 解析结果与被连接地址一致、重定向与重连再校验、越界拒绝并写审计。E 阶段若证明"按任务网络 + 出站白名单"仍不足，G 阶段升级为受限 Docker API 代理或独立受限 runner；不得把"独立网络"当作出站控制，也不得留作假设。
- **不变量**：任何新增能力、MCP 服务或工具发现结果都必须经同一网关；离线能力需证明运行器无目标网络访问（`offline` 范围判定见 §5.1）。

---

## 6. 表清单与命名（A1–A9 领域规划，均未创建）


| 迁移 | 表 |
|---|---|
| A1 `20260916100000_research_core.sql` | `research_projects`、`project_scopes`、`authorizations`、`policy_versions`、`research_tasks`、`research_stages`、`stage_runs`、`stage_events`、`research_jobs`、`project_members`、`audit_events`、`outbox_events`、`idempotency_keys`、`research.*` 权限种子 |
| A2 `20260917100000_research_assets.sql` | `assets`、`asset_identifiers`、`asset_merges`、`observations`、`services`、`components`、`reachability` |
| A3 `20260918100000_research_evidence.sql` | `evidence`、`evidence_parsed`、`evidence_links`、`capabilities`、`capability_reviews`、`execution_requests`、`policy_decisions`、`approvals`、`execution_records` |
| A4 `20260919100000_research_knowledge.sql` | `intel_sources`、`intel_collection_runs`、`intel_snapshots`、`knowledge_revisions`、`vulnerabilities`、`affected_ranges`、`weaknesses`、`attack_techniques`、`conditions`、`detection_features`、`device_constraints`、`knowledge_documents` |
| A5 `20260920100000_research_detection.sql` | `scan_jobs`、`detection_items`、`shared_detections`、`detection_dependencies`、`detection_coverage`、`findings`、`asset_vulnerabilities`、`finding_evidence` |
| A6 `20260921100000_research_chains.sql` | `candidate_chains`、`chain_nodes`、`chain_edges`、`chain_scores`、`chain_analysis_runs` |
| A7 `20260922100000_research_verification.sql` | `verification_tasks`、`task_dependencies`、`verification_runs`、`verification_results`、`verification_facts`、`feedback_events` |
| A8 `20260923100000_research_report.sql` | `report_versions`、`report_sections`、`report_evidence_refs`、`remediations`、`retests` |
| A9 `20260924100000_research_privileges_indexes.sql` | `graph_projection_state`、关键索引。`research.*` 权限种子已移入 A1；该批次可改名 `20260924100000_research_indexes.sql` |

命名与约束：

- goose 读取首个下划线前的数值作为版本；现有日期_时间格式把"同一天的第二个迁移"变成版本冲突风险（当前 32 个文件未触发），新迁移使用连续 YYYYMMDDHHMMSS 前缀以支持同日多批。上表文件名仅是领域规划示例，未实际创建；实施前验证版本唯一且排序正确。
- 表名一律小写下划线；避免与现有 26 张表冲突（`verification_tasks` 而非 `tasks`）；
- 项目内对象含 project_id；项目根表、全局静态词典不自引用项目。跨对象引用校验项目一致性，项目成员资格独立校验；不可变记录采用追加规则；
- 外键一律显式声明；被引用者软删除，不物理删除；
- 每个迁移必须提供 `-- +goose Down`（可回退）；
- 索引命名 `<table>_<cols>_idx`，唯一约束 `<table>_<cols>_uniq`。

---

## 7. 代码生成与迁移流程（必守）


1. 改表 → 写迁移 → 在演练库上 `goose up` → `sqlc generate`（Docker，**固定 1.27.0**）→ 生成 `pkg/database/*.sql.go`、`models.go`、`querier.go`；
   - 注意：sqlc.yml 配了 database.uri，应使用与迁移一致的专用分析库；固定版本与解析行为须通过实际生成和编译验证，见 PLAN §10。
   - 版本落地：仓库内必须有可执行入口（脚本或 Makefile 目标）固定 sqlc 1.27.0；当前只写在 `README.md` 与 `backend/docs/database.md` 的命令示例里，不构成约束。
2. 改 GraphQL → `gqlgen` → 生成 `generated.go`、`models_gen.go`、`schema.resolvers.go`；
3. 改 `frontend/src/graphql/*.graphql` → `graphql-codegen` → 更新 `frontend/src/graphql/types.ts`（前端 CI 会因过期失败）；
4. 改 REST 注解 → `swag init`；
5. 迁移演练：在 `pentagidb_dev` 上 `goose up` / `goose down` 各跑一遍，不触碰 `pentagidb`；
6. 生成产物不手工编辑；生成完必须能 `go build ./...`。

---

## 8. 待确认/占位（不阻塞 A 阶段）


- CNVD 许可与 NVD API key（影响 C 阶段采集频率与范围）；
- MCP 服务清单（影响第二步实现顺序）；
- 报告模板章节（H 阶段确定，接口先按 `report_sections` 通用结构设计）；
- 报告引用来源：`docs/research-platform/references/README.md` 登记附件编号 `REF-MIDTERM-0830`、文件名、大小、SHA-256 与章节 ↔ 行号对照；抽取脚本可入库，需求原文与逐条清单**不入库**（`.git/info/exclude`）。附件更新或重新抽取后必须复核全部引用；
- 实验埋点与真值标记：按 PLAN §1.4 本轮不建 `activity_log`、不加 `ground_truth_ref`（也不留占位字段）；若结题要求反转，按该表评估补齐成本（不阻塞 A 阶段）。

## 9. 阶段运行、取消与投影的一致性


- K 与 A 独立准备，M 依赖选定 K×A 快照；K 常驻采集服务与任务中的知识快照分开。只读取/导入文件的 A 不触发主动网络授权，主动补全按动作检查。
- research_task 为根，research_stages 为逻辑阶段，stage_runs 为每次尝试；执行桥接记录 flow_id、可选 assistant_id、run_id 与策略版本。纯导入/规则/投影不需要 Flow。
- 重复 run_stage 请求按项目、操作、幂等键及规范化请求哈希去重；同 key 不同参数返回冲突。同阶段仅一个有效运行，三种入口竞争同一租约与修订。
- research_jobs 保存调度、next_run_at、lease_until、heartbeat、fencing_token 和取消标记。Flow 生命周期作业继续由 flow_jobs 管理。执行器重启不能直接重放可能已有副作用的动作，先核验状态，未知转人工。
- 停止先持久化取消与任务 paused/terminated，再通知关联 Flow；阶段状态另设 cancelling/cancelled 以表达确认前后。取消运行没有有效产出，不满足后续依赖；迟到结果仅存该次运行记录。
- 恢复必须重新检查授权、窗口、策略/能力版本、输入修订、审批和目标状态；策略变化使旧审批失效。R2/R3 恢复前确认实际副作用及恢复条件。任务 `terminated` 为不可逆终态，恢复以新建任务并关联原任务的方式实现（新任务内产生新的 `stage_run` 与 `OutputRevision`），不重开原任务与已完成快照。
- 上游更新标记受影响节点 stale；正在运行的旧节点先失效，使用 revision/fencing 条件更新防止旧结果覆盖。合法跳过只支持无发现/无链等明确场景，不能跳过执行闸门。
- outbox 去重之外还需按实体 revision 防乱序覆盖，失败退避/死信与投影水位可见；Neo4j 以 project_id+实体类型+pg_id 作为稳定键；墓碑事件支持删除投影。
- chain signature 按分析运行保存，重复路径在同一运行内归并，跨运行保留出处和快照；不能用项目内唯一签名阻止重复分析保存历史。
- 已发布报告保存正文、结构化事实、证据哈希与模板/模型版本。模型断开后导出保存正文；发布版本不可覆盖。原始证据哈希验证不能替代访问权限。
- 阶段内的 PentAGI `task`/`subtask`/`toolcall`/`msglog`/`termlog` 只作只读执行轨迹展示；**不得以 `subtask_id` 作为新表键或依赖边**（`RefineSubtasks` 会删除并重建计划行，id 不稳定），验证任务图使用自有稳定标识。
- 证据二进制沿用现有 `pkg/flowfiles` 内容寻址存储（现有实现按内容哈希命名），`evidence` 行保存 SHA-256、来源与解析版本；文件发布与数据库引用不在同一事务，按 PLAN §10 的恢复步骤处理。
- 执行边界与容器网络见 §5.4；研究阶段与知识采集/投影分配独立并发预算，避免采集占满执行槽。
