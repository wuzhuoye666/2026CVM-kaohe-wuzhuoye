# 7x24 持续 CPU Profiling 工具

## 项目简介

本工具是一个容器化的持续 CPU Profiling 解决方案，让 `perf record` 像"黑匣子"一样常驻后台运行，按固定时间窗口（默认1分钟）自动轮转保存采样数据。当 CPU 异常发生后，只需指定时间点即可回查当时的采样数据，一键生成火焰图定位根因——不再需要"赶到现场却发现进程已恢复正常"的遗憾。

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    宿主机 (Linux)                         │
│                                                         │
│  ┌──────────────── Docker Container ──────────────────┐ │
│  │                                                    │ │
│  │  采集层: perf record -a -g -F 99 (99Hz全系统采样)   │ │
│  │     │  每分钟一个 .data 文件, 写入 /data            │ │
│  │     ▼                                              │ │
│  │  存储层: metadata.json 索引 + 自动过期清理           │ │
│  │     │  默认保留24小时, 可配置                        │ │
│  │     ▼                                              │ │
│  │  API层: Flask + Gunicorn (端口8080)                  │ │
│  │     │  /api/profiles     - 采样数据查询              │ │
│  │     │  /api/flamegraph   - SVG火焰图生成             │ │
│  │     │  /api/flamegraph/data - 层级JSON(d3用)        │ │
│  │     │  /api/system/status - 系统状态监控             │ │
│  │     ▼                                              │ │
│  │  前端层: 纯HTML/CSS/JS + d3-flame-graph CDN          │ │
│  │        时间线选择 → SVG嵌入/d3交互渲染双路径          │ │
│  │                                                    │ │
│  └────────────────────────────────────────────────────┘ │
│                      ↕ --pid=host --privileged           │
└─────────────────────────────────────────────────────────┘
```

**核心数据流**: `perf record` → `perf-YYYYMMDD_HHMMSS.data` 分片文件 → `metadata.json` 时间索引 → API 查询匹配 → `perf script | stackcollapse-perf.pl | flamegraph.pl` 生成 SVG → 前端渲染

## 快速启动

### 方式一：从镜像包加载（推荐）

```bash
# 1. 加载 Docker 镜像
docker load -i profiler.tar

# 2. 一键启动（--privileged 必须，perf需要访问PMU硬件计数器）
docker run --privileged --pid=host -d \
  -p 8080:8080 \
  -v /tmp/profiler-data:/data \
  --name cpu-profiler \
  cpu-profiler:latest

# 3. 打开浏览器访问
# http://localhost:8080
```

### 方式二：从源码构建

```bash
# 1. 构建 Docker 镜像
docker build -t cpu-profiler:latest ./src/

# 2. 启动容器
docker run --privileged --pid=host -d \
  -p 8080:8080 \
  -v /tmp/profiler-data:/data \
  --name cpu-profiler \
  cpu-profiler:latest
```

### 验证运行

```bash
# 查看容器状态
docker ps

# 查看系统状态API
curl http://localhost:8080/api/system/status

# 等待1-2分钟后，查看已有采样文件
ls /tmp/profiler-data/perf-*.data

# 查看元数据索引
cat /tmp/profiler-data/metadata.json
```

## 使用示例

### 1. Web 界面操作（推荐）

1. 打开 `http://localhost:8080`
2. 页面顶部显示系统概览（CPU使用率、磁盘占用、采集状态）
3. 在时间线上拖拽框选要回查的时间段
4. 火焰图区域自动加载渲染，可点击缩放、搜索函数名

### 2. 命令行 API 回查

```bash
# 查询某个时间段的采样数据
curl "http://localhost:8080/api/profiles?start=2026-06-15T03:00:00&end=2026-06-15T03:05:00"

# 生成该时间段的SVG火焰图
curl -o flamegraph.svg "http://localhost:8080/api/flamegraph?start=2026-06-15T03:00:00&end=2026-06-15T03:05:00"

# 获取d3-flame-graph所需的层级JSON数据
curl "http://localhost:8080/api/flamegraph/data?start=2026-06-15T03:00:00&end=2026-06-15T03:05:00"
```

### 3. 测试验证（CPU 飙升场景）

```bash
# 运行测试脚本，自动施加CPU压力并验证火焰图
bash test/test_scenario.sh
```

脚本会：
1. 记录当前时间并启动 `stress-ng` 施加60秒CPU压力
2. 结束后调用API回查该时间段
3. 生成火焰图SVG，验证其中包含 `stress-ng` / `matrixprod` 热点符号

## 前端访问地址

启动容器后，访问：**http://localhost:8080**

前端功能：
- **系统概览栏**: 实时显示CPU使用率、磁盘占用、采集状态
- **时间线**: 可视化过去24小时的采样覆盖情况，支持拖拽框选
- **火焰图**: 双路径渲染——SVG快速嵌入 + d3-flame-graph交互缩放/搜索

## 设计权衡说明

### 1. perf 循环分片 vs `--switch-output` 内核轮转

**选择**: 使用 `perf record -a -g -F 99 -o <file> -- sleep 60` 循环执行，而非 `--switch-output` 内核级轮转。

**权衡理由**:
- `--switch-output` 需要 Linux 内核 4.6+，在旧内核上不可用
- 循环+sleep 方式兼容性更好，元数据索引更灵活可控（每次记录精确的开始/结束时间）
- 代价是两次采样之间有 ~100ms 间隙（sleep 结束到下一次 perf record 启动），对于分钟级的故障回查可忽略

### 2. `--privileged` 特权模式 vs 细粒度 capabilities

**选择**: 使用 `--privileged` 运行容器。

**权衡理由**:
- perf 需要访问宿主机 PMU 内核计数器，必须设置 `perf_event_paranoid=0`
- 细粒度方案需要 `--cap-add=SYS_ADMIN --cap-add=SYS_PTRACE`，且还需额外挂载 `/sys/kernel/debug`、`/proc/sys/kernel` 等，配置复杂
- `--privileged` 在开发和测试环境是最简单可靠的选择
- **生产建议**: 使用最小权限原则，仅添加必要的 capabilities 并限定挂载点

### 3. SVG 嵌入 vs d3-flame-graph 交互渲染

**选择**: 同时支持两种路径——SVG 直接嵌入和 d3-flame-graph 交互渲染。

**权衡理由**:
- SVG 嵌入零依赖、加载快，但交互能力有限（仅支持容器自带点击缩放）
- d3-flame-graph 支持函数搜索高亮、hover tooltip、点击缩放等交互，但加载 d3 库增加带宽
- 双路径兼顾：网络不佳时 SVG 可用，网络良好时 d3 交互体验更优

### 4. 元数据索引 vs 文件名解析

**选择**: 使用 `metadata.json` 集中索引采样文件的时间范围和大小。

**权衡理由**:
- 文件名仅含起始时间，无法准确判断采样结束时间
- 集中索引支持快速时间范围查询，无需遍历所有文件
- 代价是需要保证 metadata.json 与实际文件的一致性（通过 fcntl 文件锁解决并发问题）

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PERF_FREQ` | `99` | perf 采样频率(Hz)，避免与系统定时器锁步采样 |
| `SLICE_SEC` | `60` | 每个采样切片的时长(秒) |
| `RETENTION_HOURS` | `24` | 采样数据保留时长(小时)，过期自动清理 |
| `PORT` | `8080` | API 服务器监听端口 |
| `DATA_DIR` | `/data` | 采样数据存储目录，建议通过 `-v` 挂载宿主机目录 |

## API 端点一览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/profiles?start=&end=` | GET | 查询时间段内的采样文件列表 |
| `/api/flamegraph?start=&end=` | GET | 生成火焰图SVG |
| `/api/flamegraph/data?start=&end=` | GET | 获取层级JSON(供d3渲染) |
| `/api/system/status` | GET | 系统状态(CPU/磁盘/采集状态) |

时间参数格式为 ISO 8601: `YYYY-MM-DDTHH:MM:SS`，例如 `2026-06-15T03:00:00`
