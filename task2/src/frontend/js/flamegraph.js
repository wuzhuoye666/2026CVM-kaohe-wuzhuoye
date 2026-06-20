/**
 * FlameGraphView - 火焰图展示组件
 * 使用 SVG 嵌入，flamegraph.pl 生成的 SVG 自带点击放大和搜索功能
 * 核心：innerHTML 插入的 SVG 不会执行 <script>，需要手动提取执行
 */
const FlameGraphView = {
  _viewEl: null,
  _loadingEl: null,
  _emptyEl: null,
  _errorEl: null,
  _errorMsg: null,
  _searchInput: null,

  init() {
    this._viewEl = document.getElementById('flamegraph-view');
    this._loadingEl = document.getElementById('flamegraph-loading');
    this._emptyEl = document.getElementById('flamegraph-empty');
    this._errorEl = document.getElementById('flamegraph-error');
    this._errorMsg = document.getElementById('error-message');
    this._searchInput = document.getElementById('search-input');

    document.getElementById('search-btn').addEventListener('click', () => this._search());
    this._searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._search();
    });
    document.getElementById('reset-btn').addEventListener('click', () => this._reset());

    this._showStatus('empty');
  },

  async load(startISO, endISO) {
    this._showStatus('loading');
    try {
      const res = await API.fetch(
        `/api/flamegraph?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
        {},
        { timeout: 120000, retries: 0 }
      );
      if (res.status === 404) {
        this._showStatus('error', '该时间段无采样数据');
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const svgText = await res.text();

      // 插入 SVG
      this._viewEl.innerHTML = svgText;

      // 关键：innerHTML 不会执行 <script>，手动提取并执行
      const svgEl = this._viewEl.querySelector('svg');
      if (svgEl) {
        svgEl.style.width = '100%';
        svgEl.style.height = 'auto';
        this._executeSvgScripts(svgEl);
      }
      }

      this._showStatus('none');
    } catch (e) {
      this._showStatus('error', '加载失败: ' + e.message);
    }
  },

  // 提取 SVG 中的 <script> 标签内容并执行
  _executeSvgScripts(svgEl) {
    const scripts = svgEl.querySelectorAll('script');
    scripts.forEach(script => {
      const code = script.textContent || script.innerHTML;
      if (code.trim()) {
        try {
          // 创建一个真正的 script 元素来执行代码
          const realScript = document.createElement('script');
          realScript.textContent = code;
          document.head.appendChild(realScript);
          // 执行后立即移除，代码已在全局作用域生效
          document.head.removeChild(realScript);
        } catch (e) {
          console.warn('Failed to execute SVG script:', e);
        }
      }
    });

    // SVG 的 onload="init(evt)" 不会被触发，手动调用
    const onloadAttr = svgEl.getAttribute('onload');
    if (onloadAttr) {
      try {
        // 创建一个模拟的 evt 对象
        const evt = { target: svgEl };
        // 在全局作用域执行 onload
        const fn = new Function('evt', onloadAttr);
        fn(evt);
      } catch (e) {
        console.warn('Failed to execute SVG onload:', e);
      }
    }
  },

  // 搜索：调用 flamegraph.pl 内置的全局 search() 函数
  _search() {
    const term = this._searchInput.value.trim();
    if (!term) { this._reset(); return; }
    try {
      if (typeof search === 'function') {
        search(term);
      }
    } catch (e) {
      console.warn('SVG search function not available');
    }
  },

  // 重置放大和搜索
  _reset() {
    this._searchInput.value = '';
    try {
      if (typeof resetzoom === 'function') {
        resetzoom(null);
      } else if (typeof unzoom === 'function') {
        unzoom(null);
      }
    } catch (e) {
      // 如果脚本函数不可用，重新加载当前数据
      console.warn('SVG resetzoom not available');
    }
  },

  _showStatus(type, msg) {
    this._loadingEl.classList.toggle('hidden', type !== 'loading');
    this._emptyEl.classList.toggle('hidden', type !== 'empty');
    this._errorEl.classList.toggle('hidden', type !== 'error');
    if (type === 'error' && msg) {
      this._errorMsg.textContent = msg;
    }
    if (type === 'loading' || type === 'empty' || type === 'error') {
      this._viewEl.innerHTML = '';
    }
  }
};
