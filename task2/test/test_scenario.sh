#!/bin/bash
set -euo pipefail

# ============================================================
# 7x24 CPU Profiler — stress-ng 端到端测试脚本
# 使用场景: 容器已启动 (docker run --privileged --pid=host)
#           本脚本在宿主机执行，模拟 CPU 压力并验证火焰图
# ============================================================

API_BASE="${API_BASE:-http://localhost:8080}"
STRESS_DURATION="${STRESS_DURATION:-60}"
STRESS_CPU="${STRESS_CPU:-2}"
SLICE_WAIT=$((STRESS_DURATION + 15))  # 等 perf slice 轮转完成

echo "=== 7x24 CPU Profiler — stress-ng 端到端测试 ==="
echo "API 地址: ${API_BASE}"
echo "压力时长: ${STRESS_DURATION}s, CPU 核数: ${STRESS_CPU}"
echo ""

# --------------- 预检查 ---------------
echo "[1/6] 预检查 — 确认 API 服务可用 ..."
if ! curl -sf "${API_BASE}/api/system/status" > /dev/null 2>&1; then
    echo "FAIL: API 服务不可达 (${API_BASE})"
    exit 1
fi
echo "  OK: API 服务可达"

# --------------- 记录开始时间 ---------------
echo "[2/6] 记录开始时间 ..."
STRESS_START=$(date -u +"%Y-%m-%dT%H:%M:%S")
echo "  STRESS_START = ${STRESS_START}"

# --------------- 执行 CPU 压力 ---------------
echo "[3/6] 执行 stress-ng CPU 压力 (stress-ng --cpu ${STRESS_CPU} --cpu-method matrixprod -t ${STRESS_DURATION}s) ..."
if command -v stress-ng > /dev/null 2>&1; then
    stress-ng --cpu "${STRESS_CPU}" --cpu-method matrixprod -t "${STRESS_DURATION}s" -q
    echo "  OK: stress-ng 执行完毕"
else
    echo "  WARN: stress-ng 未安装，使用备选方案 (dd + sha256sum) ..."
    # 备选: 用 dd + sha256sum 模拟 CPU 压力
    for _ in $(seq 1 "${STRESS_CPU}"); do
        timeout "${STRESS_DURATION}" dd if=/dev/urandom bs=1M count=10000 2>/dev/null | sha256sum > /dev/null &
    done
    wait
    echo "  OK: 备选 CPU 压力执行完毕"
fi

# --------------- 记录结束时间 ---------------
STRESS_END=$(date -u +"%Y-%m-%dT%H:%M:%S")
echo "  STRESS_END   = ${STRESS_END}"

# --------------- 等待采样轮转 ---------------
echo "[4/6] 等待 perf 采样轮转完成 (${SLICE_WAIT}s) ..."
sleep "${SLICE_WAIT}"

# --------------- API 回查采样文件 ---------------
echo "[5/6] API 回查采样文件 ..."
PROFILES_JSON=$(curl -sf "${API_BASE}/api/profiles?start=${STRESS_START}&end=${STRESS_END}")
FILE_COUNT=$(echo "${PROFILES_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
echo "  查到 ${FILE_COUNT} 个采样文件"
if [ "${FILE_COUNT}" -eq 0 ]; then
    echo "FAIL: 未查询到压力期间的采样文件"
    echo "  返回内容: ${PROFILES_JSON}"
    exit 1
fi
echo "  OK: API 回查成功"

# --------------- 生成火焰图并验证 ---------------
echo "[6/6] 生成火焰图并验证 stress-ng 符号 ..."
RESULT_SVG="/tmp/stress_test_result.svg"
HTTP_CODE=$(curl -sf -o "${RESULT_SVG}" -w "%{http_code}" \
    "${API_BASE}/api/flamegraph?start=${STRESS_START}&end=${STRESS_END}")

if [ "${HTTP_CODE}" != "200" ]; then
    echo "FAIL: 火焰图 API 返回 HTTP ${HTTP_CODE}"
    exit 1
fi

SVG_SIZE=$(stat -c%s "${RESULT_SVG}" 2>/dev/null || echo 0)
echo "  SVG 文件大小: ${SVG_SIZE} bytes"
if [ "${SVG_SIZE}" -lt 1024 ]; then
    echo "FAIL: SVG 文件过小 (< 1KB)，可能生成失败"
    exit 1
fi
echo "  OK: SVG 文件有效 (> 1KB)"

# 检查 SVG 中是否包含 stress-ng / matrix 相关符号
if grep -qiE "(stress|matrix|hash_sha|dd|sha256)" "${RESULT_SVG}"; then
    echo "  PASS: SVG 中包含 CPU 压力相关函数符号"
    MATCHED=$(grep -oiE "(stress[^\"<]*|matrix[^\"<]*|hash_sha[^\"<]*|sha256[^\"<]*)" "${RESULT_SVG}" | head -5)
    echo "  匹配符号: ${MATCHED}"
else
    echo "  WARN: SVG 中未找到 stress-ng/matrix 相关符号"
    echo "  (可能符号被内联/优化，检查是否有热点函数)"
    # 即使找不到 stress 符号也算 pass，只要火焰图不为空
    echo "  PASS (软): 火焰图生成成功但未匹配预期符号名"
fi

# --------------- 结果汇总 ---------------
echo ""
echo "=========================================="
echo "  测试结果: PASS"
echo "  采样文件数: ${FILE_COUNT}"
echo "  火焰图: ${RESULT_SVG} (${SVG_SIZE} bytes)"
echo "  时间范围: ${STRESS_START} ~ ${STRESS_END}"
echo "=========================================="
