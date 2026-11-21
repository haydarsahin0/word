/* Piksel sahne: masada oturan, daktilo yazan küçük karakter.
   Tüm çizim mantıksal piksellerle yapılır, tam sayı ölçekle büyütülür. */
(function () {
  const INK = '#2b2422';
  const BG = '#a9aea6';
  const DESIGN_W = 220;
  const H = 92;
  const GROUND = 88;
  const HEAD_X = 84;
  const HEAD_Y = 44;
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mood = 'typing';
      this.moodAt = performance.now();
      this.f = 0;
      this.lines = [0];
      this.armPhase = 0;
      this.blinkUntil = 0;
      this.nextBlink = performance.now() + 2500;
      this.W = DESIGN_W;
      this.ox = 0;
      this.k = 2;
      this.pcss = 2;
      this.last = 0;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
      const parent = this.canvas.parentElement;
      const cw = parent.clientWidth || 320;
      const dpr = window.devicePixelRatio || 1;
      // bilgisayarda (fare/klavye) piksel karakter biraz daha büyük olabilir
      const maxScale = window.matchMedia && matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches ? 4 : 3;
      let target = Math.max(1.5, Math.min(maxScale, cw / 185));
      // ekran yüksekliğine sığmak için uygulama bir üst sınır verebilir
      if (this.maxCssH) target = Math.max(1.5, Math.min(target, this.maxCssH / H));
      this.k = Math.max(1, Math.round(target * dpr));
      // yükseklik sınırı varsa yukarı yuvarlama sınırı aşmasın
      if (this.maxCssH && (this.k / dpr) * H > this.maxCssH) this.k = Math.max(1, Math.floor((this.maxCssH / H) * dpr));
      this.pcss = this.k / dpr;
      this.W = Math.floor(cw / this.pcss);
      this.ox = Math.round(this.W / 2 - 100);
      this.canvas.width = this.W * this.k;
      this.canvas.height = H * this.k;
      this.canvas.style.width = this.W * this.pcss + 'px';
      this.canvas.style.height = H * this.pcss + 'px';
      this.draw();
      if (this.onResize) this.onResize();
    }

    /** Kafanın üst ortası, canvas'a göre css piksel olarak */
    headAnchor() {
      return { x: (HEAD_X + 7 + this.ox) * this.pcss, y: (HEAD_Y - 1) * this.pcss };
    }

    groundY() {
      return GROUND * this.pcss;
    }

    setMood(m) {
      if (m === this.mood) return;
      this.mood = m;
      this.moodAt = performance.now();
      this.f = 0;
    }

    loop(t) {
      if (t - this.last > 120) {
        this.last = t;
        this.f++;
        this.step(t);
        this.draw();
      }
      requestAnimationFrame((tt) => this.loop(tt));
    }

    step(t) {
      if (t > this.nextBlink) {
        this.blinkUntil = t + 140;
        this.nextBlink = t + 2200 + Math.random() * 4200;
      }
      if (this.mood === 'typing') {
        this.armPhase = Math.random() < 0.6 ? 1 - this.armPhase : this.armPhase;
        if (this.f % 2 === 0) {
          const cur = this.lines.length - 1;
          if (this.lines[cur] < 7) this.lines[cur]++;
          else if (this.lines.length < 4) this.lines.push(0);
          else this.lines = [0];
        }
      }
    }

    timeOfDay() {
      const h = new Date().getHours();
      if (h >= 20 || h < 6) return 'night';
      if (h >= 17 || h < 8) return 'dusk';
      return 'day';
    }

    /* ---------- çizim yardımcıları ---------- */
    P(x, y) { this.ctx.fillRect(x + this.ox, y, 1, 1); }
    R(x, y, w, h) { this.ctx.fillRect(x + this.ox, y, w, h); }
    C(x, y, w, h) { // temizle (arka plan rengiyle doldur)
      this.ctx.fillStyle = BG;
      this.ctx.fillRect(x + this.ox, y, w, h);
      this.ctx.fillStyle = INK;
    }
    L(x0, y0, x1, y1) {
      let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.P(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    /** Yuvarlatılmış köşeli çerçeve; içi arka planla doldurulur */
    box(x, y, w, h, round = true) {
      const r = round === true ? 1 : round || 0;
      this.C(x + (r ? 1 : 0), y + (r ? 1 : 0), w - (r ? 2 : 0), h - (r ? 2 : 0));
      this.R(x + r, y, w - 2 * r, 1);
      this.R(x + r, y + h - 1, w - 2 * r, 1);
      this.R(x, y + r, 1, h - 2 * r);
      this.R(x + w - 1, y + r, 1, h - 2 * r);
      if (r === 2) {
        this.P(x + 1, y + 1); this.P(x + w - 2, y + 1);
        this.P(x + 1, y + h - 2); this.P(x + w - 2, y + h - 2);
      }
    }
    /** Dize tabanlı küçük sprite: '#' mürekkep, 'o' temizle */
    S(x, y, rows) {
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] === '#') this.P(x + i, y + j);
          else if (row[i] === 'o') this.C(x + i, y + j, 1, 1);
        }
      });
    }

    draw() {
      const c = this.ctx;
      c.setTransform(this.k, 0, 0, this.k, 0, 0);
      c.imageSmoothingEnabled = false;
      c.fillStyle = BG;
      c.fillRect(0, 0, this.W, H);
      c.fillStyle = INK;

      const tod = this.timeOfDay();
      this.drawWindow(tod);
      this.drawShelf();
      this.drawArmchair();
      this.drawLamp(tod);
      this.drawChair();
      const pose = this.pose();
      this.drawCharacter(pose);
      this.drawDesk();
      this.drawMug();
      this.drawTypewriter(pose);
      this.drawArms(pose);
      this.drawEffects(pose);
      // zemin çizgisi
      c.fillRect(0, GROUND, this.W, 1);
    }

    pose() {
      const now = performance.now();
      const blink = now < this.blinkUntil;
      const f = this.f;
      const p = { by: 0, eyes: blink ? 'blink' : 'open', dx: 0, dy: 0, arm: 'rest', mouth: false };
      switch (this.mood) {
        case 'typing':
          p.arm = 'type'; p.dx = -1; p.dy = 1;
          break;
        case 'thinking':
          p.arm = 'chin'; p.dx = 1; p.dy = -1;
          break;
        case 'window':
          p.dx = 2; p.dy = 0;
          break;
        case 'talking':
          p.mouth = f % 2 === 0;
          break;
        case 'happy':
          p.by = f % 2 === 0 ? -1 : 0; p.eyes = 'happy'; p.arm = 'up';
          break;
        case 'sad':
          p.eyes = blink ? 'blink' : 'sad'; p.dy = 1; p.by = 1;
          break;
        case 'sleep':
          p.eyes = 'closed'; p.by = 1; p.dy = 1;
          break;
        case 'waiting':
        case 'listening':
        default:
          break;
      }
      return p;
    }

    drawCharacter(p) {
      const hx = HEAD_X, hy = HEAD_Y + p.by;
      // gövde (hafif kambur sırt)
      const top = hy + 12;
      for (let y = top; y <= 76; y++) {
        const back = y < top + 2 ? 95 + (y - top) : y > 70 ? 96 : 97;
        const front = y < top + 2 ? 87 - (y - top) : 86;
        this.C(front + 1, y, back - front - 1, 1);
        this.P(front, y);
        this.P(back, y);
      }
      // bacaklar (sola, masanın altına)
      this.C(78, 76, 18, 4);
      this.R(79, 76, 8, 1);
      this.R(79, 79, 17, 1);
      this.R(78, 77, 1, 9);
      this.R(81, 80, 1, 6);
      this.R(75, 86, 7, 1);
      this.R(75, 87, 7, 1);
      this.R(75, 85, 1, 1);
      this.R(76, 85, 2, 1);
      this.C(79, 80, 2, 6);
      // kafa
      this.box(hx, hy, 15, 13, 2);
      const ex1 = hx + 4 + p.dx, ex2 = hx + 10 + p.dx, ey = hy + 4 + p.dy;
      switch (p.eyes) {
        case 'open':
          this.R(ex1, ey, 1, 3); this.R(ex2, ey, 1, 3); break;
        case 'blink':
        case 'closed':
          this.R(ex1 - 1, ey + 2, 2, 1); this.R(ex2, ey + 2, 2, 1); break;
        case 'happy':
          this.P(ex1 - 1, ey + 2); this.P(ex1, ey + 1); this.P(ex1 + 1, ey + 2);
          this.P(ex2 - 1, ey + 2); this.P(ex2, ey + 1); this.P(ex2 + 1, ey + 2);
          break;
        case 'sad':
          this.R(ex1, ey + 1, 1, 2); this.R(ex2, ey + 1, 1, 2);
          this.P(ex1 - 1, ey - 1); this.P(ex2 + 1, ey - 1);
          break;
      }
      if (p.mouth) this.R(hx + 6 + p.dx, hy + 9, 3, 1 + (this.f % 2));
      if (p.eyes === 'happy') { this.R(hx + 6, hy + 9, 3, 1); this.P(hx + 5, hy + 8); this.P(hx + 9, hy + 8); }
    }

    drawArms(p) {
      const by = p.by;
      const sx = 88, sy = 60 + by;
      const thick = (x0, y0, x1, y1) => { this.L(x0, y0, x1, y1); this.L(x0, y0 + 1, x1, y1 + 1); };
      switch (p.arm) {
        case 'type': {
          const a = this.armPhase;
          thick(sx, sy, 84, 65);
          thick(84, 65, 71, 64 - a);
          this.R(69, 63 - a, 2, 2);
          // arka el
          this.L(84, 66, 75, 66 - (1 - a));
          this.R(73, 65 - (1 - a), 2, 2);
          break;
        }
        case 'chin':
          thick(sx, sy, 84, 66);
          thick(84, 66, 87, 58 + by);
          this.R(86, 56 + by, 3, 2);
          break;
        case 'up':
          thick(sx, sy, 82, 53 + by);
          this.R(80, 50 + by, 2, 3);
          this.L(95, sy, 100, 53 + by);
          this.R(100, 50 + by, 2, 3);
          break;
        default: // rest: kol masaya dayalı
          thick(sx, sy, 85, 68);
          thick(85, 68, 76, 69);
          this.R(74, 68, 2, 2);
      }
    }

    drawEffects(p) {
      const f = this.f;
      const hx = HEAD_X, hy = HEAD_Y + p.by;
      if (this.mood === 'sleep') {
        const zs = [0, 7, 14];
        zs.forEach((off, i) => {
          const t = (f + off) % 21;
          const x = hx + 16 + Math.floor(t / 3) + i;
          const y = hy + 2 - t;
          const s = 4 + (t > 9 ? 1 : 0);
          if (y < 4) return;
          this.R(x, y, s, 1); this.R(x, y + s - 1, s, 1);
          for (let j = 1; j < s - 1; j++) this.P(x + s - 1 - j, y + j);
        });
      }
      if (this.mood === 'thinking') {
        const n = Math.floor(f / 4) % 4;
        if (n >= 1) this.R(hx + 15, hy - 2, 2, 2);
        if (n >= 2) this.box(hx + 18, hy - 7, 3, 3, false);
        if (n >= 3) { this.box(hx + 22, hy - 15, 9, 6); this.P(hx + 24, hy - 12); this.P(hx + 26, hy - 12); this.P(hx + 28, hy - 12); }
      }
      if (this.mood === 'happy') {
        const sp = [[hx - 6, hy - 2], [hx + 18, hy - 4], [hx + 20, hy + 6]];
        sp.forEach(([x, y], i) => {
          if ((f + i) % 3 === 0) return;
          this.P(x, y - 1); this.P(x, y + 1); this.P(x - 1, y); this.P(x + 1, y);
          if ((f + i) % 3 === 1) this.P(x, y);
        });
      }
      if (this.mood === 'sad') {
        const y = hy + 1 + (f % 6 > 2 ? 1 : 0);
        this.P(hx + 15, y); this.R(hx + 14, y + 1, 3, 2); this.P(hx + 15, y + 3);
      }
    }

    drawChair() {
      this.R(99, 58, 1, 30);
      this.R(101, 60, 1, 18);
      this.R(100, 58, 1, 1);
      this.R(85, 77, 16, 1);
      this.R(86, 80, 15, 1);
      this.R(88, 81, 1, 7);
      this.R(101, 78, 1, 10);
    }

    drawDesk() {
      this.box(42, 71, 36, 3, false);
      this.box(44, 74, 3, 14, false);
      this.box(73, 74, 3, 14, false);
      this.R(47, 82, 26, 1);
    }

    drawMug() {
      // kahve kupası + buhar
      this.box(45, 65, 5, 6, false);
      this.R(50, 66, 1, 1); this.R(51, 67, 1, 2); this.R(50, 69, 1, 1);
      const f = this.f;
      if (this.mood !== 'sleep') {
        const s = f % 6;
        this.P(46 + (s > 2 ? 1 : 0), 62 - (s % 3));
        this.P(48 - (s > 2 ? 1 : 0), 60 - (s % 3));
      }
    }

    drawTypewriter() {
      const cur = this.lines.length - 1;
      const shift = this.mood === 'typing' ? -Math.floor(this.lines[cur] / 3) : 0;
      // gövde
      this.R(53, 69, 19, 2);
      this.R(54, 67, 17, 2);
      this.R(56, 66, 13, 1);
      // tuşlar
      this.C(56, 68, 13, 1);
      for (let x = 56; x < 69; x += 2) this.P(x, 68);
      // silindir + kağıt
      const px = 57 + shift;
      this.box(px - 2, 63, 15, 3, false);
      this.P(px - 3, 64); this.P(px + 13, 64);
      this.box(px, 53, 11, 11, false);
      this.C(px + 1, 63, 9, 1);
      this.R(px, 63, 1, 1); this.R(px + 10, 63, 1, 1);
      this.lines.forEach((len, i) => { if (len) this.R(px + 2, 55 + i * 2, len, 1); });
      // kağıdın kıvrık ucu
      this.P(px + 10, 52); this.P(px + 11, 51);
    }

    drawLamp(tod) {
      // taban
      this.R(26, 87, 11, 1);
      this.R(27, 86, 9, 1);
      this.R(29, 85, 5, 1);
      // gövde
      this.L(31, 85, 30, 78);
      this.L(30, 78, 29, 70);
      this.L(29, 70, 30, 62);
      this.L(30, 62, 33, 55);
      // abajur
      this.S(31, 47, [
        '..##......',
        '.#oo##....',
        '#oooo##...',
        '#oooooo#..',
        '.#ooooo##.',
        '..#ooo####',
        '...#o####.',
        '....###...',
      ]);
      if (tod !== 'day') {
        // ışık (seyrek desen)
        for (let y = 59; y < 71; y++) {
          for (let x = 38; x < 60; x++) {
            const inside = (x - 38) > (y - 59) * 0.4 && (x - 41) < (y - 58) * 1.4;
            if (inside && (x + y * 3) % 7 === 0 && y % 2 === 0) this.P(x, y);
          }
        }
      }
    }

    drawWindow(tod) {
      const x0 = 116, x1 = 141, top = 28, bottom = 64;
      const r = (x1 - x0) / 2;
      const cx = x0 + r, cy = top + r;
      const inside = (x, y) => {
        if (x <= x0 || x >= x1 || y >= bottom || y <= top) return false;
        if (y >= cy) return true;
        const d = Math.hypot(x - cx, y - cy);
        return d < r - 0.6;
      };
      // gökyüzü deseni
      for (let y = top; y < bottom; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!inside(x, y)) continue;
          const t = (y - top) / (bottom - top);
          let d;
          if (tod === 'night') d = 0.85 - t * 0.75;
          else if (tod === 'dusk') d = 0.55 - t * 0.6;
          else d = 0.18 - t * 0.35;
          if (BAYER[y & 3][x & 3] / 16 < d) this.P(x, y);
        }
      }
      if (tod === 'night') {
        // ay ve yıldızlar
        this.C(132, 34, 4, 4); this.C(131, 35, 6, 2);
        [[122, 40], [127, 36], [137, 44], [124, 47]].forEach(([x, y]) => this.C(x, y, 1, 1));
      } else if (tod === 'day') {
        this.box(131, 36, 5, 5);
      }
      // ağaçlar ve tepe
      const tree = (x, y, h) => {
        for (let i = 0; i < h; i++) {
          const w = Math.floor(i / 2) + 1;
          this.R(x - w + 1, y + i, w * 2 - 1, 1);
        }
        this.R(x, y + h, 1, 2);
      };
      tree(122, 50, 10);
      tree(132, 54, 7);
      for (let x = x0 + 1; x < x1; x++) {
        const hh = 60 + Math.round(Math.sin((x - x0) / 5) * 1.2);
        for (let y = hh; y < bottom; y++) this.P(x, y);
      }
      // çerçeve
      for (let a = Math.PI; a <= 2 * Math.PI + 0.001; a += 0.02) {
        this.P(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
      }
      this.R(x0, cy, 1, bottom - cy);
      this.R(x1, cy, 1, bottom - cy);
      this.R(x0, bottom, x1 - x0 + 1, 1);
      this.R(x0 - 2, bottom + 1, x1 - x0 + 5, 1);
    }

    drawShelf() {
      const x = 192, y = 34, w = 24, h = 54;
      this.box(x, y, w, h, false);
      const shelves = [46, 58, 70];
      shelves.forEach((sy) => this.R(x, sy, w, 1));
      const books = [
        [y + 1, [[2, 9, 0], [2, 10, 1], [3, 8, 0], [2, 10, 0], [4, 6, 2], [3, 9, 1]]],
        [46 + 1, [[3, 10, 0], [2, 8, 1], [2, 10, 0], [6, 6, 3], [2, 9, 0]]],
        [58 + 1, [[2, 10, 1], [3, 9, 0], [2, 10, 0], [2, 7, 0], [5, 10, 3]]],
      ];
      books.forEach(([base, list]) => {
        let bx = x + 2;
        const floor = base + 11;
        list.forEach(([bw, bh, type]) => {
          if (bx + bw > x + w - 1) return;
          const ty = floor - bh;
          if (type === 1) this.R(bx, ty, bw, bh);
          else if (type === 2) { this.R(bx, floor - 2, bw + 3, 2); this.R(bx, floor - 4, bw + 2, 1); }
          else if (type === 3) {
            for (let yy = ty; yy < floor; yy++) for (let xx = bx; xx < bx + bw; xx++) if ((xx + yy) % 2 === 0) this.P(xx, yy);
          } else this.box(bx, ty, bw + 1, bh, false);
          bx += bw + 1;
        });
      });
      // alt dolap kapağı
      this.R(x + w / 2, 71, 1, 16);
      this.R(x + w / 2 - 3, 78, 2, 1);
      this.R(x + w / 2 + 2, 78, 2, 1);
    }

    drawArmchair() {
      // sırt
      this.box(176, 62, 14, 26);
      // oturak
      this.box(160, 74, 26, 7);
      // kolçak
      this.box(156, 70, 8, 12);
      this.R(158, 72, 4, 1);
      // ön panel
      this.box(158, 80, 30, 6, false);
      // ayaklar
      this.R(160, 86, 2, 2);
      this.R(184, 86, 2, 2);
      // yastık
      this.box(167, 70, 10, 5);
    }
  }

  window.Scene = Scene;
})();
