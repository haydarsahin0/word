/* Küçük, tatlı ses efektleri — dosya yok, Web Audio ile anında üretilir. */
(function () {
  let ctx = null;
  let enabled = () => true;

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, opts = {}) {
    const c = ac();
    if (!c) return;
    const { type = 'sine', vol = 0.07, to = null, delay = 0 } = opts;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  const jitter = (f) => f * (0.96 + Math.random() * 0.08);

  const SOUNDS = {
    // her tıklamada: yukarı kayan minik "blip"
    tap: () => tone(jitter(880), 0.07, { type: 'triangle', vol: 0.06, to: jitter(1320) }),
    // gönder / Enter: iki notalı "bi-ding"
    send: () => {
      tone(740, 0.07, { type: 'triangle', vol: 0.055 });
      tone(1110, 0.09, { type: 'triangle', vol: 0.055, delay: 0.065 });
    },
    // duraklat / devam
    toggle: () => tone(jitter(520), 0.06, { type: 'square', vol: 0.02, to: 780 }),
    // menü aç/kapa
    soft: () => tone(jitter(620), 0.08, { type: 'sine', vol: 0.06, to: 460 }),
    // doğru cevap: küçük arpej
    ok: () => [784, 988, 1319].forEach((f, i) => tone(f, 0.11, { type: 'triangle', vol: 0.055, delay: i * 0.07 })),
    // yanlış cevap: yumuşak, üzgün iki nota
    no: () => {
      tone(392, 0.12, { type: 'triangle', vol: 0.05, to: 330 });
      tone(294, 0.18, { type: 'triangle', vol: 0.045, delay: 0.1, to: 247 });
    },
  };

  window.SFX = {
    play(name) {
      try {
        if (!enabled()) return;
        (SOUNDS[name] || SOUNDS.tap)();
      } catch (e) { /* ses desteklenmiyor */ }
    },
    setEnabled(fn) { enabled = fn; },
  };
})();
