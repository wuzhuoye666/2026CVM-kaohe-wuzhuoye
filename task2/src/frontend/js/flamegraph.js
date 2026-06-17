/**
 * FlameGraphView - 火焰图展示组件
 * 包含两条路径：
 *   1. SVG嵌入: fetch /api/flamegraph → innerHTML
 *   2. d3-flame-graph: fetch /api/flamegraph/data → d3渲染
 */
const FlameGraphView = {
  _currentMode: 'svg',  // 'svg' or 'd3'
  _d3Chart: null,
  _loading: false,

  // DOM 引用
  _svgEl: null,
  _d3El: null,
  _loadingEl: null,
  _emptyEl: null,
  _errorEl: null,
  _errorMsg: null,

  init() {
    this._svgEl = document.getElementById('flamegraph-svg');
    this._d3El = document.getElementById('flamegraph-d3');
    this._loadingEl = document.getElementById('flamegraph-loading');
    this._emptyEl = document.getElementById('flamegraph-empty');
    this._errorEl = document.getElementById('flamegraph-error');
    this._errorMsg = document.getElementById('error-message');

    // 视图切换按钮
    document.getElementById('btn-svg').addEventListener('click', () => this.switchMode('svg'));
    document.getElementById('btn-d3').addEventListener('click', () => this.switchMode('d3'));

    // 搜索功能（d3模式）
    document.getElementById('search-btn').addEventListener('click', () => this._d3Search());
    document.getElementById('search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._d3Search();
    });
    document.getElementById('reset-zoom-btn').addEventListener('click', () => this._d3ResetZoom());

    // 初始显示空状态
    this._showStatus('empty');
  },

  switchMode(mode) {
    this._currentMode = mode;
    document.getElementById('btn-svg').classList.toggle('active', mode === 'svg');
    document.getElementById('btn-d3').classList.toggle('active', mode === 'd3');
    document.getElementById('search-box').classList.toggle('hidden', mode !== 'd3');
    this._svgEl.classList.toggle('hidden', mode !== 'svg');
    this._d3El.classList.toggle('hidden', mode !== 'd3');
  },

  async load(startISO, endISO) {
    if (this._currentMode === 'svg') {
      await this._loadSVG(startISO, endISO);
    } else {
      await this._loadD3(startISO, endISO);
    }
  },

  // ---- SVG 路径 ----
  async _loadSVG(startISO, endISO) {
    this._showStatus('loading');
    try {
      const res = await API.fetch(`/api/flamegraph?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
      if (res.status === 404) {
        this._showStatus('error', '该时间段无采样数据');
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const svg = await res.text();
      this._svgEl.innerHTML = svg;
      this._showStatus('none');
      this._svgEl.classList.remove('hidden');
    } catch (e) {
      this._showStatus('error', '加载失败: ' + e.message);
    }
  },

  // ---- d3-flame-graph 路径 ----
  async _loadD3(startISO, endISO) {
    this._showStatus('loading');
    try {
      const res = await API.fetch(`/api/flamegraph/data?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
      if (res.status === 404) {
        this._showStatus('error', '该时间段无采样数据');
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      this._renderD3(data);
      this._showStatus('none');
      this._d3El.classList.remove('hidden');
    } catch (e) {
      this._showStatus('error', '加载失败: ' + e.message);
    }
  },

  _renderD3(data) {
    // 清空旧图表
    this._d3El.innerHTML = '';
    document.getElementById('reset-zoom-btn').classList.add('hidden');

    const width = this._d3El.clientWidth || 1000;
    const chart = d3.flamegraph()
      .width(width)
      .cellHeight(18)
      .minFrameSize(2)
      .transitionDuration(300)
      .sort(true)
      .title('')
      .tooltip(true)
      .onClick(d => {
        chart.resetZoom();
        document.getElementById('reset-zoom-btn').classList.remove('hidden');
        chart.zoomTo(d);
      });

    chart.colorMapper(function(d) {
      // 给每个栈帧一个暖色调，模拟传统火焰图
      const hash = d.data.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const r = 200 + (hash % 55);
      const g = 50 + (hash % 80);
      const b = 10 + (hash % 30);
      return `rgb(${r},${g},${b})`;
    });

    d3.select(this._d3El)
      .datum(data)
      .call(chart);

    this._d3Chart = chart;
  },

  _d3Search() {
    if (!this._d3Chart) return;
    const term = document.getElementById('search-input').value.trim();
    if (term) {
      this._d3Chart.search(term);
    } else {
      this._d3Chart.clear();
    }
  },

  _d3ResetZoom() {
    if (!this._d3Chart) return;
    this._d3Chart.resetZoom();
    document.getElementById('reset-zoom-btn').classList.add('hidden');
  },

  // ---- 状态管理 ----
  _showStatus(type, msg) {
    this._loadingEl.classList.toggle('hidden', type !== 'loading');
    this._emptyEl.classList.toggle('hidden', type !== 'empty');
    this._errorEl.classList.toggle('hidden', type !== 'error');
    if (type === 'error' && msg) {
      this._errorMsg.textContent = msg;
    }
    if (type === 'loading' || type === 'empty' || type === 'error') {
      this._svgEl.classList.add('hidden');
      this._d3El.classList.add('hidden');
    }
  }
};
