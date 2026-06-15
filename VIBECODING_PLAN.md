# 7x24 Linux CPU Profiling 工具 — Vibecoding 执行计划

> 每个大步骤包含小步骤(1.1, 1.2...)，每步有明确的**测试指标**，通过后才能进入下一步。

---

## Step 1: 采集核心 — perf record 持续采集 + 1分钟轮转

### 1.1 创建 perf_collector.py 基础框架
- **做什么**: 实现 `PerfCollector` 类，循环执行 `perf record -a -g -F 99 -o /data/perf-{timestamp}.data -- sleep 60`
- **测试指标**: 手动运行 `python3 perf_collector.py`，在 `/data/` 下能看到连续生成 `perf-*.data` 文件，每个文件对应约1分钟采样

### 1.2 采样频率与命令行参数化
- **做什么**: 采样频率(-F)、时间窗口(sleep时长)、输出目录通过命令行参数或环境变量配置
- **测试指标**: 用不同参数启动（如 `-F 49 --slice 30`），确认采样文件按指定间隔生成，频率参数传递到perf命令

### 1.3 元数据索引 (metadata.py)
- **做什么**: 每生成一个采样文件，追加一条记录到 `/data/metadata.json`，包含 `{file, start_time, end_time, size}`
- **测试指标**: 运行2-3个采样周期后，`metadata.json` 中有对应条目，字段完整且时间连续

### 1.4 过期数据清理 (cleaner.py)
- **做什么**: 实现定时清理逻辑：扫描 `/data/`，删除超过24h的 `.data` 文件，同时清理 `metadata.json` 中对应条目
- **测试指标**: 手动创建一个26h前的 `.data` 文件和对应metadata条目，运行cleaner后确认该文件被删除、metadata条目被移除，其他文件不受影响

### 1.5 入口脚本 (entrypoint.sh)
- **做什么**: 编写容器入口脚本：后台启动collector循环 + 定时cleaner，前台预留给API服务器
- **测试指标**: 在宿主机直接运行 `bash entrypoint.sh`，确认collector在后台持续采集，采样文件正常生成

**Step 1 整体通过标准**: 宿主机运行入口脚本，连续采集5分钟，生成5个采样文件，metadata索引正确，无报错，CPU开销 < 2%

---

## Step 2: Docker 容器化

### 2.1 编写 Dockerfile
- **做什么**: 基于 `ubuntu:22.04`，安装 `linux-perf`/`python3`/`pip`/`flamegraph工具链`，COPY源码，设置ENTRYPOINT
- **测试指标**: `docker build -t cpu-profiler .` 构建成功，无报错

### 2.2 编写 requirements.txt
- **做什么**: 列出 flask, gunicorn, psutil 依赖
- **测试指标**: `pip install -r requirements.txt` 安装成功

### 2.3 容器内采集验证
- **做什么**: `docker run --privileged --pid=host -v /tmp/profiler-data:/data -d cpu-profiler`，等待2-3分钟
- **测试指标**: 进入容器或查看挂载卷，确认 `/data/` 下有采样文件生成，metadata索引更新正常

### 2.4 容器重启数据持久化
- **做什么**: 验证 `-v` 挂载宿主机目录后，容器停止再启动，历史采样数据仍在
- **测试指标**: 记录容器内采样文件列表 → `docker stop` → `docker start` → 确认文件仍存在且collector继续正常采集

**Step 2 整体通过标准**: `docker build` + `docker run --privileged` 一键启动，容器内持续采集，宿主机挂载卷可见采样数据

---

## Step 3: 火焰图生成后端

### 3.1 集成 FlameGraph 工具链
- **做什么**: 将 Brendan Gregg FlameGraph 仓库作为 submodule 或直接COPY进 `src/FlameGraph/`，确保 `flamegraph.pl` 和 `stackcollapse-perf.pl` 可执行
- **测试指标**: 容器内运行 `perf script -i /data/perf-xxx.data | stackcollapse-perf.pl | flamegraph.pl > test.svg`，生成有效SVG文件（浏览器可打开）

### 3.2 编写 generate_flamegraph 工具函数 (utils.py)
- **做什么**: 封装火焰图生成流水线：`find files by time range → perf script → stackcollapse → flamegraph.pl → SVG string/filepath`
- **测试指标**: 调用 `generate_flamegraph(start, end)` 返回SVG文件路径，浏览器打开显示正确火焰图

### 3.3 编写按时间查找文件函数 (utils.py)
- **做什么**: 实现 `find_profiles(start_time, end_time)`，从 metadata.json 中筛选时间重叠的采样文件
- **测试指标**: 给定已有采样文件的时间范围，返回正确文件列表；给定无匹配的时间范围，返回空列表

**Step 3 整体通过标准**: 给定时间范围，自动定位采样文件 → 生成火焰图SVG → 浏览器可视

---

## Step 4: REST API 完整实现

### 4.1 Flask app 工厂 (app.py)
- **做什么**: 创建 Flask app，注册蓝图(routes_profiles, routes_flamegraph, routes_system)，配置静态文件服务
- **测试指标**: `flask run` 启动无报错，`curl http://localhost:5000/` 返回200

### 4.2 采样数据查询API (routes_profiles.py)
- **做什么**: `GET /api/profiles?start=2026-06-15T03:00&end=2026-06-15T03:05` 返回匹配的采样文件列表及元数据
- **测试指标**: curl对应API返回JSON，包含files数组且字段完整；时间范围外返回空数组

### 4.3 火焰图生成API (routes_flamegraph.py)
- **做什么**: `GET /api/flamegraph?start=...&end=...` 触发生成并返回SVG内容（Content-Type: image/svg+xml）
- **测试指标**: curl该API返回SVG内容，浏览器直接访问显示火焰图

### 4.4 系统状态API (routes_system.py)
- **做什么**: `GET /api/system/status` 返回 `{cpu_percent, disk_usage, data_dir_size, collector_status, retention_hours}`
- **测试指标**: curl返回JSON，字段值合理（如cpu_percent为数字，collector_status为"running"）

### 4.5 配置 Gunicorn
- **做什么**: entrypoint.sh 中用 gunicorn 启动 Flask app，前端进程替代 flask dev server
- **测试指标**: 容器启动后，gunicorn进程存在，API响应正常

**Step 4 整体通过标准**: 所有4个API端点curl返回正确内容，HTTP状态码200，JSON格式正确

---

## Step 5: Web 前端

### 5.1 基础页面框架 (index.html + style.css)
- **做什么**: 三栏布局 — 顶部系统概览栏、中间时间线区、下方火焰图区
- **测试指标**: 浏览器访问 `http://localhost:8080` 显示三栏布局，无JS报错

### 5.2 系统概览组件 (system.js)
- **做什么**: 定时轮询 `/api/system/status`，展示CPU/磁盘/采集状态，每5秒刷新
- **测试指标**: 页面显示系统信息，数值与API返回一致，5秒后数值更新

### 5.3 时间线组件 (timeline.js)
- **做什么**: 可视化过去24小时的采集时间线，支持拖拽选择时间范围
- **测试指标**: 时间线显示色块代表每个采样文件，拖拽选区后下方显示选中的时间范围

### 5.4 火焰图展示 — SVG嵌入 (flamegraph.js)
- **做什么**: 选中时间范围后，请求 `/api/flamegraph` 获取SVG并嵌入页面
- **测试指标**: 选择时间范围后页面渲染火焰图SVG，可点击缩放

### 5.5 火焰图展示 — d3-flame-graph交互渲染（加分项）
- **做什么**: 新增API `GET /api/flamegraph/data?start=...&end=...` 返回层级JSON，前端用d3-flame-graph渲染
- **测试指标**: 火焰图支持搜索、缩放、hover tooltip等交互功能

**Step 5 整体通过标准**: 浏览器访问前端页面，系统状态正常显示，时间线可选择时间范围，火焰图可交互查看

---

## Step 6: 测试验证

### 6.1 编写 stress-ng 测试脚本 (test_scenario.sh)
- **做什么**: 自动化流程：启动profiler容器 → 记录当前时间 → 执行 `stress-ng --cpu 2 --cpu-method matrixprod -t 60s` → 等待采集轮转 → 通过API回查
- **测试指标**: 脚本一键运行，无手动干预，API返回包含stress-ng时间段的采样文件

### 6.2 验证火焰图定位准确性
- **做什么**: 用测试脚本生成的火焰图，检查是否能看到 `matrixprod` 或 `stress-ng` 相关热点函数
- **测试指标**: 火焰图中能识别到 stress-ng 相关函数栈帧，标注位置截图保存

### 6.3 编写API单元测试 (test_api.py)
- **做什么**: 用 pytest + Flask test client 测试所有API端点的正常/异常输入
- **测试指标**: `pytest test_api.py` 全部通过

### 6.4 截图与验证记录
- **做什么**: 保存测试过程截图到 `test/screenshots/`
- **测试指标**: screenshots目录包含：① 时间线选择截图 ② 火焰图结果截图（标注热点函数）

**Step 6 整体通过标准**: 一键测试脚本运行成功，火焰图中能看到stress-ng热点，截图完整

---

## Step 7: 文档 + 镜像导出

### 7.1 编写 task/README.md
- **做什么**: 包含 — 项目简介、架构设计说明、快速启动(docker load + run)、使用示例(回查+火焰图)、前端地址、设计权衡说明
- **测试指标**: 按README的快速启动命令，从零开始能成功启动容器并使用

### 7.2 导出 Docker 镜像
- **做什么**: `docker save -o profiler.tar cpu-profiler:latest`
- **测试指标**: 在另一台机器上 `docker load -i profiler.tar && docker run --privileged -d -p 8080:8080 cpu-profiler:latest` 能正常启动

### 7.3 补充根目录 README.md
- **做什么**: 简要指向 `task/README.md`
- **测试指标**: 根README存在且链接有效

**Step 7 整体通过标准**: 陌生的评审方按README操作能一键启动并使用工具

---

## Step 8: Git 历史 + 最终打磨

### 8.1 整理 Git 提交历史
- **做什么**: 确保每个Step对应有意义的commit，commit message清晰（如 `feat: add perf collector with 1-min rotation`）
- **测试指标**: `git log --oneline` 显示至少8个有意义的commit

### 8.2 保存 AI 对话记录
- **做什么**: 将关键AI对话导出到 `task/ai-chat-log/`
- **测试指标**: ai-chat-log目录非空，包含对话记录文件

### 8.3 最终全流程验证
- **做什么**: 从干净环境执行完整流程：git clone → docker load → docker run → 访问前端 → 回查时间 → 生成火焰图
- **测试指标**: 全流程无报错，功能完整

**Step 8 整体通过标准**: 仓库公开可克隆，提交历史完整，全流程丝滑无阻

---

## 技术栈速查

| 层 | 技术 |
|---|---|
| 采集 | Linux perf (perf-record), 99Hz, sleep-60分片 |
| 后端 | Python 3 + Flask + Gunicorn |
| 前端 | 纯HTML/CSS/JS + d3-flame-graph CDN |
| 火焰图 | Brendan Gregg FlameGraph (flamegraph.pl) |
| 容器 | Docker (ubuntu:22.04 base, --privileged) |
| 测试 | stress-ng + pytest + curl |
