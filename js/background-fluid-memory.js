/* ============================================================
   流体记忆 (Fluid Memory) — 流场粒子系统
   ─────────────────────────────────────────────
   入口遮罩 (entry overlay) 的背景动画。
   粒子在 Perlin 噪声构建的矢量场中漂移，
   形成青色到琥珀色的发光轨迹，模拟化工管道中的流体流动。
   ============================================================
   可调参数说明（参见下方 P 对象）：
     particleCount  — 粒子数量（越多越密集，性能消耗越大）
     noiseScale     — 噪声场缩放（越小流场变化越平缓）
     flowSpeed      — 粒子跟随流场的速度
     turbulence     — 噪声叠加程度（0~1，越高流场越复杂）
     diffusion      — 布朗运动强度（模拟分子扩散）
     particleLifespan — 粒子重置前的存活帧数
     trailOpacity   — 拖尾长度（值越小拖尾越长）
     hueBase        — 基础色相（青色系 180~200）
     hueRange       — 色相变化范围（随速度变化）
   ============================================================ */
(function () {
  'use strict';

  // ========== 可调参数 ==========
  const P = {
    particleCount: 180,       // 粒子数量
    noiseScale: 0.004,        // 噪声场缩放（越小流场越平滑）
    flowSpeed: 2.2,           // 粒子流动速度
    turbulence: 0.6,          // 噪声叠加权重（0=单层噪声，1=完全叠加）
    diffusion: 0.15,          // 布朗运动 / 分子扩散强度
    particleLifespan: 220,    // 粒子存活帧数，到期自动重置位置
    trailOpacity: 12,         // 拖尾渐变透明度（越小拖尾越长）
    hueBase: 195,             // 基础色相：195 = 青色（cyan）
    hueRange: 60,             // 色相随速度变化范围（快→偏向 hueBase+hueRange）
    sat: 70,                  // 饱和度
    bri: 90                   // 亮度
  };

  // ========== 内部状态 ==========
  let particles = [];          // 粒子数组
  let flowField = [];          // 矢量场网格
  let cols, rows;              // 网格列数、行数
  const scl = 20;              // 网格单元格大小（像素）
  let pg;                      // 离屏画布（用于绘制拖尾）
  let p5inst;                  // p5 实例

  // ========== 粒子类 ==========
  class Particle {
    constructor() { this.reset(); }

    // 重置粒子到随机位置（生命周期结束或初始化时调用）
    reset() {
      this.x = Math.random() * p5inst.width;
      this.y = Math.random() * p5inst.height;
      this.vx = 0;             // 水平速度
      this.vy = 0;             // 垂直速度
      this.age = Math.floor(Math.random() * P.particleLifespan * 0.5);
      this.maxAge = P.particleLifespan + Math.floor(Math.random() * 60);
      this.alpha = 255;
    }

    // 跟随矢量场：根据所在网格的向量施加力
    follow(vector) {
      this.vx += vector.x * P.flowSpeed * 0.1;
      this.vy += vector.y * P.flowSpeed * 0.1;
      // 布朗运动（随机扩散）
      this.vx += (Math.random() - 0.5) * P.diffusion;
      this.vy += (Math.random() - 0.5) * P.diffusion;
      // 阻尼（防止速度无限增长）
      this.vx *= 0.92;
      this.vy *= 0.92;
    }

    // 更新位置、生命周期和边界处理
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.age++;
      // 生命末期逐渐淡出
      const lifeRatio = this.age / this.maxAge;
      this.alpha = lifeRatio > 0.7 ? p5inst.map(lifeRatio, 0.7, 1.0, 255, 0) : 255;
      // 边缘环绕（粒子从一边出去，从另一边进来）
      if (this.x < 0) this.x += p5inst.width;
      if (this.x > p5inst.width) this.x -= p5inst.width;
      if (this.y < 0) this.y += p5inst.height;
      if (this.y > p5inst.height) this.y -= p5inst.height;
      // 生命周期结束 → 重置
      if (this.age >= this.maxAge) this.reset();
    }

    // 获取当前速度大小（用于颜色映射）
    getSpeed() {
      return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    }
  }

  // ========== 构建矢量场 ==========
  // 使用多层 Perlin 噪声生成随时间缓慢变化的流场
  function buildFlowField(t) {
    const nOff = t * 0.0003;   // 时间偏移（控制流场的演变速度）
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = x + y * cols;
        const px = x * scl;
        const py = y * scl;
        // 两层噪声叠加：主频 + 倍频
        const n1 = p5inst.noise(px * P.noiseScale + nOff, py * P.noiseScale + 123);
        const n2 = p5inst.noise(px * P.noiseScale * 2.3 + 50 + nOff * 0.7, py * P.noiseScale * 2.3 + 99);
        const n = p5inst.lerp(n1, n2, P.turbulence);
        const angle = n * p5inst.TWO_PI * 2;
        flowField[idx] = p5inst.createVector(Math.cos(angle), Math.sin(angle));
      }
    }
  }

  // ========== p5.js 草图（实例模式） ==========
  const sketch = function (p) {
    p5inst = p;

    p.setup = function () {
      const container = document.getElementById('p5bg');
      const w = container.offsetWidth || window.innerWidth;
      const h = container.offsetHeight || window.innerHeight;
      const canvas = p.createCanvas(w, h);
      canvas.parent('p5bg');
      canvas.style('pointer-events', 'none');
      canvas.style('display', 'block');

      cols = Math.floor(w / scl) + 1;
      rows = Math.floor(h / scl) + 1;
      flowField = new Array(cols * rows);

      // 离屏缓冲区：用于绘制拖尾轨迹
      pg = p.createGraphics(w, h);
      pg.background(0, 0);

      // 初始化粒子
      for (let i = 0; i < P.particleCount; i++) {
        particles.push(new Particle());
      }
    };

    p.draw = function () {
      // 更新矢量场（随时间缓慢演变）
      buildFlowField(p.frameCount);

      // 半透明遮罩：产生拖尾渐变效果
      pg.push();
      pg.noStroke();
      pg.fill(0, 0, 0, P.trailOpacity);
      pg.rect(0, 0, p.width, p.height);
      pg.pop();

      // 更新并绘制每个粒子
      for (const pt of particles) {
        // 计算粒子所在的网格索引
        const col = Math.floor(pt.x / scl);
        const row = Math.floor(pt.y / scl);
        const idx = p.constrain(col, 0, cols - 1) + p.constrain(row, 0, rows - 1) * cols;
        const v = flowField[idx];
        if (v) pt.follow(v);
        pt.update();

        // 根据速度映射颜色：慢→青色，快→琥珀色
        const speed = pt.getSpeed();
        const spdNorm = p.min(speed / 8, 1);
        const hue = P.hueBase + spdNorm * P.hueRange;
        const sat = 50 + spdNorm * 40;
        const bri = 70 + spdNorm * 30;
        const alphaVal = pt.alpha * 0.6;

        // 在离屏画布上绘制粒子点
        pg.push();
        pg.strokeWeight(1.8);
        pg.stroke(hue, sat, bri, alphaVal);
        pg.point(pt.x, pt.y);
        pg.pop();
      }

      // 将拖尾绘制到主画布（SCREEN 混合模式=发光效果）
      p.clear();
      p.push();
      p.blendMode(p.SCREEN);
      p.image(pg, 0, 0);
      p.pop();
    };

    // 窗口大小变化时重新适应
    p.windowResized = function () {
      const container = document.getElementById('p5bg');
      const w = container.offsetWidth || window.innerWidth;
      const h = container.offsetHeight || window.innerHeight;
      p.resizeCanvas(w, h);
      cols = Math.floor(w / scl) + 1;
      rows = Math.floor(h / scl) + 1;
      flowField = new Array(cols * rows);
      pg = p.createGraphics(w, h);
      pg.background(0, 0);
    };
  };

  // ========== 启动 ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      new p5(sketch, 'p5bg');
    });
  } else {
    new p5(sketch, 'p5bg');
  }
})();
