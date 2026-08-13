/**
 * background-loader.js — p5.js 背景动画按需加载器
 *
 * 仅当 BgMotion.shouldRun() 为真（非 prefers-reduced-motion 且非移动端）时，
 * 才动态注入 p5.js 与两个背景脚本；移动端 / 减弱动效用户直接跳过 ~1MB 的 p5.js 下载。
 *
 * 依赖：window.BgMotion（background-motion.js，需先加载）。
 */
(function () {
  'use strict';

  if (!window.BgMotion || !window.BgMotion.shouldRun()) {
    // 移动端 / prefers-reduced-motion：不加载 p5 动画
    return;
  }

  function loadScript(src, onload) {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // 保证同批动态脚本按插入顺序执行
    s.onload = onload || null;
    s.onerror = function () {
      console.warn('Background script failed to load:', src);
    };
    document.body.appendChild(s);
  }

  // 先加载 p5.js，其 onload 触发后再加载依赖它的两个背景脚本
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.0/p5.min.js', function () {
    loadScript('js/background-synthetic-flux.js');
    loadScript('js/background-quantum-foam.js');
  });
})();
