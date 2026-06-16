"""
DataCleaner - 过期采样数据清理模块

按保留时长自动删除过期的采样文件和对应元数据条目。
"""

import argparse
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from collector.metadata import MetadataStore, _parse_iso

logger = logging.getLogger("cleaner")


class DataCleaner:
    """定期清理过期的采样数据文件和元数据。"""

    def __init__(self, data_dir: str, metadata_store: MetadataStore,
                 retention_hours: int = 24):
        """
        Args:
            data_dir: 采样文件目录
            metadata_store: 元数据存储实例
            retention_hours: 数据保留时长(小时)
        """
        self.data_dir = Path(data_dir)
        self.metadata = metadata_store
        self.retention_hours = retention_hours

    def run_once(self) -> int:
        """执行一次清理。

        Returns:
            删除的文件数量
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.retention_hours)
        cutoff_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%S")

        # 获取过期条目
        expired = self.metadata.query("2020-01-01T00:00:00", cutoff_iso)
        if not expired:
            return 0

        deleted = 0
        for entry in expired:
            file_path = self.data_dir / entry["file"]
            if file_path.exists():
                try:
                    file_path.unlink()
                    deleted += 1
                    logger.info("Deleted expired file: %s", file_path)
                except OSError as e:
                    logger.warning("Failed to delete %s: %s", file_path, e)
            else:
                logger.debug("File already gone: %s", file_path)

        # 清理元数据
        self.metadata.remove_before(cutoff_iso)
        return deleted

    def run(self, interval_sec: int = 300):
        """持续循环执行清理。

        Args:
            interval_sec: 清理间隔(秒)，默认5分钟
        """
        logger.info("DataCleaner started: data_dir=%s retention=%dh interval=%ds",
                     self.data_dir, self.retention_hours, interval_sec)
        while True:
            try:
                deleted = self.run_once()
                if deleted:
                    logger.info("Cleaned up %d expired files", deleted)
            except KeyboardInterrupt:
                logger.info("DataCleaner stopped by user")
                break
            except Exception as e:
                logger.error("Cleaner run failed: %s", e)

            time.sleep(interval_sec)


def main():
    parser = argparse.ArgumentParser(description="Clean expired profiling data")
    parser.add_argument("--data-dir", default="/data",
                        help="Directory containing profiling data (default: /data)")
    parser.add_argument("--metadata-path", default=None,
                        help="Path to metadata JSON (default: <data-dir>/metadata.json)")
    parser.add_argument("--retention", type=int, default=24,
                        help="Retention period in hours (default: 24)")
    parser.add_argument("--interval", type=int, default=300,
                        help="Clean interval in seconds (default: 300)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    meta_path = args.metadata_path or str(Path(args.data_dir) / "metadata.json")
    store = MetadataStore(meta_path)
    cleaner = DataCleaner(
        data_dir=args.data_dir,
        metadata_store=store,
        retention_hours=args.retention,
    )
    cleaner.run(interval_sec=args.interval)


if __name__ == "__main__":
    main()
