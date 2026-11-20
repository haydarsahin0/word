/* Küçük, tatlı ses efektleri — dosya yok, Web Audio ile anında üretilir.
   Her düğmenin kendi sesi var; isimler aşağıdaki SOUNDS tablosunda. */
(function () {
  let ctx = null;
  let enabled = () => true;
  let noiseBuf = null;

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const j = (f, amt = 0.04) => f * (1 - amt + Math.random() * amt * 2);

  /* ---------- yapı taşları (her biri bir bağlam ve başlangıç zamanı alır) ---------- */
  function tone(c, at, freq, dur, o = {}) {
    const { type = 'sine', vol = 0.07, to = null, delay = 0, attack = 0.008, vibrato = 0 } = o;
    const t = at + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    if (vibrato) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 18; lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.03);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function noise(c, at, dur, o = {}) {
    const { vol = 0.05, freq = 2000, to = null, q = 1.2, delay = 0, type = 'bandpass' } = o;
    if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = at + delay;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  /* ---------- sesler ---------- */
  const SOUNDS = {
    // genel minik blip
    tap: (c, t) => tone(c, t, j(880), 0.07, { type: 'triangle', vol: 0.06, to: j(1320) }),
    // kelime gönder: iki notalı "bi-ding"
    send: (c, t) => {
      tone(c, t, 740, 0.07, { type: 'triangle', vol: 0.055 });
      tone(c, t, 1110, 0.1, { type: 'triangle', vol: 0.055, delay: 0.065 });
    },
    // cevap gönder: kısa "tık" (ardından doğru/yanlış sesi gelir)
    tick: (c, t) => tone(c, t, j(1500), 0.035, { type: 'square', vol: 0.025, to: 1100 }),
    // kaydet: "da-dum" onay
    save: (c, t) => {
      tone(c, t, 523, 0.08, { type: 'triangle', vol: 0.055 });
      tone(c, t, 784, 0.14, { type: 'triangle', vol: 0.055, delay: 0.08 });
    },
    // duraklat: aşağı inen iki 8-bit nota (uykuya dalıyor)
    pause: (c, t) => {
      tone(c, t, 660, 0.07, { type: 'square', vol: 0.022 });
      tone(c, t, 440, 0.12, { type: 'square', vol: 0.022, delay: 0.08, to: 392 });
    },
    // devam: yukarı çıkan iki 8-bit nota (uyanıyor)
    resume: (c, t) => {
      tone(c, t, 440, 0.07, { type: 'square', vol: 0.022 });
      tone(c, t, 660, 0.12, { type: 'square', vol: 0.022, delay: 0.08, to: 740 });
    },
    // menü aç: yukarı süzülen yumuşak ses + minik çan
    menuOpen: (c, t) => {
      tone(c, t, 420, 0.12, { type: 'sine', vol: 0.06, to: 840 });
      tone(c, t, 1680, 0.18, { type: 'sine', vol: 0.025, delay: 0.09 });
    },
    // menü kapa: aşağı süzülen ses
    menuClose: (c, t) => tone(c, t, 760, 0.12, { type: 'sine', vol: 0.06, to: 360 }),
    // "?" şimdi sor: soru tonlamalı "hmm?"
    ask: (c, t) => {
      tone(c, t, 500, 0.09, { type: 'triangle', vol: 0.05 });
      tone(c, t, 560, 0.16, { type: 'triangle', vol: 0.055, delay: 0.09, to: 880, vibrato: 12 });
    },
    // balonu kapat (tamam / anladım): baloncuk patlaması
    pop: (c, t) => {
      tone(c, t, j(1200), 0.05, { type: 'sine', vol: 0.08, to: 300, attack: 0.003 });
      noise(c, t, 0.03, { vol: 0.02, freq: 3000 });
    },
    // düzelt: kalem cızırtısı
    edit: (c, t) => {
      noise(c, t, 0.06, { vol: 0.05, freq: 4200, to: 5200, q: 6 });
      noise(c, t, 0.07, { vol: 0.045, freq: 3600, to: 4800, q: 6, delay: 0.09 });
    },
    // sil: aşağı inen üç nota
    del: (c, t) => [880, 660, 440].forEach((f, i) => tone(c, t, f, 0.07, { type: 'triangle', vol: 0.05, delay: i * 0.055 })),
    // göster: pırıltı
    reveal: (c, t) => [1319, 1760, 2093, 2637].forEach((f, i) => tone(c, t, j(f, 0.02), 0.09, { type: 'sine', vol: 0.04, delay: i * 0.045 })),
    // sonra: uykulu "mm-mm"
    later: (c, t) => {
      tone(c, t, 330, 0.12, { type: 'sine', vol: 0.06, to: 300 });
      tone(c, t, 262, 0.18, { type: 'sine', vol: 0.055, delay: 0.13, to: 247 });
    },
    // deftere ekle: jeton toplama
    coin: (c, t) => {
      tone(c, t, 988, 0.06, { type: 'square', vol: 0.03 });
      tone(c, t, 1319, 0.2, { type: 'square', vol: 0.03, delay: 0.06 });
    },
    // geç: hızlı "vıııjt"
    whoosh: (c, t) => noise(c, t, 0.16, { vol: 0.06, freq: 600, to: 4000, q: 2.5 }),
    // sesli oku: küçük çan
    bell: (c, t) => {
      tone(c, t, 1568, 0.45, { type: 'sine', vol: 0.045, attack: 0.004 });
      tone(c, t, 3136, 0.25, { type: 'sine', vol: 0.015, attack: 0.004 });
    },
    // karaktere dokun: cıvık "boop"
    boop: (c, t) => {
      tone(c, t, 600, 0.06, { type: 'sine', vol: 0.07, to: 950, attack: 0.004 });
      tone(c, t, 950, 0.08, { type: 'sine', vol: 0.05, delay: 0.06, to: 700 });
    },
    // + / −
    plus: (c, t) => tone(c, t, j(700, 0.02), 0.06, { type: 'triangle', vol: 0.055, to: 1050 }),
    minus: (c, t) => tone(c, t, j(700, 0.02), 0.06, { type: 'triangle', vol: 0.055, to: 470 }),
    // seçenekler: sık / normal / seyrek farklı perdede
    choice0: (c, t) => tone(c, t, 1175, 0.08, { type: 'triangle', vol: 0.05 }),
    choice1: (c, t) => tone(c, t, 880, 0.09, { type: 'triangle', vol: 0.05 }),
    choice2: (c, t) => tone(c, t, 659, 0.1, { type: 'triangle', vol: 0.05 }),
    // aç / kapat anahtarları
    on: (c, t) => {
      tone(c, t, 660, 0.05, { type: 'sine', vol: 0.06 });
      tone(c, t, 990, 0.08, { type: 'sine', vol: 0.06, delay: 0.05 });
    },
    off: (c, t) => {
      tone(c, t, 990, 0.05, { type: 'sine', vol: 0.05 });
      tone(c, t, 660, 0.08, { type: 'sine', vol: 0.05, delay: 0.05 });
    },
    // dışa aktar: yukarı koşan arpej
    export: (c, t) => [523, 659, 784, 1047].forEach((f, i) => tone(c, t, f, 0.07, { type: 'triangle', vol: 0.045, delay: i * 0.05 })),
    // içe aktar: yerine oturan iki nota
    import: (c, t) => {
      tone(c, t, 1047, 0.06, { type: 'triangle', vol: 0.045, to: 784 });
      tone(c, t, 523, 0.12, { type: 'triangle', vol: 0.05, delay: 0.07 });
    },
    // sıfırla: alçak "tok"
    reset: (c, t) => {
      tone(c, t, 160, 0.16, { type: 'sine', vol: 0.12, to: 90, attack: 0.003 });
      noise(c, t, 0.05, { vol: 0.03, freq: 800 });
    },
    // profili yenile: yukarı süzülen parıltı
    refresh: (c, t) => {
      tone(c, t, 600, 0.25, { type: 'sine', vol: 0.04, to: 1400 });
      [1760, 2349].forEach((f, i) => tone(c, t, f, 0.1, { type: 'sine', vol: 0.025, delay: 0.12 + i * 0.06 }));
    },
    // unut: silgi süpürmesi
    forget: (c, t) => noise(c, t, 0.25, { vol: 0.05, freq: 3500, to: 500, q: 1.5 }),
    // listeden sil: kağıt buruşturma
    crumple: (c, t) => [0, 0.04, 0.09, 0.13].forEach((d) => noise(c, t, 0.035, { vol: 0.05, freq: j(2500, 0.3), q: 3, delay: d })),
    // doğru cevap: küçük arpej
    ok: (c, t) => [784, 988, 1319].forEach((f, i) => tone(c, t, f, 0.11, { type: 'triangle', vol: 0.055, delay: i * 0.07 })),
    // yanlış cevap: yumuşak, üzgün iki nota
    no: (c, t) => {
      tone(c, t, 392, 0.12, { type: 'triangle', vol: 0.05, to: 330 });
      tone(c, t, 294, 0.18, { type: 'triangle', vol: 0.045, delay: 0.1, to: 247 });
    },
  };

  window.SFX = {
    play(name) {
      try {
        if (!enabled()) return;
        const c = ac();
        if (!c) return;
        (SOUNDS[name] || SOUNDS.tap)(c, c.currentTime);
      } catch (e) { /* ses desteklenmiyor */ }
    },
    /** Önizleme/test için: bir sesi verilen bağlama, verilen zamanda çal */
    renderTo(c, name, at) { (SOUNDS[name] || SOUNDS.tap)(c, at); },
    names: Object.keys(SOUNDS),
    setEnabled(fn) { enabled = fn; },
  };
})();
