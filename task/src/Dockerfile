FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 配置阿里云 pip 镜像加速
RUN mkdir -p /etc/pip && echo "[global]\nindex-url = https://mirrors.aliyun.com/pypi/simple/\ntrusted-host = mirrors.aliyun.com" > /etc/pip/pip.conf
ENV PIP_CONFIG_FILE=/etc/pip/pip.conf

# 安装系统依赖（合并为一层减少镜像大小）
RUN apt-get update && apt-get install -y --no-install-recommends \
    linux-tools-common \
    python3 \
    python3-pip \
    perl \
    stress-ng \
    && rm -rf /var/lib/apt/lists/*

# 处理 perf 路径：ubuntu 安装的是带版本号的 perf_5.15 等，需要软链接
RUN apt-get update && apt-get install -y --no-install-recommends "linux-tools-$(uname -r)" 2>/dev/null || true \
    && rm -rf /var/lib/apt/lists/* \
    && perf_bin=$(ls /usr/bin/perf_* 2>/dev/null | sort -V | tail -1) \
    && if [ -n "$perf_bin" ]; then ln -sf "$perf_bin" /usr/bin/perf; fi

# 复制 FlameGraph 工具链（已包含在源码中，避免构建时网络依赖）
COPY FlameGraph/ /opt/FlameGraph/
RUN chmod +x /opt/FlameGraph/*.pl

# 设置工作目录
WORKDIR /app

# 先复制依赖文件，利用 Docker 缓存层
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# 复制应用源码
COPY api/ ./api/
COPY collector/ ./collector/
COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh

# 数据持久化卷
VOLUME ["/data"]

# 暴露 API 端口
EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
