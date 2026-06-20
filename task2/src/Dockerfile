FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# 配置阿里云 pip 镜像加速
RUN mkdir -p /etc/pip && printf "[global]\nindex-url = https://mirrors.aliyun.com/pypi/simple/\ntrusted-host = mirrors.aliyun.com\n" > /etc/pip/pip.conf
ENV PIP_CONFIG_FILE=/etc/pip/pip.conf

# 安装系统基础依赖
# perf 强绑定内核版本，容器启动时由 entrypoint 动态安装匹配的 linux-tools-$(uname -r)
RUN apt-get update && apt-get install -y --no-install-recommends \
    linux-tools-common \
    python3 \
    python3-pip \
    perl \
    stress-ng \
    && rm -rf /var/lib/apt/lists/*

# 复制 FlameGraph 工具链
COPY FlameGraph/ /opt/FlameGraph/
RUN chmod +x /opt/FlameGraph/*.pl

WORKDIR /app

# 先复制依赖文件，利用 Docker 缓存层
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# 复制应用源码
COPY api/ ./api/
COPY collector/ ./collector/
COPY frontend/ ./frontend/
COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh

VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
