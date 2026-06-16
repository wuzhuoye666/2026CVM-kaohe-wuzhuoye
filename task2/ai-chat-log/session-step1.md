# AI 对话记录 — Step 1: 采集核心

## 对话概览

本次对话围绕 7x24 Linux CPU 持续 Profiling 工具的 **Step 1（采集核心）** 展开，从项目初始化到完成全部采集模块的实现与测试。

---

## 关键用户提示与 AI 回应

### 1. 项目初始化与深度调研
- **用户**: `/deep-research` — "我现在需要完成一个7*24的linux cpu profiling工具，注意：具体需求在产品文档.md里面 现在给我一个项目结构和vibecoding顺序"
- **AI**: 读取产品文档，启动深度研究工作流，调研 perf 持续采集最佳实践、FlameGraph 工具链、容器化 perf 注意事项、类似工具（Parca/Pyroscope）参考方案，输出完整的项目结构建议和开发顺序

### 2. 要求详细执行计划
- **用户**: "先把项目结构创建好 还有vibecoding执行步骤 防止后期乱套 需要每一步执行的小步1.1 1.2类似 并且每一步有测试指标 这一步通过才能下一步"
- **AI**: 创建完整目录结构，初始化 git 仓库，编写首版 VIBECODING_PLAN.md（8个Step，带子步骤和测试指标）

### 3. 推送到 GitHub
- **用户**: "先帮我git-init 并放到仓库"
- **AI**: 安装 gh CLI，创建 GitHub 仓库 `wuzhuoye666/2026CVM-kaohe-wuzhuoye`，首次 commit 并推送（遇到 TLS 连接问题，通过 `git config http.version HTTP/1.1` 解决）

### 4. 要求更详细的计划
- **用户**: "等等 vibecoding流程不是我要的 你必须写详细 我接下来会频繁刷新上下文 必须有详细步骤 必须做到看vibecoding plan就知道已经做了什么 还有每一步的测试指标必须有小点 可以另开一个memery-bank 里面存放对整个项目的指导"
- **AI**: 重写 VIBECODING_PLAN.md 至三级子步骤级别（如 1.1.1, 1.1.2...），每个步骤带 `[ ]` checkbox，测试指标也逐条列出 checkbox，顶部增加进度一览表；同时创建项目 memory-bank（architecture guidelines）

### 5. 开始 Step 1 采集核心
- **用户**: "开始 Step 1 采集核心"
- **AI**: 按计划逐步实现：

#### Step 1.1 — PerfCollector 类骨架
- 实现 `PerfCollector` 类（`perf_collector.py`），支持 `output_dir`, `freq`, `slice_sec` 参数
- `run_one_slice()` 方法：构造并执行 `perf record -a -g -F {freq} -o {file} -- sleep {slice_sec}`
- `run()` 方法：while True 循环，异常不打断
- 文件命名格式 `perf-YYYYMMDD_HHMMSS.data`
- 自动检测 perf 二进制路径（支持版本号如 perf_5.15）
- **测试**: 类可导入、实例化；运行10秒切片成功生成采样文件（0.7MB），格式正确
- **关键调试**: `perf_event_paranoid` 初始值为 4，需设为 0 才能全系统采集

#### Step 1.2 — 元数据索引 metadata.py
- 实现 `MetadataStore` 类，JSON 数组格式存储，文件级 fcntl 加锁
- `add_entry(file_path, start_time, end_time, size_mb)` — 追加元数据
- `query(start, end)` — 按时间范围查询（区间重叠判断）
- `remove_before(cutoff)` — 删除指定时间之前的条目，返回被删除的 file_path 列表
- `all_entries()` — 获取全部条目
- ISO格式时间字符串，带解析函数
- **测试**: 4项全部通过（重叠查询、无重叠查询、跨文件查询、remove_before）

#### Step 1.3 — 元数据写入集成到 PerfCollector
- 在 `PerfCollector.__init__` 中增加 `metadata_path` 参数，实例化 MetadataStore
- 在 `run_one_slice()` 完成后自动写入元数据条目（文件名、起止时间、大小）
- 更新 CLI 参数 `--metadata-path`
- **测试**: 集成运行后 metadata.json 包含完整条目，字段完整、时间连续

#### Step 1.4 — 过期数据清理 cleaner.py
- 实现 `DataCleaner` 类，接收 `data_dir`, `metadata_store`, `retention_hours`
- `run_once()` — 查询过期条目，删除对应 .data 文件，从 metadata 中移除条目
- `run_loop(interval)` — 定时循环清理
- 支持 CLI 独立运行
- **测试**: 创建26小时前文件，运行清理后确认识删；当前文件不受影响

#### Step 1.5 — 入口脚本 entrypoint.sh
- 编写容器入口脚本，后台启动 collector + cleaner，前台预留 API 服务器
- 支持环境变量: `PERF_FREQ`, `SLICE_SEC`, `RETENTION_HOURS`, `PORT`
- 自动设置 `perf_event_paranoid = 0`
- 信号转发（SIGTERM/SIGINT）
- **调试**: 发现 `DATA_DIR` 硬编码为 `/data`，修正为支持环境变量 `DATA_DIR` 覆盖
- **测试**: 在宿主机运行入口脚本，确认 collector 后台持续采集，采样文件正常生成

---

## 关键代码决策

- **perf 采集方式**: 采用 `perf record -a -g -F 99 -- sleep 60` 循环分片，而非 `--switch-output`，理由是兼容性更好（内核 <4.6 不支持）且元数据索引更灵活可控
- **采样频率**: 99Hz（-F 99），避免与系统定时器锁步采样导致偏差，开销 <1%
- **元数据存储**: JSON 数组文件 + fcntl 文件锁，简单可靠，无需数据库依赖
- **时间区间查询**: 使用区间重叠判断（start < q_end AND end > q_start），支持跨多个采样文件的时间范围查询

## 重要调试/排错时刻

1. **perf_event_paranoid = 4**: 默认值过高导致 perf 无法采集，需设为 0（容器需 `--privileged`）
2. **GitHub TLS 连接超时**: `GnuTLS recv error (-110)`，通过 `git config http.version HTTP/1.1` 解决
3. **DATA_DIR 环境变量未生效**: entrypoint.sh 中硬编码了 `/data`，修正为 `DATA_DIR="${DATA_DIR:-/data}"` 支持覆盖

## 最终状态

Step 1 全部 5 个子步骤（1.1-1.5）实现并通过测试。采集核心模块（PerfCollector、MetadataStore、DataCleaner、entrypoint.sh）功能完整，代码已提交并推送到 GitHub。
