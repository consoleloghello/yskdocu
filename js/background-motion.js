/**
 * background-motion.js — 背景动画开关与暂停控制
 *
 * 供 p5.js 背景脚本（synthetic-flux / quantum-foam）复用的轻量守卫：
 *   - prefers-reduced-motion: reduce → 不启动动画（尊重系统「减弱动态效果」）
 *   - 移动端（粗指针/窄屏）→ 默认关闭动画（刷题工具在手机上以流畅为先）
 *   - visibilitychange → 切后台 noLoop() 暂停，回前台 loop() 恢复
 *
 * 依赖：无（纯浏览器 API）。需在背景脚本之前加载。
 */
(function () {
  'use strict';

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isMobile() {
    if (typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches) {
      return true;
    }
    return window.innerWidth < 768;
  }

  window.BgMotion = {
    /** 是否应启动动画（非 reduced-motion 且非移动端） */
    shouldRun: function () {
      return !prefersReducedMotion() && !isMobile();
    },

    /**
     * 绑定 p5 实例的暂停控制：页面切后台时 noLoop()，回前台 loop()。
     * @param {object} p5instance p5 实例（实例模式 sketch 函数收到的 p）
     */
    bindPause: function (p5instance) {
      if (!p5instance || typeof p5instance.noLoop !== 'function') {
        return;
      }
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          p5instance.noLoop();
        } else {
          p5instance.loop();
        }
      });
    },
  };
})();
