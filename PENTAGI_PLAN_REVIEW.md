# Review of `PENTAGI_RESEARCH_MODIFICATION_PLAN.md`

> 历史讨论留档：保留原文观点与决策过程。后续实施以 [开发方案](docs/research-platform/PLAN.md) 和 [开发契约](docs/research-platform/CONTRACTS.md) 为准；本文中的建议、待确认事项及完成声明不代表当前代码状态。

Reviewer: DSH agent · Date: 2026-09-15 · Baseline: branch `codex/research-development`, HEAD `f4e300a`

Sources used
- Plan under review: `PENTAGI_RESEARCH_MODIFICATION_PLAN.md` (398 lines)
- Mid-term report: `tmp/midterm-report-extracted.md` (914 lines; line numbers below cite this extraction)
- Extracted requirements checklist: `tmp/requirements-checklist.md`
- Current status / deployment: `IMPLEMENTATION_STATUS.md`, `DEPLOYMENT.md`
- Actual code: `backend/pkg/tools`, `backend/pkg/controller`, `backend/pkg/providers`, `backend/pkg/flowfiles`, `frontend/src`

---

## 1. Verdict

**Directionally sound, faithful to the report, and clearly better than a "build the report's 8 modules from scratch" plan. It is not yet safe to start P1 as written**: three items are asserted at policy level but have no runtime design, six gaps need decisions before G1, and two of the report's own commitments are silently dropped.

| Dimension | Assessment |
|---|---|
| Fidelity to the report's technical route | Good. 4-stage main line, 5-layer architecture, control-plane/execution-plane separation, deterministic rules over LLM judgement, evidence-first, R0–R4 |
| Use of PentAGI's existing strengths | Partial. The plan reuses Flow/agents/tools/Docker/pgvector at the right level, but misses several concrete mechanisms that already implement what it plans to rebuild |
| Executability | Medium. Object model and state machines are well specified; the mapping onto PentAGI's execution model is not specified at all |
| Scope realism on a 16 GB single host | Good discipline (no microservices, no mandatory Neo4j), but P1 is two slices of work and the lab/fixtures are scheduled too late |
| Risk of rework | High in 3 places: stage↔Flow mapping, capability isolation, and the dropped evaluation/ML scope |

**Bottom line:** keep the plan's structure, fix the 3 blockers (§3.1–§3.3) and 6 major gaps (§3.4–§3.9) before G1, and wire the existing PentAGI mechanisms in §4 instead of building new subsystems. Section 8 is a concrete edit list.

---

## 2. What the plan gets right (keep this)

1. **Correct authority model.** Rules own version matching, authorization, state transitions and security conditions; the model only proposes (`candidate`) facts (report 336, 342, 693). The plan says the same in §3.3 and §4, and adds "运行成功只更新执行事实，不直接更新漏洞结论". This is the report's most easily violated requirement and the plan handles it.
2. **Correct storage decision for this host.** PostgreSQL as the single source of truth, pgvector as a retrieval index, graph as an optional rebuildable projection (§3.1). The report tolerates this (536 says the graph only provides the knowledge basis), and it avoids forcing Neo4j onto a 16 GB laptop. Deferring Neo4j is defensible; see §3.7 for the one thing that must come with it.
3. **Correct reuse posture.** §2.1 keeps Automation/Assistant dual mode, the professional agent roles, multi-model per-role config, summarization/memory, multi-source search, Docker tool isolation, flow files, templates, realtime messaging and MD/PDF export — and §2.2 forbids treating existing defects as features to preserve. This is exactly the right frame.
4. **Honest scope.** §7 replaces "finish one big module before the next" with vertical slices A–D, and §8 defines G1–G5 decision gates with an explicit "what you may do while not approved". Very few plans do this.
5. **Exit criteria target failure modes, not happy paths.** P1 cross-project negative tests; P2 out-of-scope target / DNS change / stale approval / tampered parameter tests; P3 alias + CPE/PURL + SemVer/Debian/RPM boundary fixtures; P4 golden graph including cycles, unreachable, unknown, conflict, out-of-scope; P5 per-class contract tests for the 7 conclusions. These map directly onto report §3.3, §3.4, §3.6, §4.2–4.3, §6.4 and table 6.4.
6. **The P0/P0A code claims check out** — `flow_jobs` migration `20260913_180000_flow_jobs.sql`, `pkg/controller/flowjobs.go` (per-flow FIFO, `flowJobMaxConcurrency=4`, 3 attempts, recovery), and 12 lifecycle/race tests (`flowjobs_test.go`, `flowjobs_review_test.go`, `flows_latency_test.go`, `flows_responsiveness_test.go`). Localization is a real mechanism: `frontend/src/locales/zh-CN.ts` with `uiText(...)` at ~1,498 call sites across 154 files, plus a backend-error→Chinese map in `frontend/src/lib/errors.ts`. Two caveats to record rather than assume: the specific p95 numbers and some post-2026-09-14 test totals quoted in `IMPLEMENTATION_STATUS.md` have **no artifact under `build/`**, and the real-Postgres job suite silently skips without `PENTAGI_TEST_PG_DSN` (`pkg/database/flowjobs_pg_integration_test.go:28-30`). The plan's closing condition for P0 (line 246) should therefore require a re-run artifact, not a citation.
7. **Idempotency keys + outbox + soft delete + immutable evidence versions** (§3.1) is the right contract for a system whose whole value is traceability.

---

## 3. Where the plan is not yet executable (ordered by severity)

### 3.1 BLOCKER 1 — there is no mapping from the new business objects onto PentAGI's execution model

The plan defines a rich object model (`research_projects`, `assets`, `candidate_chains`, `verification_tasks`, …) and a multi-page UI, and says "Flow 复用为执行详情" (§首版页面组织) and "在现有主代理上增加阶段状态与任务路由" (§4). It never states **what a "阶段" is at runtime**. Concretely undecided:

- Is one research task one Flow, with stages as PentAGI `tasks`? Or one Flow per stage?
- Who enforces stage gating — the LLM planner (generator/refiner) or an application state machine?
- How does "阶段完成由实际产物和必要校验决定" connect to a Flow that ends whenever the agent emits `done`?
- How do stage jobs interact with the P0 job runner (per-flow FIFO, ≤4 flows cross-flow concurrent)?
- Are the report's business objects (`ChainNode`, `Condition`, `Evidence`) written by the agent loop, or only by the deterministic services after the loop?

Two further facts constrain the answer. First, **PentAGI has no dependency model at all**: `subtasks` has no edges, execution is a sequential FIFO loop over `subtasks ORDER BY id ASC` (`pkg/controller/task.go:302-329`, `backend/sqlc/models/subtasks.sql:48-55`), and result propagation to later steps is prompt-only (`pkg/providers/helpers.go:224-242, 702-762`) — so the plan's `TaskDependency` / verification task graph is genuinely new work, not an extension. Second, **PentAGI subtask ids are volatile**: `RefineSubtasks` deletes and re-creates planned rows (`pkg/controller/subtasks.go:97-139`), so any new dependency edge table keyed on `subtask_id` will break on refinement. The verification task graph must live entirely in the new business schema with its own stable ids.

Without this, the frontend's five stage pages and the Flow page will read different truths, and P1's "阶段状态" will be cosmetic — the exact failure mode the plan warns about ("不能只显示模型生成的完成文字").

**Recommendation (G1 deliverable).** Publish an explicit mapping table and freeze it:

| Research object | PentAGI object | Written by | Notes |
|---|---|---|---|
| `research_task` | new table, `user_id` owner | API | project scope root |
| `stage` (5 values) | `flow` (one per stage execution) + `research_stage` row | deterministic service | stage state in PostgreSQL, never in the LLM |
| stage step | `task` / `subtask` | existing planner | read-only projection into the stage page |
| execution | `toolcall` / `msglog` / `termlog` | existing executor | reused as the execution trace |
| evidence | `flowfiles` blob + `evidence` row | deterministic service | SHA-256 (see §5 R-2) |

Also decide the stage-capability binding: per-flow `Functions` (see §4.2) or per-stage tool sets, and define stage concurrency against the existing 4-way job runner.

### 3.2 BLOCKER 2 — "isolate the legacy execution path" is asserted but not designed, and the mechanism it needs is currently dead code

P2 requires: "原任意 Shell、动态安装和直接 Docker 通路继续服务旧 Flow 时必须标记为 legacy，并禁止从新研究任务入口调用" and legacy cannot bypass the new gateway. Three facts from the code:

1. Each agent's tool list is **hardcoded** in the executor builders (`backend/pkg/tools/tools.go:1296-1372` for pentester; one `Get*Executor` per role). So today a flow created from a research page would get `terminal` + `file` with no restriction.
2. `tools.Functions{Disabled []DisableFunction, Function []ExternalFunction}` already exists in the REST model, DB column and flow-job payload (`backend/pkg/server/models/flows.go:57,88`, `flows.go:595`, `pkg/controller/flow.go:432-441`, `pkg/tools/tools.go:39-68`) — but the parsed value is only **stored**, never read when building tool definitions (`pkg/tools/tools.go:184, 443-444`; the only other reference is `cmd/ftester/worker/tester.go:184`). Verified by grep: no consumer of `.Disabled` in the tool path.
3. Target scope is not enforced anywhere at tool level; the terminal tool runs inside the per-flow container. Containers attach to a single globally configured network — `DOCKER_NETWORK`, or `host` mode — applied uniformly to every flow container (`pkg/docker/client.go:378-421`, `pkg/config/config.go:52`). There is no per-task or per-project network policy today, although the create path already accepts a named network, so per-task networks are an extension rather than a rewrite.

**Consequences:** the plan's R1/R2 exit criterion ("legacy 通路无法绕过新任务入口网关") cannot be met by configuration; it needs code plus negative tests. And R3's "网络隔离" cannot be inherited from the existing container model.

**Recommendation.**
- P2 work item: wire `Functions.Disabled` (and a new allowlist) into executor construction — one filtering helper + table tests. This is cheap and turns an existing API contract into the report's "capability whitelist".
- Put the policy/approval gate as a **decorator around the single dispatch point** `customExecutor.Execute` (`pkg/tools/executor.go:242`), where the tool call is already logged (`tclp.PutLog`, line 289) and results are persisted. That is the report's control plane (676) with no new service.
- **Also cover the second choke point.** Every container command goes through `ContainerExecCreate` (`pkg/docker/client.go:907`) with only three callers (`terminal.go:225`, `tools.go:656` file sync, `server/services/flow_files.go:1336` — the latter deletes files with `rm -rf --`). A gate at `executor.go` alone is bypassed by the next `docker exec` someone adds. Note also that the flow container runs as root and the host Docker socket is mounted (`docker-compose.yml:206, 211`), so a gateway cannot treat the container as its privilege boundary.
- For R3 network isolation, decide at G2 between (a) a per-task Docker network (cheap: `client.go:415-421` already takes a named network, so this is "create + attach" work), (b) a firewall/proxy allowlist for the flow container, or (c) a separate runner container. Do not leave it as an assumption.
- Add the negative tests to the P2 exit criteria: "research flow cannot invoke `terminal`/`file`", "R1 capability cannot reach a non-whitelisted target", "approval bound to a changed parameter hash is rejected".

### 3.3 BLOCKER 3 — the plan drops the report's own acceptance content without a decision record

Plan §10 and §7 place experiment design, the 15% indicators, ground truth, human timing and statistical tests out of scope, and P3 places ML asset classification / historical success prediction out of scope. Those come from the report itself:

- 课题预期目标 (report 147): "减少人工介入时间不少于15%"; "提升漏洞覆盖率不少于15%".
- 研究内容 2 (report 151-152): ML-based asset feature extraction/classification, historical scan-data prediction of unscanned areas, false-positive filtering.
- Chapter 8 (report 793-817): lab, two-group control design, the two primary metrics with exact counting rules, and zero-tolerance conditions.

This may be a deliberate, user-approved deferral (see the commit `f4e300a "docs: defer research experiment planning"`). The problem is not the deferral — it is that **two things needed later are cheap now and expensive later**:

1. **Instrumentation.** Metric F1 is "human intervention minutes" per activity class, and F2 requires `(asset, vuln instance)` counting with dedup and an evidence threshold. Neither can be reconstructed retroactively from logs. Add from P1: an `activity_log` (actor, stage, activity type, minutes, object ids) and a `ground_truth`/`evidence_threshold` tag on `asset_vulnerabilities`. This is a few columns and one table, and it keeps the deferral reversible.
2. **A minimal, defensible ML/statistical component or a documented deviation.** The plan currently has no ML anywhere. If 结题 or 论文/软著 depends on 研究内容 2, add either a small rule+statistics classifier with confidence and model-version provenance (report 379-380 asks for exactly this provenance: model version, confidence, input features) or an explicit written deviation signed off by the client.

**Recommendation:** add an "out of scope, but hooks retained" subsection listing (a) instrumentation hooks, (b) ground-truth tagging, (c) configurable scenario parameters (report 608/809 require them to be frozen before the experiment, not hard-coded), and get a one-line decision on the ML content.

### 3.4 MAJOR — the report's Skill/MCP capability layer (§5.2, 表5.1) has no mapping

The report's 漏洞收集 tool is specified as three layers: 智能体决策层 / 能力接入层 (internal **Skill** + external **MCP**) / 功能处理层, with eight named function components (report 497-514). The plan's §3.5 defines a generic adapter interface (`Describe/Validate/Plan/Execute/Cancel/Parse/Health`) and never mentions Skill or MCP. PentAGI already has a partial equivalent that the plan does not name:

- `registryDefinitions` + `ExecutorHandler` + tool `IsAvailable()` = the capability registry.
- `ExternalFunction` (name + URL + timeout + JSON schema + context list) = an HTTP capability adapter, i.e. the natural host for Skill-side and MCP-side registration.

**Recommendation:** add an explicit mapping (Skill → registry tool or `skill` row; MCP → capability client with the same registration metadata) and state which of 表5.1's eight components are reused (采集/解析/治理/存储) vs newly built (任务调度/关系构建/服务与反馈). Without it, the "智能化漏洞收集工具" deliverable looks like "agents plus web search", not the report's architecture.

### 3.5 MAJOR — UI coverage gaps against report chapter 7 (approvals, audit, permissions, dashboard)

The report requires 8 modules (743), 5 permission domains (731-741), an approval interaction with target/risk/stop-condition display and withdrawal (788), audit covering approval/evidence access/policy changes (770), and a dashboard whose rule is "扫描器告警不得直接统计为已确认漏洞" (745). The plan's first-version page set is task centre + 5 stages, and defers the rest. Two of those deferrals are risky:

- **Approval queue + approver identity.** R2 needs single-request approval bound to target + parameter hash + validity; R3 needs **two different approvers** (table 6.3, report 686). Today PentAGI ships two roles (admin/user) through a real `roles`/`privileges` schema (`backend/migrations/sql/20241026_115120_initial_state.sql:3-33`, `users.role_id`), so adding approver/auditor roles and permission names is cheap — but the identity rule (approver ≠ requester, two distinct approvers for R3) does not exist and must be implemented. Add the approval queue page and the identity rule to P2, not P5.
- **Audit.** The `AuditEvent` object is in the plan's §3 data list but has no page and no write points until P5. Write audit events from P1 (project/scope changes, imports, merges) and from P2 (gateway decisions, approvals, evidence access) — retrofitting audit is what fails 等保 reviews.

Dashboard and Agent-management pages can stay deferred, but say so explicitly in §7 with a "report module ↔ first-version coverage" matrix (the plan has such a matrix in §10 for capabilities, but not for the 8 modules).

### 3.6 MAJOR — the state vocabulary needs one frozen mapping table

The report uses several partially overlapping vocabularies; the plan uses a different but compatible one. Report: candidate screening 4 states (表4.2), vulnerability detection 3 states (表4.3: 已确认/未检出/待确认), condition 5 states, chain-linkage 4 states (完全/部分/不匹配/未知), verification 7 conclusions (表6.4), plus task/judgement/constraint/data/remediation states (表7.2). Plan: 5 vulnerability states (`candidate/confirmed/not_detected/conflict/stale`), 5 condition states, 7 conclusions.

This is a superset and defensible, but the plan itself warns about 口径冲突 (§首版目标). Publish at G1 a single table: report state ↔ plan enum ↔ UI label ↔ DB enum ↔ allowed transitions, and make it the only place vocabulary is defined. Otherwise the same issue will surface in the final report and in UI labels.

### 3.7 MAJOR — "no Neo4j" needs one companion decision to keep the 知识图谱 claim defensible

§3.1 is right that PostgreSQL + recursive CTE suffices for bounded search, and that the graph projection is rebuildable. But report 5.4.2 (三条关系链), 6.2 (子图提取) and the 创新点 explicitly claim a knowledge graph, and the frontend spec has a relation-graph view (759). Deferring Graphiti is fine; **deferring all graph modelling and visualization is not**, because then the deliverable cannot demonstrate the claim.

**Recommendation:** in P4, implement the three relation chains as first-class edge tables (`vuln–product/component–range`, `railway device–component–protocol`, `vuln–condition–detection feature`, plus `device–detection constraint`) and render the chain graph from the API (the report only requires the graph to provide the knowledge basis, 536). Add Graphiti/Neo4j later as a projection if query needs grow. Record this as a deliberate design note.

### 3.8 MAJOR — external content is not treated as untrusted input

Report 677 is explicit: external technical material, target responses and tool output "只能作为数据和证据使用，不能直接修改授权策略、任务状态或触发新的工具调用". The plan has no prompt-injection / data-vs-instruction control at all. PentAGI feeds tool results and web content straight back into the agent loop, and the new design gives the agent capability call requests. This is a security requirement of the target domain (railway/等保), not a nicety.

**Recommendation.** Add to §3.7: provenance-tag every external fragment entering the model context; forbid policy/authorization parameters and tool-call targets to be derived from content; require structured capability requests to be re-validated against the frozen task scope; add a fixture test (a malicious page/scan banner asking the agent to scan another host must not produce a request outside scope).

### 3.9 MAJOR — P5's "frozen report snapshot" and server-side export do not exist and are not costed

Today reports are **mutable rows**: the automation report is a `report` msglog written at task end (`pkg/controller/task.go:359-368`), and the assistant report is a `report` assistantlog **rewritten in place** on regeneration (`pkg/reports/assistant_report.go:259-264, 334-351`). There is no report table, no revision history, no evidence binding, no publish gate, and **PDF is generated client-side only** (`frontend/src/lib/report/report-pdf.tsx`, `@react-pdf/renderer`).

P5 requires: draft → in review → published → retest versions, frozen SQL revision + file hashes + rule/prompt/model/template versions, blocking publication when evidence is missing, and rebuilding the same fact tables/evidence catalogue **with the model service disconnected** (plan §P5 exit criteria, report 769). That is new storage and a server-side render path. Two implications for the plan:

- Decide now whether "export" stays browser-side (simplest: server returns a frozen Markdown/HTML snapshot, the existing client PDF renderer produces the PDF) or becomes server-side (then a headless-Chromium or Go PDF dependency enters the backend and the Docker image grows). Put the choice in §P5, not in the middle of implementation.
- The "rebuild with the model offline" criterion needs the report to be assembled from stored structured fields, which is a design constraint on the snapshot schema, not just a test.

---

## 4. PentAGI strengths the plan should exploit harder (with code evidence)

The plan's §2.1 list is good but generic ("保留现有能力"). These are the concrete mechanisms worth naming in the plan, each of which removes work from P1–P5.

| # | Existing mechanism | Evidence | What it replaces in the plan |
|---|---|---|---|
| 1 | Per-agent tool sets already encode "each role gets only the capabilities it needs" (report 764) | `pkg/tools/tools.go:1000-1838` (`GetPrimaryExecutor`, `GetPentesterExecutor`, `GetSearcherExecutor`, `GetReporterExecutor`, …) with explicit `definitions`/`handlers` maps | The plan's generic "能力注册" can start as new entries in the existing registry, added only to the executors of roles allowed to use them |
| 2 | `Functions.Disabled` + `Functions.Function` (external HTTP capability with JSON schema) are already plumbed through REST/DB/payload — but unused | `pkg/tools/tools.go:39-68`, `pkg/server/models/flows.go:57`, `pkg/controller/flow.go:432-441`, assignment only at `tools.go:443-444` | Legacy-path isolation (BLOCKER 2) and the Skill/MCP adapter path (§3.4). Wiring it is small; building a parallel capability system is not |
| 3 | One dispatch point for every tool call, already logging to `toolcalls`, plus one choke point for every container exec | `pkg/tools/executor.go:242` (`Execute`), `:289` (`tclp.PutLog`); `pkg/docker/client.go:907` (`ContainerExecCreate`, only 3 callers) | The report's control-plane check (675-677) and the audit trail. Cover **both** points — a gate at `executor.go` alone is bypassed by the next direct `docker exec` |
| 4 | Content-addressed resource/flow-file store | `pkg/flowfiles/files.go:565` (`Hash … // MD5 hex` blob name), `:609` blob resolution | Evidence blob storage. Reuse it, but add SHA-256 — the plan and report require integrity verification (report 715; plan §3.1) and MD5 does not support that claim |
| 5 | Persistent lifecycle jobs with per-flow FIFO, 4-way cross-flow concurrency, retries, restart recovery | `pkg/controller/flowjobs.go` (`flowJobRunner`), migration `20260913_180000_flow_jobs.sql`, tests in `flowjobs_test.go` | A new stage/verification scheduler. Extend `flow_jobs.kind` per stage instead; define how a 5-stage task's stage jobs queue against the same runner |
| 6 | GraphQL + subscriptions + Apollo codegen + flow/msg/terminal/toolcall subscriptions | `backend/pkg/graph/schema.graphqls` (1204 lines), `frontend/src/graphql`, providers under `frontend/src/providers` | The multi-page UI's live status. The plan never chooses REST vs GraphQL for the new objects — choose GraphQL for reads/subscriptions, REST for import/export, and say so |
| 7 | Centralized Chinese copy table with parameterised keys | `frontend/src/locales/zh-CN.ts` (62 KB) + `uiText(...)`; methodology in `IMPLEMENTATION_STATUS.md:262-269` | §P0A says "建立统一中文术语和集中维护的文案机制" — it already exists; require new pages to use it and add the plan's "持续门禁" scan as a script/test |
| 8 | Report pipeline: prompt template, backend report assembly, frontend report page + MD/PDF export | `backend/pkg/templates/prompts/reporter.tmpl`, `backend/pkg/reports/assistant_report.go`, `frontend/src/pages/flows/flow-report.tsx`, `frontend/src/lib/report/report.ts` + `report-pdf.tsx` | P5's Chinese report. Extend the template + assembly with evidence-driven fields; do not build a second report engine |
| 9 | Knowledge documents + pgvector retrieval filtered by `flow_id` in one shared collection | `pkg/tools/memory.go:67` (flow_id filter), `pkg/tools/tools.go:429` (`WithCollectionName("langchain")`) | 漏洞收集's document store and RAG. Note the nuance: cross-*task* leakage is already prevented; cross-*project* scoping is not, and needs an extra metadata filter or per-project collection — a code change, not configuration |
| 10 | Per-flow Docker container with terminal/file/screenshot/file-pull-file-push tools | `pkg/docker`, `pkg/tools/terminal.go`, `pkg/flowfiles` | Raw evidence capture (outputs, screenshots, pulled files). Reuse; add the SHA-256 + immutability wrapper |
| 11 | Assistant mode + `AskUser` barrier | `pkg/providers/assistant.go`, `pkg/tools` barrier tools | Human-in-the-loop. For R2/R3 approvals, prefer a structured `Approval` record over the chat path, but reuse the UI/notification hooks |
| 12 | Observability: OpenTelemetry + Langfuse traces for provider/tool calls | `pkg/observability`, `pkg/observability/lfclient.go` | The report's structured agent-event timeline (765) — while respecting 765's rule that chain-of-thought is not audit content; configure retention/detail accordingly |

**Net effect if adopted:** P2 stops being "build a policy gateway and a tool runner" and becomes "wire the allowlist, add the gate decorator, restrict the container network, add tests"; P4 keeps its deterministic search (genuinely new); P5 becomes template + evidence assembly rather than a new reporting subsystem.

---

## 5. Risk register

| ID | Risk | Why it matters | Recommendation |
|---|---|---|---|
| R-1 | Stage↔Flow mapping undefined (§3.1) | UI and execution diverge; "real artifact" gating becomes cosmetic | G1 mapping table; freeze before P1 migrations |
| R-2 | Evidence integrity on an MD5 store | Plan and report require SHA-256 integrity for evidence; `flowfiles` uses MD5 blob names | Add SHA-256 on evidence ingestion; keep MD5 store for resources; store both |
| R-3 | Legacy isolation unimplemented (§3.2) | P2 exit criterion unmeetable; report's zero-tolerance "授权越界 = 0" unverifiable | Wire `Functions.Disabled` + gate decorator + negative tests |
| R-4 | R3 network isolation assumed | Every flow container uses one global `DOCKER_NETWORK` (or host mode); R3 (isolated sim state change) cannot be enforced as-is | Decide at G2: per-task Docker network (existing create path already accepts a named network), proxy allowlist, or separate runner |
| R-5 | Approver identity rule missing | R3 requires two different approvers; only admin/user roles exist (roles/privileges schema supports adding more) | Add approver role/permission + approver≠requester and two-distinct-approver constraints in P2 |
| R-6 | Version comparators are correctness-critical | SemVer/dpkg/rpm edge cases (epoch, revisions, prereleases) are a classic source of false findings | Use a vetted library; shell out to `dpkg`/`rpm` only in fixtures; keep `unknown` semantics; freeze NVD-derived fixtures (report asks for exactly this) |
| R-7 | Prompt injection via tool output / fetched pages (§3.8) | Report 677 forbids content from changing policy/state/triggering calls | Provenance tagging + scope re-validation + adversarial fixture |
| R-8 | Outbox + pgvector + optional graph in a single-node stack | Three consistency surfaces on a 16 GB dev host; failure modes surface as "index lag" | Keep the first slice working with projection degraded; show lag/backlog in the UI (report 784 data states) |
| R-9 | Lab/fixtures scheduled too late | P3/P4/P5 golden tests and F2's ground truth need a frozen environment (report 796: GNS3/Vulhub/Juice Shop/DVWA/Metasploitable) | Start the lab in P1; freeze ground truth before P3 |
| R-10 | No backups by decision (`DEPLOYMENT.md`) | Schema mistakes are unrecoverable without a dump | Require the plan's own P1 "forward/backward rehearsal" plus a schema-only dump per slice; add a seed fixture instead of the deleted flow data |
| R-11 | `16 GB` concurrency budget is qualitative | Nmap + headless browser + LLM + Postgres can thrash | Set explicit default caps per project/security domain (report 369/452 expects configurable concurrency), measure at P2 |
| R-12 | Report has no numeric thresholds | Subagent meta-finding: only 15%, R0–R4, 3/7-state tables, 8 modules are numeric; all depths/thresholds are "configurable, freeze before the experiment" (608, 809) | The plan's defaults (depth 5, branch 20, ≤2 unknowns, 30 s, 100 paths) are fine as **versioned defaults**, but the plan should say they are scenario parameters with recorded values, not constants — it partially does in §3.6; make it explicit in the config table |
| R-13 | No dependency/DAG substrate exists, and PentAGI subtask ids are volatile | `subtasks` has no edges; execution is a sequential FIFO loop (`pkg/controller/task.go:302-329`); `RefineSubtasks` deletes and re-creates planned rows (`pkg/controller/subtasks.go:97-139`), so any edge table keyed on `subtask_id` breaks | Keep the verification task graph entirely in the new business schema with its own stable ids; add a ready-set scheduler + cycle detection as explicit P4 work; do not map dependencies onto PentAGI subtasks |
| R-14 | Adding a business agent role costs more than the plan implies | One role touches `pconfig.ProviderOptionsType`, GraphQL `AgentType`, the `MSGCHAIN_TYPE` DB enum (migration), prompts, and the settings UI/GraphQL `AgentConfigType` | Budget the P4 exploit-chain role as a cross-cutting change; consider implementing it as a prompt+tool-permission variant of an existing role if the contracts allow |
| R-15 | Report snapshot + server-side export are greenfield (§3.9) | Reports are mutable rows today; PDF is browser-only; no publish/evidence binding | Decide browser-side vs server-side export at P5 planning; design the snapshot schema to be rebuildable with the model offline |
| R-16 | Codegen and CI gates | A schema change needs gqlgen + `sqlc generate` + `swag` + `pnpm run graphql:generate`; frontend CI hard-fails a stale `types.ts`, while **backend CI runs `go test ./...` and golangci-lint with `continue-on-error`** | Add codegen steps and a backend gate to the plan's per-slice exit criteria; assume codegen time in estimates |
| R-17 | In-process-only subscriptions | The GraphQL subscription broker is a single-process channel fan-out (`pkg/graph/subscriptions/controller.go`) | Fine for this single-node deployment; do not design live multi-page status as if multi-replica were supported |

---

## 6. Sequencing and effort sanity check

- **P1 as written is two slices.** Data model + scope isolation + import + merge engine + evidence sidebar + 5-stage routing + shared context + outbox is more than one iteration. Split:
  - **P1a** — schema + `Project/Scope/Authorization` + asset/observation + evidence (SHA-256) + Nmap/CSV import with validate-preview-commit + merge service + project-scope enforcement tests.
  - **P1b** — task centre + 5-stage skeleton + shared context + evidence sidebar + cross-page navigation, reading real P1a data.
- **Put a walking skeleton first.** Before breadth, prove one thin end-to-end path: create project → import Nmap XML → 1 asset → 1 candidate vulnerability → 1 hand-entered candidate chain → 1 R1 read-only check through the gate → 1 evidence record → 1 Chinese report page. This validates the stage↔Flow mapping, the gate, the evidence schema and the UI wiring at the lowest possible cost.
- **Move the lab earlier** (P1) and freeze ground truth before P3.
- **Critical path:** G1 (IDs, states, scope, stage mapping) → import/merge → evidence → gate → low-risk capability → candidate matching → bounded search → verification task graph → evidence-driven report.
- **Do not produce a schedule now** if the client cannot yet confirm scope (§9); the plan is right to gate estimates on G1. But state the *unit* of estimation per slice and the review cadence, otherwise "no estimate" becomes "no accountability".

---

## 7. Factual corrections to the plan text

1. **URL scheme.** The plan says the entry point is `https://localhost:8443` (lines 5, 9, 383). Since 2026-09-14 the deployment is HTTP: `SERVER_USE_SSL=false`, `http://localhost:8443` (`DEPLOYMENT.md:3, 24, 34`). Fix the baseline section.
2. **Role count.** "现有 13 个模型角色" is accurate for configurable per-role model config (`pkg/providers/pconfig/config.go:141-153`), but there are 15 `AgentType` values (`pkg/graph/model/models_gen.go:734-769`). Say "13 configurable model roles / 15 agent types".
3. **P0 regression baseline.** Line 246 says to archive existing regression data and migration versions. The database was intentionally cleared on 2026-09-14 (`flows` = 0 rows, `DEPLOYMENT.md:27`), so there is no flow data to archive; the baseline is code + tests + a new seed fixture. Reword.
4. **Vector retrieval isolation.** §2.1 says "避免检索串任务或串项目". Cross-task retrieval is already filtered by `flow_id` (`pkg/tools/memory.go:67`); only cross-project scoping is missing. Precise wording changes the size of the required change.
5. **Adapter interface duplication.** §3.5's `Describe/Validate/Plan/Execute/Cancel/Parse/Health` overlaps existing `FunctionDefinition` + `ExecutorHandler` + `IsAvailable` + JSON schema. Map the two instead of introducing a parallel concept.
6. **Phase numbering.** `IMPLEMENTATION_STATUS.md:280` refers to "P1–P6" from the previous plan; the new plan uses P1–P5. Add one line mapping old→new to avoid confusion in future status reports (the status doc needs the same note).
7. **Tool runner.** The plan proposes a separate runner process as if new. Check at G2 whether the existing worker/job model can host it before adding a service and Compose entry; the plan's own resource note argues for restraint on this host.
8. **Localization mechanism.** §P0A item 2 says "建立统一中文术语和集中维护的文案机制" as future work; it exists (`frontend/src/locales/zh-CN.ts`, `uiText`). Reword to "extend and gate this existing mechanism". Note also that the "全站中文化" claim is not fully true for **numeric** formatting (`frontend/src/lib/utils/format.ts:22` uses `Intl.NumberFormat('en-US')`, and `formatDuration` emits raw `h/m/s`); add numbers/durations to the P0A/P1 scope, and remember new pages need sidebar entries + breadcrumbs + `frontend/src/lib/route-titles/index.ts` entries.
9. **P0 close condition.** Line 246 should require fresh artifacts. The quoted p95 numbers and post-2026-09-14 test totals are not present under `build/`, and the real-Postgres job suite skips without `PENTAGI_TEST_PG_DSN` (`pkg/database/flowjobs_pg_integration_test.go:28-30`). "Close P0 with a re-run log" is a one-line fix that removes a credibility risk in the status chain.

---

## 8. Recommended edits to the plan (actionable checklist)

1. Add **§2.3 Research object ↔ PentAGI execution object mapping** (the table in §3.1) and make it a G1 freeze item.
2. Add to **P2**: wire `Functions.Disabled`/allowlist into executor construction; insert the policy/approval decorator at `customExecutor.Execute`; restrict research-flow container networking; add the three negative tests.
3. Add to **G1**: state-vocabulary mapping table (report ↔ plan ↔ UI ↔ DB) and cross-project scope-enforcement tests.
4. Add an **"out of scope but instrumented"** subsection: activity/time logging, ground-truth + evidence-threshold tagging, versioned scenario parameters; obtain a written decision on the report's ML content (研究内容 2).
5. Add **approval queue page + approver identity/role rule** to P2 scope, and **audit write points** from P1 with a read-only audit page by P2.
6. Add the **Skill/MCP mapping** to §3.5 and name which of 表5.1's eight components are reused vs new.
7. Add a **prompt-injection / external-content-is-data** control and test to §3.7.
8. Add a **report-module ↔ first-version coverage matrix** (8 modules, 5 permission domains) to §7, listing explicit deferrals.
9. Add **SHA-256 evidence hashing** and the graph-projection companion decision (§3.7) to P4/P5.
10. Split **P1 into P1a/P1b**, add the walking skeleton, and move **lab setup + ground-truth freezing into P1**.
11. Add **report snapshot + publication-gate design** (and the browser-side vs server-side export decision) to P5; do not leave it to implementation time (§3.9).
12. Add **codegen + gate steps** (gqlgen / `sqlc generate` / `swag` / `pnpm run graphql:generate`, plus a backend test gate) to every slice's exit criteria; note that P4's new role touches five code locations plus a DB enum migration.
13. Add the **subtask-id volatility** constraint: the verification task graph must not key on PentAGI `subtask_id` (§3.1, R-13).
14. Add **numeric/date localization** to the Chinese-UI scope and route/nav/breadcrumb registration for the five new pages.
15. Correct the factual items in §7 above.

---

## 9. Open questions that change the answer

1. **Acceptance scope.** Does 结题/验收 require the report's chapter 8 experiment, the two 15% indicators, and 研究内容 2's ML components (asset classification, historical prediction, false-positive filtering)? If yes, the plan's deferral needs either hooks now (§3.3) or a signed deviation; if no, the plan is fine and I would only keep the measurement hooks.
2. **Deadline.** Contract/结题 date, or the date the system must be demonstrable? This determines whether the vertical slices should be reordered to front-load a demoable end-to-end path.
3. **Research artifacts.** The report's 科技研究成果专页 (专利/软著/论文) is blank (report 23-29). If a 软著 or paper is expected, the knowledge-graph/MCP/ML claims need something demonstrable, which raises the priority of §3.4 and §3.7.
4. **Lab hosting.** May the isolated lab (Vulhub/Juice Shop/DVWA/Metasploitable, optionally GNS3) run on this 16 GB host, or a separate machine/VM? It determines the P1 fixture plan and the concurrency budget.
5. **Confirmed run mode.** Single deployment, HTTP `localhost:8443`, no backups, DB cleared — if confirmed, the plan should mandate the seed fixture + schema dump + `goose down` rehearsal as the substitute for backup-based recovery.

---

## Appendix — verification notes

- P0 code claims verified against source and tests (migration `20260913_180000_flow_jobs.sql`, `pkg/controller/flowjobs.go`, 12 lifecycle/concurrency tests). P0's quoted latency numbers and some post-2026-09-14 test totals could **not** be verified — no artifact under `build/`.
- Localization verified as a mechanism (`frontend/src/locales/zh-CN.ts`, `uiText`, ~1,498 call sites / 154 files), with the remaining-English classification documented at `IMPLEMENTATION_STATUS.md:277`.
- `Functions.Disabled`/`Function` non-consumption verified by grep across `backend/` (only assignments at `pkg/tools/tools.go:443-444` and one use in `cmd/ftester`).
- Tool-dispatch single point verified at `pkg/tools/executor.go:242` with tool-call logging at `:289`; container-exec choke point at `pkg/docker/client.go:907` (3 callers).
- No dependency edges anywhere: `subtasks` schema and the sequential exec loop (`pkg/controller/task.go:302-329`); `RefineSubtasks` re-creates planned rows (`pkg/controller/subtasks.go:97-139`).
- Content-addressed file store verified at `pkg/flowfiles/files.go:565, 609` (MD5 hex blob names, path hash at `:193-196`).
- Report mutability verified: `pkg/controller/task.go:359-368` (msglog) and `pkg/reports/assistant_report.go:334-351` (in-place rewrite); PDF is client-side (`frontend/src/lib/report/report-pdf.tsx`).
- Greenfield confirmation: none of assets / services / components / vulnerabilities / findings / evidence / approvals / projects / scopes / chains / verification tasks exist as tables (26 tables in `pkg/database/models.go`); zero `WITH RECURSIVE` in the repo.
- Vector retrieval flow-scoping verified at `pkg/tools/memory.go:67`; shared collection name at `pkg/tools/tools.go:429`.
- Report line citations follow `tmp/midterm-report-extracted.md`; the full requirement checklist is in `tmp/requirements-checklist.md`.
