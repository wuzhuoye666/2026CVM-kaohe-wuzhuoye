"""
Flask应用工厂 - 创建并配置Flask REST API服务器

提供采样数据查询、火焰图生成、系统状态监控等API端点，
同时服务前端静态文件。
"""

import os
from pathlib import Path

from flask import Flask, send_from_directory


def create_app() -> Flask:
    """创建并配置Flask应用实例。

    Returns:
        配置好的Flask应用
    """
    # 静态文件指向前端目录
    frontend_dir = str(Path(__file__).resolve().parent.parent / "frontend")

    app = Flask(
        __name__,
        static_folder=frontend_dir,
        static_url_path="/",
    )

    # 从环境变量读取配置
    app.config["DATA_DIR"] = os.environ.get("DATA_DIR", "/data")
    app.config["RETENTION_HOURS"] = int(os.environ.get("RETENTION_HOURS", "24"))

    # 注册蓝图
    from api.routes_profiles import profiles_bp
    from api.routes_flamegraph import flamegraph_bp
    from api.routes_system import system_bp

    app.register_blueprint(profiles_bp)
    app.register_blueprint(flamegraph_bp)
    app.register_blueprint(system_bp)

    # 根路由返回前端首页
    @app.route("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    return app
