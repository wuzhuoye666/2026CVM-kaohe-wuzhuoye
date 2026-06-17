/**
 * Timeline - 时间线组件
 * 用 Canvas 绘制过去24小时的采集色块，支持拖拽框选时间范围
 */
const Timeline = {
  canvas: null,
  ctx: null,
  profiles: [],       // { start, end, file } from metadata
  selection: null,     // { start: Date, end: Date }
  onSelect: null,      // callback(startISO, endISO)

  // 拖拽状态
  _dragging: false,
  _dragStartX: 0,

  // 时间范围
  rangeStart: null,
  rangeEnd: null,

  init(canvasId, onSelect) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.onSelect = onSelect;
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // 鼠标事件
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', e => this._onMouseUp(e));

    // 设置默认时间范围: 过去24小时
    this._setDefaultRange();
    this.loadProfiles();
  },

  _setDefaultRange() {
    this.rangeEnd = new Date();
    this.rangeStart = new Date(this.rangeEnd.getTime() - 24 * 3600 * 1000);
  },

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this._drawWidth = rect.width;
    this._drawHeight = rect.height;
    this.draw();
  },

  async loadProfiles() {
    try {
      const startISO = this.rangeStart.toISOString().slice(0, 19);
      const endISO = this.rangeEnd.toISOString().slice(0, 19);
      const res = await fetch(`/api/profiles?start=${startISO}&end=${endISO}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      // profiles is file paths; we need metadata entries — fetch /api/system/status for files count
      // Actually, let's use profiles API which returns file paths
      // We need start/end for each file — parse from filename or use metadata
      this.profiles = (data.files || []).map(f => {
        // Parse filename: perf-YYYYMMDD_HHMMSS.data
        const basename = f.split('/').pop(); // handle full paths like /data/perf-xxx.data
        const match = basename.match(/perf-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.data$/);
        if (match) {
          const [, y, mo, d, h, mi, s] = match;
          // Filename timestamp is UTC, use Date.UTC to avoid timezone offset
          const start = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
          const end = new Date(start.getTime() + 60 * 1000); // assume 1min slice
          return { start, end, file: f };
        }
        return null;
      }).filter(Boolean);
      this.draw();
    } catch (e) {
      console.warn('Timeline.loadProfiles failed:', e);
    }
  },

  // 坐标转换
  _timeToX(date) {
    const total = this.rangeEnd.getTime() - this.rangeStart.getTime();
    const offset = date.getTime() - this.rangeStart.getTime();
    return (offset / total) * this._drawWidth;
  },
  _xToTime(x) {
    const total = this.rangeEnd.getTime() - this.rangeStart.getTime();
    return new Date(this.rangeStart.getTime() + (x / this._drawWidth) * total);
  },

  draw() {
    const ctx = this.ctx;
    const w = this._drawWidth;
    const h = this._drawHeight;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // 背景
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, w, h);

    // 绘制采集色块
    for (const p of this.profiles) {
      const x1 = this._timeToX(p.start);
      const x2 = this._timeToX(p.end);
      if (x2 < 0 || x1 > w) continue;
      ctx.fillStyle = '#0ead69';
      ctx.fillRect(Math.max(x1, 0), 2, Math.min(x2, w) - Math.max(x1, 0), h - 4);
    }

    // 绘制选区
    if (this.selection) {
      const sx1 = this._timeToX(this.selection.start);
      const sx2 = this._timeToX(this.selection.end);
      const left = Math.min(sx1, sx2);
      const right = Math.max(sx1, sx2);
      ctx.fillStyle = 'rgba(233,69,96,0.25)';
      ctx.fillRect(left, 0, right - left, h);
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.strokeRect(left, 0, right - left, h);
    }

    // X轴刻度 (每4小时)
    ctx.fillStyle = '#556677';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const stepMs = 4 * 3600 * 1000;
    let t = new Date(Math.ceil(this.rangeStart.getTime() / stepMs) * stepMs);
    while (t < this.rangeEnd) {
      const x = this._timeToX(t);
      ctx.fillText(t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), x, h - 2);
      t = new Date(t.getTime() + stepMs);
    }
  },

  // 鼠标事件
  _getMouseX(e) {
    const rect = this.canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  },
  _onMouseDown(e) {
    this._dragging = true;
    this._dragStartX = this._getMouseX(e);
    const t = this._xToTime(this._dragStartX);
    this.selection = { start: t, end: t };
    this.draw();
  },
  _onMouseMove(e) {
    if (!this._dragging) return;
    const x = this._getMouseX(e);
    this.selection.end = this._xToTime(x);
    this.draw();
  },
  _onMouseUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    const x = this._getMouseX(e);
    this.selection.end = this._xToTime(x);

    // 保证 start <= end
    if (this.selection.start > this.selection.end) {
      [this.selection.start, this.selection.end] = [this.selection.end, this.selection.start];
    }

    // 更新选区信息
    const fmt = d => d.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const info = document.getElementById('selection-info');
    if (info) info.textContent = `${fmt(this.selection.start)} ~ ${fmt(this.selection.end)}`;

    // 触发回调
    if (this.onSelect) {
      const toISO = d => d.toISOString().slice(0, 19);
      this.onSelect(toISO(this.selection.start), toISO(this.selection.end));
    }
    this.draw();
  }
};
