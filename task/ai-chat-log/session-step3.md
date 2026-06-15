# AI 对话记录 — Step 3: 火焰图生成后端

## 对话概要

本次对话实现 Step 3 火焰图生成后端，包括 FlameGraph 工具链验证、`find_profiles` 文件查询函数和 `generate_flamegraph` SVG 生成函数。用户要求严格按 VIBECODING_PLAN 逐步实现并逐项验证，而非一次性完成所有代码。

## 关键用户提示

- "开始 Step 3 火焰图生成后端"
- "一步一步来 你没按vibecoding_plan来做 没有进行验证" — 纠正AI一次性完成所有代码的行为，要求严格按计划的 3.1→3.2→3.3 逐步实现并验证每个测试指标
- "如果符合确认验收要求帮我git" — 验收通过后提交代码

## AI 核心回应与决策

### find_profiles 函数 (`api/utils.py`)

- 使用 `MetadataStore.query(start_iso, end_iso)` 查询时间重叠的元数据条目
- 将返回的 `file` 字段拼接 `data_dir` 生成完整路径
- 时间重叠判断: `profile.start <= query.end AND profile.end >= query.start`（由 MetadataStore 内部实现）

### generate_flamegraph 管道实现 (`api/utils.py`)

- 对每个 `perf.data` 文件单独执行 `perf script -i {path}`，通过 `subprocess.run` 捕获 stdout
- 将所有 `perf script` 输出合并后，通过 `subprocess.Popen` 管道串联: `stackcollapse-perf.pl | flamegraph.pl --title {title}`
- 支持 `output_path` 参数：指定则写文件，否则返回 SVG 字符串

### FlameGraph 工具链验证

- 在运行中的容器内直接测试 `perf script | stackcollapse-perf.pl | flamegraph.pl` 全流水线
- 注意避开正在写入的采样文件（data size=0），选用已完成写入的旧文件

## 关键决策

1. **subprocess.Popen 管道串联** — 避免生成中间临时文件，stackcollapse 的 stdout 直连 flamegraph 的 stdin
2. **火焰图标题显示时间范围** — 通过 `flamegraph.pl --title` 参数传入查询时间范围
3. **perf script 单独执行后合并** — 多文件场景下，逐个执行 `perf script` 收集文本，再统一送入管道；单个文件 perf script 失败时跳过继续，全部失败才报错
4. **逐步验证而非一次完成** — 用户纠正后改为 3.1→3.2→3.3 逐步实现和验证

## 验证结果

| 子步骤 | 测试指标 | 结果 |
|---|---|---|
| 3.1 FlameGraph 工具链 | 流水线无报错，SVG>1KB，包含`<svg`标签 | PASS (398KB SVG) |
| 3.2 find_profiles | 重叠范围返回非空列表 | PASS (5文件) |
| 3.2 find_profiles | 未来时间返回空列表 | PASS (0文件) |
| 3.2 find_profiles | 宽时间范围返回所有重叠文件 | PASS (35文件) |
| 3.3 generate_flamegraph | 返回含`<svg`的字符串 | PASS (361KB) |
| 3.3 generate_flamegraph | 写入文件可打开 | PASS |
| 3.3 generate_flamegraph | 空列表抛出 ValueError | PASS |
| 3.3 generate_flamegraph | 不存在路径抛出 FileNotFoundError | PASS |
| 端到端 | ISO范围→find_profiles→generate_flamegraph→有效SVG | PASS (200KB SVG) |

最终提交: `feat: Step 3 火焰图生成后端` (7077715)，已推送至 origin/main。
