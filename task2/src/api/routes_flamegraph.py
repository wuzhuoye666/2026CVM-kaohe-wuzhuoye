"""
火焰图生成API蓝图

提供SVG火焰图生成和d3-flame-graph层级JSON数据两种接口。
"""

import logging
import subprocess
from collections import defaultdict
from pathlib import Path

from flask import Blueprint, request, jsonify, Response, current_app

from api.utils import find_profiles, profile_paths, generate_flamegraph, STACKCOLLAPSE_PL

logger = logging.getLogger("api.flamegraph")

flamegraph_bp = Blueprint("flamegraph", __name__, url_prefix="/api/flamegraph")


def _validate_time_params():
    """校验start/end参数，返回 (start, end, error_response)。

    Returns:
        成功: (start_str, end_str, None)
        失败: (None, None, error_response)
    """
    start = request.args.get("start")
    end = request.args.get("end")

    if not start or not end:
        return None, None, (jsonify({"error": "Both 'start' and 'end' parameters are required"}), 400)

    from collector.metadata import _parse_iso
    try:
        _parse_iso(start)
    except ValueError:
        return None, None, (jsonify({"error": f"Invalid 'start' format: {start}. Expected ISO format like 2026-06-15T00:00:00"}), 400)
    try:
        _parse_iso(end)
    except ValueError:
        return None, None, (jsonify({"error": f"Invalid 'end' format: {end}. Expected ISO format like 2026-06-15T00:00:00"}), 400)

    return start, end, None


@flamegraph_bp.route("", methods=["GET"])
def get_flamegraph_svg():
    """生成并返回SVG火焰图。

    Query Parameters:
        start: ISO格式开始时间
        end: ISO格式结束时间

    Returns:
        200: SVG内容 (Content-Type: image/svg+xml)
        400: 参数缺失或格式错误
        404: 无匹配的采样数据
    """
    start, end, err = _validate_time_params()
    if err:
        return err

    data_dir = current_app.config["DATA_DIR"]
    entries = find_profiles(start, end, data_dir=data_dir)
    # 过滤掉实际不存在的文件（metadata 可能残留过期条目）
    valid_entries = [e for e in entries if Path(data_dir, e.get("file", "")).exists()]
    files = profile_paths(valid_entries, data_dir)

    if not files:
        return jsonify({"error": f"No profile data found for {start} ~ {end}"}), 404

    title = f"CPU Flame Graph ({start} ~ {end})"
    try:
        svg = generate_flamegraph(files, title=title)
    except Exception as e:
        logger.error("Flamegraph generation failed: %s", e)
        return jsonify({"error": f"Flamegraph generation failed: {e}"}), 500

    return Response(svg, mimetype="image/svg+xml")


def _parse_folded_to_tree(folded_text: str) -> dict:
    """将folded stack格式文本解析为d3-flame-graph层级JSON。

    Folded格式: `top_func;mid_func;leaf_func 42`

    Returns:
        层级JSON: {"name": "root", "value": 0, "children": [...]}
    """
    root = {"name": "root", "value": 0, "children": []}

    for line in folded_text.strip().splitlines():
        line = line.strip()
        if not line or " " not in line:
            continue

        # 最后一部分是采样数
        parts = line.rsplit(" ", 1)
        if len(parts) != 2:
            continue

        stack_str, count_str = parts
        try:
            count = int(count_str)
        except ValueError:
            continue

        frames = stack_str.split(";")
        current = root

        for frame in frames:
            # 在当前层级的children中查找是否已有该frame
            found = None
            for child in current.get("children", []):
                if child["name"] == frame:
                    found = child
                    break

            if found is None:
                found = {"name": frame, "value": 0, "children": []}
                current.setdefault("children", []).append(found)

            found["value"] += count
            current = found

        root["value"] += count

    return root


@flamegraph_bp.route("/data", methods=["GET"])
def get_flamegraph_data():
    """生成folded stack数据并返回d3-flame-graph层级JSON。

    Query Parameters:
        start: ISO格式开始时间
        end: ISO格式结束时间

    Returns:
        200: 层级JSON (Content-Type: application/json)
        400: 参数缺失或格式错误
        404: 无匹配的采样数据
    """
    start, end, err = _validate_time_params()
    if err:
        return err

    data_dir = current_app.config["DATA_DIR"]
    entries = find_profiles(start, end, data_dir=data_dir)
    # 过滤掉实际不存在的文件
    valid_entries = [e for e in entries if Path(data_dir, e.get("file", "")).exists()]
    files = profile_paths(valid_entries, data_dir)

    if not files:
        return jsonify({"error": f"No profile data found for {start} ~ {end}"}), 404

    # 对每个文件执行 perf script | stackcollapse-perf.pl 合并folded输出
    combined_folded = []
    for fp in files:
        if not Path(fp).exists():
            continue
        try:
            script_result = subprocess.run(
                ["perf", "script", "-i", fp],
                capture_output=True, text=True, timeout=120
            )
            if script_result.returncode != 0:
                logger.warning("perf script failed for %s: %s", fp, script_result.stderr[:200])
                continue

            collapse_result = subprocess.run(
                [STACKCOLLAPSE_PL],
                input=script_result.stdout,
                capture_output=True, text=True, timeout=60
            )
            if collapse_result.returncode != 0:
                logger.warning("stackcollapse failed for %s: %s", fp, collapse_result.stderr[:200])
                continue

            combined_folded.append(collapse_result.stdout)
        except subprocess.TimeoutExpired:
            logger.warning("Timeout processing %s", fp)
        except Exception as e:
            logger.warning("Error processing %s: %s", fp, e)

    if not combined_folded:
        return jsonify({"error": "Failed to process profile data"}), 500

    all_folded = "\n".join(combined_folded).strip()
    if not all_folded:
        return jsonify({"error": "Profile data contains no samples"}), 404

    tree = _parse_folded_to_tree(all_folded)

    return jsonify(tree)
