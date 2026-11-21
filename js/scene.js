/* Piksel sahne: masada oturan, daktilo yazan küçük karakter.
   Tüm çizim mantıksal piksellerle yapılır, tam sayı ölçekle büyütülür.
   Renkler: INK (çizgi), MID (gölge/doku), LT (ışık), BG (zemin). */
(function () {
  const INK = '#2b2422';
  const MID = '#6f6c66';
  const LT = '#c4c8bf';
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
  const CALM = ['typing', 'waiting', 'listening', 'window', 'talking', 'reading', 'thinking'];

  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mood = 'typing';
      this.moodAt = performance.now();
      this.f = 0;   // ruh hâli başladığından beri kare
      this.t = 0;   // toplam kare
      this.lines = [0];
      this.armPhase = 0;
      this.key = -1;
      this.ding = 0;
      this.blinkUntil = 0;
      this.nextBlink = performance.now() + 2500;
      this.parts = [];
      this.bird = null;
      this.catTail = 0;
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
      return { x: (HEAD_X + 7 + this.ox) * this.pcss, y: (HEAD_Y - 2) * this.pcss };
    }

    groundY() {
      return GROUND * this.pcss;
    }

    setMood(m) {
      if (m === this.mood) return;
      this.mood = m;
      this.moodAt = performance.now();
      this.f = 0;
      if (m === 'happy') this.confetti();
    }

    confetti() {
      for (let i = 0; i < 16; i++) {
        this.parts.push({
          x: HEAD_X + 7 + (Math.random() * 30 - 15), y: HEAD_Y - 4 - Math.random() * 6,
          vx: Math.random() * 1.6 - 0.8, vy: -1.2 - Math.random() * 1.2,
          life: 14 + Math.floor(Math.random() * 10), c: Math.random() < 0.5 ? INK : MID,
        });
      }
    }

    loop(t) {
      if (t - this.last > 110) {
        this.last = t;
        this.f++;
        this.t++;
        this.step(t);
        this.draw();
      }
      requestAnimationFrame((tt) => this.loop(tt));
    }

    step(t) {
      if (t > this.nextBlink) {
        this.blinkUntil = t + 130;
        this.nextBlink = t + 2200 + Math.random() * 4200;
      }
      if (this.mood === 'typing') {
        this.armPhase = Math.random() < 0.6 ? 1 - this.armPhase : this.armPhase;
        this.key = Math.floor(Math.random() * 7);
        if (this.f % 2 === 0) {
          const cur = this.lines.length - 1;
          if (this.lines[cur] < 7) this.lines[cur]++;
          else {
            this.ding = 5; // satır sonu: "ding"
            if (this.lines.length < 4) this.lines.push(0);
            else this.lines = [0];
          }
        }
      } else this.key = -1;
      if (this.ding > 0) this.ding--;
      // konfeti
      this.parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life--; });
      this.parts = this.parts.filter((p) => p.life > 0 && p.y < GROUND);
      // pencerede kuş (gündüz)
      if (!this.bird && this.timeOfDay() !== 'night' && Math.random() < 0.012) this.bird = { x: 116, y: 34 + Math.floor(Math.random() * 12) };
      if (this.bird) { this.bird.x += 1; this.bird.y += (this.t % 4 === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0); if (this.bird.x > 142) this.bird = null; }
      // kedinin kuyruğu ara ara sallanır
      if (Math.random() < 0.03) this.catTail = 8;
      if (this.catTail > 0) this.catTail--;
    }

    timeOfDay() {
      const h = new Date().getHours();
      if (h >= 20 || h < 6) return 'night';
      if (h >= 17 || h < 8) return 'dusk';
      return 'day';
    }

    /* ---------- çizim yardımcıları ---------- */
    col(c) { this.ctx.fillStyle = c; }
    P(x, y) { this.ctx.fillRect(x + this.ox, y, 1, 1); }
    R(x, y, w, h) { this.ctx.fillRect(x + this.ox, y, w, h); }
    /** renkli dikdörtgen (sonra mürekkebe döner) */
    F(x, y, w, h, c) { this.col(c); this.R(x, y, w, h); this.col(INK); }
    /** dama deseniyle gölge */
    D(x, y, w, h, c = MID, phase = 0) {
      this.col(c);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((x + i + y + j + phase) % 2 === 0) this.P(x + i, y + j);
      this.col(INK);
    }
    C(x, y, w, h) { this.F(x, y, w, h, BG); }
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
    /** Yuvarlatılmış köşeli çerçeve; içi verilen renkle (varsayılan zemin) doldurulur */
    box(x, y, w, h, round = true, fill = BG) {
      const r = round === true ? 1 : round || 0;
      this.F(x + (r ? 1 : 0), y + (r ? 1 : 0), w - (r ? 2 : 0), h - (r ? 2 : 0), fill);
      this.R(x + r, y, w - 2 * r, 1);
      this.R(x + r, y + h - 1, w - 2 * r, 1);
      this.R(x, y + r, 1, h - 2 * r);
      this.R(x + w - 1, y + r, 1, h - 2 * r);
      if (r === 2) {
        this.P(x + 1, y + 1); this.P(x + w - 2, y + 1);
        this.P(x + 1, y + h - 2); this.P(x + w - 2, y + h - 2);
      }
    }
    /** Dize tabanlı küçük sprite: '#' mürekkep, 'm' gölge, 'l' ışık, 'o' zemin */
    S(x, y, rows) {
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const ch = row[i];
          if (ch === '#') this.P(x + i, y + j);
          else if (ch === 'm') this.F(x + i, y + j, 1, 1, MID);
          else if (ch === 'l') this.F(x + i, y + j, 1, 1, LT);
          else if (ch === 'o') this.C(x + i, y + j, 1, 1);
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
      this.drawClock();
      this.drawWindow(tod);
      this.drawShelf();
      this.drawArmchair();
      this.drawCat();
      this.drawFloorShadow();
      this.drawLamp(tod);
      this.drawChair();
      const pose = this.pose();
      this.drawCharacter(pose);
      this.drawDesk();
      if (!pose.mugInHand) this.drawMug();
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
      const p = { by: 0, eyes: blink ? 'blink' : 'open', dx: 0, dy: 0, arm: 'rest', mouth: 'line', brow: null, cheeks: false };
      // nefes: sakin hâllerde baş ve omuzlar hafifçe iner kalkar
      if (CALM.includes(this.mood) && this.t % 28 >= 21) p.by = 1;
      switch (this.mood) {
        case 'typing':
          p.arm = 'type'; p.dx = -1; p.dy = 1; p.mouth = 'line';
          break;
        case 'thinking': {
          const scratch = Math.floor(f / 14) % 2 === 1;
          p.arm = scratch ? 'scratch' : 'chin'; p.dx = 1; p.dy = -1; p.brow = 'think'; p.mouth = 'side';
          break;
        }
        case 'window':
          p.dx = 2; p.dy = -1; p.mouth = 'smile';
          break;
        case 'reading':
          p.dx = 2; p.dy = -2; p.mouth = 'line'; p.by = Math.floor(f / 10) % 6 === 0 ? 1 : p.by;
          break;
        case 'talking':
          p.mouth = f % 2 === 0 ? 'open' : 'line'; p.arm = 'gesture'; p.cheeks = true;
          break;
        case 'waiting':
          p.mouth = 'smile'; p.cheeks = true; p.dy = -1;
          break;
        case 'listening':
          p.dx = -2; p.dy = 2; p.mouth = 'smile'; p.by = Math.floor(f / 8) % 4 === 0 ? 1 : 0;
          break;
        case 'happy':
          p.by = f % 4 < 2 ? -2 : 0; p.eyes = 'happy'; p.arm = 'up'; p.mouth = 'grin'; p.cheeks = true;
          break;
        case 'sad':
          p.eyes = blink ? 'blink' : 'sad'; p.dy = 1; p.by = 1; p.brow = 'sad'; p.mouth = 'frown';
          break;
        case 'sleep':
          p.eyes = 'closed'; p.by = 2; p.dy = 1; p.mouth = 'none';
          break;
        case 'coffee': {
          // uzan → kaldır → yudumla → bırak (döngü)
          const ph = f % 26;
          if (ph < 4) { p.arm = 'reach'; }
          else if (ph < 8) { p.arm = 'lift'; p.mugInHand = true; p.lift = (ph - 4) / 3; }
          else if (ph < 18) { p.arm = 'sip'; p.mugInHand = true; p.eyes = 'closed'; p.cheeks = true; p.mouth = 'none'; }
          else if (ph < 22) { p.arm = 'lift'; p.mugInHand = true; p.lift = 1 - (ph - 18) / 3; }
          else { p.arm = 'reach'; }
          break;
        }
        case 'stretch': {
          const ph = f % 22;
          p.arm = ph < 3 ? 'half' : ph < 17 ? 'stretch' : 'half';
          p.eyes = 'closed'; p.mouth = ph >= 3 && ph < 15 ? 'yawn' : 'line'; p.by = ph >= 3 && ph < 17 ? -1 : 0;
          break;
        }
        default:
          break;
      }
      return p;
    }

    drawCharacter(p) {
      const hx = HEAD_X, hy = HEAD_Y + p.by;
      // ---- gövde: çizgili kazak ----
      const top = hy + 12;
      for (let y = top; y <= 76; y++) {
        const back = y < top + 2 ? 95 + (y - top) : y > 70 ? 96 : 97;
        const front = y < top + 2 ? 87 - (y - top) : 86;
        this.C(front + 1, y, back - front - 1, 1);
        // çizgiler ve sırt gölgesi
        if (y === top + 7 || y === top + 8 || y === top + 13) this.F(front + 1, y, back - front - 1, 1, MID);
        else if (y > top + 1) { this.col(MID); if ((y + back) % 2 === 0) this.P(back - 1, y); this.col(INK); }
        this.P(front, y);
        this.P(back, y);
      }
      // V yaka
      this.P(89, top + 1); this.P(90, top + 2); this.P(91, top + 2); this.P(92, top + 1);
      // ---- bacaklar: kot + ayakkabı ----
      this.C(78, 76, 18, 4);
      this.D(80, 77, 15, 2, MID);
      this.R(79, 76, 8, 1);
      this.R(79, 79, 17, 1);
      this.R(78, 77, 1, 9);
      this.R(81, 80, 1, 5);
      this.C(79, 80, 2, 5);
      this.D(79, 80, 2, 5, MID, 1);
      // ayakkabı
      this.S(74, 84, [
        '.#####...',
        '#mmmmm#..',
        '########.',
        '########.',
      ]);
      // ---- kafa ----
      this.box(hx, hy, 15, 13, 2);
      // yüz gölgesi (sağ ve alt kenar)
      this.D(hx + 12, hy + 3, 1, 7, MID);
      this.D(hx + 3, hy + 11, 9, 1, MID, 1);
      // perçem
      this.P(hx + 6, hy - 1); this.P(hx + 7, hy - 2); this.P(hx + 8, hy - 2); this.P(hx + 9, hy - 1);
      const ex1 = hx + 4 + p.dx, ex2 = hx + 10 + p.dx, ey = hy + 4 + p.dy;
      switch (p.eyes) {
        case 'open':
          this.R(ex1, ey, 1, 3); this.R(ex2, ey, 1, 3);
          break;
        case 'blink':
        case 'closed':
          this.R(ex1 - 1, ey + 2, 2, 1); this.R(ex2, ey + 2, 2, 1);
          break;
        case 'happy':
          this.P(ex1 - 1, ey + 2); this.P(ex1, ey + 1); this.P(ex1 + 1, ey + 2);
          this.P(ex2 - 1, ey + 2); this.P(ex2, ey + 1); this.P(ex2 + 1, ey + 2);
          break;
        case 'sad':
          this.R(ex1, ey + 1, 1, 2); this.R(ex2, ey + 1, 1, 2);
          break;
      }
      // kaşlar
      if (p.brow === 'think') { this.R(ex1 - 1, ey - 2, 2, 1); this.R(ex2, ey - 3, 2, 1); }
      if (p.brow === 'sad') { this.P(ex1 - 1, ey - 1); this.P(ex1, ey - 2); this.P(ex2, ey - 2); this.P(ex2 + 1, ey - 1); }
      // yanaklar
      if (p.cheeks) { this.F(hx + 2, hy + 8, 2, 1, MID); this.F(hx + 11, hy + 8, 2, 1, MID); }
      // ağız
      const mx = hx + 6 + Math.sign(p.dx);
      switch (p.mouth) {
        case 'line': this.R(mx + 1, hy + 9, 2, 1); break;
        case 'smile': this.P(mx, hy + 9); this.R(mx + 1, hy + 10, 2, 1); this.P(mx + 3, hy + 9); break;
        case 'grin': this.R(mx - 1, hy + 8, 5, 1); this.R(mx, hy + 9, 3, 1); this.F(mx, hy + 9, 3, 1, INK); break;
        case 'open': this.box(mx, hy + 8, 3, 3, false, MID); break;
        case 'side': this.R(mx + 2, hy + 9, 2, 1); break;
        case 'frown': this.R(mx + 1, hy + 9, 2, 1); this.P(mx, hy + 10); this.P(mx + 3, hy + 10); break;
        case 'yawn': this.box(mx, hy + 7, 4, 4, true, MID); break;
        default: break;
      }
    }

    drawArms(p) {
      const by = p.by;
      const sx = 88, sy = 60 + by;
      const f = this.f;
      const thick = (x0, y0, x1, y1) => { this.L(x0, y0, x1, y1); this.L(x0, y0 + 1, x1, y1 + 1); };
      const hand = (x, y) => this.S(x, y, ['##', '##']);
      const mugAt = (x, y) => this.S(x, y, ['####.', '#ll##', '#ll#.', '####.']);
      switch (p.arm) {
        case 'type': {
          const a = this.armPhase;
          thick(sx, sy, 84, 65);
          thick(84, 65, 71, 64 - a);
          hand(69, 63 - a);
          this.L(84, 66, 75, 66 - (1 - a));
          hand(73, 65 - (1 - a));
          break;
        }
        case 'chin':
          thick(sx, sy, 84, 66);
          thick(84, 66, 87, 58 + by);
          this.R(86, 56 + by, 3, 2);
          break;
        case 'scratch': {
          const w = f % 2;
          thick(sx, sy, 83, 55 + by);
          thick(83, 55 + by, 85 + w, HEAD_Y - 1 + by);
          hand(85 + w, HEAD_Y - 2 + by);
          // hareket çizgileri
          this.P(82, HEAD_Y - 3 + by); this.P(81, HEAD_Y - 4 + by);
          break;
        }
        case 'gesture': {
          const w = Math.floor(f / 2) % 2;
          thick(sx, sy, 83, 64);
          thick(83, 64, 79, 58 - w);
          hand(77, 56 - w);
          break;
        }
        case 'up':
          thick(sx, sy, 82, 53 + by);
          this.R(80, 50 + by, 2, 3);
          this.L(95, sy, 100, 53 + by);
          this.R(100, 50 + by, 2, 3);
          break;
        case 'half':
          thick(sx, sy, 83, 56 + by);
          hand(81, 54 + by);
          this.L(95, sy, 99, 56 + by);
          hand(99, 54 + by);
          break;
        case 'stretch': {
          const w = Math.floor(f / 3) % 2;
          thick(sx, sy, 82, 48 + by);
          hand(81 - w, 45 + by);
          this.L(95, sy, 101, 48 + by);
          this.L(95, sy + 1, 101, 49 + by);
          hand(101 + w, 45 + by);
          break;
        }
        case 'reach':
          thick(sx, sy, 80, 66);
          thick(80, 66, 52, 66);
          hand(50, 66);
          break;
        case 'lift': {
          const k = p.lift || 0;
          const hx = Math.round(52 + (80 - 52) * k), hy = Math.round(66 - 10 * k);
          thick(sx, sy, 82, 64);
          thick(82, 64, hx + 2, hy + 1);
          mugAt(hx - 3, hy - 1);
          break;
        }
        case 'sip':
          thick(sx, sy, 84, 64);
          thick(84, 64, 82, 57 + by);
          mugAt(78, 53 + by);
          // buhar
          if (f % 4 < 2) { this.F(79, 50 + by - (f % 2), 1, 1, MID); this.F(81, 49 + by, 1, 1, MID); }
          break;
        default: // rest: kol masaya dayalı
          thick(sx, sy, 85, 68);
          thick(85, 68, 76, 69);
          hand(74, 68);
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
        // burun baloncuğu
        const r = [1, 2, 3, 3, 2, 1][Math.floor(f / 2) % 6];
        this.box(hx - 1 - r, hy + 7, r + 2, r + 2, r > 1, LT);
      }
      if (this.mood === 'thinking') {
        const n = Math.floor(f / 4) % 4;
        if (n >= 1) this.R(hx + 15, hy - 2, 2, 2);
        if (n >= 2) this.box(hx + 18, hy - 7, 3, 3, false);
        if (n >= 3) { this.box(hx + 22, hy - 15, 9, 6, true, LT); this.P(hx + 24, hy - 12); this.P(hx + 26, hy - 12); this.P(hx + 28, hy - 12); }
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
        // küçük yağmur bulutu
        const cy = hy - 13;
        this.S(hx + 1, cy, [
          '...####......',
          '.##mmmm##.##.',
          '#mmmmmmmm#mm#',
          '#mmmmmmmmmmm#',
          '.###########.',
        ]);
        for (let i = 0; i < 4; i++) {
          const dx = hx + 3 + i * 3, dy = cy + 6 + ((f + i * 2) % 5);
          if (dy < hy - 1) this.P(dx, dy);
        }
      }
      if (this.mood === 'stretch' && p.mouth === 'yawn') {
        this.P(hx - 3, hy + 3); this.P(hx - 4, hy + 2); this.P(hx + 17, hy + 3); this.P(hx + 18, hy + 2);
      }
      // konfeti
      this.parts.forEach((q) => { this.col(q.c); this.P(Math.round(q.x), Math.round(q.y)); if (q.life % 2) this.P(Math.round(q.x) + 1, Math.round(q.y)); });
      this.col(INK);
    }

    drawFloorShadow() {
      this.D(42, 87, 64, 1, MID);
      this.D(156, 87, 36, 1, MID, 1);
    }

    drawChair() {
      this.R(99, 58, 1, 30);
      this.R(101, 60, 1, 18);
      this.R(100, 58, 1, 1);
      this.F(100, 59, 1, 18, MID);
      this.R(85, 77, 16, 1);
      this.F(86, 78, 14, 2, MID);
      this.R(86, 80, 15, 1);
      this.R(88, 81, 1, 7);
      this.R(101, 78, 1, 10);
    }

    drawDesk() {
      this.box(42, 71, 36, 3, false);
      this.F(43, 72, 34, 1, MID);
      this.box(44, 74, 3, 14, false);
      this.box(73, 74, 3, 14, false);
      // çekmece
      this.box(52, 74, 16, 5, false);
      this.R(59, 76, 2, 1);
      this.R(47, 83, 26, 1);
    }

    drawMug() {
      // kahve kupası + buhar
      this.box(45, 65, 5, 6, false, LT);
      this.F(46, 66, 3, 1, MID);
      this.R(50, 66, 1, 1); this.R(51, 67, 1, 2); this.R(50, 69, 1, 1);
      const f = this.t;
      if (this.mood !== 'sleep') {
        const s = f % 6;
        this.F(46 + (s > 2 ? 1 : 0), 62 - (s % 3), 1, 1, MID);
        this.F(48 - (s > 2 ? 1 : 0), 60 - (s % 3), 1, 1, MID);
      }
    }

    drawTypewriter() {
      const cur = this.lines.length - 1;
      const shift = this.mood === 'typing' ? -Math.floor(this.lines[cur] / 3) : 0;
      // gövde
      this.R(53, 69, 19, 2);
      this.R(54, 67, 17, 2);
      this.R(56, 66, 13, 1);
      this.F(55, 69, 15, 1, MID);
      // tuşlar (basılan tuş parlar)
      this.C(56, 68, 13, 1);
      for (let i = 0; i < 7; i++) {
        if (i === this.key) this.F(56 + i * 2, 68, 1, 1, LT);
        else this.P(56 + i * 2, 68);
      }
      // silindir + kağıt
      const px = 57 + shift;
      this.box(px - 2, 63, 15, 3, false, MID);
      this.P(px - 3, 64); this.P(px + 13, 64);
      this.box(px, 53, 11, 11, false, LT);
      this.C(px + 1, 63, 9, 1);
      this.R(px, 63, 1, 1); this.R(px + 10, 63, 1, 1);
      this.lines.forEach((len, i) => { if (len) this.R(px + 2, 55 + i * 2, len, 1); });
      // kağıdın kıvrık ucu
      this.P(px + 10, 52); this.P(px + 11, 51);
      // satır sonu zili
      if (this.ding > 0) {
        const s = 5 - this.ding;
        this.P(74, 60 - s); this.P(76, 61 - s); this.P(75, 58 - s); this.P(73, 62 - s);
      }
    }

    drawClock() {
      // gerçek saati gösteren duvar saati
      const cx = 60, cy = 27, r = 6;
      for (let a = 0; a < Math.PI * 2; a += 0.05) this.P(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
      for (let y = -r + 1; y < r; y++) for (let x = -r + 1; x < r; x++) if (x * x + y * y < (r - 0.8) * (r - 0.8)) this.F(cx + x, cy + y, 1, 1, LT);
      [0, 3, 6, 9].forEach((h) => { const a = (h / 12) * Math.PI * 2 - Math.PI / 2; this.F(Math.round(cx + Math.cos(a) * (r - 2)), Math.round(cy + Math.sin(a) * (r - 2)), 1, 1, MID); });
      const d = new Date();
      const ma = (d.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
      const ha = ((d.getHours() % 12 + d.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;
      this.L(cx, cy, Math.round(cx + Math.cos(ma) * (r - 2)), Math.round(cy + Math.sin(ma) * (r - 2)));
      this.L(cx, cy, Math.round(cx + Math.cos(ha) * (r - 3)), Math.round(cy + Math.sin(ha) * (r - 3)));
      this.R(cx, cy - r - 2, 1, 2);
    }

    drawLamp(tod) {
      // taban
      this.R(26, 87, 11, 1);
      this.R(27, 86, 9, 1);
      this.R(29, 85, 5, 1);
      this.F(30, 86, 3, 1, MID);
      // gövde
      this.L(31, 85, 30, 78);
      this.L(30, 78, 29, 70);
      this.L(29, 70, 30, 62);
      this.L(30, 62, 33, 55);
      // abajur
      this.S(31, 47, [
        '..##......',
        '.#mm##....',
        '#mmmm##...',
        '#mmmmmm#..',
        '.#mmmmm##.',
        '..#mmm####',
        '...#m####.',
        '....###...',
      ]);
      if (tod !== 'day') {
        // ışık konisi (hafifçe titrer)
        const flick = this.t % 37 === 0 ? 1 : 0;
        this.col(LT);
        for (let y = 56; y < 71; y++) {
          for (let x = 37; x < 62; x++) {
            const inside = (x - 38) > (y - 59) * 0.4 && (x - 41) < (y - 56) * 1.5;
            if (inside && BAYER[y & 3][x & 3] < 4 - flick) this.P(x, y);
          }
        }
        this.col(INK);
        this.F(39, 56, 2, 1, LT);
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
      const tt = this.t;
      if (tod === 'night') {
        // ay ve parlayıp sönen yıldızlar
        this.F(132, 34, 4, 4, LT); this.F(131, 35, 6, 2, LT); this.F(134, 35, 1, 1, MID);
        [[122, 40], [127, 36], [137, 44], [124, 47], [139, 38]].forEach(([x, y], i) => { if ((tt + i * 5) % 14 < 10) this.F(x, y, 1, 1, LT); });
      } else {
        // güneş ve kayan bulutlar
        if (tod === 'day') this.box(131, 36, 5, 5, true, LT);
        const cloud = (bx, by) => {
          [[0, 1, 7], [1, 0, 4], [2, 2, 3]].forEach(([dx, dy, w]) => {
            for (let i = 0; i < w; i++) { const x = bx + dx + i, y = by + dy; if (inside(x, y)) this.F(x, y, 1, 1, LT); }
          });
        };
        cloud(x0 + ((Math.floor(tt / 9)) % 34) - 8, 38);
        cloud(x0 + ((Math.floor(tt / 13) + 17) % 34) - 8, 45);
        if (this.bird) {
          const b = this.bird, w = tt % 4 < 2;
          [[0, w ? 0 : 1], [1, 1], [2, w ? 0 : 1]].forEach(([dx, dy]) => { if (inside(b.x + dx, b.y + dy)) this.P(b.x + dx, b.y + dy); });
        }
      }
      // ağaçlar ve tepe
      const tree = (x, y, h) => {
        for (let i = 0; i < h; i++) {
          const w = Math.floor(i / 2) + 1;
          this.R(x - w + 1, y + i, w * 2 - 1, 1);
          if (i > 2 && i % 2 === 0) this.F(x - w + 2, y + i, 1, 1, MID);
        }
        this.R(x, y + h, 1, 2);
      };
      tree(122, 50, 10);
      tree(132, 54, 7);
      for (let x = x0 + 1; x < x1; x++) {
        const hh = 60 + Math.round(Math.sin((x - x0) / 5) * 1.2);
        for (let y = hh; y < bottom; y++) this.P(x, y);
      }
      // çerçeve, orta kayıt ve pervaz
      for (let a = Math.PI; a <= 2 * Math.PI + 0.001; a += 0.02) {
        this.P(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
      }
      this.R(x0, cy, 1, bottom - cy);
      this.R(x1, cy, 1, bottom - cy);
      this.R(x0, bottom, x1 - x0 + 1, 1);
      this.R(x0 - 2, bottom + 1, x1 - x0 + 5, 1);
      this.F(x0 - 1, bottom + 2, x1 - x0 + 3, 1, MID);
      // cama vuran ışık
      if (tod !== 'night') { this.F(x0 + 3, cy + 2, 1, 3, LT); this.F(x0 + 4, cy + 1, 1, 1, LT); }
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
          else if (type === 3) this.D(bx, ty, bw, bh, INK);
          else { this.box(bx, ty, bw + 1, bh, false, MID); this.F(bx + 1, ty + 2, bw - 1, 1, LT); }
          bx += bw + 1;
        });
      });
      // alt dolap kapağı
      this.R(x + w / 2, 71, 1, 16);
      this.R(x + w / 2 - 3, 78, 2, 1);
      this.R(x + w / 2 + 2, 78, 2, 1);
      this.D(x + 1, 71, w / 2 - 1, 16, MID, 1);
      // üstte saksı bitkisi (hafifçe sallanır)
      const sway = Math.floor(this.t / 12) % 2;
      this.S(x + 4, y - 10, [
        sway ? '..#.#...' : '.#..#...',
        sway ? '.#m#m#..' : '#m##m#..',
        '..#m#.#.',
        '#..#.#m#',
        '.#.##.#.',
        '..####..',
        '.#mmmm#.',
        '.#mmmm#.',
        '..####..',
      ]);
    }

    drawArmchair() {
      // sırt
      this.box(176, 62, 14, 26, true, BG);
      this.D(186, 64, 3, 22, MID);
      // oturak
      this.box(160, 74, 26, 7);
      this.F(161, 75, 24, 1, MID);
      // kolçak
      this.box(156, 70, 8, 12);
      this.R(158, 72, 4, 1);
      // ön panel
      this.box(158, 80, 30, 6, false, MID);
      // ayaklar
      this.R(160, 86, 2, 2);
      this.R(184, 86, 2, 2);
    }

    drawCat() {
      // koltukta kıvrılmış uyuyan kedi; kuyruğu ara ara sallanır
      const tail = this.catTail > 0 ? (this.catTail % 4 < 2 ? 0 : 1) : 0;
      this.S(163, 67, [
        '.#.#.........',
        '#m#m#####....',
        '#mmmmmmmm##..',
        '#m#m#mmmmmm#.',
        '.#mmmmmmmmmm#',
        '..##########.',
      ]);
      if (tail) this.S(175, 66, ['.#', '#.', '#.']);
      else this.S(175, 70, ['##', '.#']);
      if (this.mood === 'sleep' || this.t % 60 < 30) this.F(165, 69, 1, 1, INK); // kapalı göz çizgisi
    }
  }

  window.Scene = Scene;
})();
