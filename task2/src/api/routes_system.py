"""
系统状态API蓝图

提供采集器运行状态、CPU/磁盘使用情况等监控接口。
"""

import os
import time
from pathlib import Path

import psutil
from flask import Blueprint, jsonify

system_bp = Blueprint("system", __name__, url_prefix="/api/system")

# 记录应用启动时间
_start_time = time.time()


def _check_collector_alive() -> str:
    """检查perf采集器进程是否存活且实质可用。

    检测 python3 -m collector.perf_collector 进程，而非 perf record 子进程，
    因为 perf record 在分片间隙会短暂退出，导致误判为离线。
    同时检查 .collector_health 文件判断采集器是否因连续失败而降级。
    """
    found = False
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            cmdline = " ".join(proc.info.get("cmdline") or [])
            if "collector.perf_collector" in cmdline:
                found = True
                break
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    if not found:
        return "stopped"

    # 检查健康状态文件
    data_dir = os.environ.get("DATA_DIR", "/data")
    health_path = Path(data_dir) / ".collector_health"
    try:
        if health_path.exists():
            import json
            health = json.loads(health_path.read_text(encoding="utf-8"))
            if health.get("status") == "degraded":
                return "degraded"
    except (OSError, json.JSONDecodeError):
        pass

    return "running"


@system_bp.route("/status", methods=["GET"])
def get_system_status():
    """返回系统状态信息。

    Returns:
        200: JSON包含CPU、磁盘、采集状态等信息
    """
    data_dir = os.environ.get("DATA_DIR", "/data")

    # CPU使用率（非阻塞采样，interval=0使用上次调用缓存值）
    cpu_percent = psutil.cpu_percent(interval=0)
    if cpu_percent == 0.0:
        # 首次调用返回0，短暂等待后重试
        cpu_percent = psutil.cpu_percent(interval=0.5)

    # 磁盘使用率
    try:
        disk = psutil.disk_usage(data_dir)
        disk_usage_percent = round(disk.percent, 1)
    except Exception:
        disk_usage_percent = 0.0

    # 数据目录大小和文件数
    data_dir_size_mb = 0.0
    data_dir_files = 0
    try:
        for entry in os.scandir(data_dir):
            if entry.is_file() and entry.name.endswith(".data"):
                data_dir_files += 1
                data_dir_size_mb += entry.stat().st_size / (1024 * 1024)
    except OSError:
        pass
    data_dir_size_mb = round(data_dir_size_mb, 1)

    # 采集器状态
    collector_status = _check_collector_alive()

    # 保留时长
    retention_hours = int(os.environ.get("RETENTION_HOURS", "24"))

    # 运行时间
    uptime_seconds = int(time.time() - _start_time)

    return jsonify({
        "cpu_percent": cpu_percent,
        "disk_usage_percent": disk_usage_percent,
        "data_dir_size_mb": data_dir_size_mb,
        "data_dir_files": data_dir_files,
        "collector_status": collector_status,
        "retention_hours": retention_hours,
        "uptime_seconds": uptime_seconds,
    })
