"""
7x24 CPU Profiler — API 单元测试

使用 pytest + Flask test client，覆盖所有 4 个 API 端点的正常/异常场景。
运行: pytest test_api.py -v
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# 将 src/ 加入 sys.path，确保能 import api 和 collector
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from api.app import create_app
from collector.metadata import MetadataStore

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def temp_data_dir():
    """创建临时数据目录并写入测试用 metadata.json"""
    with tempfile.TemporaryDirectory() as tmpdir:
        meta_path = str(Path(tmpdir) / "metadata.json")
        store = MetadataStore(meta_path)
        # 写入 3 条测试数据: 过去1小时、过去2小时、25小时前(过期)
        store.add_entry("perf-20260615_050000.data",
                        "2026-06-15T05:00:00", "2026-06-15T05:01:00", 1.0)
        store.add_entry("perf-20260615_040000.data",
                        "2026-06-15T04:00:00", "2026-06-15T04:01:00", 1.2)
        store.add_entry("perf-20260614_030000.data",
                        "2026-06-14T03:00:00", "2026-06-14T03:01:00", 0.8)
        # 创建同名空文件使 find_profiles 的 Path.exists() 检查通过
        for name in ["perf-20260615_050000.data",
                      "perf-20260615_040000.data",
                      "perf-20260614_030000.data"]:
            (Path(tmpdir) / name).touch()
        yield tmpdir


@pytest.fixture()
def app(temp_data_dir):
    """创建配置好的 Flask 应用实例（测试模式）"""
    os.environ["DATA_DIR"] = temp_data_dir
    os.environ["RETENTION_HOURS"] = "24"
    app = create_app()
    app.config["TESTING"] = True
    yield app
    # 清理环境变量
    os.environ.pop("DATA_DIR", None)
    os.environ.pop("RETENTION_HOURS", None)


@pytest.fixture()
def client(app):
    """Flask 测试客户端"""
    return app.test_client()


# ===========================================================================
# GET /api/profiles
# ===========================================================================

class TestProfilesAPI:

    def test_profiles_normal_query(self, client, temp_data_dir):
        """正常查询: 返回匹配的文件列表"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-15T04:30:00",
                                        "end": "2026-06-15T05:30:00"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] >= 1
        assert "files" in data
        assert data["start"] == "2026-06-15T04:30:00"
        assert data["end"] == "2026-06-15T05:30:00"

    def test_profiles_no_match(self, client):
        """查询无匹配时间段返回空列表"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2099-01-01T00:00:00",
                                        "end": "2099-01-01T01:00:00"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 0
        assert data["files"] == []

    def test_profiles_missing_start(self, client):
        """缺少 start 参数返回 400"""
        resp = client.get("/api/profiles",
                          query_string={"end": "2026-06-15T06:00:00"})
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_profiles_missing_end(self, client):
        """缺少 end 参数返回 400"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-15T05:00:00"})
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_profiles_missing_both(self, client):
        """同时缺少 start 和 end 返回 400"""
        resp = client.get("/api/profiles")
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_profiles_invalid_start_format(self, client):
        """非法 start 格式返回 400"""
        resp = client.get("/api/profiles",
                          query_string={"start": "not-a-date",
                                        "end": "2026-06-15T06:00:00"})
        assert resp.status_code == 400
        data = resp.get_json()
        assert "Invalid 'start' format" in data["error"]

    def test_profiles_invalid_end_format(self, client):
        """非法 end 格式返回 400"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-15T05:00:00",
                                        "end": "bad-format"})
        assert resp.status_code == 400
        data = resp.get_json()
        assert "Invalid 'end' format" in data["error"]

    def test_profiles_wide_range_returns_multiple(self, client):
        """宽广时间范围返回多个文件"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-14T00:00:00",
                                        "end": "2026-06-15T23:59:59"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] >= 2


# ===========================================================================
# GET /api/flamegraph
# ===========================================================================

class TestFlamegraphAPI:

    def test_flamegraph_missing_params(self, client):
        """缺少参数返回 400"""
        resp = client.get("/api/flamegraph")
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_flamegraph_invalid_start(self, client):
        """非法 start 格式返回 400"""
        resp = client.get("/api/flamegraph",
                          query_string={"start": "bad", "end": "2026-06-15T06:00:00"})
        assert resp.status_code == 400

    def test_flamegraph_no_data_returns_404(self, client):
        """查询无数据的时间段返回 404"""
        resp = client.get("/api/flamegraph",
                          query_string={"start": "2099-01-01T00:00:00",
                                        "end": "2099-01-01T01:00:00"})
        assert resp.status_code == 404
        data = resp.get_json()
        assert "No profile data found" in data["error"]

    def test_flamegraph_svg_with_mock(self, client, temp_data_dir):
        """使用 mock 测试有数据时返回 SVG"""
        fake_svg = '<svg xmlns="http://www.w3.org/2000/svg"><g></g></svg>'
        with patch("api.routes_flamegraph.generate_flamegraph", return_value=fake_svg):
            resp = client.get("/api/flamegraph",
                              query_string={"start": "2026-06-15T04:30:00",
                                            "end": "2026-06-15T05:30:00"})
            assert resp.status_code == 200
            assert "image/svg+xml" in resp.content_type
            assert b"<svg" in resp.data

    def test_flamegraph_generation_failure_returns_500(self, client, temp_data_dir):
        """火焰图生成失败返回 500"""
        with patch("api.routes_flamegraph.generate_flamegraph",
                   side_effect=RuntimeError("perf script failed")):
            resp = client.get("/api/flamegraph",
                              query_string={"start": "2026-06-15T04:30:00",
                                            "end": "2026-06-15T05:30:00"})
            assert resp.status_code == 500
            assert "Flamegraph generation failed" in resp.get_json()["error"]


# ===========================================================================
# GET /api/flamegraph/data
# ===========================================================================

class TestFlamegraphDataAPI:

    def test_flamegraph_data_missing_params(self, client):
        """缺少参数返回 400"""
        resp = client.get("/api/flamegraph/data")
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_flamegraph_data_no_data_returns_404(self, client):
        """无数据返回 404"""
        resp = client.get("/api/flamegraph/data",
                          query_string={"start": "2099-01-01T00:00:00",
                                        "end": "2099-01-01T01:00:00"})
        assert resp.status_code == 404
        assert "No profile data found" in resp.get_json()["error"]

    def test_flamegraph_data_with_mock(self, client, temp_data_dir):
        """使用 mock 测试 d3 数据返回"""
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "main;func_a 10\nmain;func_b 5\n"

        with patch("api.routes_flamegraph.subprocess.run", return_value=mock_result):
            resp = client.get("/api/flamegraph/data",
                              query_string={"start": "2026-06-15T04:30:00",
                                            "end": "2026-06-15T05:30:00"})
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["name"] == "root"
            assert data["value"] == 15
            assert len(data["children"]) >= 1

    def test_flamegraph_data_subprocess_failure_returns_500(self, client, temp_data_dir):
        """perf script 失败导致空数据时返回 500"""
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""  # empty folded output

        with patch("api.routes_flamegraph.subprocess.run", return_value=mock_result):
            resp = client.get("/api/flamegraph/data",
                              query_string={"start": "2026-06-15T04:30:00",
                                            "end": "2026-06-15T05:30:00"})
            assert resp.status_code == 500


# ===========================================================================
# GET /api/system/status
# ===========================================================================

class TestSystemStatusAPI:

    def test_system_status_returns_all_fields(self, client):
        """系统状态返回所有必需字段"""
        resp = client.get("/api/system/status")
        assert resp.status_code == 200
        data = resp.get_json()
        required_fields = [
            "cpu_percent", "disk_usage_percent", "data_dir_size_mb",
            "data_dir_files", "collector_status", "retention_hours",
            "uptime_seconds",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    def test_system_status_field_types(self, client):
        """字段类型正确"""
        resp = client.get("/api/system/status")
        data = resp.get_json()
        assert isinstance(data["cpu_percent"], (int, float))
        assert isinstance(data["disk_usage_percent"], (int, float))
        assert isinstance(data["data_dir_size_mb"], (int, float))
        assert isinstance(data["data_dir_files"], int)
        assert data["collector_status"] in ("running", "stopped")
        assert isinstance(data["retention_hours"], int)
        assert isinstance(data["uptime_seconds"], int)

    def test_system_status_uptime_increases(self, client):
        """连续请求 uptime_seconds 递增"""
        resp1 = client.get("/api/system/status")
        import time
        time.sleep(1.1)
        resp2 = client.get("/api/system/status")
        uptime1 = resp1.get_json()["uptime_seconds"]
        uptime2 = resp2.get_json()["uptime_seconds"]
        assert uptime2 >= uptime1


# ===========================================================================
# 边界场景
# ===========================================================================

class TestBoundaryScenarios:

    def test_profiles_cross_day_query(self, client):
        """跨天查询: 涵盖 6-14 到 6-15 的数据"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-14T00:00:00",
                                        "end": "2026-06-15T23:59:59"})
        assert resp.status_code == 200
        data = resp.get_json()
        # 应至少返回跨天的两条数据
        assert data["count"] >= 2

    def test_profiles_beyond_retention_period(self, client):
        """超出保留期查询: 25小时前的数据仍可查到（清理是另一逻辑）"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-14T02:00:00",
                                        "end": "2026-06-14T04:00:00"})
        assert resp.status_code == 200
        # 测试数据中有 2026-06-14T03 的记录
        data = resp.get_json()
        assert data["count"] >= 1

    def test_profiles_exact_boundary_match(self, client):
        """精确边界: start 等于 profile.end 应匹配（重叠判断含等号）"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-15T05:01:00",
                                        "end": "2026-06-15T05:02:00"})
        assert resp.status_code == 200
        # profile end=05:01:00, query start=05:01:00 -> e_end >= q_start 满足
        data = resp.get_json()
        assert data["count"] >= 1

    def test_profiles_inverted_range_returns_empty(self, client):
        """start > end 反序范围返回空结果（不报错）"""
        resp = client.get("/api/profiles",
                          query_string={"start": "2026-06-15T06:00:00",
                                        "end": "2026-06-15T04:00:00"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 0


# ===========================================================================
# 根路由
# ===========================================================================

class TestRootRoute:

    def test_index_returns_html(self, client):
        """根路由返回 HTML 页面"""
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"html" in resp.data.lower() or b"<!doctype" in resp.data.lower()
