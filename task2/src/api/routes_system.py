"""
系统状态API蓝图

提供采集器运行状态、CPU/磁盘使用情况等监控接口。
"""

import os
import time

import psutil
from flask import Blueprint, jsonify

system_bp = Blueprint("system", __name__, url_prefix="/api/system")

# 记录应用启动时间
_start_time = time.time()


def _check_collector_alive() -> str:
    """检查perf采集进程是否存活。"""
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            name = proc.info["name"] or ""
            cmdline = " ".join(proc.info.get("cmdline") or [])
            if "perf" in name and "record" in cmdline:
                return "running"
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return "stopped"


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
