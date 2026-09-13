const W = 480;
const H = 720;
const GROUND_H = 118;
const BIRD_SIZE = 74;
const BIRD_X = 128;
const PIPE_W = 82;
const PIPE_GAP = 228;
const PIPE_SPACING = 248;
const GRAVITY = 1680;
const FLAP_V = -430;
const MAX_FALL = 780;
const SCROLL = 168;
const HIT_R = BIRD_SIZE * 0.34;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Missing asset ${src}`));
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function circleRect(cx, cy, r, x, y, w, h) {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export class FlappyDude {
  constructor(canvas, webcam) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.webcam = webcam;
    this.state = "title";
    this.assets = {};
    this.pipeCapRatio = 0.18;
    this.best = Number(localStorage.getItem("flappyDudeBest") || 0);
    this.reset();
    this._sounds = null;
    this.onGameOver = null;
    this.flash = 0;
    this.shake = 0;
  }

  async load() {
    const [pipe, wing, beak, cloud, ground, hills, meta] = await Promise.all([
      loadImage("/assets/pipe.png"),
      loadImage("/assets/wing.png"),
      loadImage("/assets/beak.png"),
      loadImage("/assets/cloud.png"),
      loadImage("/assets/ground.png"),
      loadImage("/assets/hills.png"),
      fetch("/assets/meta.json")
        .then((r) => r.json())
        .catch(() => ({ pipeCapRatio: 0.18 })),
    ]);
    this.assets = { pipe, wing, beak, cloud, ground, hills };
    this.pipeCapRatio = meta.pipeCapRatio || 0.18;
    this.clouds = [
      { x: 40, y: 70, s: 0.7, v: 18 },
      { x: 260, y: 130, s: 0.9, v: 26 },
      { x: 420, y: 50, s: 0.55, v: 14 },
    ];
  }

  reset() {
    this.bird = {
      x: BIRD_X,
      y: H * 0.42,
      vy: 0,
      rot: 0,
      wing: 0,
    };
    this.pipes = [];
    this.spawnX = PIPE_SPACING;
    this.score = 0;
    this.scroll = 0;
    this.hillScroll = 0;
    this.deadTimer = 0;
    this.flash = 0;
    this.shake = 0;
  }

  ready() {
    this.reset();
    this.state = "ready";
  }

  start() {
    if (this.state !== "ready") return;
    this.state = "playing";
    this.spawnPipe();
    this.spawnX = PIPE_SPACING;
    this.flap();
  }

  flap() {
    if (this.state === "ready") {
      this.start();
      return;
    }
    if (this.state !== "playing") return;
    this.bird.vy = FLAP_V;
    this.bird.wing = 1;
    this.tone(520, 0.07, "square", 0.05);
  }

  tone(freq, dur, type = "square", gain = 0.06) {
    try {
      if (!this._sounds) this._sounds = new AudioContext();
      const ctx = this._sounds;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      /* audio is optional */
    }
  }

  update(dt) {
    const face = this.webcam.update();
    this.faceSquare = face;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 8);

    const moving = this.state === "playing" || this.state === "dead";
    const scrolling = this.state === "playing";

    if (scrolling) {
      this.scroll += SCROLL * dt;
      this.hillScroll += SCROLL * 0.28 * dt;
      this.spawnX -= SCROLL * dt;
      if (this.spawnX <= 0) {
        this.spawnPipe();
        this.spawnX = PIPE_SPACING;
      }
      for (const pipe of this.pipes) pipe.x -= SCROLL * dt;
      this.pipes = this.pipes.filter((p) => p.x > -PIPE_W - 10);
    }

    for (const cloud of this.clouds) {
      cloud.x -= cloud.v * dt * (scrolling ? 1 : 0.25);
      if (cloud.x < -180) cloud.x = W + rand(20, 120);
    }

    if (this.state === "ready" || this.state === "title") {
      this.bird.y = H * 0.42 + Math.sin(performance.now() / 260) * 9;
      this.bird.vy = 0;
      this.bird.rot = 0;
      this.bird.wing = (Math.sin(performance.now() / 120) + 1) / 2;
    }

    if (this.state === "playing" || this.state === "dead") {
      this.bird.vy = Math.min(MAX_FALL, this.bird.vy + GRAVITY * dt);
      this.bird.y += this.bird.vy * dt;
      this.bird.rot = clamp(this.bird.vy / 700, -0.55, 1.15);
      this.bird.wing = Math.max(0, this.bird.wing - dt * 3.2);
    }

    if (this.bird.y < -BIRD_SIZE * 0.45) {
      this.bird.y = -BIRD_SIZE * 0.45;
      this.bird.vy = Math.max(this.bird.vy, 0);
    }

    if (this.state === "playing") {
      this._scorePipes();
      if (this._hit()) this.die();
    }

    if (this.state === "dead") {
      this.deadTimer += dt;
      const floor = H - GROUND_H - BIRD_SIZE * 0.42;
      if (this.bird.y > floor) {
        this.bird.y = floor;
        this.bird.vy = 0;
      }
    }
  }

  spawnPipe() {
    const margin = 90;
    const minY = margin + PIPE_GAP / 2;
    const maxY = H - GROUND_H - margin - PIPE_GAP / 2;
    this.pipes.push({
      x: W + 10,
      gapY: rand(minY, maxY),
      scored: false,
    });
  }

  _scorePipes() {
    for (const pipe of this.pipes) {
      if (!pipe.scored && pipe.x + PIPE_W < this.bird.x) {
        pipe.scored = true;
        this.score += 1;
        this.tone(880, 0.08, "square", 0.05);
        setTimeout(() => this.tone(1180, 0.1, "square", 0.05), 70);
      }
    }
  }

  _hit() {
    const b = this.bird;
    const floor = H - GROUND_H;
    if (b.y + HIT_R >= floor) return true;
    for (const pipe of this.pipes) {
      const topH = pipe.gapY - PIPE_GAP / 2;
      const botY = pipe.gapY + PIPE_GAP / 2;
      if (circleRect(b.x, b.y, HIT_R, pipe.x, 0, PIPE_W, topH)) return true;
      if (circleRect(b.x, b.y, HIT_R, pipe.x, botY, PIPE_W, H - GROUND_H - botY)) return true;
    }
    return false;
  }

  die() {
    this.state = "dead";
    this.flash = 0.7;
    this.shake = 1;
    this.tone(140, 0.28, "sawtooth", 0.08);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem("flappyDudeBest", String(this.best));
    }
    if (this.onGameOver) this.onGameOver(this.score);
  }

  draw() {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) {
      this.canvas.width = W * dpr;
      this.canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.save();
    if (this.shake) {
      ctx.translate((Math.random() - 0.5) * 8 * this.shake, (Math.random() - 0.5) * 8 * this.shake);
    }

    this._drawSky(ctx);
    this._drawHills(ctx);
    this._drawClouds(ctx);
    for (const pipe of this.pipes) this._drawPipePair(ctx, pipe);
    this._drawBird(ctx);
    this._drawGround(ctx);
    if (this.state === "playing" || this.state === "dead") this._drawScore(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  _drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#7ed7e0");
    g.addColorStop(1, "#b8ecf0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _drawHills(ctx) {
    const img = this.assets.hills;
    if (!img) return;
    const drawH = 280;
    const drawW = img.width * (drawH / img.height);
    const y = H - GROUND_H - drawH + 36;
    let x = -((this.hillScroll * 0.5) % drawW);
    while (x < W) {
      ctx.drawImage(img, x, y, drawW, drawH);
      x += drawW;
    }
  }

  _drawClouds(ctx) {
    const img = this.assets.cloud;
    if (!img) return;
    for (const cloud of this.clouds) {
      const w = 170 * cloud.s;
      const h = (img.height / img.width) * w;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(img, cloud.x, cloud.y, w, h);
      ctx.globalAlpha = 1;
    }
  }

  _drawPipePair(ctx, pipe) {
    const topH = pipe.gapY - PIPE_GAP / 2;
    const botY = pipe.gapY + PIPE_GAP / 2;
    const botH = H - GROUND_H - botY;
    this._drawPipe(ctx, pipe.x, 0, PIPE_W, topH, false);
    this._drawPipe(ctx, pipe.x, botY, PIPE_W, botH, true);
  }

  _drawPipe(ctx, x, y, w, h, capOnTop) {
    const img = this.assets.pipe;
    if (!img || h <= 0) return;
    const capRatio = this.pipeCapRatio;
    const capSrc = Math.max(8, img.height * capRatio);
    const shaftSrcY = Math.min(img.height - 6, Math.floor(img.height * 0.55));
    const capH = Math.min(h, w * 0.32);

    ctx.save();
    if (!capOnTop) {
      ctx.translate(x + w / 2, y + h);
      ctx.scale(1, -1);
      ctx.translate(-w / 2, 0);
    } else {
      ctx.translate(x, y);
    }

    ctx.fillStyle = "#2e9d86";
    ctx.fillRect(w * 0.08, capH - 2, w * 0.84, Math.max(0, h - capH + 2));
    ctx.drawImage(img, 0, shaftSrcY, img.width, 5, w * 0.07, capH - 1, w * 0.86, Math.max(1, h - capH + 1));
    ctx.drawImage(img, 0, 0, img.width, capSrc, 0, 0, w, capH);
    ctx.restore();
  }

  _drawBird(ctx) {
    const { x, y, rot, wing } = this.bird;
    const s = BIRD_SIZE;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    const wingImg = this.assets.wing;
    if (wingImg) {
      ctx.save();
      ctx.translate(-s * 0.38, s * 0.04);
      ctx.rotate(-0.55 + wing * 0.9);
      ctx.scale(-1, 1);
      ctx.drawImage(wingImg, -s * 0.15, -s * 0.38, s * 0.78, s * 0.78);
      ctx.restore();
    }

    const box = s;
    const rad = 16;
    roundRect(ctx, -box / 2 - 5, -box / 2 - 5, box + 10, box + 10, rad + 4);
    ctx.fillStyle = "#f0c43a";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#2b1d12";
    ctx.stroke();

    ctx.save();
    roundRect(ctx, -box / 2, -box / 2, box, box, rad);
    ctx.clip();
    if (this.faceSquare) {
      ctx.drawImage(this.faceSquare, -box / 2, -box / 2, box, box);
    } else {
      ctx.fillStyle = "#222";
      ctx.fillRect(-box / 2, -box / 2, box, box);
    }
    ctx.restore();

    roundRect(ctx, -box / 2, -box / 2, box, box, rad);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#2b1d12";
    ctx.stroke();

    ctx.fillStyle = "#f0c43a";
    ctx.strokeStyle = "#2b1d12";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, -box / 2 - 4);
    ctx.quadraticCurveTo(-2, -box / 2 - 22, 10, -box / 2 - 8);
    ctx.quadraticCurveTo(2, -box / 2 - 10, 4, -box / 2 - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const beak = this.assets.beak;
    if (beak) {
      ctx.drawImage(beak, s * 0.28, -s * 0.2, s * 0.62, s * 0.5);
    }

    ctx.restore();
  }

  _drawGround(ctx) {
    const img = this.assets.ground;
    const y = H - GROUND_H;
    if (img) {
      const drawH = GROUND_H + 8;
      const drawW = img.width * (drawH / img.height);
      let x = -(this.scroll % drawW);
      while (x < W) {
        ctx.drawImage(img, x, y - 6, drawW, drawH);
        x += drawW - 1;
      }
    } else {
      ctx.fillStyle = "#c27a3a";
      ctx.fillRect(0, y, W, GROUND_H);
    }
    ctx.fillStyle = "rgba(42,28,18,0.35)";
    ctx.fillRect(0, y - 4, W, 4);
  }

  _drawScore(ctx) {
    ctx.font = '700 42px "Bungee", system-ui';
    ctx.textAlign = "center";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#2b1d12";
    ctx.fillStyle = "#fff6df";
    ctx.strokeText(String(this.score), W / 2, 74);
    ctx.fillText(String(this.score), W / 2, 74);
  }
}
