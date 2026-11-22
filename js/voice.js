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
  const buffers = new Map(); // "ses|metin" → AudioBuffer (son 80)
  let ctx = null;
  let current = null;

  function emit() { listeners.forEach((f) => { try { f({ status, percent, error: lastError }); } catch (e) { /* yok say */ } }); }

  function audioCtx() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // iPad/iPhone: ses ancak bir dokunuştan sonra açılabilir — ilk dokunuşta kilidi aç
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => document.addEventListener(ev, () => audioCtx(), { passive: true, capture: true }));

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

  async function speak(text, key) {
    text = String(text || '').trim();
    if (!text) return false;
    const v = VOICES[key] || VOICES.thorsten;
    const s = await load(key);
    const c = audioCtx();
    if (!c) throw new Error('no_audio');
    const k = v.id + '|' + text;
    let buf = buffers.get(k);
    if (!buf) {
      const wav = await s.predict(text);
      buf = await c.decodeAudioData(await wav.arrayBuffer());
      buffers.set(k, buf);
      if (buffers.size > 80) buffers.delete(buffers.keys().next().value);
    }
    if (current) { try { current.stop(); } catch (e) { /* yok say */ } }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
    current = src;
    return true;
  }

  window.Voice = {
    VOICES,
    load,
    speak,
    isReady: (key) => status === 'ready' && sessionId === (VOICES[key] || VOICES.thorsten).id,
    status: () => ({ status, percent, error: lastError }),
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
  };
})();
