"""
采样数据查询API蓝图

提供按时间范围查询采样文件列表的接口。
"""

from flask import Blueprint, request, jsonify, current_app

from api.utils import find_profiles

profiles_bp = Blueprint("profiles", __name__, url_prefix="/api/profiles")


@profiles_bp.route("", methods=["GET"])
def get_profiles():
    """查询指定时间范围内的采样文件列表。

    Query Parameters:
        start: ISO格式开始时间，如 2026-06-15T00:00:00
        end: ISO格式结束时间，如 2026-06-15T23:59:59

    Returns:
        200: JSON {"files": [...], "count": N, "start": "...", "end": "..."}
        400: 参数缺失或格式错误
    """
    start = request.args.get("start")
    end = request.args.get("end")

    if not start or not end:
        return jsonify({"error": "Both 'start' and 'end' parameters are required"}), 400

    # 尝试解析时间格式
    from collector.metadata import _parse_iso
    try:
        _parse_iso(start)
    except ValueError:
        return jsonify({"error": f"Invalid 'start' format: {start}. Expected ISO format like 2026-06-15T00:00:00"}), 400
    try:
        _parse_iso(end)
    except ValueError:
        return jsonify({"error": f"Invalid 'end' format: {end}. Expected ISO format like 2026-06-15T00:00:00"}), 400

    data_dir = current_app.config["DATA_DIR"]
    entries = find_profiles(start, end, data_dir=data_dir)

    return jsonify({
        "entries": entries,
        "count": len(entries),
        "start": start,
        "end": end,
    })
