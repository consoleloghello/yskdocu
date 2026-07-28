/* ============================================================
   合成流 (Synthetic Flux) — 科幻风格流场粒子系统
   ─────────────────────────────────────────────
   入口遮罩 (entry overlay) 的背景动画。
   粒子在多层噪声 + 正弦调制的矢量场中漂移，
   以霓虹赛博色调（青蓝·品红·粉紫）发光，
   模拟数据包在神经网络拓扑中的流动。
   ============================================================
   可调参数说明（参见下方 P 对象）：
     particleCount  — 粒子数量（越多越密集，性能消耗越大）
     noiseScale     — 噪声场缩放（越小流场变化越平缓）
     flowSpeed      — 粒子跟随流场的速度
     turbulence     — 噪声叠加程度（0~1，越高流场越复杂）
     trailOpacity   — 拖尾渐变透明度（值越小拖尾越长）
     burstRate      — 数据突发频率（0~0.04，0 关闭突发）
     hueCyan        — 数据包色相偏移（青蓝基调）
     hueMagenta     — 信号色相偏移（品红基调）
     sat            — 饱和度
     bri            — 亮度
   ============================================================ */
(function () {
  'use strict';

  // ========== 可调参数 ==========
  var P = {
    particleCount: 50,        // 粒子数量
    noiseScale: 0.003,        // 噪声场缩放
    flowSpeed: 1.8,           // 粒子流动速度
    turbulence: 0.55,         // 噪声叠加权重
    trailOpacity: 14,         // 拖尾渐变透明度
    burstRate: 0.01,          // 数据突发频率
    hueCyan: 195,             // 数据包色相
    hueMagenta: 305,          // 信号色相
    sat: 88,                  // 饱和度
    bri: 92                   // 亮度
  };

  // ========== 内部状态 ==========
  var particles = [];
  var flowField = [];
  var cols, rows;
  var scl = 18;
  var pg;
  var p5inst;

  // ========== 粒子类 ==========
  var Particle = function () {
    this.reset = function () {
      this.x = Math.random() * p5inst.width;
      this.y = Math.random() * p5inst.height;
      this.prevX = this.x;
      this.prevY = this.y;
      this.vx = 0;
      this.vy = 0;
      this.age = 0;
      this.maxAge = 280 + Math.floor(Math.random() * 180);
      this.bursting = false;
      this.alpha = 255;
    };
    this.reset();

    // 数据包类型：0=普通数据包(55%) 1=优先级信号(30%) 2=故障码(15%)
    var roll = Math.floor(Math.random() * 100);
    if (roll < 55) this.type = 0;
    else if (roll < 85) this.type = 1;
    else this.type = 2;
    this.glitchTimer = Math.floor(Math.random() * 60) + 20;
  };

  Particle.prototype.follow = function (v) {
    var spd = P.flowSpeed * 0.1;
    this.vx += v.x * spd;
    this.vy += v.y * spd;

    // 类型特异性行为
    if (this.type === 1) {
      this.vx += v.x * spd * 0.6;
      this.vy += v.y * spd * 0.6;
    } else if (this.type === 2) {
      this.glitchTimer--;
      if (this.glitchTimer <= 0) {
        this.vx += (Math.random() - 0.5) * 3.0;
        this.vy += (Math.random() - 0.5) * 3.0;
        this.glitchTimer = Math.floor(Math.random() * 42) + 8;
      }
    }

    this.vx *= 0.90;
    this.vy *= 0.90;

    if (this.bursting) {
      this.burstTimer--;
      if (this.burstTimer <= 0) this.bursting = false;
    }
  };

  Particle.prototype.triggerBurst = function () {
    if (!this.bursting) {
      this.bursting = true;
      this.burstTimer = Math.floor(Math.random() * 18) + 8;
      var angle = Math.atan2(this.vy, this.vx) + (Math.random() - 0.5) * 0.8;
      var force = 4 + Math.random() * 6;
      this.vx += Math.cos(angle) * force;
      this.vy += Math.sin(angle) * force;
    }
  };

  Particle.prototype.update = function () {
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vx;
    this.y += this.vy;
    this.age++;

    var lifeRatio = this.age / this.maxAge;
    this.alpha = lifeRatio > 0.7 ? p5inst.map(lifeRatio, 0.7, 1.0, 255, 0) : 255;

    if (this.x < 0) { this.x += p5inst.width; this.prevX = this.x; }
    if (this.x > p5inst.width) { this.x -= p5inst.width; this.prevX = this.x; }
    if (this.y < 0) { this.y += p5inst.height; this.prevY = this.y; }
    if (this.y > p5inst.height) { this.y -= p5inst.height; this.prevY = this.y; }

    if (this.age >= this.maxAge) this.reset();
  };

  Particle.prototype.getSpeed = function () {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  };

  Particle.prototype.getHue = function () {
    var speed = this.getSpeed();
    var spdNorm = Math.min(speed / 8, 1);
    if (this.type === 0) {
      return P.hueCyan + spdNorm * 20;
    } else if (this.type === 1) {
      return P.hueMagenta - spdNorm * 30;
    } else {
      var osc = Math.sin(this.age * 0.05) * 0.5 + 0.5;
      return p5inst.lerp(P.hueCyan, P.hueMagenta, osc);
    }
  };

  Particle.prototype.getLineWidth = function () {
    var spd = this.getSpeed();
    if (this.bursting) return p5inst.map(spd, 0, 12, 1.0, 3.5);
    if (this.type === 1) return 1.4;
    if (this.type === 2) return 0.8 + Math.random() * 0.6;
    return 1.0;
  };

  Particle.prototype.getAlpha = function () {
    var base = this.alpha * 0.65;
    if (this.bursting) return p5inst.constrain(base * 2, 0, 255);
    if (this.type === 1) return base * 1.2;
    return base;
  };

  // ========== 构建矢量场 ==========
  // 三层 Perlin 噪声 + 正弦波调制 = 科技感流路
  function buildFlowField(t) {
    var nOff = t * 0.00025;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var idx = x + y * cols;
        var px = x * scl;
        var py = y * scl;

        var n1 = p5inst.noise(px * P.noiseScale + nOff, py * P.noiseScale + 100);
        var n2 = p5inst.noise(px * P.noiseScale * 2.3 + 50 + nOff * 0.65, py * P.noiseScale * 2.3 + 200);
        var n3 = p5inst.noise(px * P.noiseScale * 5.1 + 300 + nOff * 0.4, py * P.noiseScale * 5.1 + 400);

        var n = p5inst.lerp(n1, n2, P.turbulence);
        n = p5inst.lerp(n, n3, P.turbulence * 0.4);

        // 正弦调制：产生类电路板布线的结构感
        var sinMod = Math.sin(px * 0.008 + py * 0.006 + t * 0.0004) * 0.35;
        var angle = n * p5inst.TWO_PI * 2 + sinMod * p5inst.PI;

        flowField[idx] = p5inst.createVector(Math.cos(angle), Math.sin(angle));
      }
    }
  }

  // ========== 全息网格 ==========
  function drawGrid(p, t) {
    var op = 0.06;   // 网格透明度（固定，在背景中保持统一）
    var gridSize = 45;
    var pulse = Math.sin(t * 0.015) * 0.25 + 0.75;
    var baseAlpha = op * 255 * pulse;

    p.push();
    // 网格使用 RGB 颜色模式（画布默认为 HSB，此处临时覆盖）
    p.colorMode(p.RGB);
    p.noFill();

    // 网格线
    var lineAlpha = baseAlpha * 0.6;
    p.stroke(120, 160, 255, lineAlpha);
    p.strokeWeight(0.4);
    for (var x = 0; x <= p.width; x += gridSize) { p.line(x, 0, x, p.height); }
    for (var y = 0; y <= p.height; y += gridSize) { p.line(0, y, p.width, y); }

    // 交叉点节点
    var dotAlpha = baseAlpha * 0.5;
    p.fill(180, 210, 255, dotAlpha);
    p.noStroke();
    for (var x = gridSize; x < p.width; x += gridSize) {
      for (var y = gridSize; y < p.height; y += gridSize) {
        var d = 0.8 + Math.sin(x * 0.03 + y * 0.04 + t * 0.02) * 0.4;
        p.circle(x, y, d);
      }
    }

    // 中心十字高亮
    p.stroke(180, 220, 255, baseAlpha * 0.3);
    p.strokeWeight(0.6);
    p.line(p.width / 2, 0, p.width / 2, p.height);
    p.line(0, p.height / 2, p.width, p.height / 2);

    p.pop();
  }

  // ========== p5.js 草图（实例模式） ==========
  var sketch = function (p) {
    p5inst = p;

    p.setup = function () {
      var container = document.getElementById('p5bg');
      var w = container.offsetWidth || window.innerWidth;
      var h = container.offsetHeight || window.innerHeight;
      var canvas = p.createCanvas(w, h);
      canvas.parent('p5bg');
      canvas.style('pointer-events', 'none');
      canvas.style('display', 'block');

      // HSB 颜色模式（与合成流独立版一致）
      p.colorMode(p.HSB, 360, 100, 100, 255);

      cols = Math.floor(w / scl) + 1;
      rows = Math.floor(h / scl) + 1;
      flowField = new Array(cols * rows);

      // 离屏缓冲区：用于绘制拖尾轨迹
      pg = p.createGraphics(w, h);
      pg.colorMode(p.HSB, 360, 100, 100, 255);
      pg.background(0, 0, 0, 255);

      // 初始化粒子
      for (var i = 0; i < P.particleCount; i++) {
        particles.push(new Particle());
      }
    };

    p.draw = function () {
      // 更新矢量场
      buildFlowField(p.frameCount);

      // 拖尾渐变
      pg.push();
      pg.noStroke();
      pg.fill(0, 0, 0, P.trailOpacity);
      pg.rect(0, 0, p.width, p.height);
      pg.pop();

      // 更新并绘制每个粒子
      for (var i = 0; i < particles.length; i++) {
        var pt = particles[i];
        var col = Math.floor(pt.x / scl);
        var row = Math.floor(pt.y / scl);
        var idx = p.constrain(col, 0, cols - 1) + p.constrain(row, 0, rows - 1) * cols;
        var v = flowField[idx];
        if (v) pt.follow(v);
        pt.update();

        // 根据速度映射 HSB 颜色
        var speed = pt.getSpeed();
        var spdNorm = Math.min(speed / 7, 1);
        var hue = pt.getHue();
        var sat = P.sat - (1 - spdNorm) * 15;
        var bri = P.bri - (1 - spdNorm) * 25;
        var alphaVal = pt.getAlpha();

        // 在离屏画布上绘制拖尾线段
        pg.push();
        var lw = pt.getLineWidth();
        pg.strokeWeight(lw);
        pg.stroke(hue, sat, bri, alphaVal);
        pg.line(pt.prevX, pt.prevY, pt.x, pt.y);

        // 突发粒子的辉光光晕
        if (pt.bursting) {
          pg.noStroke();
          pg.fill(hue, sat, 100, alphaVal * 0.5);
          pg.circle(pt.x, pt.y, lw * 4);
        }
        pg.pop();

        // 随机触发数据突发
        if (P.burstRate > 0 && pt.type > 0 && Math.random() < P.burstRate * 0.3) {
          pt.triggerBurst();
        }
      }

      // 渲染主画布
      p.background(0, 0, 3, 255);   // 极深色背景
      p.push();
      p.blendMode(p.SCREEN);
      p.image(pg, 0, 0);
      p.pop();

      // 环境光晕
      p.push();
      p.noStroke();
      var ambientGlow = Math.sin(p.frameCount * 0.008) * 0.02 + 0.03;
      var grd = p.drawingContext.createRadialGradient(
        p.width / 2, p.height / 2, 0,
        p.width / 2, p.height / 2, p.width * 0.6
      );
      grd.addColorStop(0, 'rgba(50, 60, 120, ' + ambientGlow + ')');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      p.drawingContext.fillStyle = grd;
      p.rect(0, 0, p.width, p.height);
      p.pop();

      // 全息网格
      drawGrid(p, p.frameCount);
    };

    // 窗口大小变化时重新适应
    p.windowResized = function () {
      var container = document.getElementById('p5bg');
      var w = container.offsetWidth || window.innerWidth;
      var h = container.offsetHeight || window.innerHeight;
      p.resizeCanvas(w, h);
      cols = Math.floor(w / scl) + 1;
      rows = Math.floor(h / scl) + 1;
      flowField = new Array(cols * rows);
      pg = p.createGraphics(w, h);
      pg.colorMode(p.HSB, 360, 100, 100, 255);
      pg.background(0, 0, 0, 255);
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
