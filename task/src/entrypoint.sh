#!/bin/bash
set -euo pipefail

# ============================================================
# cpu-profiler 容器入口脚本
# 后台启动 perf 采集 + 定时清理，前台启动 API 服务器
# ============================================================

# --- 环境变量默认值 ---
export PERF_FREQ="${PERF_FREQ:-99}"
export SLICE_SEC="${SLICE_SEC:-60}"
export RETENTION_HOURS="${RETENTION_HOURS:-24}"
export PORT="${PORT:-8080}"

DATA_DIR="${DATA_DIR:-/data}"

echo "=== CPU Profiler Starting ==="
echo "  PERF_FREQ       = ${PERF_FREQ} Hz"
echo "  SLICE_SEC       = ${SLICE_SEC} s"
echo "  RETENTION_HOURS = ${RETENTION_HOURS} h"
echo "  PORT            = ${PORT}"
echo "  DATA_DIR        = ${DATA_DIR}"

# --- 创建数据目录 ---
mkdir -p "${DATA_DIR}"

# --- 降低 perf 权限限制（如果可写）---
if [ -w /proc/sys/kernel/perf_event_paranoid ]; then
    echo 0 > /proc/sys/kernel/perf_event_paranoid
    echo "  Set perf_event_paranoid = 0"
else
    echo "  WARNING: Cannot set perf_event_paranoid (need --privileged)"
fi

# --- 禁用 buildid 缓存写入（减少开销）---
if [ -w /proc/sys/kernel/perf_event_mlock_kb ]; then
    echo 512 > /proc/sys/kernel/perf_event_mlock_kb 2>/dev/null || true
fi

# --- 后台启动采集器 ---
python3 -m collector.perf_collector \
    --output-dir "${DATA_DIR}" \
    --freq "${PERF_FREQ}" \
    --slice "${SLICE_SEC}" &
COLLECTOR_PID=$!
echo "  Collector PID = ${COLLECTOR_PID}"

# --- 后台启动清理器 ---
python3 -m collector.cleaner \
    --data-dir "${DATA_DIR}" \
    --retention "${RETENTION_HOURS}" \
    --interval 300 &
CLEANER_PID=$!
echo "  Cleaner PID = ${CLEANER_PID}"

# --- 等待1秒确认进程存活 ---
sleep 1
if ! kill -0 ${COLLECTOR_PID} 2>/dev/null; then
    echo "FATAL: Collector process died!"
    exit 1
fi
if ! kill -0 ${CLEANER_PID} 2>/dev/null; then
    echo "FATAL: Cleaner process died!"
    exit 1
fi

echo "=== All services started ==="

# --- 前台启动 API 服务器（Step 4 将替换为 gunicorn）---
# 当前占位：使用 sleep infinity 保持容器运行
# Step 4 替换为: exec gunicorn --bind 0.0.0.0:${PORT} --workers 2 "api.app:create_app()"
sleep infinity
