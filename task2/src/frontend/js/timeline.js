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
  viewOffset: 0,  // 相对于 00:00 的毫秒偏移（本地时间）
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
    // 默认跳转到当前本地时间附近
    const now = new Date();
    const ms = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000;
    this.selectedSlice = Math.floor(ms / this.sliceDuration);
    this.viewOffset = this._normOffset(ms - this.viewDuration / 2);
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
      // 用本地时间构造查询范围（后端存储是 UTC 的 ISO 字符串）
      const now = new Date();
      const endISO = now.toISOString().slice(0, 19);
      const startISO = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 19);
      const data = await API.getJSON(`/api/profiles?start=${startISO}&end=${endISO}`);
      this.profiles = (data.entries || []).map(entry => {
        const f = entry.file || '';
        const cpu = entry.cpu_percent || 0;
        // 解析文件名中的 UTC 时间
        const basename = f.split('/').pop();
        const match = basename.match(/perf-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.data$/);
        if (match) {
          const [, y, mo, d, h, mi, s] = match;
          // 文件名存的是 UTC，转为本地 Date 用于时间轴显示
          const utcStart = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
          const utcEnd = new Date(utcStart.getTime() + this.sliceDuration);
          return { start: utcStart, end: utcEnd, file: f, cpuPercent: cpu };
        }
        return null;
      }).filter(Boolean);
      // 有数据时自动跳转到最新数据所在区域
      if (this.profiles.length > 0) {
        const latest = this.profiles[this.profiles.length - 1];
        const ms = latest.start.getHours() * 3600000 + latest.start.getMinutes() * 60000 + latest.start.getSeconds() * 1000;
        this.selectedSlice = Math.floor(ms / this.sliceDuration);
        this.viewOffset = this._normOffset(ms - this.viewDuration / 2 + this.sliceDuration / 2);
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
    // 把一天内的毫秒偏移转为本地时间的"虚拟"Date（用于取小时/分钟显示）
    const base = new Date(2000, 0, 1); // 任意日期，只取时/分
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
    this.draw();
    this._triggerSelect();
  },

  // 自动滚动视图让选中片始终可见
  _autoScrollToSelection() {
    const selOffset = this._sliceToOffset(this.selectedSlice);
    const rel = this._normOffset(selOffset - this.viewOffset);
    if (rel < this.viewDuration * 0.15 || rel > this.viewDuration * 0.85) {
      this.viewOffset = this._normOffset(selOffset - this.viewDuration / 2 + this.sliceDuration / 2);
    }
  },

  // 触发回调 — 生成正确的 UTC ISO 时间戳给后端
  _triggerSelect() {
    // 用本地时间 selectedSlice 算出选中时段的本地日期时间，
    // 再转 UTC ISO 发给后端查询
    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();

    const startH = Math.floor(this.selectedSlice / 60);
    const startM = this.selectedSlice % 60;

    // 构造本地时间 Date 对象
    const localStart = new Date(todayY, todayM, todayD, startH, startM, 0);
    const localEnd = new Date(localStart.getTime() + this.selectedDuration * 60 * 1000);

    // 转为 UTC ISO（后端存储的就是 UTC ISO 字符串）
    const startISO = localStart.toISOString().slice(0, 19);
    const endISO = localEnd.toISOString().slice(0, 19);

    const info = document.getElementById('selection-info');
    if (info) {
      const fmt = dt => {
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        const ss = String(dt.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      };
      info.textContent = `${fmt(localStart)} ~ ${fmt(localEnd)} (${this.selectedDuration}分钟)`;
    }

    if (this.onSelect) {
      this.onSelect(startISO, endISO);
    }
  },

  // 根据时间字符串跳转到对应时间片
  jumpToTime(timeStr, durationMinutes) {
    const trimmed = timeStr.trim();

    // 完整日期格式: YYYY-MM-DD HH:MM 或 YYYY-MM-DD HH:MM:SS
    const fullMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (fullMatch) {
      const [, y, mo, d, h, m, s] = fullMatch;
      const date = new Date(+y, +mo - 1, +d, +h, +m, +(s || 0));
      if (isNaN(date.getTime())) return false;
      const ms = date.getHours() * 3600000 + date.getMinutes() * 60000 + date.getSeconds() * 1000;
      this.selectedSlice = Math.floor(ms / this.sliceDuration);
      if (durationMinutes && durationMinutes > 0) {
        this.selectedDuration = Math.min(Math.max(parseInt(durationMinutes, 10), 1), 60);
      }
      this.viewOffset = this._normOffset(ms - this.viewDuration / 2 + this.sliceDuration / 2);
      this.draw();
      this._triggerSelect();
      return true;
    }

    // HH:MM 或 HH:MM:SS 格式
    const parts = trimmed.split(':');
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
    this.draw();
    this._triggerSelect();
    return true;
  },

  // 根据 CPU 使用率返回颜色
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

    // 绘制采集色块（用本地时间坐标）
    for (const p of this.profiles) {
      // profile.start 是从文件名解析的 UTC Date，.getHours() 等方法返回本地时间
      const pStartOfDay = p.start.getHours() * 3600000 + p.start.getMinutes() * 60000 + p.start.getSeconds() * 1000 + p.start.getMilliseconds();
      const pEndOfDay = pStartOfDay + (p.end.getTime() - p.start.getTime());
      for (let shift = -1; shift <= 1; shift++) {
        const x1 = this._offsetToX(pStartOfDay + shift * this.totalDuration);
        const x2 = this._offsetToX(pEndOfDay + shift * this.totalDuration);
        if (x2 < 0 || x1 > w) continue;
        ctx.fillStyle = this._cpuColor(p.cpuPercent || 0);
        ctx.fillRect(Math.max(x1, 0), 2, Math.min(x2, w) - Math.max(x1, 0), h - 4);
      }
    }

    // 绘制选中范围
    const selOffset = this._sliceToOffset(this.selectedSlice);
    const sliceW = (this.sliceDuration / this.viewDuration) * w;
    let selX = this._offsetToX(selOffset);
    const rangeW = sliceW * this.selectedDuration;
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

    // X轴刻度（本地时间，每 10 分钟）
    ctx.fillStyle = '#556677';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const stepMs = 10 * 60 * 1000;
    const startStep = Math.floor(this.viewOffset / stepMs) * stepMs;
    for (let tOff = startStep; tOff <= startStep + this.viewDuration + stepMs; tOff += stepMs) {
      const x = this._offsetToX(tOff);
      if (x < 0 || x > w) continue;
      const t = this._offsetToDate(tOff);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      ctx.fillText(`${hh}:${mm}`, x, h - 2);
      ctx.strokeStyle = '#445566';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, h - 12);
      ctx.lineTo(x, h - 2);
      ctx.stroke();
    }

    // 顶部时间范围提示（本地时间）
    ctx.fillStyle = '#8899aa';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    const fmtShort = ms => {
      const dt = this._offsetToDate(ms);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };
    const selTime = this._offsetToDate(this._sliceToOffset(this.selectedSlice));
    const selhh = String(selTime.getHours()).padStart(2, '0');
    const selmm = String(selTime.getMinutes()).padStart(2, '0');
    ctx.fillText(
      `${fmtShort(this.viewOffset)} ~ ${fmtShort(this.viewOffset + this.viewDuration)}  |  选中: ${selhh}:${selmm} +${this.selectedDuration}分钟`,
      8, 14
    );
  }
};
