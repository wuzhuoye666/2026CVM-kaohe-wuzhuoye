/**
 * api.js - 统一 API 客户端
 * 自动推断后端地址，提供统一请求、超时、重试、错误处理
 */

const API_BASE = (() => {
  const loc = window.location;
  if (loc.protocol === 'file:') {
    // 本地直接打开文件时回退到默认端口
    return 'http://localhost:8080';
  }
  return loc.origin;
})();

const API = {
  BASE: API_BASE,

  // 默认超时 8s，重试 1 次
  async fetch(url, options = {}, { timeout = 8000, retries = 1 } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;

    try {
      const res = await fetch(fullUrl, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (retries > 0 && err.name !== 'AbortError') {
        await new Promise(r => setTimeout(r, 500));
        return this.fetch(url, options, { timeout, retries: retries - 1 });
      }
      throw err;
    }
  },

  async get(url, options = {}) {
    const res = await this.fetch(url, { ...options, method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res;
  },

  async getJSON(url, options = {}) {
    const res = await this.get(url, options);
    return res.json();
  },

  async getText(url, options = {}) {
    const res = await this.get(url, options);
    return res.text();
  }
};
