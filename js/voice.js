/* Daha kaliteli Almanca ses: Piper (açık kaynak nöral ses), tamamen tarayıcıda, ücretsiz.
   İlk kullanımda ses modeli (~63 MB) ve motor (~28 MB) bir kez indirilir, sonra cihazda saklanır.
   Hazır değilken ya da bir sorun olursa cihazın kendi sesi kullanılır. */
(function () {
  const LIB = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm';
  const VOICES = {
    thorsten: { id: 'de_DE-thorsten-medium', label: 'Thorsten' },
    // "low" kalitedeki eski modeller (kerstin, ramona, eva_k) bazı Almanca seslerde bozuluyor: kullanılmıyor
    mls: { id: 'de_DE-mls-medium', label: 'Stimme 2' },
  };
  let mod = null;
  let wasmPaths = null;
  /** Kütüphanenin gerçekten yüklediği ONNX sürümünü bul, motor dosyalarını aynı sürümden al */
  async function resolveWasmPaths() {
    if (wasmPaths) return wasmPaths;
    let ver = '1.27.0';
    try {
      const src = await (await fetch(LIB)).text();
      const m = src.match(/onnxruntime-web@([0-9.]+)/);
      if (m) ver = m[1];
    } catch (e) { /* varsayılan sürüm */ }
    wasmPaths = {
      onnxWasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ver}/dist/`,
      piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
      piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
    };
    return wasmPaths;
  }
  let session = null;
  let sessionId = null;
  let loading = null;
  let status = 'idle'; // idle | loading | ready | error
  let lastError = '';
  let percent = 0;
  const listeners = new Set();
  const clips = new Map(); // "ses|metin" → wav blob adresi (son 80)
  // Medya öğesiyle çal: iPad sessiz moddayken de duyulur (Web Audio sessiz modda susar)
  const player = new Audio();
  player.preload = 'auto';
  player.setAttribute('playsinline', '');
  let unlocked = false;
  /** Çok kısa sessiz bir WAV (iPad'de sesin kilidini açmak için) */
  function silentWav() {
    const n = 1600, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 16000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  const SILENT = silentWav();
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      player.src = SILENT;
      const pr = player.play();
      if (pr && pr.catch) pr.catch(() => { unlocked = false; });
    } catch (e) { unlocked = false; }
  }
  // iPad/iPhone: ses ancak bir dokunuştan sonra açılabilir — ilk dokunuşta kilidi aç
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true, capture: true }));

  function emit() { listeners.forEach((f) => { try { f({ status, percent, error: lastError }); } catch (e) { /* yok say */ } }); }


  async function load(key) {
    const v = VOICES[key] || VOICES.thorsten;
    if (session && sessionId === v.id) return session;
    if (loading && loading.id === v.id) return loading.p;
    status = 'loading';
    percent = 0;
    lastError = '';
    emit();
    const p = (async () => {
      if (!mod) mod = await import(LIB);
      const paths = await resolveWasmPaths();
      // kütüphane aynı sayfada ses değiştirmeyi düzgün desteklemiyor: değişiklik sayfa yenilenince uygulanır
      if (sessionId && sessionId !== v.id) throw new Error('reload_needed');
      const s = await mod.TtsSession.create({
        voiceId: v.id,
        wasmPaths: paths,
        progress: (e) => {
          if (e && e.total && String(e.url || '').endsWith('.onnx')) {
            percent = Math.min(100, Math.round((e.loaded / e.total) * 100));
            emit();
          }
        },
      });
      session = s;
      sessionId = v.id;
      status = 'ready';
      percent = 100;
      loading = null;
      emit();
      return s;
    })().catch((e) => {
      status = 'error';
      lastError = String((e && e.message) || e);
      loading = null;
      emit();
      throw e;
    });
    loading = { id: v.id, p };
    return p;
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  let token = 0;
  let active = false;
  let chain = Promise.resolve(); // model aynı anda tek iş yapsın

  function clipFor(s, v, text) {
    const k = v.id + '|' + text;
    if (clips.has(k)) return Promise.resolve(clips.get(k));
    const job = chain.then(() => (clips.has(k) ? clips.get(k) : s.predict(text).then((wav) => {
      const u = URL.createObjectURL(wav);
      clips.set(k, u);
      if (clips.size > 120) { const [ok, ou] = clips.entries().next().value; URL.revokeObjectURL(ou); clips.delete(ok); }
      return u;
    })));
    chain = job.catch(() => {});
    return job;
  }
  function playUrl(url) {
    return new Promise((resolve, reject) => {
      player.onended = () => resolve();
      player.onerror = () => reject(new Error('play_error'));
      player.pause();
      player.src = url;
      player.currentTime = 0;
      const pr = player.play();
      if (pr && pr.catch) pr.catch(reject);
    });
  }

  /** Birkaç cümleyi sırayla oku: ilk cümle hazır olunca hemen başlar, gerisi arkada hazırlanır. */
  async function speakAll(parts, key) {
    parts = (parts || []).map((t) => String(t || '').trim()).filter(Boolean);
    if (!parts.length) return false;
    const my = ++token;
    active = true;
    try {
      const v = VOICES[key] || VOICES.thorsten;
      const s = await load(key);
      const jobs = parts.map((t) => clipFor(s, v, t)); // hepsini sıraya koy
      for (let i = 0; i < jobs.length; i++) {
        const url = await withTimeout(jobs[i], i === 0 ? 8000 : 15000);
        if (my !== token) return false; // bu arada başka bir şey okunmaya başlandı
        await playUrl(url);
        if (my !== token) return false;
      }
      lastError = '';
      return true;
    } finally {
      if (my === token) active = false;
    }
  }
  const speak = (text, key) => speakAll([text], key);
  function stop() { token++; active = false; try { player.pause(); } catch (e) { /* yok say */ } }

  function lastPlayError() { return lastError; }

  window.Voice = {
    VOICES,
    load,
    speak,
    speakAll,
    stop,
    isSpeaking: () => active,
    isReady: (key) => status === 'ready' && sessionId === (VOICES[key] || VOICES.thorsten).id,
    status: () => ({ status, percent, error: lastError }),
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    lastPlayError,
  };
})();
