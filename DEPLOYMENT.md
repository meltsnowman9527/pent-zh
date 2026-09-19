# 单套部署与更新

按用户最新决定，只保留原来的 PentAGI 部署，访问地址为 http://localhost:8443（2026-09-14 起由 HTTPS 改为 HTTP，本机部署不再使用自签证书）。后续直接修改当前项目源码，再构建并替换同名 `pentagi` 应用容器。原数据库和其他必要配套服务继续使用，不再创建独立开发部署，也不自动制作备份。

完整更新命令（在项目目录的 PowerShell 中运行）：

```powershell
.\scripts\update.ps1
```

脚本先构建前端，再通过 `Dockerfile.local` 编译后端并运行控制器并发测试，生成 `pentagi-local:latest`。运行依赖复用本机已有的 `vxcontrol/pentagi:latest` 镜像；辅助命令行工具继续使用该镜像中的版本。项目依赖或辅助工具改变时应采用原 `Dockerfile` 完整重建运行基础。

`scripts/update.ps1` 必须以 UTF-8 BOM 保存：本机只有 Windows PowerShell 5.1，无 BOM 时会按 ANSI 代码页读取，脚本中的中文提示会导致解析失败。脚本不支持改用 UTF-16 或去掉中文提示来规避，保持 BOM 即可。

成功后脚本写入原 `.env` 的镜像选择，并更新原 Compose 项目。构建失败不会替换运行中的应用；部署替换时会短暂中断访问。Docker 构建缓存不是第二套运行服务。`-DeployOnly` 仅用于部署已经构建并验证的本地镜像。

“一套部署”包含一个 PentAGI 应用及原来必需的数据库、网页抓取等配套容器。更新后应用名称和访问地址保持一致，但 Docker 可能重新创建容器，其内部编号会变化。

2026-09-13 已撤除开发副本及旧备份。锁修复与第一批中文化保留在源码中，并已于同日 14:06 完成构建与部署。

## 当前部署实况（2026-09-14 复核）

- `.env` 中 `PENTAGI_IMAGE=pentagi-local:latest`，本地镜像由 `Dockerfile.local` 从当前源码构建，构建过程包含 `go test -race ./pkg/controller`。
- 入口为 HTTP：`.env` 中 `SERVER_USE_SSL=false`、`SERVER_PORT=8443`，`PUBLIC_URL` 与 `CORS_ORIGINS` 均为 `http://localhost:8443`；`PENTAGI_LISTEN_IP=127.0.0.1` 只监听本机。登录 Cookie 的 `Secure` 标志取自 `c.Request.TLS != nil`，HTTP 下自动省略。
- `pentagi` 应用容器最近一次重建于 2026-09-14 17:10:21（交互助手会话的「分析报告」生成：后端材料整理 + 报告撰写提示词 + `generateAssistantReport` 变更，前端报告页/下拉入口与四条导出出口），运行 `pentagi-local:latest`；`pgvector`、`scraper`、`pgexporter` 仍为原配套容器，原数据库卷未替换。
- 容器内 `/opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 校验值一致（md5 `cc7b0b84671f8397800fc4b4e445093c`），说明运行界面就是当前源码的构建产物。
- 任务数据已于 2026-09-14 按用户要求清空（flows 及其全部子表与向量记忆均为 0 行），账户与模型配置保留；删除前生成的 `build/pentagidb-backup-20260914-114555.sql` 已按用户要求删除，本次清库不可回退。`flows_id_seq` 也已按用户要求 `RESTART WITH 1`。清空后用户新建了流程 #1（交互助手模式：1 个助手、219 条助手消息、0 个任务），其向量库条目（210 条英文记忆）已按用户要求单独删除，流程记录本身保留，可在任务流程列表直接打开查看/导出报告。
- http://localhost:8443 返回 200，HTTPS 不再监听；数据库 `pentagidb` 中保留原有 provider 配置与历史任务。

## 2026-09-15 更新

- 已部署按流程隔离的生命周期锁与最多 4 路跨流程后台作业调度，同一流程保持 FIFO。
- 已部署 PDF Markdown 表格、跨页重复表头与中文长文本换行修复，以及密码可见性按钮的键盘焦点修复。
- `pentagi` 容器于 10:00 重建并启动，运行 `pentagi-local:latest`；`http://localhost:8443` 返回 200。
- 容器内与本地 `index.html` 的 MD5 均为 `cc32e2973969c55d1f937e0c1f6b799d`。

## 2026-09-18 多源安全知识与知识图谱

- 多源知识收集内置 CISA KEV、NVD CVE 2.0、MITRE ATT&CK Enterprise STIX 和 MITRE CWE XML/ZIP；支持每日或每周调度、手动同步、自定义 JSON/RSS/STIX/CWE 来源，以及最多保留三份压缩原始快照。
- 新增结构化知识条目与关系存储。ATT&CK 写入战术、技术、组织、软件、攻击活动与缓解措施及其 STIX 关系；CWE 写入弱点层级与 CAPEC 关联；NVD 写入 CVE、CVSS、CPE 厂商/产品和 CVE→CWE 关系。
- 知识图谱页面改为读取后端节点/关系接口并使用力导向布局，支持按节点类型筛选、缩放、拖动和查看来源详情。新增 `intelligence.view/manage/sync` 权限。
- 迁移 `20260920` 已完成前向、批次写入和回退验证，`20260921` 为已有账户幂等补齐四个内置来源。官方 ATT&CK 53.8 MB STIX 文件和 CWE ZIP 均通过真实下载解析测试。
- 实际首次同步完成：CISA 1,713 条、NVD 5,469 条、ATT&CK 1,953 条、CWE 969 条，共 10,104 个来源记录、27,775 条关系；四个来源状态均为 `ready`。
- `pentagi` 已使用 `pentagi-local:latest` 重建，`http://localhost:8443` 返回 200；容器前端与本地构建产物校验一致。

## 2026-09-19 安全评估编排修复（阶段 4）

- 安全评估不再用一段提示词要求智能体按标题创建四个任务，而是由后端编排器按顺序真正调用各阶段服务：资产发现 → 漏洞扫描 → 利用链推理 → 渗透测试，每个阶段拥有独立 Flow。
- 阶段状态改为持久化：新增 `security_assessment_stages` 表（唯一键 `assessment_run_id + stage_key`、状态机 `pending/running/waiting/finished/failed/skipped/stopped`），`security_assessment_runs` 增加 `status`、`current_stage`、`model_provider`、`resource_ids`，`flow_id` 改为可空并始终指向当前阶段的 Flow；阶段进度不再从任务标题推断。
- 新增编排接口 `GET /api/v1/security-assessments/:id`、`POST /api/v1/security-assessments/:id/stop`、`POST /api/v1/security-assessments/:id/retry`；后台调度每 30 秒推进未结束的编排，服务重启后按 Flow 状态继续，读取列表/详情时也会即时推进。
- 阶段四沿用所选执行方式（自动执行或交互助手），其余三个阶段固定自动执行；停止编排会同时停止当前阶段的 Flow，重试会重置该阶段及其后续阶段。
- 迁移 `20260923` 已在临时库完成前向、回退和再次前向验证；后端 `go build ./...`、`go vet`、`go test ./...` 通过（仅 `cmd/installer` 相关用例因缺少生成的嵌入文件失败，与本次改动无关，在改动前的提交上同样失败）。
- `pentagi` 已使用 `pentagi-local:latest` 重建并替换，数据库已迁移至 `20260923`，`http://localhost:8443` 返回 200；登录后 `GET /api/v1/security-assessments/` 返回 `{"items":[],"total":0}`，不存在的编号返回 404「安全评估编排不存在」。

## 复核方式

- `docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}'`
- `docker exec pentagi printenv | Select-String 'SERVER_USE_SSL|PUBLIC_URL'`
- `docker exec pentagi md5sum /opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 比对
- `curl.exe -s -o NUL -w "%{http_code}" http://localhost:8443`
- `docker exec pgvector psql -U postgres -d pentagidb -tAc "select count(*) from flows;"`
- 后端并发测试：`docker run --rm -v <项目>/backend:/src -w /src golang:1.26.5-bookworm sh -c "go test -race -p 4 ./pkg/controller -timeout 300s"`
