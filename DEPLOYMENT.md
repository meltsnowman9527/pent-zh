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

## 复核方式

- `docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}'`
- `docker exec pentagi printenv | Select-String 'SERVER_USE_SSL|PUBLIC_URL'`
- `docker exec pentagi md5sum /opt/pentagi/fe/index.html` 与本地 `frontend/dist/index.html` 比对
- `curl.exe -s -o NUL -w "%{http_code}" http://localhost:8443`
- `docker exec pgvector psql -U postgres -d pentagidb -tAc "select count(*) from flows;"`
- 后端并发测试：`docker run --rm -v <项目>/backend:/src -w /src golang:1.26.5-bookworm sh -c "go test -race -p 4 ./pkg/controller -timeout 300s"`
