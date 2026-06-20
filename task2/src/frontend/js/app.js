/**
 * app.js - 主控制器
 * 初始化所有组件，连接时间线选区变化到火焰图加载
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化火焰图组件
    FlameGraphView.init();

    // 2. 初始化时间线，绑定选区回调
    Timeline.init('timeline-canvas', (startISO, endISO) => {
      FlameGraphView.load(startISO, endISO);
    });

    // 3. 绑定跳转按钮
    const jumpBtn = document.getElementById('jump-btn');
    const jumpInput = document.getElementById('jump-input');
    const rangeInput = document.getElementById('range-input');
    if (jumpBtn && jumpInput) {
      jumpBtn.addEventListener('click', () => {
        const duration = rangeInput ? parseInt(rangeInput.value, 10) : 1;
        if (!Timeline.jumpToTime(jumpInput.value, duration)) {
          alert('请输入正确的时间格式，如 2026-06-18 03:00 或 03:00');
        }
      });
      jumpInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') jumpBtn.click();
      });
    }

    // 4. 启动系统监控
    SystemMonitor.start(5000);

    // 5. 定期刷新时间线数据 (每60秒)
    setInterval(() => Timeline.loadProfiles(), 60000);
  });
})();
