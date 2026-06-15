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

    // 3. 启动系统监控
    SystemMonitor.start(5000);

    // 4. 定期刷新时间线数据 (每60秒)
    setInterval(() => Timeline.loadProfiles(), 60000);
  });
})();
