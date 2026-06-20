# 2026CVM-kaohe-wuzhuoye

2026 CVM 考核作业仓库

## 个人信息

- **姓名**: 吴卓烨
- **仓库**: https://github.com/wuzhuoye666/2026CVM-kaohe-wuzhuoye

## 题目完成情况概览

| 题目 | 内容 | 状态 |
|------|------|------|
| 题目1-1 | 多场景微架构指标采集（5种负载 perf stat） | ✅ 已完成 |
| 题目1-2 | 火焰图生成与热点分析（2种负载） | ✅ 已完成 |
| 题目1-3 | AI辅助编写 Cache Line 微基准测试 | ✅ 已完成 |
| 题目2 | 容器化持续 CPU Profiling 工具（含前端） | ✅ 已完成 |
| resume | 个人简历 | ✅ 已完成 |

## 项目内容

### task1/ — CPU 微架构性能指标采集、火焰图分析与瓶颈定位

- **1-perf-stat/** — 多场景微架构指标采集（5 种 stress-ng 负载 × perf stat）
  - `results/` — perf stat 原始输出
  - `README.md` — 环境准备与采集命令
- **2-flamegraph/** — 火焰图生成与热点分析（至少 2 种负载）
  - `flamegraphs/` — 生成的 SVG 火焰图
  - `README.md` — 操作步骤与分析要点
- **3-cache-line-test/** — AI 辅助编写 Cache Line 微基准测试
  - `src/cache_line_test.c` — C 源代码（不同步长遍历大数组）
  - `results/` — 各步长 perf 输出
  - `flamegraphs/` — stride=1 vs stride=64 对比火焰图
  - `ai-chat-log/` — AI 工具对话记录
  - `README.md` — 编译、运行、采集命令

### task2/ — AI 编程挑战：容器化持续 CPU Profiling 工具（已完成）

- `README.md` — 架构设计、快速启动、使用示例、设计权衡
- `src/` — 源代码（采集器、API、前端、Dockerfile）
- `profiler.tar` — Docker 镜像导出文件
- `test/` — 测试脚本与截图
- `ai-chat-log/` — AI 对话记录

详细说明请参阅各子目录的 `README.md`。
