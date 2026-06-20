#!/bin/bash
set -euo pipefail

# ============================================================
# cpu-profiler 容器入口脚本
# 必须以 --privileged 运行，perf 需要访问 PMU 硬件计数器
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

mkdir -p "${DATA_DIR}"

# --- 安装匹配宿主机内核的 perf ---
# perf 强绑定内核版本，必须安装 linux-tools-$(uname -r)
host_kernel=$(uname -r)
echo "  Host kernel: ${host_kernel}"

echo "  Installing linux-tools-${host_kernel} ..."
if ! apt-get update -qq 2>/dev/null; then
    echo "FATAL: apt-get update failed. Check network/DNS."
    exit 1
fi

if ! apt-get install -y --no-install-recommends "linux-tools-${host_kernel}" 2>/dev/null; then
    echo ""
    echo "FATAL: linux-tools-${host_kernel} not found in apt."
    echo ""
    echo "  perf is tightly coupled to the running kernel version."
    echo "  This container must be built on or have access to packages"
    echo "  for kernel ${host_kernel}."
    echo ""
    echo "  Current host: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || echo "unknown")"
    echo "  Kernel: ${host_kernel}"
    echo ""
    echo "  Make sure:"
    echo "  1) The host OS matches this image's Ubuntu release"
    echo "  2) Run 'sudo apt update' on the host first"
    echo "  3) Use --privileged flag: docker run --privileged -d -p 8080:8080 cpu-profiler"
    rm -rf /var/lib/apt/lists/*
    exit 1
fi
rm -rf /var/lib/apt/lists/*

# 验证 perf 可用
perf_bin="/usr/lib/linux-tools/${host_kernel}/perf"
if [ ! -x "${perf_bin}" ]; then
    echo "FATAL: ${perf_bin} not found after install."
    exit 1
fi

ln -sf "${perf_bin}" /usr/local/bin/perf
echo "  perf installed: ${perf_bin} ($(${perf_bin} --version 2>&1 | head -1)"

# --- 降低 perf 权限限制 ---
if [ -w /proc/sys/kernel/perf_event_paranoid ]; then
    echo 0 > /proc/sys/kernel/perf_event_paranoid
    echo "  Set perf_event_paranoid = 0"
else
    echo "  WARNING: Cannot set perf_event_paranoid (need --privileged)"
fi

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

# --- 等待确认进程存活 ---
sleep 2
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
