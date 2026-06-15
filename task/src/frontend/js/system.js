/**
 * SystemMonitor - 系统概览组件
 * 每5秒请求 /api/system/status，更新顶部状态栏
 */
const SystemMonitor = {
  _timer: null,

  async fetch() {
    try {
      const res = await fetch('/api/system/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      this._render(d);
    } catch (e) {
      console.warn('SystemMonitor.fetch failed:', e);
    }
  },

  _render(d) {
    // CPU
    const cpuEl = document.getElementById('cpu-value');
    const cpuBar = document.getElementById('cpu-bar');
    cpuEl.textContent = d.cpu_percent.toFixed(1) + '%';
    cpuBar.style.width = Math.min(d.cpu_percent, 100) + '%';
    cpuBar.style.background = d.cpu_percent > 80 ? 'var(--accent)' : 'var(--accent2)';

    // 磁盘
    document.getElementById('disk-value').textContent = d.disk_usage_percent.toFixed(1) + '%';

    // 数据目录大小
    document.getElementById('data-value').textContent = d.data_dir_size_mb.toFixed(1) + ' MB';

    // 文件数
    document.getElementById('files-value').textContent = d.data_dir_files + ' 个';

    // 保留时长
    document.getElementById('retention-value').textContent = d.retention_hours + 'h';

    // 采集状态
    const badge = document.getElementById('collector-status');
    if (d.collector_status === 'running') {
      badge.className = 'status-badge running';
      badge.innerHTML = '&#9679; 运行中';
    } else {
      badge.className = 'status-badge stopped';
      badge.innerHTML = '&#9679; 离线';
    }
  },

  start(interval = 5000) {
    this.fetch();
    this._timer = setInterval(() => this.fetch(), interval);
  },

  stop() {
    if (this._timer) clearInterval(this._timer);
  }
};
