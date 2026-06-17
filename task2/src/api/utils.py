"""
API工具模块 - 火焰图生成与采样文件查询

提供find_profiles查询采样文件、generate_flamegraph生成SVG火焰图。
"""

import logging
import subprocess
from pathlib import Path

from collector.metadata import MetadataStore

logger = logging.getLogger("api.utils")

# FlameGraph工具链路径（容器内）
FLAMEGRAPH_PL = "/opt/FlameGraph/flamegraph.pl"
STACKCOLLAPSE_PL = "/opt/FlameGraph/stackcollapse-perf.pl"


def find_profiles(start_iso: str, end_iso: str, data_dir: str = "/data") -> list[dict]:
    """根据时间范围查找匹配的采样元数据条目。

    读取metadata.json，返回与[start_iso, end_iso]时间范围有重叠的
    采样元数据条目列表。

    时间重叠判断: profile.start <= query.end AND profile.end >= query.start

    Args:
        start_iso: ISO格式开始时间，如 "2026-06-15T03:00:00"
        end_iso: ISO格式结束时间，如 "2026-06-15T03:05:00"
        data_dir: 采样数据目录，默认 "/data"

    Returns:
        匹配的采样元数据条目列表(每个条目包含 file, start, end, size_mb, cpu_percent)
    """
    metadata_path = Path(data_dir) / "metadata.json"
    store = MetadataStore(str(metadata_path))
    entries = store.query(start_iso, end_iso)

    logger.info(
        "find_profiles(%s ~ %s): found %d entries", start_iso, end_iso, len(entries)
    )
    return entries


def profile_paths(entries: list[dict], data_dir: str = "/data") -> list[str]:
    """将元数据条目列表转换为完整文件路径列表。"""
    return [str(Path(data_dir) / e["file"]) for e in entries]


def generate_flamegraph(
    file_paths: list[str],
    output_path: str | None = None,
    title: str = "CPU Flame Graph",
) -> str:
    """根据采样文件路径列表生成CPU火焰图SVG。

    使用subprocess.Popen管道串联 perf script → stackcollapse-perf.pl → flamegraph.pl，
    避免临时中间文件。

    Args:
        file_paths: 采样文件完整路径列表
        output_path: 输出SVG文件路径，为None时返回SVG字符串
        title: 火焰图标题

    Returns:
        SVG内容字符串

    Raises:
        ValueError: file_paths为空
        FileNotFoundError: 采样文件不存在
        RuntimeError: 工具链执行失败
    """
    if not file_paths:
        raise ValueError("file_paths cannot be empty")

    # 检查所有文件存在
    for fp in file_paths:
        if not Path(fp).exists():
            raise FileNotFoundError(f"Profile data file not found: {fp}")

    # 为每个文件执行 perf script，合并输出
    combined_script = []
    for fp in file_paths:
        cmd = ["perf", "script", "-i", fp]
        logger.info("Running: %s", " ".join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(
                f"perf script failed for {fp} (rc={result.returncode}): {result.stderr[:500]}"
            )
        combined_script.append(result.stdout)

    all_script = "\n".join(combined_script)

    # 使用Popen管道串联: stackcollapse-perf.pl | flamegraph.pl
    logger.info("Piping through stackcollapse-perf.pl | flamegraph.pl")
    collapse_proc = subprocess.Popen(
        [STACKCOLLAPSE_PL],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    flame_proc = subprocess.Popen(
        [FLAMEGRAPH_PL, "--title", title, "--width", "1200"],
        stdin=collapse_proc.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # 写入perf script输出到stackcollapse的stdin
    collapse_proc.stdout.close()  # 允许collapse_proc接收SIGPIPE
    try:
        collapse_proc.stdin.write(all_script)
        collapse_proc.stdin.close()
    except BrokenPipeError:
        pass

    svg_output, flame_err = flame_proc.communicate(timeout=60)
    collapse_proc.wait(timeout=10)

    if flame_proc.returncode != 0:
        collapse_err = collapse_proc.stderr.read()
        raise RuntimeError(
            f"flamegraph.pl failed (rc={flame_proc.returncode}): "
            f"flame_err={flame_err[:300]} collapse_err={collapse_err[:300]}"
        )

    if collapse_proc.returncode != 0:
        collapse_err = collapse_proc.stderr.read()
        raise RuntimeError(
            f"stackcollapse-perf.pl failed (rc={collapse_proc.returncode}): {collapse_err[:500]}"
        )

    # 写文件或返回字符串
    if output_path:
        Path(output_path).write_text(svg_output, encoding="utf-8")
        logger.info("SVG written to %s", output_path)

    return svg_output
