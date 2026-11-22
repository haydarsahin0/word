/* Uygulama kabuğunu önbelleğe alır; çeviri istekleri her zaman ağdan gider. */
const CACHE = 'kelime-defteri-v35';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/sfx.js', 'js/dict.js', 'js/ai.js', 'js/translate.js', 'js/voice.js', 'js/reader.js', 'js/scene.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
// Ses modeli ve ses motoru (Piper): büyük ve değişmeyen dosyalar → kalıcı ayrı önbellek, önce önbellek
const VOICE_CACHE = 'kelime-voice-v1';
const isVoiceAsset = (u) =>
  (u.hostname === 'huggingface.co' && u.pathname.includes('/piper-voices/')) ||
  (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.includes('/onnxruntime-web/')) ||
  (u.hostname === 'cdn.jsdelivr.net' && (u.pathname.includes('/piper-wasm@') || u.pathname.includes('/piper-tts-web@') || u.pathname.includes('/onnxruntime-web@')));

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== VOICE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'GET' && isVoiceAsset(url)) {
    e.respondWith(caches.open(VOICE_CACHE).then(async (c) => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      const r = await fetch(e.request.url, { mode: 'cors' });
      if (r.ok) c.put(e.request.url, r.clone());
      return r;
    }));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
