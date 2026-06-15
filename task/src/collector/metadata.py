"""
MetadataStore - 采样文件元数据索引

使用JSON文件记录每个采样文件的起止时间和大小，
支持按时间范围查询和过期清理。
"""

import fcntl
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("metadata")

# ISO格式时间字符串的标准格式
TIME_FORMAT = "%Y-%m-%dT%H:%M:%S"


def _now_iso() -> str:
    """返回当前UTC时间的ISO格式字符串。"""
    return datetime.now(timezone.utc).strftime(TIME_FORMAT)


def _parse_iso(s: str) -> datetime:
    """将ISO格式字符串解析为datetime对象。"""
    return datetime.strptime(s, TIME_FORMAT).replace(tzinfo=timezone.utc)


class MetadataStore:
    """采样文件元数据存储，JSON数组格式，文件级加锁。"""

    def __init__(self, filepath: str = "/data/metadata.json"):
        self.filepath = Path(filepath)
        # 确保文件存在
        if not self.filepath.exists():
            self.filepath.parent.mkdir(parents=True, exist_ok=True)
            self._write([])
            logger.info("Created metadata file: %s", self.filepath)

    def _read(self) -> list[dict]:
        """读取JSON文件内容。"""
        try:
            with open(self.filepath, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _write(self, data: list[dict]):
        """写入JSON文件内容。"""
        with open(self.filepath, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            json.dump(data, f, indent=2, ensure_ascii=False)
            fcntl.flock(f, fcntl.LOCK_UN)

    def _modify(self, operation):
        """加锁读取→修改→写回的模板方法。"""
        with open(self.filepath, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                data = json.load(f)
                result = operation(data)
                f.seek(0)
                f.truncate()
                json.dump(data, f, indent=2, ensure_ascii=False)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        return result

    def add_entry(self, file_path: str, start_time: str, end_time: str, size_mb: float):
        """追加一条采样记录。

        Args:
            file_path: 采样文件名（相对/data/的文件名）
            start_time: ISO格式开始时间
            end_time: ISO格式结束时间
            size_mb: 文件大小(MB)
        """
        entry = {
            "file": file_path,
            "start": start_time,
            "end": end_time,
            "size_mb": round(size_mb, 2),
        }

        def _add(data: list[dict]):
            data.append(entry)
            return entry

        self._modify(_add)
        logger.info("Metadata entry added: %s (%s ~ %s)", file_path, start_time, end_time)

    def query(self, start_time: str, end_time: str) -> list[dict]:
        """查询与指定时间范围有重叠的采样条目。

        重叠判断: profile.start <= query.end AND profile.end >= query.start

        Args:
            start_time: ISO格式查询开始时间
            end_time: ISO格式查询结束时间

        Returns:
            匹配的元数据条目列表
        """
        q_start = _parse_iso(start_time)
        q_end = _parse_iso(end_time)

        data = self._read()
        results = []
        for entry in data:
            try:
                e_start = _parse_iso(entry["start"])
                e_end = _parse_iso(entry["end"])
                if e_start <= q_end and e_end >= q_start:
                    results.append(entry)
            except (KeyError, ValueError) as e:
                logger.warning("Skipping malformed entry: %s (%s)", entry, e)
        return results

    def remove_before(self, cutoff_time: str) -> int:
        """删除早于截止时间的条目。

        Args:
            cutoff_time: ISO格式截止时间

        Returns:
            删除的条目数
        """
        cutoff = _parse_iso(cutoff_time)

        def _remove(data: list[dict]) -> int:
            original_len = len(data)
            data[:] = [e for e in data if _parse_iso(e.get("end", "2099-01-01T00:00:00")) >= cutoff]
            removed = original_len - len(data)
            if removed:
                logger.info("Removed %d metadata entries before %s", removed, cutoff_time)
            return removed

        return self._modify(_remove)

    def all_entries(self) -> list[dict]:
        """返回全部元数据条目。"""
        return self._read()
