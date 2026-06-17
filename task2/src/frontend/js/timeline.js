/**
 * Timeline - 24h 循环滑动式时间轴组件
 * 范围 00:00-24:00 循环，视图宽度 1 小时(60 时间片)。
 * 点击任意位置选中时间片，指针跟随选中位置，不再固定中间。
 * 支持合并 N 个时间片(1~60分钟)生成火焰图。
 */
const Timeline = {
  canvas: null,
  ctx: null,
  profiles: [],
  onSelect: null,

  // 时间范围: 24 小时循环环
  totalDuration: 24 * 60 * 60 * 1000, // 86400000 ms
  viewDuration: 60 * 60 * 1000,         // 3600000 ms (1h)
  sliceDuration: 60 * 1000,           // 60000 ms (1min)

  // 视图起点(在 0~23h 内循环)
  viewOffset: 0,  // 相对于 00:00 的毫秒偏移
  selectedSlice: 0, // 当前选中的起始时间片索引(0~1439, 每片1min)
  selectedDuration: 1, // 选中的合并时长(分钟)

  // 拖拽状态
  _dragging: false,
  _dragStartX: 0,
  _dragStartOffset: 0,

  init(canvasId, onSelect) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.onSelect = onSelect;

    this._setDefaultView();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // 点击选中 + 拖拽平移
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', e => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', e => this._onMouseUp(e));

    // 加载 24h 数据
    this.loadProfiles();
  },

  _setDefaultView() {
    // 默认固定从 00:00 开始，不随当前时间变化；只由用户手动拖动
    this.selectedSlice = 0;  // 选中 00:00
    this.viewOffset = 0;       // 视图从 00:00 开始
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
      const now = new Date();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
      const start = new Date(end.getTime() - 24 * 3600 * 1000);
      const startISO = start.toISOString().slice(0, 19);
      const endISO = end.toISOString().slice(0, 19);
      const data = await API.getJSON(`/api/profiles?start=${startISO}&end=${endISO}`);
      this.profiles = (data.entries || []).map(entry => {
        const f = entry.file || '';
        const cpu = entry.cpu_percent || 0;
        const basename = f.split('/').pop();
        const match = basename.match(/perf-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.data$/);
        if (match) {
          const [, y, mo, d, h, mi, s] = match;
          const start = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
          const end = new Date(start.getTime() + this.sliceDuration);
          return { start, end, file: f, cpuPercent: cpu };
        }
        return null;
      }).filter(Boolean);
      // 有数据时自动跳转到最新数据所在区域，并选中该时间片
      if (this.profiles.length > 0) {
        const latest = this.profiles[this.profiles.length - 1];
        const ms = latest.start.getUTCHours() * 3600000 + latest.start.getUTCMinutes() * 60000 + latest.start.getUTCSeconds() * 1000;
        this.selectedSlice = Math.floor(ms / this.sliceDuration);
        this.viewOffset = this._normOffset(ms - this.viewDuration / 2 + this.sliceDuration / 2);
        this.referenceDate = new Date(latest.start);
      }
      this.draw();
      this._triggerSelect();
    } catch (e) {
      console.warn('Timeline.loadProfiles failed:', e);
    }
  },

  // ----- 循环工具函数 -----
  _normOffset(ms) {
    return ((ms % this.totalDuration) + this.totalDuration) % this.totalDuration;
  },
  _offsetToDate(offset) {
    // 返回基于 UTC 的"虚拟"Date，仅用于坐标转换(小时/分钟/秒)
    const base = new Date(Date.UTC(1970, 0, 1));
    return new Date(base.getTime() + this._normOffset(offset));
  },
  _sliceToOffset(sliceIdx) {
    return (sliceIdx * this.sliceDuration) % this.totalDuration;
  },
  _offsetToSlice(offset) {
    return Math.floor(this._normOffset(offset) / this.sliceDuration);
  },

  // 坐标转换(基于 viewOffset)
  _offsetToX(offset) {
    const rel = this._normOffset(offset - this.viewOffset);
    return (rel / this.viewDuration) * this._drawWidth;
  },
  _xToOffset(x) {
    return this._normOffset(this.viewOffset + (x / this._drawWidth) * this.viewDuration);
  },

  // ----- 鼠标交互 -----
  _getMouseX(e) {
    const rect = this.canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  },

  _onMouseDown(e) {
    this._dragging = true;
    this._dragStartX = this._getMouseX(e);
    this._dragStartOffset = this.viewOffset;
    // 点击直接选中该位置的时间片
    this._selectAtX(this._dragStartX);
  },

  _onMouseMove(e) {
    if (!this._dragging) return;
    const dx = this._getMouseX(e) - this._dragStartX;
    const msPerPixel = this.viewDuration / this._drawWidth;
    this.viewOffset = this._normOffset(this._dragStartOffset - dx * msPerPixel);
    this.draw();
  },

  _onMouseUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
  },

  // 在指定 x 位置选中时间片
  _selectAtX(x) {
    const offset = this._xToOffset(x);
    this.selectedSlice = Math.floor(this._normOffset(offset) / this.sliceDuration);
    this._autoScrollToSelection();
    // 以最近一条数据的日期作为基准，避免时区偏移导致查询不到
    if (this.profiles.length > 0) {
      this.referenceDate = new Date(this.profiles[this.profiles.length - 1].start);
    }
    this.draw();
    this._triggerSelect();
  },

  // 自动滚动视图让选中片始终可见，且尽量靠近中心
  _autoScrollToSelection() {
    const selOffset = this._sliceToOffset(this.selectedSlice);
    const rel = this._normOffset(selOffset - this.viewOffset);
    const w = this._drawWidth;
    const sliceW = (this.sliceDuration / this.viewDuration) * w * this.selectedDuration;

    // 如果选中片在边缘 20% 范围内，滚动视图让它居中
    if (rel < this.viewDuration * 0.15 || rel > this.viewDuration * 0.85) {
      this.viewOffset = this._normOffset(selOffset - this.viewDuration / 2 + this.sliceDuration / 2);
    }
  },

  // 触发回调 — 使用 UTC 构造 ISO，避免本地时区偏差导致查不到数据
  _triggerSelect() {
    const base = this.referenceDate || new Date();
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    const d = base.getUTCDate();

    const startH = Math.floor(this.selectedSlice / 60);
    const startM = this.selectedSlice % 60;
    const startDate = new Date(Date.UTC(y, m, d, startH, startM, 0));
    const startISO = startDate.toISOString().slice(0, 19);

    const endTotalMinutes = this.selectedSlice + this.selectedDuration;
    const endH = Math.floor(endTotalMinutes / 60) % 24;
    const endM = endTotalMinutes % 60;
    const endDate = new Date(Date.UTC(y, m, d, endH, endM, 0));
    const endISO = endDate.toISOString().slice(0, 19);

    const info = document.getElementById('selection-info');
    if (info) {
      const fmt = dt => dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
      info.textContent = `${fmt(startDate)} ~ ${fmt(endDate)} (${this.selectedDuration}分钟)`;
    }

    if (this.onSelect) {
      this.onSelect(startISO, endISO);
    }
  },

  // 根据时间字符串跳转到对应时间片 (HH:MM 或 HH:MM:SS)
  jumpToTime(timeStr, durationMinutes) {
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return false;

    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parts.length >= 3 ? parseInt(parts[2], 10) : 0;

    if (isNaN(h) || isNaN(m) || isNaN(s)) return false;
    if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return false;

    const ms = (h * 3600 + m * 60 + s) * 1000;
    this.selectedSlice = Math.floor(ms / this.sliceDuration);
    if (durationMinutes && durationMinutes > 0) {
      this.selectedDuration = Math.min(Math.max(parseInt(durationMinutes, 10), 1), 60);
    }
    this.viewOffset = this._normOffset(ms - this.viewDuration / 2 + this.sliceDuration / 2);
    // 以最近一条数据的日期作为基准，避免时区偏移导致查询不到
    if (this.profiles.length > 0) {
      this.referenceDate = new Date(this.profiles[this.profiles.length - 1].start);
    }
    this.draw();
    this._triggerSelect();
    return true;
  },

  // 根据 CPU 使用率返回颜色：0% 绿色 -> 50% 黄色 -> 100% 红色
  _cpuColor(pct) {
    if (pct <= 0) return '#0ead69';
    if (pct >= 100) return '#e74c3c';
    if (pct <= 50) {
      return this._lerpColor('#0ead69', '#f4d03f', pct / 50);
    }
    return this._lerpColor('#f4d03f', '#e74c3c', (pct - 50) / 50);
  },

  _lerpColor(c1, c2, t) {
    const hex = s => parseInt(s.slice(1), 16);
    const r1 = (hex(c1) >> 16) & 0xff, g1 = (hex(c1) >> 8) & 0xff, b1 = hex(c1) & 0xff;
    const r2 = (hex(c2) >> 16) & 0xff, g2 = (hex(c2) >> 8) & 0xff, b2 = hex(c2) & 0xff;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  },

  draw() {
    const ctx = this.ctx;
    const w = this._drawWidth;
    const h = this._drawHeight;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, w, h);

    // 绘制采集色块(循环绘制，多画一圈避免边界断裂)
    for (const p of this.profiles) {
      const pStartOfDay = p.start.getUTCHours() * 3600000 + p.start.getUTCMinutes() * 60000 + p.start.getUTCSeconds() * 1000 + p.start.getUTCMilliseconds();
      const pEndOfDay = pStartOfDay + (p.end.getTime() - p.start.getTime());
      // 绘制原始位置 + 前后各一圈
      for (let shift = -1; shift <= 1; shift++) {
        const x1 = this._offsetToX(pStartOfDay + shift * this.totalDuration);
        const x2 = this._offsetToX(pEndOfDay + shift * this.totalDuration);
        if (x2 < 0 || x1 > w) continue;
        ctx.fillStyle = this._cpuColor(p.cpuPercent || 0);
        ctx.fillRect(Math.max(x1, 0), 2, Math.min(x2, w) - Math.max(x1, 0), h - 4);
      }
    }

    // 绘制选中范围 — 红色高亮框，宽度 = duration 个时间片
    const selOffset = this._sliceToOffset(this.selectedSlice);
    const sliceW = (this.sliceDuration / this.viewDuration) * w;
    let selX = this._offsetToX(selOffset);
    const rangeW = sliceW * this.selectedDuration;
    // 如果接近边界，也画相邻环
    if (selX + rangeW < 0) selX += (this.totalDuration / this.viewDuration) * w;
    if (selX > w) selX -= (this.totalDuration / this.viewDuration) * w;

    if (selX + rangeW > 0 && selX < w) {
      const drawX = Math.max(selX, 0);
      const drawW = Math.min(rangeW, w - selX);
      ctx.fillStyle = 'rgba(233, 69, 96, 0.25)';
      ctx.fillRect(drawX, 0, drawW, h);
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX, 0, drawW, h);
    }

    // X轴刻度(每 10 分钟)
    ctx.fillStyle = '#556677';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const stepMs = 10 * 60 * 1000;
    const startStep = Math.floor(this.viewOffset / stepMs) * stepMs;
    for (let tOff = startStep; tOff <= startStep + this.viewDuration + stepMs; tOff += stepMs) {
      const x = this._offsetToX(tOff);
      if (x < 0 || x > w) continue;
      const t = this._offsetToDate(tOff);
      ctx.fillText(t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }), x, h - 2);
      ctx.strokeStyle = '#445566';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, h - 12);
      ctx.lineTo(x, h - 2);
      ctx.stroke();
    }

    // 顶部时间范围提示 + 选中时间
    ctx.fillStyle = '#8899aa';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    const selTime = this._offsetToDate(this._sliceToOffset(this.selectedSlice));
    const viewStart = this._offsetToDate(this.viewOffset);
    const viewEnd = this._offsetToDate(this.viewOffset + this.viewDuration);
    ctx.fillText(
      `${viewStart.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} ~ ${viewEnd.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}  |  选中: ${selTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} +${this.selectedDuration}分钟`,
      8, 14
    );
  }
};
