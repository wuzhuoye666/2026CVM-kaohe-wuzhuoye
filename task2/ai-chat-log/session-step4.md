# AI 对话记录 — Step 4: REST API 完整实现

## 对话概要

用户启动 Step 4 REST API 完整实现，AI 查阅项目记忆和执行计划，确认 Step 1-3 已完成，然后逐步实现了全部 5 个子步骤（4.1-4.5）：Flask 应用工厂、采样查询 API、火焰图 API、系统状态 API、Gunicorn 集成。完成后用户要求派发 10 个子 agent 对 Step 1-4 全部已有模块进行正确性确认，发现 metadata.py `_read()` 缺少共享锁的 bug 并修复。

---

## 关键用户提示与 AI 回应

### 1. 开始 Step 4
- **用户**: "开始 Step 4 REST API 完整实现"
- **AI**: 读取 MEMORY.md、project-guidelines.md 和 VIBECODING_PLAN.md，确认 Step 1-3 已完成，API 已有骨架文件（app.py、routes_profiles.py、routes_flamegraph.py、routes_system.py、utils.py）但内容基本为空

### 2. 查阅执行计划
- **用户**: "还要看vibecoding_plan"
- **AI**: 仔细阅读 VIBECODING_PLAN.md 第 4 步的 5 个子步骤和测试指标，然后创建 6 个任务（Flask 工厂、profiles API、火焰图 API、系统状态 API、Gunicorn 集成、端到端验证），逐步实现

### 3. 要求全面正确性确认
- **用户**: "请派发十个子agent对step4前面的步骤进行正确性确认 不要影响后面的步骤"
- **AI**: 创建 10 个验证任务，并行派发 10 个 Explore 子 agent，分别验证 Step 1.1-1.5、Step 2、Step 3.2-3.3、Step 4.1-4.5 的代码正确性

### 4. 推送代码
- **用户**: "帮我git到仓库"
- **AI**: commit 并推送 `feat: implement REST API (Step 4) + fix metadata read lock` 到 origin/main

---

## 实现详情

### 4.1 Flask 应用工厂 (app.py)
- 实现 `create_app()` 工厂函数
- 注册 3 个蓝图：`profiles_bp`、`flamegraph_bp`、`system_bp`
- 配置 `DATA_DIR`、`METADATA_PATH`、`FLAMEGRAPH_DIR` 环境变量
- 静态文件指向前端目录（`frontend/`）
- 根路由 `/` 返回 `index.html`
- **关键修复**: Flask 3.0 中 `request.app` 不存在，改用 `current_app.config` 访问配置

### 4.2 采样查询 API (routes_profiles.py)
- `GET /api/profiles?start=...&end=...`
- 参数校验：缺少 start/end 返回 400，时间格式非法返回 400
- 调用 `find_profiles()` 查询匹配文件列表
- 返回 JSON：`{files, count, start, end}`

### 4.3 火焰图 API (routes_flamegraph.py)
- `GET /api/flamegraph` — 返回 SVG（`Content-Type: image/svg+xml`）
- `GET /api/flamegraph/data` — 返回 d3-flame-graph 层级 JSON
- 内置 folded stack 解析器（`_folded_to_hierarchy()`），将 `stack;frame count` 格式转为树形结构
- 参数校验：缺少时间范围返回 400，无匹配数据返回 404

### 4.4 系统状态 API (routes_system.py)
- `GET /api/system/status`
- 使用 `psutil` 获取 CPU 使用率、磁盘使用率
- 通过检查 `perf` 进程是否存活判断 `collector_status`（running/stopped）
- 返回字段：`cpu_percent`, `disk_percent`, `data_size_mb`, `file_count`, `collector_status`, `uptime_seconds`

### 4.5 Gunicorn 集成
- 修改 `entrypoint.sh`：将 `sleep infinity` 替换为 `exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 2 "api.app:create_app()"`

---

## 关键代码决策

- **Flask 3.0 兼容性**: `request.app` 在 Flask 3.0 中已被移除，全部改用 `current_app.config` 访问应用配置
- **火焰图双端点**: SVG 端点用于静态嵌入，JSON 端点用于 d3-flame-graph 交互渲染，满足前端两种使用场景
- **Folded stack 解析器**: 自己实现 `_folded_to_hierarchy()` 解析器，而非依赖外部工具，避免容器路径依赖问题

## 重要调试/排错时刻

1. **Flask 3.0 `request.app` 报错**: 测试客户端调用时报 `AttributeError`，将两个蓝图文件中 `request.app.config` 改为 `current_app.config` 解决
2. **Flask 未安装**: 宿主机缺少 Flask，通过 `apt-get install python3-flask python3-psutil` 安装
3. **metadata.py `_read()` 缺少共享锁**: 10 个子 agent 验证时发现 `_read()` 方法读取文件时未加 `fcntl LOCK_SH` 共享锁，可能导致读写竞争；已修复添加

## 验证结果

10 个子 agent 并行验证，覆盖 Step 1-4 全部已有模块：

| Agent | 验证范围 | 检查点 | 结果 |
|-------|---------|--------|------|
| Explore-1 | Step 1.1 PerfCollector | 5 | **5/5 PASS** |
| Explore-2 | Step 1.2 MetadataStore | 8 | **7/8 PASS, 1 FAIL** → 已修复 |
| Explore-3 | Step 1.3 Collector→Metadata集成 | 5 | **5/5 PASS** |
| Explore-4 | Step 1.4 DataCleaner | 7 | **7/7 PASS** |
| Explore-5 | Step 1.5 entrypoint.sh | 7 | **7/7 PASS** |
| Explore-6 | Step 2 Dockerfile + requirements | 10 | **10/10 PASS** |
| Explore-7 | Step 3.2 find_profiles() | 6 | **6/6 PASS** |
| Explore-8 | Step 3.3 generate_flamegraph() | 10 | **10/10 PASS** |
| Explore-9 | Step 4.1-4.3 API 路由 | 9 | **9/9 PASS** |
| Explore-10 | Step 4.4-4.5 系统 API + Gunicorn | 9 | **9/9 PASS** |

唯一 FAIL 项：MetadataStore._read() 缺少 fcntl 共享锁，已修复。

## Git 提交

- **commit**: `2d3676c` — `feat: implement REST API (Step 4) + fix metadata read lock`
- 内容：Flask 应用工厂 + 4 个 API 端点 + entrypoint.sh Gunicorn 集成 + metadata.py 锁修复
- 已推送至 `origin/main`
