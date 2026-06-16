# AI 对话记录 — Step 6: 测试验证

## 概述

本阶段实现了项目的测试验证工作，包括 stress-ng 端到端测试脚本、API 单元测试以及截图证据收集。所有测试均通过。

## 关键操作

### 6.1 stress-ng 端到端测试脚本 (test_scenario.sh)

- 创建 `test/test_scenario.sh`，完整的6步测试流程：
  1. **预检查**：确认 API 服务可用 (`/api/system/status`)
  2. **记录开始时间**：ISO 格式 `STRESS_START`
  3. **执行 CPU 压力**：`stress-ng --cpu 2 --cpu-method matrixprod -t 60s`)
  4. **等待轮转**：等待75秒让 perf 采样切片完成
  5. **API 回查**：用时间范围调用 `/api/profiles?start=...&end=...`
  6. **生成火焰图并验证**：调用 `/api/flamegraph`，检查 SVG 有效且包含 `stress-ng-cpu` 符号
- 设置 `chmod +x` 使脚本可执行

### 6.2 API 单元测试 (test_api.py)

- 使用 pytest + Flask test client 编写 23 个测试用例
- 测试类别：
  - **TestProfilesAPI** (7 个)：正常查询、无匹配、缺少 start/end 参数、格式错误参数
  - **TestFlamegraphSVG** (4 个)：正常生成SVG、无效时间范围返回空SVG、缺少参数400
  - **TestFlamegraphData** (5 个)：正常返回层级JSON、无数据返回空、缺少参数
  - **TestSystemAPI** (7 个)：状态返回字段验证、CPU/磁盘/采集器/运行时间字段检查
- 修复 `content_type` 断言：从 `== "image/svg+xml"` 改为 `"image/svg+xml" in ...`（Flask 添加 charset 后缀）
- 安装 pytest (`pip3 install pytest --break-system-packages`)
- **全部 23 个测试通过**

### 6.3 stress-ng 测试执行验证

- 在宿主机安装 stress-ng (`apt-get install -y stress-ng`)
- 执行 `test_scenario.sh`，结果：
  - 查到 2 个采样文件
  - SVG 文件大小 258070 bytes（有效 > 1KB）
  - **SVG 中包含 `stress-ng-cpu` 符号，占比 24.11%**
  - 最终结果：**PASS**
- 将火焰图 SVG 复制到 `task/test/screenshots/stress_ng_flamegraph.svg`
- 保存 API JSON 验证数据到 `system_status.json` 和 `stress_profiles.json`

## 产出文件

| 文件 | 说明 |
|------|------|
| `test/test_scenario.sh` | stress-ng 端到端测试脚本（107行） |
| `test/test_api.py` | API 单元测试（315行，23个测试） |
| `test/screenshots/stress_ng_flamegraph.svg` | stress-ng 时段火焰图 |
| `test/screenshots/system_status.json` | 系统状态API快照 |
| `test/screenshots/stress_profiles.json` | 压测期间采样文件列表 |

## 测试结果

- pytest：23/23 PASSED
- stress-ng 端到端：PASS（stress-ng-cpu 符号可见，24.11% 采样占比）
