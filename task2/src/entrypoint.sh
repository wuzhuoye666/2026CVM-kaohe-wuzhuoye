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

# --- 检查 perf 二进制可用性 ---
perf_bin=$(command -v perf 2>/dev/null || true)
if [ -z "${perf_bin}" ]; then
    # 尝试查找带版本号的 perf 并创建软链接
    latest_perf=$(ls /usr/bin/perf_* 2>/dev/null | sort -V | tail -1 || true)
    if [ -n "${latest_perf}" ]; then
        ln -sf "${latest_perf}" /usr/local/bin/perf
        perf_bin="/usr/local/bin/perf"
        echo "  Linked ${latest_perf} -> /usr/local/bin/perf"
    else
        echo "FATAL: perf binary not found! Ensure linux-tools-common is installed,"
        echo "       or rebuild image on a host matching the target kernel version."
        exit 1
    fi
fi
echo "  perf path = ${perf_bin} ($(${perf_bin} --version 2>&1 | head -1))"

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

# --- 前台启动 API 服务器 ---
exec gunicorn --bind 0.0.0.0:${PORT} --workers 2 --timeout 300 "api.app:create_app()"
