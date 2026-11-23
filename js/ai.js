/* Meta Muse Ember istemcisi — Cloudflare Worker (kelime-ai) üzerinden konuşur.
   API anahtarı tarayıcıda DEĞİL, Worker secret'ında ("musebaba") durur. */
(function () {
  const ENDPOINT = 'https://kelime-ai.haydar-sahin.workers.dev';
  let downUntil = 0;
  let lastError = '';
  let profileProvider = () => ({ text: '', interests: [] });

  let activeCheck = () => true;
  let usageCb = null;

  async function call(action, payload, ms = 25000) {
    const independent = action === 'image' || action === 'usage' || action === 'story'; // görseller/kullanım/metin konuşma hatalarından etkilenmesin
    if (!independent && Date.now() < downUntil) throw new Error('ai_down');
    // sen bakmıyorken (sekme arka planda / uzun süre dokunulmadı) model çağrılmaz; çeviri ve metin yazma hariç
    if (action !== 'lookup' && action !== 'story' && !activeCheck()) throw new Error('inactive');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, profile: profileProvider().text, ...payload }),
        signal: ctl.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        lastError = j.error || 'http_' + r.status;
        // sunucu tarafı sorunlarında bir süre rahat bırak
        if (!independent && (r.status >= 500 || r.status === 404 || r.status === 429 || j.error === 'missing_key')) downUntil = Date.now() + 2 * 60 * 1000;
        throw new Error(lastError);
      }
      lastError = '';
      if (j && j._usage && usageCb) { try { usageCb(j._usage, action); } catch (e) { /* yok say */ } }
      return j;
    } catch (e) {
      if ((e.name === 'AbortError' || e instanceof TypeError) && !independent) {
        lastError = 'network';
        downUntil = Date.now() + 60 * 1000;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

  async function lookup(q, context) {
    const j = await call('lookup', context ? { q, context } : { q });
    const de = s(j.de, 60).replace(/^(der|die|das)\s+/i, '');
    const tr = s(j.tr, 60);
    if (!de || !tr) throw new Error('ai_empty');
    const art = ['der', 'die', 'das'].includes(s(j.art).toLowerCase()) ? s(j.art).toLowerCase() : '';
    const ex = j.example && s(j.example.de) ? { de: s(j.example.de), tr: s(j.example.tr), src: 'muse' } : null;
    return {
      de, art, tr,
      alts: Array.isArray(j.alts) ? j.alts.map((a) => s(a, 40)).filter(Boolean).slice(0, 2) : [],
      pos: ['n', 'v', 'a', 'd'].includes(j.pos) ? j.pos : (art ? 'n' : ''),
      plural: s(j.plural, 60),
      meaning_tr: s(j.meaning_tr, 220),
      explain_de: s(j.explain_de, 260),
      say_de: s(j.say_de, 160),
      ex,
      dir: j.lang === 'de' ? 'de2tr' : 'tr2de',
      source: 'muse',
    };
  }

  async function talk(words, known, wantNew, n = 3, onlyNew = false) {
    const j = await call('talk', { words, known, wantNew, n, onlyNew, interests: profileProvider().interests || [] }, 35000);
    return Array.isArray(j.items) ? j.items.filter((it) => it && typeof it.type === 'string') : [];
  }

  async function check(q_de, word, answer) {
    return call('check', { q_de, word, answer });
  }

  /** Kelime görseli (Muse Image) — kelime başına bir kez üretilir, sunucuda saklanır */
  async function image(w) {
    const j = await call('image', { de: w.de, art: w.art || '', tr: w.tr || '', explain: w.explain_de || '' }, 120000);
    return j.url || null;
  }

  /** İkinci çalışan: kelimelerin kullanım bilgisi (en fazla 8 kelime, kelime başına bir kez) */
  async function usage(words) {
    const j = await call('usage', { words }, 120000);
    return Array.isArray(j.items) ? j.items : [];
  }

  /** Üçüncü çalışan: seçilen kelimelerin geçtiği rastgele konuda metin */
  async function story(words, avoidTopics = []) {
    const j = await call('story', { words, avoidTopics }, 60000);
    const text_de = typeof j.text_de === 'string' ? j.text_de.trim() : '';
    if (!text_de) throw new Error('ai_empty');
    return {
      topic_seed: s(j.topic_seed, 120),
      topic_de: s(j.topic_de, 100),
      topic_tr: s(j.topic_tr, 100),
      title_de: s(j.title_de, 120),
      text_de,
      text_tr: typeof j.text_tr === 'string' ? j.text_tr.trim() : '',
    };
  }

  async function profile(old, events) {
    return call('profile', { old, events }, 45000);
  }

  /* ---------- senkron (aynı Worker, KV deposu) ---------- */
  async function syncCall(action, payload) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
        signal: ctl.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || 'http_' + r.status);
      return j;
    } finally {
      clearTimeout(t);
    }
  }
  window.Sync = {
    /** Kod → depolama anahtarı (SHA-256). Kodun kendisi sunucuya hiç gitmez. */
    async keyFor(code) {
      const data = new TextEncoder().encode('kelime-sync-v1:' + String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''));
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    },
    /** Diğer cihazların kayıtları (her cihaz kendi kaydına yazar) */
    get: (key) => syncCall('sync_get', { key }).then((j) => (Array.isArray(j.docs) ? j.docs : [])),
    put: (key, device, doc) => syncCall('sync_put', { key, device, doc }),
  };

  window.AI = {
    lookup, talk, check, profile, image, usage, story,
    setProfileProvider: (fn) => { profileProvider = fn; },
    setActiveCheck: (fn) => { activeCheck = fn; },
    onUsage: (fn) => { usageCb = fn; },
    available: () => Date.now() >= downUntil,
    lastError: () => lastError,
    endpoint: ENDPOINT,
  };
})();
