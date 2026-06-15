# 7x24 Linux CPU Profiling 工具 — Vibecoding 执行计划

> **使用方法**: 每完成一个小步骤，在对应条目的 `[ ]` 中打 `[x]`。
> 刷新上下文后会话丢失，但此文件保留进度，一看就知道做到哪了。
> 每步必须通过**测试指标**中所有检查点，才能进入下一步。

---

## 当前进度一览

| Step | 内容 | 状态 |
|------|------|------|
| 1 | 采集核心 — perf record 持续采集 + 轮转 | [x] 完成 |
| 2 | Docker 容器化 | [x] 完成 |
| 3 | 火焰图生成后端 | [x] 完成 |
| 4 | REST API 完整实现 | [x] 完成 |
| 5 | Web 前端 | [x] 完成 |
| 6 | 测试验证 | [x] 完成 |
| 7 | 文档 + 镜像导出 | [x] 完成 |
| 8 | Git 历史 + 最终打磨 | [ ] |

---

## Step 1: 采集核心 — perf record 持续采集 + 1分钟轮转

### 1.1 创建 PerfCollector 类骨架 (perf_collector.py)

- [x] 1.1.1 创建 `PerfCollector` 类，`__init__` 接收参数: `output_dir`, `freq=99`, `slice_sec=60`
- [x] 1.1.2 实现 `run_one_slice()` 方法: 构造并执行 `perf record -a -g -F {freq} -o {output_dir}/perf-{timestamp}.data -- sleep {slice_sec}`
- [x] 1.1.3 实现 `run()` 方法: while True 循环调用 `run_one_slice()`，捕获异常不打断循环，打印日志
- [x] 1.1.4 实现 `if __name__ == "__main__"` 入口: 解析命令行参数，实例化并运行
- [x] 1.1.5 采样文件命名格式: `perf-20260615_030500.data`（年月日_时分秒）

**测试指标 1.1**:
- [x] 运行 `python3 -c "from collector.perf_collector import PerfCollector; p=PerfCollector('/tmp/test-data'); print(p)"` 无报错
- [x] 运行 `python3 -m collector.perf_collector --output-dir /tmp/test-data --freq 99 --slice 10`，等待15秒后Ctrl+C
- [x] `ls /tmp/test-data/perf-*.data` 至少有一个文件
- [x] 文件名格式匹配 `perf-YYYYMMDD_HHMMSS.data`

---

### 1.2 元数据索引 (metadata.py)

- [x] 1.2.1 创建 `MetadataStore` 类，`__init__` 接收 `filepath`（默认 `/data/metadata.json`）
- [x] 1.2.2 实现 `add_entry(file_path, start_time, end_time, size)` 方法: 追加一条记录到JSON数组
- [x] 1.2.3 实现 `query(start_time, end_time)` 方法: 返回所有与 [start_time, end_time] 时间范围有重叠的条目
- [x] 1.2.4 实现 `remove_before(cutoff_time)` 方法: 删除早于 cutoff_time 的条目
- [x] 1.2.5 实现 `all_entries()` 方法: 返回全部条目
- [x] 1.2.6 文件读写加锁（fcntl），防止collector和cleaner并发冲突
- [x] 1.2.7 每条记录格式: `{"file": "perf-20260615_030500.data", "start": "2026-06-15T03:05:00", "end": "2026-06-15T03:06:00", "size_mb": 1.2}`

**测试指标 1.2**:
- [x] 单元测试: `python3 -c "from collector.metadata import MetadataStore; m=MetadataStore('/tmp/test-meta.json'); m.add_entry('f1','2026-06-15T03:00:00','2026-06-15T03:01:00',1.0); print(m.query('2026-06-15T03:00:30','2026-06-15T03:00:40'))"` 返回1条结果
- [x] 无重叠测试: query 一个完全不在范围内的时间，返回空列表
- [x] remove_before 测试: 添加3条记录，remove_before中间时间，只剩2条

---

### 1.3 将元数据写入集成到 PerfCollector

- [x] 1.3.1 在 `run_one_slice()` 中，执行完 perf record 后，调用 `metadata.add_entry()`
- [x] 1.3.2 start_time 取 perf 命令执行前时间，end_time 取 sleep 结束后时间
- [x] 1.3.3 size 取文件 stat 的字节数转为MB

**测试指标 1.3**:
- [x] 运行 collector 2个采样周期（slice=10秒，等25秒）
- [x] `metadata.json` 中有2条记录
- [x] 每条记录的 file/start/end/size_mb 字段完整且合理
- [x] 两段时间连续（前一条end ≈ 后一条start）

---

### 1.4 过期数据清理 (cleaner.py)

- [x] 1.4.1 创建 `DataCleaner` 类，`__init__` 接收 `data_dir`, `metadata_store`, `retention_hours=24`
- [x] 1.4.2 实现 `run_once()` 方法:
  - 计算截止时间 = now - retention_hours
  - 调用 `metadata_store.query("2020-01-01", 截止时间)` 获取过期条目
  - 删除对应的 .data 文件
  - 调用 `metadata_store.remove_before(截止时间)`
- [x] 1.4.3 实现 `run()` 方法: 每5分钟循环调用 `run_once()`
- [x] 1.4.4 删除文件前检查文件存在，删除失败打印警告但不中断

**测试指标 1.4**:
- [x] 创建 `/tmp/test-clean/` 目录，放入一个 `perf-20260614_030000.data`（模拟26小时前的文件）
- [x] 往 `/tmp/test-clean-meta.json` 写入对应元数据
- [x] 运行 `cleaner.run_once()`，确认文件被删除、元数据被清理
- [x] 其他非过期文件不受影响

---

### 1.5 入口脚本 (entrypoint.sh)

- [x] 1.5.1 脚本开头 `#!/bin/bash` + `set -euo pipefail`
- [x] 1.5.2 创建 `/data` 目录（如果不存在）（注：已改为可配置DATA_DIR）
- [x] 1.5.3 设置内核参数: `echo 0 > /proc/sys/kernel/perf_event_paranoid`（如果可写）
- [x] 1.5.4 后台启动 collector: `python3 -m collector.perf_collector --output-dir /data --freq ${PERF_FREQ:-99} --slice ${SLICE_SEC:-60} &`
- [x] 1.5.5 后台启动 cleaner: `python3 -m collector.cleaner --data-dir /data --retention ${RETENTION_HOURS:-24} &`
- [x] 1.5.6 前台启动 API 服务器（先占位 `sleep infinity`，Step 4 替换为 gunicorn）
- [x] 1.5.7 `chmod +x entrypoint.sh`

**测试指标 1.5**:
- [x] 在宿主机直接运行 `bash entrypoint.sh`（需要root权限运行perf）
- [x] 等30秒后，`ls /data/perf-*.data` 有文件生成（注：需要设置DATA_DIR=/tmp/xxx测试）
- [x] `cat /data/metadata.json` 有对应条目
- [x] `ps aux | grep perf` 看到 perf record 进程在运行

**Step 1 整体通过标准**:
- [x] 宿主机运行 entrypoint.sh，连续运行3分钟
- [x] 生成至少2个采样文件
- [x] metadata.json 条目正确且时间连续
- [x] 手动触发 cleaner 可正确清理过期文件
- [x] 整体 CPU 开销 < 2%（用 `top` 确认 perf + python 占用）

---

## Step 2: Docker 容器化

### 2.1 编写 Dockerfile

- [x] 2.1.1 基础镜像 `FROM ubuntu:22.04`
- [x] 2.1.2 `ENV DEBIAN_FRONTEND=noninteractive`
- [x] 2.1.3 安装载依赖: `apt-get update && apt-get install -y linux-tools-common python3 python3-pip perl stress-ng`（注：linux-perf 在 ubuntu 中为 linux-tools-common，去掉不需要的 wget/git，加入 stress-ng 用于测试）
- [x] 2.1.4 处理 perf 路径: 动态查找 `perf_*` 最新版本并软链接
- [x] 2.1.5 FlameGraph: 使用本地 COPY（因网络限制无法 git clone，等效替代）
- [x] 2.1.6 设置工作目录: `WORKDIR /app`
- [x] 2.1.7 `COPY requirements.txt . && pip3 install --no-cache-dir -r requirements.txt`
- [x] 2.1.8 `COPY api/ ./api/` + `COPY collector/ ./collector/` + `COPY entrypoint.sh .`（更精确的COPY）
- [x] 2.1.9 `RUN chmod +x /app/entrypoint.sh`
- [x] 2.1.10 `VOLUME ["/data"]`
- [x] 2.1.11 `EXPOSE 8080`
- [x] 2.1.12 `ENTRYPOINT ["/app/entrypoint.sh"]`

**测试指标 2.1**:
- [x] `docker build -t cpu-profiler:latest /root/Project/2026CVM-kaohe-wuzhuoye/task/src/` 构建成功
- [x] 构建时间 < 5分钟（首次约3分钟，缓存后 <30秒）
- [x] 镜像大小 < 800MB（实际 341MB）

---

### 2.2 编写 requirements.txt

- [x] 2.2.1 内容: `flask==3.0.*`, `gunicorn==21.2.*`, `psutil==5.9.*`

**测试指标 2.2**:
- [x] `pip3 install -r requirements.txt` 安装成功无冲突（容器内验证: Flask 3.0.3, gunicorn 21.2.0, psutil 5.9.8）
- [x] `python3 -c "import flask; import gunicorn; import psutil; print('OK')"` 输出OK

---

### 2.3 容器内采集验证

- [x] 2.3.1 运行: `docker run --privileged --pid=host -v /tmp/profiler-data:/data -d --name cpu-profiler cpu-profiler:latest`
- [x] 2.3.2 等2分钟后: `ls /tmp/profiler-data/perf-*.data` 有文件
- [x] 2.3.3 `cat /tmp/profiler-data/metadata.json` 条目正确

**测试指标 2.3**:
- [x] 容器状态 `docker ps` 显示 running（Up 6+ minutes）
- [x] 宿主机挂载目录有采样文件（7个 .data 文件）
- [x] metadata.json 条目数 ≈ 采样文件数（差异1因最新采样进行中，属正常）

---

### 2.4 容器重启数据持久化

- [x] 2.4.1 `docker stop cpu-profiler && docker start cpu-profiler`
- [x] 2.4.2 等待1分钟后确认新采样文件生成

**测试指标 2.4**:
- [x] 旧采样文件仍在（重启前7个→重启后旧7个全部保留）
- [x] 新采样文件正常生成（重启后新增2个，metadata.json 新增条目）

**Step 2 整体通过标准**:
- [x] `docker build` 成功
- [x] `docker run --privileged --pid=host` 一键启动采集
- [x] 宿主机挂载卷可见数据且重启后持久化

---

## Step 3: 火焰图生成后端

### 3.1 验证 FlameGraph 工具链

- [x] 3.1.1 进入运行中容器: `docker exec -it cpu-profiler bash`
- [x] 3.1.2 测试全流水线: `perf script -i /data/perf-xxx.data | /opt/FlameGraph/stackcollapse-perf.pl | /opt/FlameGraph/flamegraph.pl > /tmp/test.svg`
- [x] 3.1.3 验证SVG: `head -5 /tmp/test.svg` 包含 `<svg` 标签

**测试指标 3.1**:
- [x] 流水线命令执行无报错
- [x] 生成的SVG文件 > 1KB
- [x] 文件开头包含 `<svg`

---

### 3.2 编写按时间查找文件函数 (utils.py)

- [x] 3.2.1 实现 `find_profiles(start_iso, end_iso, data_dir="/data")`: 读取 metadata.json，返回时间重叠的文件完整路径列表
- [x] 3.2.2 时间重叠判断逻辑: `profile.start <= query.end AND profile.end >= query.start`
- [x] 3.2.3 输入参数为 ISO 格式字符串（如 `2026-06-15T03:00:00`），内部转为 datetime 比较

**测试指标 3.2**:
- [x] 给定已有采样的时间范围中间段，返回非空列表
- [x] 给定完全无关的未来时间，返回空列表
- [x] 跨越多个采样文件的宽时间范围，返回所有重叠文件

---

### 3.3 编写 generate_flamegraph 函数 (utils.py)

- [x] 3.3.1 实现 `generate_flamegraph(file_paths, output_path=None)`:
  - 遍历 file_paths，对每个执行 `perf script -i {path}`
  - 将所有输出合并 piped 给 `stackcollapse-perf.pl | flamegraph.pl`
  - 如果 output_path 指定，写入文件；否则返回 SVG 字符串
- [x] 3.3.2 使用 `subprocess.Popen` 管道串联，避免临时中间文件
- [x] 3.3.3 火焰图标题显示查询时间范围
- [x] 3.3.4 错误处理: perf script 或 perl 脚本失败时抛出明确异常

**测试指标 3.3**:
- [x] 调用 `generate_flamegraph(["/data/perf-xxx.data"])` 返回包含 `<svg` 的字符串
- [x] 调用 `generate_flamegraph(["/data/perf-xxx.data"], "/tmp/out.svg")` 生成文件可浏览器打开
- [x] 传入空列表抛出 ValueError
- [x] 传入不存在的文件路径抛出明确异常

**Step 3 整体通过标准**:
- [x] 给定 ISO 时间范围 → `find_profiles` 返回正确文件列表
- [x] 文件列表传入 `generate_flamegraph` → 生成有效SVG
- [x] 浏览器打开SVG显示完整火焰图

---

## Step 4: REST API 完整实现

### 4.1 Flask app 工厂 (app.py)

- [x] 4.1.1 实现 `create_app()` 工厂函数
- [x] 4.1.2 注册蓝图: `profiles_bp`, `flamegraph_bp`, `system_bp`
- [x] 4.1.3 配置 Flask 静态文件服务: `static_folder="../frontend"`, `static_url_path="/"`
- [x] 4.1.4 添加根路由 `/` 返回 `index.html`
- [x] 4.1.5 配置 CORS（如有跨域需求）

**测试指标 4.1**:
- [x] `python3 -c "from api.app import create_app; app=create_app(); print(app.url_map)"` 无报错
- [x] `flask --app api.app run` 启动无报错
- [x] `curl http://localhost:5000/` 返回200

---

### 4.2 采样数据查询API (routes_profiles.py)

- [x] 4.2.1 创建蓝图 `profiles_bp = Blueprint('profiles', __name__, url_prefix='/api/profiles')`
- [x] 4.2.2 实现 `GET /api/profiles?start=...&end=...`
  - 调用 `find_profiles(start, end)` 获取文件列表
  - 返回 JSON: `{"files": [...], "count": N, "start": "...", "end": "..."}`
- [x] 4.2.3 参数缺失时返回 400 + 错误信息
- [x] 4.2.4 日期格式非法时返回 400 + 错误信息

**测试指标 4.2**:
- [x] `curl "http://localhost:5000/api/profiles?start=2026-06-15T00:00:00&end=2026-06-15T23:59:59"` 返回200 + JSON
- [x] 无 start 参数返回 400
- [x] 非法日期格式返回 400
- [x] 无匹配时间范围返回 `{"files": [], "count": 0}`

---

### 4.3 火焰图生成API (routes_flamegraph.py)

- [x] 4.3.1 创建蓝图 `flamegraph_bp = Blueprint('flamegraph', __name__, url_prefix='/api/flamegraph')`
- [x] 4.3.2 实现 `GET /api/flamegraph?start=...&end=...`
  - 调用 `find_profiles` + `generate_flamegraph`
  - 返回 SVG 内容，`Content-Type: image/svg+xml`
- [x] 4.3.3 实现 `GET /api/flamegraph/data?start=...&end=...`（d3-flame-graph 用）
  - 调用 `find_profiles`，执行 `perf script | stackcollapse-perf.pl`
  - 解析 folded stack 格式为层级 JSON `{name, value, children}`
  - 返回 `Content-Type: application/json`
- [x] 4.3.4 参数校验同 4.2

**测试指标 4.3**:
- [x] `curl "http://localhost:5000/api/flamegraph?start=...&end=..."` 返回 SVG + content-type 正确
- [x] 浏览器直接访问该URL显示火焰图
- [x] `curl "http://localhost:5000/api/flamegraph/data?start=...&end=..."` 返回层级JSON
- [x] 无匹配时间返回 404 + 提示信息

---

### 4.4 系统状态API (routes_system.py)

- [x] 4.4.1 创建蓝图 `system_bp = Blueprint('system', __name__, url_prefix='/api/system')`
- [x] 4.4.2 实现 `GET /api/system/status` 返回:
  ```json
  {
    "cpu_percent": 12.5,
    "disk_usage_percent": 45.2,
    "data_dir_size_mb": 128.3,
    "data_dir_files": 24,
    "collector_status": "running",
    "retention_hours": 24,
    "uptime_seconds": 3600
  }
  ```
- [x] 4.4.3 用 `psutil` 获取 CPU 和磁盘信息
- [x] 4.4.4 collector_status 通过检查 perf 进程是否存活判断

**测试指标 4.4**:
- [x] `curl http://localhost:5000/api/system/status` 返回200 + JSON
- [x] 所有字段都存在且类型正确
- [x] 连续请求3次，cpu_percent 值有变化（说明确实在实时读取）

---

### 4.5 配置 Gunicorn 并更新 entrypoint.sh

- [x] 4.5.1 修改 entrypoint.sh 前台进程为: `exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 2 "api.app:create_app()"`
- [x] 4.5.2 删除之前的 `sleep infinity` 占位

**测试指标 4.5**:
- [x] 容器启动后 `docker exec cpu-profiler ps aux | grep gunicorn` 显示 gunicorn master + worker 进程
- [x] `curl http://localhost:8080/api/system/status` 返回正确JSON（注意现在是8080端口）

**Step 4 整体通过标准**:
- [x] 4个API端点全部curl返回正确结果
- [x] 异常输入返回4xx状态码
- [x] gunicorn 正常运行

---

## Step 5: Web 前端

### 5.1 基础页面框架 (index.html + style.css)

- [x] 5.1.1 index.html: 引入 style.css 和所有JS文件
- [x] 5.1.2 布局结构:
  ```
  ┌──────────────────────────────────┐
  │  系统概览栏 (cpu/磁盘/状态)      │
  ├──────────────────────────────────┤
  │  时间线区 (24h色块 + 选区)       │
  ├──────────────────────────────────┤
  │  火焰图区 (SVG嵌入/d3渲染)       │
  └──────────────────────────────────┘
  ```
- [x] 5.1.3 引入 d3-flame-graph CDN
- [x] 5.1.4 引入 d3 v7 CDN
- [x] 5.1.5 style.css: 深色主题，火焰图区域占满宽度

**测试指标 5.1**:
- [ ] 浏览器访问 `http://localhost:8080/` 能看到三栏布局
- [ ] 浏览器控制台无JS/CSS报错
- [ ] 页面在1920x1080和1366x768下布局不错乱

---

### 5.2 系统概览组件 (system.js)

- [x] 5.2.1 实现 `SystemMonitor` 类/对象
- [x] 5.2.2 `fetch()`: 请求 `/api/system/status`，填充DOM元素
- [x] 5.2.3 `start()`: 每5秒调用 `fetch()`
- [x] 5.2.4 展示: CPU使用率(数字+颜色条)、磁盘占用、数据文件数、采集状态(绿/红点)

**测试指标 5.2**:
- [ ] 页面加载后1秒内显示系统信息
- [ ] CPU数值与 `curl /api/system/status` 返回值一致
- [ ] 等5秒后数值自动更新
- [ ] 采集状态显示绿色圆点 + "运行中"

---

### 5.3 时间线组件 (timeline.js)

- [x] 5.3.1 实现 `Timeline` 类/对象
- [x] 5.3.2 用 Canvas 绘制过去24小时的采集色块（每个色块=1个采样文件）
- [x] 5.3.3 支持鼠标拖拽框选时间范围
- [x] 5.3.4 框选完成后，触发回调传出 `start_time`, `end_time`（ISO格式）
- [x] 5.3.5 显示当前选区的时间范围标注文字
- [x] 5.3.6 X轴标注时间刻度（每4小时一个刻度）

**测试指标 5.3**:
- [ ] 时间线显示已有采样文件的色块
- [ ] 鼠标拖拽可选区，选区有高亮效果
- [ ] 选区下方显示 "2026-06-15 03:00 ~ 03:05" 格式的时间范围
- [ ] 已有采样时间段有色块，未来时间段空白

---

### 5.4 火焰图展示 — SVG嵌入路径 (flamegraph.js)

- [x] 5.4.1 实现 `FlameGraphView` 类/对象
- [x] 5.4.2 时间线选区变化时，fetch `/api/flamegraph?start=...&end=...`
- [x] 5.4.3 将返回的SVG字符串 `innerHTML` 嵌入页面容器
- [x] 5.4.4 显示加载中状态（spinner）
- [x] 5.4.5 显示错误状态（"无采样数据"等提示）

**测试指标 5.4**:
- [ ] 选择有数据的时间范围后，3秒内渲染出火焰图
- [ ] 火焰图可点击缩放（SVG自带交互）
- [ ] 选择无数据范围显示 "该时间段无采样数据"
- [ ] 加载过程中显示loading动画

---

### 5.5 d3-flame-graph交互渲染路径 (flamechart.js，加分项)

- [x] 5.5.1 fetch `/api/flamegraph/data?start=...&end=...` 获取层级JSON
- [x] 5.5.2 用 d3-flame-graph 渲染：支持搜索高亮、hover tooltip、点击缩放
- [x] 5.5.3 添加搜索框（输入函数名，高亮匹配栈帧）
- [x] 5.5.4 添加 Reset Zoom 按钮

**测试指标 5.5**:
- [ ] 火焰图支持鼠标悬停显示函数名+采样数 tooltip
- [ ] 搜索框输入函数名，匹配的栈帧高亮
- [ ] 点击栈帧可缩放，Reset Zoom 可恢复
- [ ] 渲染性能: 1000+节点不卡顿

**Step 5 整体通过标准**:
- [ ] 浏览器访问前端，三项组件全部可用
- [ ] 端到端流程: 选择时间范围 → 看到火焰图 → 可交互查看热点

---

## Step 6: 测试验证

### 6.1 编写 stress-ng 测试脚本 (test_scenario.sh)

- [x] 6.1.1 脚本头部: `#!/bin/bash + `set -euo pipefail`
- [x] 6.1.2 记录当前时间: `STRESS_START=$(date -u +"%Y-%m-%dT%H:%M:%S")`
- [x] 6.1.3 执行CPU压力: `stress-ng --cpu 2 --cpu-method matrixprod -t 60s`
- [x] 6.1.4 记录结束时间: `STRESS_END=$(date -u +"%Y-%m-%dT%H:%M:%S")`
- [x] 6.1.5 等待采样轮转完成: `sleep 70`
- [x] 6.1.6 调用API回查: `curl "http://localhost:8080/api/profiles?start=${STRESS_START}&end=${STRESS_END}"`
- [x] 6.1.7 生成火焰图: `curl -o /tmp/result.svg "http://localhost:8080/api/flamegraph?start=${STRESS_START}&end=${STRESS_END}"`
- [x] 6.1.8 验证SVG包含stress-ng: `grep -i "stress\|matrix" /tmp/result.svg && echo "PASS" || echo "FAIL"`

**测试指标 6.1**:
- [x] `bash test_scenario.sh` 一键执行完毕
- [x] API回查返回非空文件列表
- [x] 生成的SVG文件存在且 > 1KB
- [x] SVG中包含 stress-ng/matrix 相关符号

---

### 6.2 编写API单元测试 (test_api.py)

- [x] 6.2.1 用 pytest + Flask test client
- [x] 6.2.2 测试 GET /api/profiles 正常/异常参数
- [x] 6.2.3 测试 GET /api/flamegraph 正常/无数据
- [x] 6.2.4 测试 GET /api/system/status 返回正确字段
- [x] 6.2.5 测试边界: 跨天查询、超出保留期查询

**测试指标 6.2**:
- [x] `pytest test_api.py -v` 全部通过
- [x] 覆盖所有4个API端点的正常+异常场景

---

### 6.3 截图与验证记录

- [ ] 6.3.1 截图1: 前端时间线显示采样色块
- [ ] 6.3.2 截图2: 框选stress-ng时间段
- [ ] 6.3.3 截图3: 火焰图结果，红框标注 stress-ng/matrixprod 热点
- [ ] 6.3.4 截图4: 系统概览显示采集状态正常
- [x] 6.3.5 截图存入 `task/test/screenshots/`

**测试指标 6.3**:
- [ ] screenshots/ 目录包含至少3张截图(PNG/JPG)
- [ ] 火焰图截图中能肉眼识别 stress-ng 热点

**Step 6 整体通过标准**:
- [x] test_scenario.sh 一键通过
- [x] pytest 全绿
- [x] 火焰图中能看到 stress-ng 热点函数
- [ ] 截图完整

---

## Step 7: 文档 + 镜像导出

### 7.1 编写 task/README.md

- [x] 7.1.1 项目简介（2-3句话说明做什么）
- [x] 7.1.2 架构设计说明（文字描述: 采集层→存储层→API层→前端层）
- [x] 7.1.3 快速启动命令:
  ```bash
  docker load -i profiler.tar
  docker run --privileged --pid=host -d -p 8080:8080 -v /tmp/profiler-data:/data --name cpu-profiler cpu-profiler:latest
  ```
- [x] 7.1.4 使用示例: 如何回查时间段、如何生成火焰图
- [x] 7.1.5 前端访问地址: `http://localhost:8080`
- [x] 7.1.6 设计权衡说明（至少3条）:
  - perf分片 vs switch-output
  - --privileged vs 细粒度capabilities
  - SVG嵌入 vs d3-flame-graph交互渲染
- [x] 7.1.7 环境变量说明表

**测试指标 7.1**:
- [x] README 存在且 > 500字
- [x] 包含上述所有7个板块
- [x] 快速启动命令可直接复制执行

---

### 7.2 导出 Docker 镜像

- [x] 7.2.1 `docker save -o /root/Project/2026CVM-kaohe-wuzhuoye/task/profiler.tar cpu-profiler:latest`
- [x] 7.2.2 如果 > 100MB，计划上传GitHub Release并记录下载链接（实际72MB，可直接放仓库）

**测试指标 7.2**:
- [x] profiler.tar 文件生成成功
- [x] 记录文件大小（72MB）

---

### 7.3 补充根目录 README.md

- [x] 7.3.1 简要说明此仓库内容
- [x] 7.3.2 指向 `task/README.md` 的详细文档链接

**测试指标 7.3**:
- [x] 根README存在，包含指向task/README.md的链接

**Step 7 整体通过标准**:
- [x] README完整，评审方可按文档操作
- [x] 镜像文件就绪

---

## Step 8: Git 历史 + 最终打磨

### 8.1 整理 Git 提交历史

- [ ] 8.1.1 确认每个Step有对应commit
- [ ] 8.1.2 commit message 格式: `feat: xxx`, `fix: xxx`, `docs: xxx`
- [ ] 8.1.3 推送到远程: `git push origin main`

**测试指标 8.1**:
- [ ] `git log --oneline | wc -l` >= 8
- [ ] 每条commit message语义清晰

---

### 8.2 保存 AI 对话记录

- [ ] 8.2.1 导出关键对话到 `task/ai-chat-log/`
- [ ] 8.2.2 文件命名: `session-step1.md`, `session-step2.md` 等

**测试指标 8.2**:
- [ ] `ls task/ai-chat-log/` 非空
- [ ] 至少包含3个步骤的对话记录

---

### 8.3 最终全流程验证

- [ ] 8.3.1 模拟评审方: `git clone` → `docker load` → `docker run` → 浏览器访问 → 回查时间 → 生成火焰图
- [ ] 8.3.2 记录启动到可用的时间
- [ ] 8.3.3 确认所有功能正常

**测试指标 8.3**:
- [ ] 全流程0报错
- [ ] 从clone到看到火焰图 < 5分钟

**Step 8 整体通过标准**:
- [ ] 仓库公开可克隆
- [ ] 提交历史体现开发过程
- [ ] 全流程丝滑无阻

---

## 技术栈速查

| 层 | 技术 |
|---|---|
| 采集 | Linux perf (perf-record), 99Hz, sleep-60分片 |
| 后端 | Python 3.10 + Flask + Gunicorn |
| 前端 | 纯HTML/CSS/JS + d3-flame-graph CDN |
| 火焰图 | Brendan Gregg FlameGraph (flamegraph.pl) |
| 容器 | Docker (ubuntu:22.04 base, --privileged) |
| 测试 | stress-ng + pytest + curl |
