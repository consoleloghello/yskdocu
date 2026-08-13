/* ============================================================
   量子泡沫 (Quantum Foam) — 气泡生长聚并系统
   ─────────────────────────────────────────────
   主页面 (main content) 的背景动画。
   气泡在画面中随机成核、缓慢生长、碰撞合并，
   最终破裂消散，模拟化工反应器中的鼓泡和泡沫行为。
   ============================================================
   可调参数说明（参见下方 P2 对象）：
     targetCount     — 目标气泡数量（越多画面越丰富）
     maxBubbleRadius — 气泡最大半径（像素）
     minBubbleRadius — 气泡最小半径（像素）
     growSpeed       — 每帧生长速度
     spawnInterval   — 每隔多少帧尝试生成一个新气泡
     hueBase         — 基础色相（青色 190）
     hueRange        — 从诞生到破裂的色相变化范围（120°→青到珊瑚）
     popFlashFrames  — 破裂粒子爆散的持续帧数
   ============================================================ */
(function () {
  'use strict';

  // ========== 可调参数 ==========
  const P2 = {
    targetCount: 50,         // 目标气泡数量（画面上的气泡数会维持在此值附近）10~120
    maxBubbleRadius: 40,     // 气泡最大半径，单位像素（剧烈沸腾时气泡小而密）15~120px
    minBubbleRadius: 3,      // 气泡最小半径（新生成时的初始大小）2~20px
    growSpeed: 1,            // 气泡每帧的生长速度（剧烈沸腾，快速膨胀、快速破裂）0-1.5
    spawnInterval: 5,        // 每隔 5 帧尝试生成一个新气泡（高密度成核）
    hueBase: 190,            // 基础色相：190 = 青色（cyan）0~360°
    hueRange: 120,           // 色相变化范围：从青色(190)到珊瑚色(310)0~360°
    popFlashFrames: 15       // 气泡破裂时粒子爆散的持续帧数2~30
  };

  // ========== 内部状态 ==========
  let p5bg;
  let w2, h2;                // 画布宽高
  let bubbles = [];
  let frameCounter = 0;
  let popParticles = [];     // 破裂时产生的爆散粒子

  // ========== 气泡类 ==========
  class Bubble {
    constructor(x, y, r) {
      this.x = x;
      this.y = y;
      this.r = r || P2.minBubbleRadius;          // 当前半径
      this.maxR = P2.minBubbleRadius + Math.random() * (P2.maxBubbleRadius - P2.minBubbleRadius);
      this.growRate = P2.growSpeed * (0.6 + Math.random() * 0.8);  // 每帧生长速度（随机化）
      this.age = 0;
      this.lifespan = 300 + Math.floor(Math.random() * 400);  // 寿命：300~700 帧
      this.birthHue = P2.hueBase + Math.random() * 30 - 15;   // 气泡的个性色相偏移
      this.popAlpha = 1.0;
    }

    // 生命周期比例 0~1
    get lifeRatio() { return this.age / this.lifespan; }

    // 色相：随年龄从青色→蓝绿→琥珀→珊瑚
    get hue() {
      return (this.birthHue + this.lifeRatio * P2.hueRange) % 360;
    }

    // 饱和度：中年最鲜艳
    get sat() {
      return 18 + 15 * Math.sin(this.lifeRatio * Math.PI);
    }

    // 亮度：高龄略微变暗
    get bri() {
      return 92 + 7 * (1 - this.lifeRatio);
    }

    // 透明度：渐入 → 稳定 → 渐出
    get alpha() {
      if (this.lifeRatio < 0.05) return this.lifeRatio / 0.05;
      if (this.lifeRatio > 0.85) return (1 - this.lifeRatio) / 0.15;
      return 1.0;
    }

    // 每帧更新：长大一岁、半径增加
    update() {
      this.age++;
      if (this.r < this.maxR) {
        this.r += this.growRate;
        if (this.r > this.maxR) this.r = this.maxR;
      }
    }

    isDead() {
      return this.age >= this.lifespan || this.popAlpha <= 0;
    }
  }

  // ========== 破裂粒子类 ==========
  // 气泡破裂时产生若干小粒子向四周飞散
  class PopParticle {
    constructor(x, y, hue) {
      this.x = x;
      this.y = y;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.life = P2.popFlashFrames;
      this.maxLife = P2.popFlashFrames;
      this.hue = hue;
      this.r = 2 + Math.random() * 3;
    }

    get lifeRatio() { return this.life / this.maxLife; }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.92;   // 减速
      this.vy *= 0.92;
      this.life--;
    }

    isDead() { return this.life <= 0; }
  }

  // ========== 生成新气泡 ==========
  // 在随机位置尝试生成，避开已有气泡
  function spawnBubble() {
    const margin = 40;
    const x = margin + Math.random() * (w2 - margin * 2);
    const y = margin + Math.random() * (h2 - margin * 2);
    // 检查是否离已有气泡太近
    for (const b of bubbles) {
      const dx = x - b.x;
      const dy = y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < b.r + P2.minBubbleRadius + 5) return;
    }
    bubbles.push(new Bubble(x, y));
  }

  // ========== 气泡合并逻辑 ==========
  // 当两个气泡重叠时：较小的被较大的吸收，面积守恒
  function handleMerging() {
    const toRemove = new Set();
    for (let i = 0; i < bubbles.length; i++) {
      if (toRemove.has(i)) continue;
      for (let j = i + 1; j < bubbles.length; j++) {
        if (toRemove.has(j)) continue;
        const a = bubbles[i];
        const b = bubbles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const overlap = a.r + b.r - dist;
        if (overlap > 0) {
          if (a.r >= b.r) {
            // a 吸收 b：面积守恒（πr² 合并）
            a.r = Math.sqrt(a.r * a.r + b.r * b.r);
            if (a.r > P2.maxBubbleRadius) a.r = P2.maxBubbleRadius;
            toRemove.add(j);
            // 被吸收的气泡产生爆散粒子
            for (let k = 0; k < 6; k++) {
              popParticles.push(new PopParticle(b.x, b.y, b.hue));
            }
          } else {
            b.r = Math.sqrt(b.r * b.r + a.r * a.r);
            if (b.r > P2.maxBubbleRadius) b.r = P2.maxBubbleRadius;
            toRemove.add(i);
            for (let k = 0; k < 6; k++) {
              popParticles.push(new PopParticle(a.x, a.y, a.hue));
            }
            break;
          }
        }
      }
    }
    if (toRemove.size > 0) {
      const sorted = [...toRemove].sort((a, b) => b - a);
      for (const idx of sorted) bubbles.splice(idx, 1);
    }
  }

  // ========== p5.js 草图（实例模式） ==========
  const sketch2 = function (p) {
    p5bg = p;
    if (window.BgMotion) {
      window.BgMotion.bindPause(p);
    }

    p.setup = function () {
      const container = document.getElementById('p5bg-main');
      w2 = container.offsetWidth || window.innerWidth;
      h2 = container.offsetHeight || window.innerHeight;
      const canvas = p.createCanvas(w2, h2);
      canvas.parent('p5bg-main');
      canvas.style('pointer-events', 'none');
      canvas.style('display', 'block');
      p.colorMode(p.HSB, 360, 100, 100, 1.0);
      p.noStroke();

      // 初始化：生成 20 个初始气泡
      for (let i = 0; i < 20; i++) {
        const x = 40 + Math.random() * (w2 - 80);
        const y = 40 + Math.random() * (h2 - 80);
        const r = P2.minBubbleRadius + Math.random() * (P2.maxBubbleRadius * 0.4);
        bubbles.push(new Bubble(x, y, r));
      }
    };

    p.draw = function () {
      frameCounter++;

      // 如果气泡数量不足，尝试生成新气泡
      if (bubbles.length < P2.targetCount && frameCounter % P2.spawnInterval === 0) {
        spawnBubble();
      }

      // 所有气泡生长
      for (const b of bubbles) b.update();

      // 碰撞检测与合并
      handleMerging();

      // 移除寿命耗尽的气泡 → 产生破裂效果
      const surviving = [];
      for (const b of bubbles) {
        if (b.isDead()) {
          for (let k = 0; k < 10; k++) {
            popParticles.push(new PopParticle(b.x, b.y, b.hue));
          }
        } else {
          surviving.push(b);
        }
      }
      bubbles = surviving;

      // 更新爆散粒子
      for (const pp of popParticles) pp.update();
      popParticles = popParticles.filter(p => !p.isDead());

      // ========== 绘制 ==========
      p.clear();
      p.blendMode(p.SCREEN);

      // 绘制气泡（从大到小排序，保证大泡在底层）
      const sorted = [...bubbles].sort((a, b) => b.r - a.r);
      for (const b of sorted) {
        const alpha = b.alpha * 0.2;   // 整体不透明度（调低以不干扰阅读）

        // 径向辉光：从中心向外多层渐变
        const layers = Math.min(8, Math.ceil(b.r / 8));
        for (let i = 0; i < layers; i++) {
          const ratio = i / layers;
          const layerR = b.r * (1 - ratio * 0.85);
          const layerAlpha = alpha * (1 - ratio * 0.8);
          const layerBri = b.bri + (1 - ratio) * 10;
          const layerSat = b.sat - ratio * 15;

          p.fill(b.hue, layerSat, layerBri, layerAlpha);
          p.ellipse(b.x, b.y, layerR * 2, layerR * 2);
        }

        // 左上角高光（模拟玻璃反射）
        p.fill(b.hue, 10, 97, alpha * 0.2);
        p.ellipse(b.x - b.r * 0.25, b.y - b.r * 0.25, b.r * 0.4, b.r * 0.4);
      }

      // 绘制破裂爆散粒子
      for (const pp of popParticles) {
        const alpha = (1 - pp.lifeRatio) * 0.8;
        p.fill(pp.hue, 70, 90, alpha);
        p.ellipse(pp.x, pp.y, pp.r * 2, pp.r * 2);
      }
    };

    // 窗口大小变化时重新适应
    p.windowResized = function () {
      const container = document.getElementById('p5bg-main');
      w2 = container.offsetWidth || window.innerWidth;
      h2 = container.offsetHeight || window.innerHeight;
      p.resizeCanvas(w2, h2);
    };
  };

  // ========== 启动（reduced-motion / 移动端默认关闭） ==========
  if (window.BgMotion && window.BgMotion.shouldRun()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        new p5(sketch2, 'p5bg-main');
      });
    } else {
      new p5(sketch2, 'p5bg-main');
    }
  }
})();
