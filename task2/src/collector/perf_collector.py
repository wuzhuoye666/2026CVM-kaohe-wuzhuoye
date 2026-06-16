"""
PerfCollector - 持续CPU Profiling采集模块

循环执行 perf record，按固定时间窗口(默认60s)分片保存采样文件。
"""

import argparse
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from collector.metadata import MetadataStore, TIME_FORMAT

logger = logging.getLogger("perf_collector")


class PerfCollector:
    """持续执行 perf record 并按时间窗口分片保存。"""

    def __init__(self, output_dir: str, freq: int = 99, slice_sec: int = 60,
                 metadata_path: str | None = None):
        """
        Args:
            output_dir: 采样文件输出目录
            freq: 采样频率(Hz)，默认99避免锁步采样
            slice_sec: 每个采样切片的时长(秒)
            metadata_path: 元数据文件路径，默认为 output_dir/metadata.json
        """
        self.output_dir = Path(output_dir)
        self.freq = freq
        self.slice_sec = slice_sec
        self.output_dir.mkdir(parents=True, exist_ok=True)
        meta_path = metadata_path or str(self.output_dir / "metadata.json")
        self.metadata = MetadataStore(meta_path)

    def _perf_path(self) -> str:
        """找到系统中可用的perf二进制路径。"""
        # 优先用系统perf
        for candidate in ["perf", "/usr/bin/perf"]:
            if os.path.exists(candidate) or self._which(candidate):
                return candidate
        # 在容器中可能是 perf_5.15 这样带版本号的
        for p in sorted(Path("/usr/bin").glob("perf_*"), reverse=True):
            return str(p)
        return "perf"

    @staticmethod
    def _which(cmd: str) -> str | None:
        """模仿which命令查找可执行文件。"""
        for d in os.environ.get("PATH", "").split(":"):
            candidate = Path(d) / cmd
            if candidate.is_file():
                return str(candidate)
        return None

    def run_one_slice(self) -> Path:
        """执行一次 perf record 采样切片，返回生成的文件路径。"""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        output_file = self.output_dir / f"perf-{timestamp}.data"

        perf_bin = self._perf_path()
        cmd = [
            perf_bin, "record",
            "-a",           # 全局采集(所有CPU)
            "-g",           # 调用栈
            "-F", str(self.freq),
            "-o", str(output_file),
            "--", "sleep", str(self.slice_sec),
        ]

        logger.info("Starting perf slice: %s", " ".join(cmd))
        start_time = datetime.now(timezone.utc)

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            end_time = datetime.now(timezone.utc)

            if result.returncode not in (0, 128):
                # perf record 在被SIGINT中断时返回128，这是正常的
                stderr = result.stderr.decode(errors="replace")
                logger.error("perf record failed (rc=%d): %s", result.returncode, stderr)
            else:
                logger.info("Perf slice completed: %s (%.1f MB)",
                            output_file.name,
                            output_file.stat().st_size / 1024 / 1024
                            if output_file.exists() else 0)
        except FileNotFoundError:
            logger.error("perf binary not found: %s", perf_bin)
            raise
        except Exception as e:
            logger.error("Unexpected error running perf: %s", e)
            raise

        # 写入元数据
        if output_file.exists():
            size_mb = output_file.stat().st_size / 1024 / 1024
            self.metadata.add_entry(
                file_path=output_file.name,
                start_time=start_time.strftime(TIME_FORMAT),
                end_time=end_time.strftime(TIME_FORMAT),
                size_mb=size_mb,
            )

        return output_file

    def run(self):
        """持续循环执行采样切片，直到进程被终止。"""
        logger.info("PerfCollector started: output_dir=%s freq=%dHz slice=%ds",
                     self.output_dir, self.freq, self.slice_sec)
        while True:
            try:
                self.run_one_slice()
            except KeyboardInterrupt:
                logger.info("PerfCollector stopped by user")
                break
            except Exception as e:
                logger.error("Slice failed, continuing: %s", e)
                time.sleep(1)  # 失败后短暂等待避免快速循环


def main():
    parser = argparse.ArgumentParser(description="Continuous CPU profiling with perf record")
    parser.add_argument("--output-dir", default="/data",
                        help="Directory to store profiling data (default: /data)")
    parser.add_argument("--freq", type=int, default=99,
                        help="Sampling frequency in Hz (default: 99)")
    parser.add_argument("--slice", type=int, default=60,
                        help="Duration of each profiling slice in seconds (default: 60)")
    parser.add_argument("--metadata-path", default=None,
                        help="Path to metadata JSON file (default: <output-dir>/metadata.json)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    collector = PerfCollector(
        output_dir=args.output_dir,
        freq=args.freq,
        slice_sec=args.slice,
        metadata_path=args.metadata_path,
    )
    collector.run()


if __name__ == "__main__":
    main()
