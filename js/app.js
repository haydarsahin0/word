/* Kelime Defteri — ana uygulama mantığı */
(function () {
  const STORE = 'kelime-defteri-v1';
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  // Aralıklı tekrar basamakları (3 dk'dan 90 güne kadar adım adım)
  const INTERVALS = [
    3 * MIN, 5 * MIN, 10 * MIN, HOUR, 4 * HOUR, 12 * HOUR,
    DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY,
  ];
  const MAX_IVL = INTERVALS[INTERVALS.length - 1]; // 90 gün
  const MASTERED = 7; // 3 gün aralığına ulaşan kelime "öğrenildi" sayılır
  const isMastered = (w) => (w.ivl || 0) >= 3 * DAY * 0.95;
  const PAIR_SIZE = 2; // yeni kelimeleri 2'li gruplar halinde öğret
  const PAIR_GOAL = 2; // üst üste 2 doğru cevaptan sonra sıradaki yeni kelimeye geç
  // Basamak tabanlı tekrar parametreleri
  const LEARN_STEPS = INTERVALS.slice(0, 6);
  const GRAD_IVL = DAY;
  const EASE0 = 2.3, EASE_MIN = 1.3, EASE_MAX = 3.0;
  const clampEase = (e) => Math.max(EASE_MIN, Math.min(EASE_MAX, e));
  function levelFromIvl(ivl) {
    let l = -1;
    for (const x of INTERVALS) if (x <= ivl * 1.05) l++;
    return Math.max(0, l);
  }
  /** Zorluk: düşük kolaylık + yakın zamandaki hatalar (pratik seçiminde öne alınır) */
  const difficulty = (w) => (EASE_MAX - (w.ease || EASE0)) + (w.recentErr || 0) * 0.7;
  // aynı kelime bu süre içinde tekrar gösterilmez (az kelimede kısa, çok kelimede uzun)
  const cooldownMs = () => { const n = state.words.length; return n <= 3 ? 8 * 1000 : n <= 10 ? 20 * 1000 : 45 * 1000; };
  const IDLE_MS = 8 * MIN; // bu kadar dokunulmazsa kanka uyur, model çağrılmaz
  // sorular arası boşluk: neredeyse hiç ara vermeden art arda
  const GAPS = { often: 800, normal: 1500, rare: 6 * 1000 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = window.Translator;

  /* ---------- durum ---------- */
  let state = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && Array.isArray(s.words)) {
        s.settings = Object.assign(defaults().settings, s.settings);
        if (!['thorsten', 'mls', 'device'].includes(s.settings.engine)) s.settings.engine = 'thorsten';
        if (s.settings.voice !== 'off') s.settings.voice = 'on'; // geri alınan "kelime/anlatım" ayarı → açık
        s.days = s.days || {};
        s.recent = Array.isArray(s.recent) ? s.recent : [];
        s.log = Array.isArray(s.log) ? s.log : [];
        s.profile = s.profile && typeof s.profile === 'object' ? s.profile : null;
        s.profileAt = s.profileAt || 0;
        s.logAtProfile = s.logAtProfile || 0;
        s.cost = s.cost && typeof s.cost === 'object' ? s.cost : { days: {}, view: 'day' };
        s.deleted = s.deleted || {};
        s.sync = s.sync || { code: '', lastAt: 0, err: '' };
        s.settingsAt = s.settingsAt || 0;
        if (!s.deviceId) s.deviceId = Math.random().toString(36).slice(2, 10);
        const now = Date.now();
        s.words.forEach((w) => {
          if (!Array.isArray(w.pool)) w.pool = w.ex ? [{ de: w.ex.de, tr: w.ex.tr || '', n: 0, last: 0 }] : [];
          if (!Array.isArray(w.asked)) w.asked = [];
          if (w.ease == null) {
            w.ease = 2.3; w.reps = w.level || 0; w.recentErr = 0;
            w.ivl = INTERVALS[Math.min(w.level || 0, INTERVALS.length - 1)];
          }
          if (w.ivl > MAX_IVL) w.ivl = MAX_IVL;
          w.level = levelFromIvl(w.ivl);
          if (w.due && w.due > now + MAX_IVL * 1.12) w.due = now + MAX_IVL;
          if (w.pairDone == null) w.pairDone = (w.level || 0) > 0 || (w.reps || 0) >= 2;
          if (w.pairHits == null) w.pairHits = w.pairDone ? PAIR_GOAL : Math.min(1, w.reps || 0);
        });
        if (!Array.isArray(s.learnPair)) s.learnPair = [];
        if (!Array.isArray(s.stories)) s.stories = [];
        s.worker2Muted = !!s.worker2Muted;
        return s;
      }
    } catch (e) { /* boş başla */ }
    return defaults();
  }
  function defaults() {
    return { words: [], days: {}, recent: [], log: [], cost: { days: {}, view: 'day' }, deleted: {}, sync: { code: '', lastAt: 0, err: '' }, settingsAt: 0, deviceId: Math.random().toString(36).slice(2, 10), profile: null, profileAt: 0, logAtProfile: 0, learnPair: [], stories: [], worker2Muted: false, settings: { dailyGoal: 10, totalGoal: 500, freq: 'normal', voice: 'on', sfx: 'on', name: 'Haydar', engine: 'thorsten' }, paused: false };
  }
  let syncDirty = false;
  function save(markDirty = true) {
    if (markDirty) syncDirty = true;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* depolama yok */ }
  }

  const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function day(k = todayKey()) {
    return state.days[k] || (state.days[k] = { added: 0, reviewed: 0, correct: 0 });
  }
  function streak() {
    let n = 0;
    const d = new Date();
    const active = (k) => state.days[k] && (state.days[k].added || state.days[k].reviewed);
    if (!active(todayKey(d))) d.setDate(d.getDate() - 1);
    while (active(todayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const fullDe = (w) => (w.art ? w.art + ' ' : '') + w.de;
  /** İsimle hitap: "Haydar" (ayarlardan değişir); boşsa hiç eklenmez */
  /** Soru ipucunda kelimeyi ele verme: aynı kökten her sözcüğü ___ yap */
  function maskWord(text, w) {
    if (!text || !w || !w.de) return text || '';
    const fold = (x) => x.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
    const forms = String(w.de).split(/\s+/).filter((x) => x.length >= 3).map((x) => {
      let st = fold(x);
      const cut = st.replace(/(ieren|eln|ern|en|n|e|s)$/, '');
      if (cut.length >= 4) st = cut;
      return st.length >= 4 ? st : fold(x);
    });
    if (w.plural) forms.push(fold(String(w.plural).replace(/^(der|die|das)\s+/i, '')));
    return text.replace(/[\p{L}\p{M}]+/gu, (tok) => {
      const f = fold(tok);
      return forms.some((st) => st.length >= 3 && (f.includes(st) || (f.length >= 4 && st.startsWith(f) && f.length >= st.length - 1))) ? '___' : tok;
    });
  }
  const nameTag = (pre = '', post = '') => { const n = (state.settings.name || '').trim(); return n ? pre + n + post : ''; };

  /* ---------- aynı kelime tek kayıt ---------- */
  const deKey = (de) => String(de || '').normalize('NFC').trim().toLowerCase().replace(/^(der|die|das)\s+/, '').replace(/\s+/g, ' ');
  function findByDe(de) {
    const k = deKey(de);
    return k ? state.words.find((w) => deKey(w.de) === k) : null;
  }
  const isToday = (ts) => todayKey(new Date(ts)) === todayKey();
  function todayAdded() {
    return state.words.filter((w) => isToday(w.created)).length;
  }
  /** Eski sürümlerden kalan çift kayıtları birleştir */
  function mergeDuplicates() {
    const byKey = new Map();
    const keep = [];
    let merged = 0;
    for (const w of state.words) {
      const k = deKey(w.de);
      const first = byKey.get(k);
      if (!first) { byKey.set(k, w); keep.push(w); continue; }
      merged++;
      first.level = Math.max(first.level || 0, w.level || 0);
      first.ivl = Math.max(first.ivl || 0, w.ivl || 0);
      first.reps = Math.max(first.reps || 0, w.reps || 0);
      first.ease = Math.min(first.ease || 2.3, w.ease || 2.3);
      first.reviews = (first.reviews || 0) + (w.reviews || 0);
      first.correct = (first.correct || 0) + (w.correct || 0);
      first.lapses = (first.lapses || 0) + (w.lapses || 0);
      first.last = Math.max(first.last || 0, w.last || 0);
      first.created = Math.min(first.created || Date.now(), w.created || Date.now());
      ['art', 'plural', 'meaning_tr', 'explain_de', 'say_tr', 'pos', 'ex'].forEach((f) => { if (!first[f] && w[f]) first[f] = w[f]; });
      first.alts = [...new Set([...(first.alts || []), ...(w.alts || [])])].slice(0, 3);
      first.asked = [...(first.asked || []), ...(w.asked || [])].slice(-10);
      const seenPool = new Set((first.pool || []).map((x) => x.de));
      (w.pool || []).forEach((x) => { if (!seenPool.has(x.de)) { first.pool.push(x); seenPool.add(x.de); } });
    }
    state.words = keep;
    return merged;
  }
  if (mergeDuplicates()) save();
  day().added = todayAdded();

  /* ---------- senkron: iPad ⇄ telefon ---------- */
  const SYNC_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function newSyncCode() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    const c = [...b].map((x) => SYNC_ALPHA[x % SYNC_ALPHA.length]).join('');
    return c.match(/.{4}/g).join('-');
  }
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prettyCode = (c) => (cleanCode(c).match(/.{1,4}/g) || []).join('-');

  /** İki cihazdaki aynı kelimeyi birleştir: metin → en son düzenlenen, tekrar bilgisi → en son çalışılan */
  function mergeWord(a, b) {
    const ta = a.edited || a.created || 0, tb = b.edited || b.created || 0;
    const m = { ...(tb > ta ? b : a) };
    const rv = (b.last || 0) > (a.last || 0) ? b : a;
    ['level', 'ivl', 'ease', 'reps', 'due', 'lapses', 'correct', 'reviews', 'last', 'lastMode', 'recentErr'].forEach((f) => { if (rv[f] !== undefined) m[f] = rv[f]; });
    m.id = (a.created || 0) <= (b.created || 0) ? a.id : b.id;
    m.created = Math.min(a.created || Date.now(), b.created || Date.now());
    const pool = new Map();
    [...(a.pool || []), ...(b.pool || [])].forEach((x) => {
      const o = pool.get(x.de);
      pool.set(x.de, o ? { ...o, n: Math.max(o.n || 0, x.n || 0), last: Math.max(o.last || 0, x.last || 0) } : { ...x });
    });
    m.pool = [...pool.values()].slice(-15);
    m.asked = [...new Set([...(a.asked || []), ...(b.asked || [])])].slice(-10);
    if (a.seenDay === b.seenDay) m.seenToday = Math.max(a.seenToday || 0, b.seenToday || 0);
    else { const sd = (a.seenDay || '') > (b.seenDay || '') ? a : b; m.seenDay = sd.seenDay; m.seenToday = sd.seenToday; }
    m.seenAt = Math.max(a.seenAt || 0, b.seenAt || 0);
    const withImg = [a, b].filter((x) => x.img).sort((x, y) => (y.imgV || 0) - (x.imgV || 0))[0];
    if (withImg) { m.img = withImg.img; m.imgV = withImg.imgV; }
    if (!m.usage) m.usage = a.usage || b.usage;
    return m;
  }

  function mergeRemote(r) {
    if (!r || r.v !== 1) return;
    const del = { ...(r.deleted || {}) };
    Object.entries(state.deleted || {}).forEach(([k, t]) => { del[k] = Math.max(del[k] || 0, t); });
    state.deleted = del;
    const map = new Map(state.words.map((w) => [deKey(w.de), w]));
    (r.words || []).forEach((rw) => {
      const k = deKey(rw.de);
      const lw = map.get(k);
      if (lw) Object.assign(lw, mergeWord(lw, rw)); // aynı nesne kalsın (açık soru bozulmasın)
      else map.set(k, rw);
    });
    state.words = [...map.values()]
      .filter((w) => !((del[deKey(w.de)] || 0) >= (w.created || 0)))
      .sort((a, b) => (a.created || 0) - (b.created || 0));
    Object.entries(r.days || {}).forEach(([k, d]) => {
      const l = state.days[k] || (state.days[k] = { added: 0, reviewed: 0, correct: 0 });
      ['added', 'reviewed', 'correct'].forEach((f) => { l[f] = Math.max(l[f] || 0, d[f] || 0); });
    });
    if ((r.settingsAt || 0) > (state.settingsAt || 0) && r.settings) {
      state.settings = Object.assign({}, state.settings, r.settings);
      if (state.settings.voice !== 'off') state.settings.voice = 'on';
      state.settingsAt = r.settingsAt;
    }
    if ((r.profileAt || 0) > (state.profileAt || 0) && r.profile) {
      state.profile = r.profile;
      state.profileAt = r.profileAt;
    }
    const seenLog = new Set();
    state.log = [...(state.log || []), ...(r.log || [])]
      .filter((e) => { const k = JSON.stringify(e); if (seenLog.has(k)) return false; seenLog.add(k); return true; })
      .sort((a, b) => ((a.t || '') < (b.t || '') ? -1 : 1))
      .slice(-200);
    state.recent = [...new Set([...(r.recent || []), ...state.recent])].slice(-500);
    state.skipped = [...new Set([...(r.skipped || []), ...(state.skipped || [])])].slice(-100);
    if (r.deviceId && r.deviceId !== state.deviceId) {
      state.costOthers = state.costOthers || {};
      state.costOthers[r.deviceId] = r.costDays || {};
    }
  }

  function exportDoc() {
    return {
      v: 1,
      deviceId: state.deviceId,
      updatedAt: Date.now(),
      words: state.words,
      deleted: state.deleted,
      days: state.days,
      settings: state.settings,
      settingsAt: state.settingsAt,
      profile: state.profile,
      profileAt: state.profileAt,
      log: state.log,
      recent: state.recent,
      skipped: state.skipped || [],
      costDays: state.cost.days,
    };
  }

  let syncing = false;
  let lastSyncTry = 0;
  async function syncNow() {
    if (!window.Sync || !state.sync.code || syncing) return false;
    syncing = true;
    lastSyncTry = Date.now();
    let ok = false;
    try {
      const key = await Sync.keyFor(state.sync.code);
      const docs = await Sync.get(key);
      docs.filter((d) => d && d.deviceId !== state.deviceId).forEach(mergeRemote);
      await Sync.put(key, state.deviceId, exportDoc());
      state.sync.lastAt = Date.now();
      state.sync.err = '';
      syncDirty = false;
      ok = true;
      day().added = todayAdded();
    } catch (e) {
      state.sync.err = e && e.message === 'Failed to fetch' ? 'bağlantı yok' : String((e && e.message) || e);
    }
    syncing = false;
    save(false);
    render();
    if (!$('sheet').hidden) renderSync();
    return ok;
  }
  // bağlantıyla gelindiyse (…/?sync=KOD) kodu al
  (function () {
    try {
      const u = new URL(location.href);
      const c = u.searchParams.get('sync');
      if (c && cleanCode(c).length >= 12) {
        state.sync.code = prettyCode(c);
        u.searchParams.delete('sync');
        history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
        save(false);
      }
    } catch (e) { /* yok say */ }
  })();

  /* ---------- sadece sen bakarken çalış ---------- */
  let lastInteraction = Date.now();
  let dormant = false;
  const isActive = () => !document.hidden && Date.now() - lastInteraction < IDLE_MS;
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) =>
    document.addEventListener(ev, () => { lastInteraction = Date.now(); if (dormant) wakeUp(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { lastInteraction = Date.now(); if (dormant) wakeUp(); }
    // ayrılırken ve dönünce eşitle (diğer cihazdaki değişiklikler gelsin)
    if (state.sync.code && typeof syncNow === 'function') syncNow();
  });
  if (window.AI && AI.setActiveCheck) AI.setActiveCheck(isActive);

  /* ---------- aynı kelimeyi üst üste getirme ---------- */
  let lastWordId = null;
  function touch(w) {
    if (!w) return;
    w.seenAt = Date.now();
    lastWordId = w.id;
    const k = todayKey();
    if (w.seenDay !== k) { w.seenDay = k; w.seenToday = 0; }
    w.seenToday = (w.seenToday || 0) + 1;
  }
  const cooling = (w) => (w.id === lastWordId && state.words.length > 1) || Date.now() - (w.seenAt || 0) < cooldownMs();
  const seenTodayOf = (w) => (w.seenDay === todayKey() ? w.seenToday || 0 : 0);

  /* ---------- canlı maliyet (sağ üst) ---------- */
  // Muse Ember fiyatı (1 milyon token başına, USD). Meta panelindeki fiyat farklıysa burayı değiştir.
  const PRICE_IN = 0.10 / 1e6, PRICE_OUT = 0.50 / 1e6;
  const PRICE_IMG = 0.02; // Muse Image, görsel başına (tahmini; Meta panelinden kontrol et)
  const COST_VIEWS = { day: 'heute', month: 'diesen Monat', total: 'insgesamt' };
  function addCost(u) {
    const usd = (u.in || 0) * PRICE_IN + (u.out || 0) * PRICE_OUT + (u.images || 0) * PRICE_IMG;
    const k = todayKey();
    const d = state.cost.days[k] || (state.cost.days[k] = { usd: 0, in: 0, out: 0, calls: 0 });
    d.usd += usd; d.in += u.in || 0; d.out += u.out || 0; d.calls += u.calls || 1;
    save();
    renderCost(true);
  }
  function costFor(view) {
    const k = todayKey();
    // bu cihaz + senkronla gelen diğer cihazlar
    const all = {};
    [state.cost.days, ...Object.values(state.costOthers || {})].forEach((dd) => Object.entries(dd || {}).forEach(([d, v]) => {
      all[d] = all[d] || { usd: 0 };
      all[d].usd += v.usd || 0;
    }));
    if (view === 'day') return (all[k] || {}).usd || 0;
    const days = Object.entries(all);
    if (view === 'month') return days.filter(([d]) => d.slice(0, 7) === k.slice(0, 7)).reduce((a, [, v]) => a + v.usd, 0);
    return days.reduce((a, [, v]) => a + v.usd, 0);
  }
  function fmtUsd(v) {
    const digits = v < 0.01 ? 4 : v < 1 ? 3 : 2;
    return v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' $';
  }
  function renderCost(bump) {
    const view = state.cost.view || 'day';
    $('costVal').textContent = fmtUsd(costFor(view));
    $('costLbl').textContent = COST_VIEWS[view];
    if (bump) { const b = $('costBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
  if (window.AI && AI.onUsage) AI.onUsage(addCost);
  $('costBtn').addEventListener('click', () => {
    const order = ['day', 'month', 'total'];
    state.cost.view = order[(order.indexOf(state.cost.view || 'day') + 1) % order.length];
    save();
    renderCost();
  });

  /* ---------- ses efektleri ---------- */
  if (window.SFX) SFX.setEnabled(() => state.settings.sfx !== 'off');
  const sfx = (n) => window.SFX && SFX.play(n);
  const ACT_SOUNDS = {
    close: 'pop', edit: 'edit', delete: 'del', reveal: 'reveal', later: 'later',
    addnew: 'coin', addbook: 'coin', skip: 'whoosh', 'say-ex': 'bell', hint: 'reveal',
  };
  const ID_SOUNDS = {
    menuBtn: 'menuOpen', closeSheet: 'menuClose', askBtn: 'ask', exportBtn: 'export',
    resetBtn: 'reset', profileRefresh: 'refresh', profileForget: 'forget',
    storyBtn: 'reveal', closeStory: 'menuClose', storyWriteBtn: 'ask', suggestBtn: 'ask',
  };
  function soundFor(b) {
    if (b.id === 'pauseBtn') return state.paused ? 'resume' : 'pause';
    if (b.id === 'bookBtn') return readerOpen ? 'menuClose' : 'reveal';
    if (b.id === 'costBtn') return 'choice' + ['day', 'month', 'total'].indexOf(state.cost.view || 'day');
    if (ID_SOUNDS[b.id]) return ID_SOUNDS[b.id];
    if (b.matches('label.btn') && b.querySelector('#importFile')) return 'import';
    if (b.dataset.say) return 'bell';
    const act = b.dataset.act;
    if (act === 'knew' || act === 'forgot' || act === 'giveup') return null; // sonuç sesi çalacak
    if (ACT_SOUNDS[act]) return ACT_SOUNDS[act];
    if (b.dataset.d) return +b.dataset.d > 0 ? 'plus' : 'minus';
    if (b.closest('#freqSeg')) return 'choice' + ['often', 'normal', 'rare'].indexOf(b.dataset.v);
    if (b.closest('#voiceSeg')) return b.dataset.v === 'on' ? 'on' : 'off';
    if (b.id === 'engineTest') return null;
    if (b.closest('#engineSeg')) return 'tap';
    if (b.closest('#sfxSeg')) return b.dataset.v === 'on' ? null : 'off';
    if (b.classList.contains('del') || b.classList.contains('st-hist-del')) return 'crumple';
    if (b.id === 'syncCreate' || b.id === 'syncJoin') return 'coin';
    if (b.id === 'syncNowBtn') return 'refresh';
    if (b.id === 'syncCopy') return 'bell';
    if (b.id === 'syncOff') return 'off';
    return 'tap';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, label.btn');
    if (!b || (b.type === 'submit' && b.form) || b.disabled) return;
    const name = soundFor(b);
    if (name) sfx(name);
  }, true);
  document.addEventListener('submit', (e) => {
    const kind = e.target.dataset && e.target.dataset.form;
    sfx(kind === 'answer' ? 'tick' : kind === 'manual' || kind === 'edit' ? 'save' : 'send');
  }, true);
  /* ---------- sahne ---------- */
  const canvas = $('scene');
  const stage = $('stage');
  const bubble = $('bubble');
  const scene = new window.Scene(canvas);
  scene.onResize = () => { syncGround(); placeBubble(); if (typeof placeThought === 'function') placeThought(); if (typeof placeBubble3 === 'function') placeBubble3(); };

  /** Kart ekrana sığsın: önce karakterin üstündeki boşluk, gerekirse sahne küçülür */
  function fitToScreen() {
    const card = $('card');
    stage.style.paddingTop = '';
    scene.maxCssH = null;
    scene.resize();
    const avail = window.innerHeight - 24;
    let over = card.offsetHeight - avail;
    if (over > 0) {
      const pad = parseFloat(getComputedStyle(stage).paddingTop) || 0;
      const newPad = Math.max(28, pad - over);
      stage.style.paddingTop = newPad + 'px';
      over -= pad - newPad;
    }
    if (over > 0) {
      scene.maxCssH = Math.max(92 * 1.5, canvas.offsetHeight - over);
      scene.resize();
    }
    syncGround();
    placeBubble();
    if (typeof placeThought === 'function') placeThought();
    if (typeof placeBubble2 === 'function') placeBubble2();
    if (typeof placeBubble3 === 'function') placeBubble3();
  }
  let fitTimer = 0;
  const scheduleFit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitToScreen, 60); };
  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);
  function syncGround() {
    const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    stage.style.setProperty('--ground', (cr.top - sr.top + scene.groundY()) + 'px');
    stage.style.setProperty('--px', scene.pcss + 'px');
  }

  /* ---------- arayüz güncelleme ---------- */
  function render() {
    const total = state.words.length;
    const goal = state.settings.totalGoal;
    const added = todayAdded();
    $('total').textContent = `${total.toLocaleString('tr-TR')} / ${goal.toLocaleString('tr-TR')}`;
    const pct = Math.min(100, Math.floor((total / goal) * 100));
    $('totalPct').textContent = '%' + pct;
    $('totalBar').style.width = pct + '%';
    $('today').textContent = `${added} / ${state.settings.dailyGoal}`;
    const dp = Math.min(100, (added / state.settings.dailyGoal) * 100);
    $('dailyBar').style.width = dp + '%';
    $('dailyBar').closest('.meter').classList.toggle('done', dp >= 100);
    $('streak').textContent = streak();
    renderCost();
    document.body.classList.toggle('paused', !!state.paused);
    renderTicker();
  }

  function renderTicker() {
    const recent = state.words.slice(-12).reverse();
    const items = recent.length
      ? recent.map((w) => `<span><b>${esc(fullDe(w))}</b> — ${esc(w.tr)}</span>`).join('')
      : '<span>Schreib ein Wort – wir lernen zusammen</span><span>Türkçe ⇄ Deutsch</span><span>Schritt für Schritt</span>';
    const el = $('ticker');
    if (el.dataset.items === items) return;
    el.dataset.items = items;
    el.classList.remove('scroll');
    el.innerHTML = items;
    // sadece sığmıyorsa kaydır; kesintisiz dönsün diye o zaman iki kopya koy
    if (el.scrollWidth > el.parentElement.clientWidth) {
      el.innerHTML = items + items;
      el.style.animationDuration = Math.max(20, recent.length * 5) + 's';
      el.classList.add('scroll');
    }
  }

  /* ---------- balon ---------- */
  let bubbleTimer = 0;
  let bubbleKind = null;
  let nextReviewAt = Date.now() + 4000;
  let nextTimer = 0;
  let busy = false;
  let moodUntil = 0;

  function showBubble(html, kind, opts = {}) {
    clearTimeout(bubbleTimer);
    bubble.innerHTML = `<div class="b-inner">${html}</div>`;
    bubble.classList.remove('show-tr');
    if (bubble.querySelector('.tr')) bubble.firstElementChild.insertAdjacentHTML('afterbegin', '<button class="tr-toggle" data-act="tr" aria-label="Türkçe çeviri">TR</button>');
    bubble.hidden = false;
    bubbleKind = kind;
    bubble.style.animation = 'none';
    void bubble.offsetWidth;
    bubble.style.animation = '';
    hideThought();
    placeBubble();
    if (opts.autoClose) bubbleTimer = setTimeout(() => { if (opts.onTimeout) opts.onTimeout(); hideBubble(); }, opts.autoClose);
    const inp = bubble.querySelector('input');
    if (inp && opts.focus !== false) setTimeout(() => inp.focus({ preventScroll: true }), 60);
  }
  function hideBubble() {
    clearTimeout(bubbleTimer);
    if (window.Reader) Reader.clearMark();
    bubble.hidden = true;
    bubbleKind = null;
    if (typeof suggestBrowse !== 'undefined') suggestBrowse = false;
    const sb = $('suggestBtn');
    if (sb) sb.classList.remove('on');
    nextReviewAt = Date.now() + GAPS[state.settings.freq];
    clearTimeout(nextTimer);
    nextTimer = setTimeout(() => { if (typeof tickTalk === 'function') tickTalk(); }, GAPS[state.settings.freq] + 30);
    if (!state.paused) setMood('typing', 4000);
    updateTitle();
    placeAllBubbles();
  }

  /** Üç çalışanın konuşma balonlarını birbirinin üstüne binmeyecek şekilde yan yana yerleştir */
  function placeAllBubbles() {
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    if (!sr.width) return;
    const cardTop = $('card').getBoundingClientRect().top;
    const pad = 8, gap = 10;
    const defs = [
      { el: $('bubble'),  anchor: () => scene.headAnchor(),  bias: 0.42 },
      { el: $('bubble2'), anchor: () => scene.headAnchor2(), bias: 0.50 },
      { el: $('bubble3'), anchor: () => scene.headAnchor3(), bias: 0.68 },
    ];
    const vis = [];
    defs.forEach((d) => {
      if (!d.el) return;
      d.el.style.maxWidth = '';
      d.el.classList.remove('floating');
      if (d.el.hidden) return;
      const a = d.anchor();
      const hx = a ? cr.left - sr.left + a.x : sr.width - 24;
      const hy = a ? cr.top - sr.top + a.y : cr.top - sr.top + 40;
      vis.push({ ...d, a, hx, hy });
    });
    if (!vis.length) return;

    const avail = sr.width - pad * 2 - gap * (vis.length - 1);
    const canSideBySide = vis.length === 1 || (avail / vis.length) >= 210;
    if (vis.length > 1 && canSideBySide) {
      // Dar/kompakt etiketler kendi küçük genişliğini alsın, kalan alanı büyük balonlar eşit paylaşsın
      const fixedW = vis.reduce((s, v) => s + (v.el.classList.contains('compact') ? v.el.offsetWidth : 0), 0);
      const flexN = vis.filter((v) => !v.el.classList.contains('compact')).length || 1;
      const laneMax = Math.max(200, Math.floor((avail - fixedW) / flexN));
      vis.forEach((v) => { if (!v.el.classList.contains('compact')) v.el.style.maxWidth = laneMax + 'px'; });
    }

    vis.forEach((v) => {
      v.bw = v.el.offsetWidth;
      v.left = Math.max(pad, Math.min(v.hx - v.bw * v.bias, sr.width - v.bw - pad));
      v.bottom = sr.height - v.hy + 14;
    });

    if (vis.length > 1 && canSideBySide) {
      // Soldan sağa iterek çakışmayı gider
      for (let i = 1; i < vis.length; i++) {
        vis[i].left = Math.max(vis[i].left, vis[i - 1].left + vis[i - 1].bw + gap);
      }
      // Sağdan taştıysa geri çekip sola yay
      const last = vis[vis.length - 1];
      if (last.left + last.bw > sr.width - pad) {
        last.left = sr.width - pad - last.bw;
        for (let i = vis.length - 2; i >= 0; i--) {
          vis[i].left = Math.min(vis[i].left, vis[i + 1].left - vis[i].bw - gap);
        }
        if (vis[0].left < pad) vis[0].left = pad;
      }
    }

    vis.forEach((v, idx) => {
      v.el.style.left = Math.round(v.left) + 'px';
      v.el.style.bottom = Math.round(v.bottom) + 'px';
      if (!v.a) v.el.classList.add('floating');
      const tail = Math.max(16, Math.min(v.bw - 16, v.hx - v.left));
      v.el.style.setProperty('--tail', Math.round(tail) + 'px');

      if (!canSideBySide && idx > 0) {
        const prev = vis[idx - 1].el;
        const curB = { l: v.el.offsetLeft, t: v.el.offsetTop, r: v.el.offsetLeft + v.el.offsetWidth, b: v.el.offsetTop + v.el.offsetHeight };
        const preB = { l: prev.offsetLeft, t: prev.offsetTop, r: prev.offsetLeft + prev.offsetWidth, b: prev.offsetTop + prev.offsetHeight };
        if (!(curB.r < preB.l || curB.l > preB.r || curB.b < preB.t || curB.t > preB.b)) {
          v.el.style.bottom = Math.round(stage.clientHeight - preB.t + 8) + 'px';
          v.el.classList.add('floating');
        }
      }

      const inner = v.el.firstElementChild;
      if (inner) {
        const maxH = Math.max(130, sr.top - cardTop + v.hy - 36);
        inner.classList.remove('scrolls');
        inner.style.maxHeight = '';
        if (inner.scrollHeight > maxH + 4) {
          inner.style.maxHeight = maxH + 'px';
          inner.classList.add('scrolls');
        }
      }
    });
  }
  function placeBubble() { placeAllBubbles(); }
  window.addEventListener('resize', placeAllBubbles);

  function setMood(m, ms = 0) {
    scene.setMood(m);
    moodUntil = Date.now() + ms;
  }

  const speakerSvg = '<svg viewBox="0 0 10 9" shape-rendering="crispEdges"><rect x="0" y="3" width="2" height="3"/><rect x="2" y="2" width="1" height="5"/><rect x="3" y="1" width="1" height="7"/><rect x="4" y="0" width="1" height="9"/><rect x="6" y="3" width="1" height="3"/><rect x="8" y="1" width="1" height="7"/></svg>';
  const speakBtn = (text) => `<button class="btn speak" data-say="${esc(text)}" aria-label="Sesli oku">${speakerSvg}</button>`;

  /** Seslendir: önce kaliteli Piper sesi; hazır değilse ya da hata olursa cihazın sesi */
  function say(text) {
    if (!text) return;
    const engine = state.settings.engine || 'thorsten';
    if (engine !== 'device' && window.Voice) {
      if (Voice.isReady(engine)) {
        if ('speechSynthesis' in window && speechSynthesis.speaking) speechSynthesis.cancel();
        Voice.speak(text, engine).catch((e) => { lastVoiceError = String((e && e.message) || e); deviceSay(text); });
        return;
      }
      Voice.load(engine).catch(() => {}); // arka planda hazırlansın; bu sefer cihaz sesi
    }
    deviceSay(text);
  }
  /** Cihazın sesi: en kaliteli Almanca sesi seç (Premium/Enhanced/Natural/Google önce) */
  let lastVoiceError = '';
  function deviceSay(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      const go = () => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'de-DE';
        u.rate = 0.92;
        const voices = speechSynthesis.getVoices().filter((x) => /^de/i.test(x.lang));
        const score = (x) => (/premium/i.test(x.name + x.voiceURI) ? 4 : 0) + (/enhanced|erweitert/i.test(x.name + x.voiceURI) ? 3 : 0) + (/natural|online/i.test(x.name) ? 3 : 0) + (/google/i.test(x.name) ? 2 : 0);
        const v = voices.sort((a, b) => score(b) - score(a))[0];
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      };
      // iPad: iptal edip aynı anda konuşturunca bazen sessiz kalıyor — kısa ara ver
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(go, 80); } else go();
    } catch (e) { /* desteklenmiyor */ }
  }

  function highlight(sentence, word, mode) {
    const s = esc(sentence);
    const w = esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}])(${w})(?=$|[^\\p{L}])`, 'iu');
    if (!re.test(s)) return null;
    return s.replace(re, (m, pre, hit) => pre + (mode === 'gap' ? '<span class="gap">&nbsp;</span>' : `<mark>${hit}</mark>`));
  }
  function exampleWord(w) {
    if (!w.ex) return null;
    const m = w.ex.de.match(new RegExp(`(^|[^\\p{L}])(${w.de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}])`, 'iu'));
    return m ? m[2] : null;
  }

  /* ---------- kanka seni tanıyor: olay günlüğü + profil ---------- */
  let logSeq = 0;
  function logEvent(type, data) {
    const e = { t: new Date().toISOString().slice(0, 16), type, ...data };
    Object.keys(e).forEach((k) => { if (typeof e[k] === 'string') e[k] = e[k].slice(0, 160); if (e[k] === '' || e[k] == null) delete e[k]; });
    state.log.push(e);
    state.logCount = (state.logCount || 0) + 1;
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
    save();
  }
  function profileText() {
    const p = state.profile;
    const nm = (state.settings.name || '').trim();
    if (!p) return nm ? 'Name: ' + nm : '';
    const parts = [];
    if (nm) parts.push('Name: ' + nm);
    if (p.summary_tr) parts.push('Summary: ' + p.summary_tr);
    if (p.level) parts.push('Level: ' + p.level);
    if (p.interests && p.interests.length) parts.push('Interests: ' + p.interests.join(', '));
    if (p.life && p.life.length) parts.push('Life: ' + p.life.join('; '));
    if (p.goals && p.goals.length) parts.push('Wants to learn: ' + p.goals.join(', '));
    if (p.weak_points && p.weak_points.length) parts.push('Weak points: ' + p.weak_points.join(', '));
    if (p.style) parts.push('Their style: ' + p.style);
    if (p.next_focus) parts.push('Next focus: ' + p.next_focus);
    const recentQ = state.log.filter((e) => e.type === 'lookup').slice(-12).map((e) => e.q).filter(Boolean);
    if (recentQ.length) parts.push('Recently asked about: ' + recentQ.join(', '));
    return parts.join('\n');
  }
  if (window.AI) AI.setProfileProvider(() => ({ text: profileText(), interests: (state.profile && state.profile.interests) || [] }));

  let profiling = false;
  async function maybeUpdateProfile(force) {
    if (profiling || !window.AI || !AI.available() || state.paused) return;
    const fresh = (state.logCount || 0) - (state.logAtProfile || 0);
    const age = Date.now() - (state.profileAt || 0);
    const due = force || fresh >= 8 || (fresh >= 3 && age > 20 * MIN) || (!state.profile && fresh >= 3);
    if (!due || age < 2 * MIN) return;
    profiling = true;
    try {
      const r = await AI.profile(state.profile || {}, state.log.slice(-80));
      const arr = (v, n) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, n) : []);
      const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
      const prevObs = state.profile && state.profile.observation_de;
      state.profile = {
        summary_tr: str(r.summary_tr, 400), level: str(r.level, 3),
        interests: arr(r.interests, 6), life: arr(r.life, 5), goals: arr(r.goals, 5), weak_points: arr(r.weak_points, 5),
        style: str(r.style, 300), next_focus: str(r.next_focus, 200), observation_de: str(r.observation_de, 160),
      };
      state.profileAt = Date.now();
      state.logAtProfile = state.logCount || 0;
      save();
      if (state.profile.observation_de && state.profile.observation_de !== prevObs) {
        setTimeout(() => { if (bubble.hidden) { setMood('thinking', 6000); think(state.profile.observation_de, 8000); } }, 1500);
      }
      if (!$('sheet').hidden) renderSheet();
    } catch (e) { /* sonra tekrar dener */ }
    profiling = false;
  }

  /* ---------- çeşitlilik: gösterilen cümleleri hatırla, tekrar etme ---------- */
  const sentKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function seen(text) { return !!text && state.recent.includes(sentKey(text)); }
  function markShown(text) {
    const k = sentKey(text);
    if (!k) return;
    state.recent = state.recent.filter((x) => x !== k);
    state.recent.push(k);
    if (state.recent.length > 500) state.recent.splice(0, state.recent.length - 500);
  }
  function wordIn(sentence, w) {
    const m = String(sentence || '').match(new RegExp(`(^|[^\\p{L}])(${w.de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}])`, 'iu'));
    return m ? m[2] : null;
  }
  function addToPool(w, de, tr) {
    if (!de) return;
    w.pool = w.pool || [];
    const k = sentKey(de);
    if (w.pool.some((p) => sentKey(p.de) === k)) return;
    w.pool.push({ de, tr: tr || '', n: 0, last: 0 });
    if (w.pool.length > 15) { w.pool.sort((a, b) => b.n - a.n || a.last - b.last); w.pool.shift(); }
  }
  /** En uzun süredir gösterilmeyen cümleyi seç */
  function nextSentence(w, needWord = true, freshOnly = true) {
    const hourAgo = Date.now() - HOUR;
    const list = (w.pool || []).filter((p) => (!needWord || wordIn(p.de, w)) && (!freshOnly || p.last < hourAgo));
    if (!list.length) return null;
    list.sort((a, b) => a.last - b.last || a.n - b.n);
    const p = list[0];
    p.n++;
    p.last = Date.now();
    markShown(p.de);
    save();
    return { de: p.de, tr: p.tr, last: p.last };
  }
  function freshSentences(w) {
    const hour = Date.now() - HOUR;
    return (w.pool || []).filter((p) => wordIn(p.de, w) && p.last < hour).length;
  }

  function wordCard(w, tag, opts = {}) {
    const alts = (w.alts || []).length ? ` <span class="alt">· ${esc(w.alts.slice(0, 2).join(', '))}</span>` : '';
    const e = opts.ex || w.ex;
    const ex = e ? `<div class="b-ex">„${highlight(e.de, opts.mark || w.de) || highlight(e.de, w.de) || esc(e.de)}“${e.tr ? `<span class="tr">${esc(e.tr)}</span>` : ''}</div>` : '';
    const plural = w.plural ? ` <span class="alt">· Plural: ${esc(w.plural)}</span>` : '';
    const meaning = w.meaning_tr ? `<div class="b-hint tr">${esc(w.meaning_tr)}</div>` : '';
    const simple = w.explain_de ? `<div class="b-simple"><span>einfach gesagt</span>${esc(w.explain_de)}</div>` : '';
    const sayLine = opts.say && w.say_de ? `<div class="b-say">${esc(w.say_de)}</div>` : '';
    const img = w.img && !opts.noImg ? `<img class="b-img" src="${esc(w.img)}" alt="" loading="lazy">` : '';
    return `<div class="b-tag">${tag}</div>${img}${sayLine}
      <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
      <div class="b-mean">${esc(w.tr)}${alts}${plural}</div>${meaning}${simple}${ex}`;
  }

  /* ---------- kelime ekleme ---------- */
  function findExisting(q) {
    const k = T.key(q);
    const kt = T.lowerTr(q.trim());
    return state.words.find((w) => T.key(w.de) === k || T.lowerTr(w.tr) === kt);
  }

  async function submitWord(q) {
    q = q.trim();
    if (!q || busy) return;
    const existing = findExisting(q);
    if (existing) return showKnown(existing, q);
    busy = true;
    hideBubbleQuiet();
    setMood('thinking');
    think(pick(['Moment… ich schaue nach', 'hmm, ich erkläre es dir gleich', 'okay, sofort', 'kurz, ich notiere das']) + '…', 6000);
    const started = Date.now();
    let res = null, err = null;
    try { res = await window.Translator.lookup(q); } catch (e) { err = e; }
    const wait = Math.max(0, 1100 - (Date.now() - started));
    await sleep(wait);
    if (err || !res || !res.de || !res.tr) {
      busy = false;
      setMood('sad', 2500);
      manualEntry(q);
      return;
    }
    // model yazımı düzeltmiş olabilir (ör. verwisen → verweisen): düzeltilmiş hâli de kontrol et
    const dup = findByDe(res.de);
    if (dup) { busy = false; return showKnown(dup, q); }
    setMood('typing');
    think('ich schreibe es in mein Heft…', 1200);
    await sleep(900);
    const w = addWord(res);
    logEvent('lookup', { q, de: fullDe(w), tr: w.tr, pos: w.pos });
    showUsage(w);
    busy = false;
    setMood('talking', 1500);
    showBubble(`${wordCard(w, 'neues Wort · steht jetzt in meinem Heft', { say: true })}
      <div class="b-actions"><button class="btn sm" data-act="close">ok</button><button class="btn sm" data-act="edit" data-id="${w.id}">korrigieren</button></div>`,
      'info', { autoClose: 25000 });
    if (state.settings.voice === 'on') say(fullDe(w));
    celebrateGoal();
  }

  function showKnown(w, q) {
    logEvent('lookup_again', { q, de: fullDe(w), level: w.level });
    showUsage(w);
    const typo = q && deKey(q) !== deKey(w.de) && T.lowerTr(q.trim()) !== T.lowerTr(w.tr)
      ? `<div class="b-hint">man schreibt: <b>${esc(fullDe(w))}</b></div>` : '';
    setMood('happy', 1800);
    showBubble(`${wordCard(w, 'das kennen wir schon ✓', { ex: nextSentence(w, false, false) || w.ex })}${typo}
      <div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 15000 });
    if (state.settings.voice === 'on') say(fullDe(w));
  }

  function hideBubbleQuiet() {
    clearTimeout(bubbleTimer);
    bubble.hidden = true;
    bubbleKind = null;
    placeAllBubbles();
  }

  function addWord(res) {
    const already = findByDe(res.de);
    if (already) return already; // aynı kelime ikinci kez eklenmez
    const now = Date.now();
    const w = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      de: res.de, art: res.art || '', tr: res.tr, alts: res.alts || [], pos: res.pos || '',
      plural: res.plural || '', meaning_tr: res.meaning_tr || '', explain_de: res.explain_de || '', say_de: res.say_de || '',
      ex: res.ex || null, dir: res.dir || 'tr2de', source: res.source || '',
      // yeni eklenen kelime 2'li öğrenme çiftine girer (2 doğru üst üste → 3dk → 5dk → ... → 90g)
      level: 0, due: now + 20 * 1000, created: now, reviews: 0, correct: 0, lapses: 0, last: 0,
      ease: EASE0, ivl: INTERVALS[0], reps: 0, recentErr: 0, seenAt: 0, pairHits: 0, pairDone: false,
      pool: res.ex ? [{ de: res.ex.de, tr: res.ex.tr || '', n: 1, last: now }] : [], asked: [],
    };
    if (res.ex) markShown(res.ex.de);
    state.words.push(w);
    if (typeof ensureImage === 'function') setTimeout(() => ensureImage(w), 0);
    if (typeof queueUsage === 'function') setTimeout(() => queueUsage(w), 0);
    day().added = todayAdded();
    save();
    render();
    return w;
  }

  let celebratedDay = '';
  function celebrateGoal() {
    const n = todayAdded();
    if (n === state.settings.dailyGoal && celebratedDay !== todayKey()) {
      celebratedDay = todayKey();
      setTimeout(() => {
        if (bubbleKind) return;
        setMood('happy', 3000);
        showBubble(`<div class="b-tag">Tagesziel</div><div class="b-big">Geschafft!</div>
          <div class="b-hint">Heute ${n} neue Wörter. Toll gemacht${nameTag(', ')}!</div>`, 'info', { autoClose: 5000 });
      }, 6000);
    }
  }

  function manualEntry(q) {
    const g = T.guessLang(q);
    const deV = g === 'de' ? q : '', trV = g === 'de' ? '' : q;
    showBubble(`<div class="b-tag">ich komme gerade nicht ins Internet</div>
      <div class="b-hint">Schreibst du mir die Bedeutung? Ich notiere sie.</div>
      <form class="b-edit" data-form="manual">
        <div class="row"><label>Artikel<select name="art"><option value=""></option><option>der</option><option>die</option><option>das</option></select></label>
        <label style="flex:1">Deutsch<input name="de" value="${esc(deV)}" autocapitalize="off"></label></div>
        <label>Türkisch<input name="tr" value="${esc(trV)}" autocapitalize="off"></label>
        <div class="b-actions"><button class="btn sm solid" type="submit">speichern</button><button class="btn sm" type="button" data-act="close">abbrechen</button></div>
      </form>`, 'edit');
  }

  function editWord(id) {
    const w = state.words.find((x) => x.id === id);
    if (!w) return;
    showBubble(`<div class="b-tag">korrigieren</div>
      <form class="b-edit" data-form="edit" data-id="${w.id}">
        <div class="row"><label>Artikel<select name="art">${['', 'der', 'die', 'das'].map((a) => `<option${a === w.art ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
        <label style="flex:1">Deutsch<input name="de" value="${esc(w.de)}" autocapitalize="off"></label></div>
        <label>Türkisch<input name="tr" value="${esc(w.tr)}" autocapitalize="off"></label>
        <label>Beispielsatz<input name="ex" value="${esc(w.ex ? w.ex.de : '')}" autocapitalize="off"></label>
        <div class="b-actions"><button class="btn sm solid" type="submit">speichern</button><button class="btn sm" type="button" data-act="delete" data-id="${w.id}">löschen</button><button class="btn sm" type="button" data-act="close">abbrechen</button></div>
      </form>`, 'edit');
  }

  /* ---------- tekrar (aralıklı tekrar) ---------- */
  let current = null; // {w, mode, answer}

  function dueWords() {
    const now = Date.now();
    return state.words.filter((w) => w.due <= now).sort((a, b) => a.due - b.due);
  }

  /** Sadece iki soru türü: resimli ("Was ist das?") ve Türkçe → Almanca */
  function pickMode(w) {
    if (!w.img) return 'tr2de';
    if (w.lastMode === 'picture') return Math.random() < 0.75 ? 'tr2de' : 'picture';
    if (w.lastMode === 'tr2de') return Math.random() < 0.75 ? 'picture' : 'tr2de';
    return Math.random() < 0.55 ? 'picture' : 'tr2de';
  }

  const REVIEW_OPTS = { autoClose: 120000, onTimeout: () => postpone() };
  function postpone() {
    if (current && current.w) {
      const until = Date.now() + 5 * MIN;
      current.w.due = Math.max(current.w.due, until);
      current.w.skippedUntil = until;
    }
    current = null;
    save();
  }

  function startReview(w, mode) {
    if (!w) return;
    const hasSentence = freshSentences(w) > 0;
    mode = mode || pickMode(w, hasSentence);
    if (mode !== 'picture' && mode !== 'tr2de') mode = pickMode(w); // diğer türler kaldırıldı
    if (mode === 'picture' && !w.img) mode = 'tr2de';
    const ex = mode === 'reverse' || mode === 'picture' || mode === 'tr2de' ? null : nextSentence(w, true);
    const exW = ex && wordIn(ex.de, w);
    if (mode === 'cloze' && !exW) mode = 'reverse';
    w.lastMode = mode;
    touch(w);
    hideUsageFor(w);
    current = { w, mode, ex, revealed: false, started: Date.now() };
    setMood('talking', 1200);
    if (mode === 'cloze') {
      current.answer = exW;
      showBubble(`<div class="b-tag">${pick(['Was passt in die Lücke?', 'Ergänze den Satz!', 'Na, welches Wort fehlt?'])}</div>
        <div class="b-ex" style="border:0;margin:0;padding:0">„${highlight(ex.de, exW, 'gap')}“</div>
        <div class="b-hint">Tipp: ${esc(w.explain_de ? maskWord(w.explain_de, w) : w.tr)}${w.explain_de ? `<span class="tr"> · ${esc(w.tr)}</span>` : ''}${ex.tr ? `<span class="tr"><i>${esc(ex.tr)}</i></span>` : ''}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="welches Wort?" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">weiß nicht</button><button class="btn sm" data-act="later">später</button></div>`, 'review', REVIEW_OPTS);
    } else if (mode === 'picture') {
      current.answer = w.de;
      showBubble(`<div class="b-tag">${pick(['Was ist das?', 'Na, was siehst du?', 'Wie heißt das auf Deutsch?'])}</div>
        <img class="b-img big" src="${esc(w.img)}" alt="">
        <div class="b-hint tr">${esc(w.tr)}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="${w.pos === 'n' ? 'Artikel + Wort' : 'auf Deutsch'}" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="hint">Tipp</button><button class="btn sm" data-act="giveup">weiß nicht</button><button class="btn sm" data-act="later">später</button></div>`, 'review', REVIEW_OPTS);
    } else if (mode === 'tr2de') {
      // Türkçe düşün, Almanca söyle: Türkçesi görünür, Almancası yazılır
      current.answer = w.de;
      showBubble(`<div class="b-tag">${pick(['Wie sagt man das auf Deutsch?', 'Und auf Deutsch?', 'Auf Deutsch, bitte!', `${nameTag('', ', ')}wie heißt das auf Deutsch?`])}</div>
        <div class="b-big tr-prompt">„${esc(w.tr)}“</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="${w.pos === 'n' ? 'Artikel + Wort' : 'auf Deutsch'}" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="hint">Tipp</button><button class="btn sm" data-act="giveup">weiß nicht</button><button class="btn sm" data-act="later">später</button></div>`, 'review', REVIEW_OPTS);
    } else if (mode === 'reverse') {
      current.answer = w.de;
      showBubble(`<div class="b-tag">${pick(['Wie heißt das auf Deutsch?', 'Welches Wort suche ich?', 'Na, wie sagt man das?'])}</div>
        ${w.explain_de ? `<div class="b-simple"><span>einfach gesagt</span>${esc(maskWord(w.explain_de, w))}</div><div class="b-hint tr">${esc(w.tr)}</div>` : `<div class="b-big">${esc(w.tr)}</div>`}
        <form class="b-form" data-form="answer"><input name="a" placeholder="${w.pos === 'n' ? 'Artikel + Wort' : 'auf Deutsch'}" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">weiß nicht</button><button class="btn sm" data-act="later">später</button></div>`, 'review', REVIEW_OPTS);
    } else {
      current.mode = 'recall';
      const sentence = ex ? `<div class="b-ex" style="border:0;margin:0;padding:0">„${highlight(ex.de, w.de) || esc(ex.de)}“</div>` : '';
      showBubble(`<div class="b-tag">${pick(['Erinnerst du dich?', 'Was war das nochmal?', 'Kennst du das noch?'])}</div>
        <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
        ${sentence}
        <div class="b-actions"><button class="btn sm solid" data-act="reveal">zeigen</button><button class="btn sm" data-act="later">später</button></div>`, 'review', { ...REVIEW_OPTS, focus: false });
    }
    updateTitle();
  }

  function reveal() {
    const w = current.w;
    current.revealed = true;
    showBubble(`${wordCard(w, 'Hast du es gewusst?', { ex: current.ex })}
      <div class="b-actions"><button class="btn sm solid" data-act="knew">gewusst ✓</button><button class="btn sm" data-act="forgot">nicht gewusst</button></div>`, 'review', { focus: false });
  }

  function normalize(s) {
    return String(s || '').normalize('NFC').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[„“"'.,!?;:()]/g, ' ')
      .replace(/(^|\s)(der|die|das|den|dem|des|ein|eine|einen|einem|einer)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[m][n];
  }

  function checkAnswer(input) {
    const w = current.w;
    const a = normalize(input), b = normalize(current.answer);
    if (!a) return;
    let ok = a === b;
    let note = '';
    if (!ok && b.length >= 5 && lev(a, b) <= 1) { ok = true; note = `kleiner Tippfehler: <b>${esc(current.answer)}</b>`; }
    if (ok && ['reverse', 'picture', 'tr2de'].includes(current.mode) && w.art) {
      const m = input.trim().toLowerCase().match(/^(der|die|das)\s/);
      if (!m) note = note || `mit Artikel: <b>${esc(fullDe(w))}</b>`;
      else if (m[1] !== w.art) note = `Artikel: <b>${esc(w.art)}</b> – ${esc(fullDe(w))}`;
    }
    current.input = input;
    grade(ok, note);
  }

  /** Cevap kalitesi 0–5: doğruluk, yazım/artikel notu ve cevap süresi */
  function quality(ok, note, ms, mode) {
    if (!ok) return 1;
    if (note) return 3;
    if (mode === 'recall') return 4; // kendi değerlendirmen
    if (ms < 7000) return 5;
    if (ms < 18000) return 4;
    return 3;
  }

  /** Henüz 2'li yeni kelime çalışmasından mezun olmamış kelime mi? */
  const needsPair = (w) => !w.pairDone && (w.level || 0) === 0;

  /**
   * 90 günlük basamaklı aralıklı tekrar + 2'li yeni kelime öğretimi:
   * Yeni kelimeler 2'li çift halinde üst üste 2 doğru yapılana kadar döner;
   * ardından 3dk → 5dk → 10dk → 1sa → 4sa → 12sa → 1g → 3g → 7g → 14g → 30g → 60g → 90g
   * sırasıyla ilerler. Hata yapılırsa aynı seviyede ve aynı sürede kalır.
   */
  function review(w, q) {
    const now = Date.now();
    const wasDue = w.due <= now + 30 * 1000;
    let advanced = false;
    w.ease = w.ease || EASE0;
    const curLevel = Math.max(0, Math.min(INTERVALS.length - 1, levelFromIvl(w.ivl || INTERVALS[0])));
    w.ivl = INTERVALS[curLevel];
    w.reviews++;
    w.last = now;
    if (q >= 3) w.correct++;
    else { w.lapses++; w.recentErr = Math.min(5, (w.recentErr || 0) + 1); }

    if (needsPair(w)) {
      if (q < 3) {
        // 2'li öğrenmede hata: seri sıfırlanır, kelime eşiyle birlikte dönmeye devam eder
        w.pairHits = 0;
        w.ease = clampEase(w.ease - 0.15);
        w.level = 0;
        w.ivl = INTERVALS[0];
        w.due = now + 20 * 1000;
      } else {
        w.pairHits = (w.pairHits || 0) + 1;
        w.ease = clampEase(w.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
        if (q >= 4) w.recentErr = Math.max(0, (w.recentErr || 0) - 1);
        if (w.pairHits >= PAIR_GOAL) {
          // Üst üste 2 doğru → çiftten mezun ol ve normal 90 günlük SRS'e (3 dk) başla
          w.pairDone = true;
          w.reps = Math.max(1, (w.reps || 0) + 1);
          w.level = 0;
          w.ivl = INTERVALS[0];
          w.due = now + w.ivl * (0.94 + Math.random() * 0.12);
          state.learnPair = (state.learnPair || []).filter((id) => id !== w.id);
          advanced = true;
        } else {
          // 1/2 doğru: çiftte kal, eşiyle bir tur daha dön
          w.level = 0;
          w.ivl = INTERVALS[0];
          w.due = now + 20 * 1000;
        }
      }
    } else if (wasDue) {
      if (q < 3) {
        // Hata: aynı seviyede ve aynı sürede kalır, bir sonraki seviyeye geçmez
        w.ease = clampEase(w.ease - 0.15);
        w.level = curLevel;
        w.ivl = INTERVALS[curLevel];
        w.due = now + w.ivl;
      } else {
        w.reps = (w.reps || 0) + 1;
        w.ease = clampEase(w.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
        const nextLevel = Math.min(INTERVALS.length - 1, curLevel + 1);
        w.level = nextLevel;
        w.ivl = INTERVALS[nextLevel];
        if (q >= 4) w.recentErr = Math.max(0, (w.recentErr || 0) - 1);
        advanced = nextLevel > curLevel;
        w.due = now + w.ivl * (0.94 + Math.random() * 0.12);
      }
    } else if (q < 3) {
      // Erken pratikte/tazelemede hata: aynı seviyede ve aynı sürede kalır, uzamaz
      w.ease = clampEase(w.ease - 0.1);
      w.level = curLevel;
      w.ivl = INTERVALS[curLevel];
      w.due = Math.min(w.due, now + w.ivl);
    } else {
      w.level = curLevel;
      if (q === 5) w.ease = clampEase(w.ease + 0.02);
    }
    const d = day();
    d.reviewed++;
    if (q >= 3) d.correct++;
    save();
    render();
    return advanced;
  }
  function applyResult(w, ok) { return review(w, ok ? 4 : 1); }
  function record(w, q) { return review(w, typeof q === 'number' ? q : (q ? 4 : 1)); }

  function grade(ok, note) {
    const w = current.w;
    const shownEx = current.ex || null;
    logEvent('quiz', { mode: current.mode, de: fullDe(w), tr: w.tr, ok, answer: current.input || (ok ? '(bildim)' : '(bilemedim)'), expected: current.answer });
    const now = Date.now();
    showUsage(w); // ikinci çalışan aynı anda kullanım kartını gösterir
    let q = quality(ok, note, now - (current.started || now), current.mode);
    if (ok && current.hinted) q = Math.min(q, 3); // ipucu aldıysan "zor" sayılır
    const wasPair = needsPair(w);
    const advanced = review(w, q);
    const nextTxt = humanize(w.due - now);
    const progressTxt = wasPair && needsPair(w)
      ? `Lernpaar ${w.pairHits}/${PAIR_GOAL} ✓ · kommt gleich nochmal`
      : wasPair && w.pairDone
        ? `Gemerkt (${PAIR_GOAL}/${PAIR_GOAL}) ✓ · nächste Wiederholung ${nextTxt}`
        : (advanced ? `nächste Wiederholung ${nextTxt}` : `Extra-Übung ✓ · Wiederholung ${nextTxt}`);
    sfx(ok ? 'ok' : 'no');
    if (ok) {
      setMood('happy', 2200);
      const praise = q === 5 ? pick(['Blitzschnell!', `Wow${nameTag(', ')}, sofort gewusst!`, 'Ohne Nachdenken – stark!']) : pick(['Super!', 'Sehr gut!', 'Genau!', `Stark${nameTag(', ')}!`, 'Perfekt!', `Klasse${nameTag(', ')}!`]);
      showBubble(`<div class="b-tag">${praise}</div>
        <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
        <div class="b-mean">${esc(w.tr)}</div>
        ${note ? `<div class="b-hint">${note}</div>` : ''}
        ${q === 3 && !note ? '<div class="b-hint">richtig – aber noch etwas langsam, wir üben das öfter</div>' : ''}
        <div class="b-hint">${progressTxt}</div>`, 'feedback', { autoClose: note ? 3000 : 1600 });
    } else {
      setMood('sad', 2500);
      showBubble(`${wordCard(w, 'kein Problem – so ist es richtig, ich frage dich wieder', { ex: shownEx })}
        <div class="b-actions"><button class="btn sm solid" data-act="close">ok</button></div>`, 'feedback', { autoClose: 6000, focus: false });
    }
    if (state.settings.voice === 'on') say(fullDe(w));
    current = null;
  }

  function humanize(ms) {
    if (ms < MIN) return 'gleich';
    if (ms < HOUR) return 'in ' + Math.round(ms / MIN) + ' Min.';
    if (ms < DAY) return 'in ' + Math.round(ms / HOUR) + ' Std.';
    const d = Math.round(ms / DAY);
    return 'in ' + d + (d === 1 ? ' Tag' : ' Tagen');
  }

  /* ---------- arkadaş: düşünce balonları ---------- */
  const thought = $('thought');
  let thoughtTimer = 0;
  let recentThoughts = [];
  let nextThoughtAt = Date.now() + 9000;
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function think(text, ms = 4500) {
    if (!bubble.hidden || state.paused) return;
    clearTimeout(thoughtTimer);
    thought.textContent = text;
    thought.hidden = false;
    thought.style.animation = 'none';
    void thought.offsetWidth;
    thought.style.animation = '';
    placeThought();
    thoughtTimer = setTimeout(hideThought, ms);
    nextThoughtAt = Date.now() + 9000 + Math.random() * 12000;
  }
  function hideThought() {
    clearTimeout(thoughtTimer);
    thought.hidden = true;
  }
  function placeThought() {
    if (thought.hidden) return;
    const a = scene.headAnchor();
    const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const hx = cr.left - sr.left + a.x;
    const hy = cr.top - sr.top + a.y;
    const tw = thought.offsetWidth;
    const left = Math.max(8, Math.min(hx + 6, sr.width - tw - 8));
    thought.style.left = left + 'px';
    thought.style.bottom = (sr.height - hy + 26) + 'px';
    thought.style.setProperty('--tx', Math.max(10, hx - left + 4) + 'px');
  }
  window.addEventListener('resize', placeThought);

  function idleThought() {
    const ws = state.words;
    const w = ws.length ? pick(ws) : null;
    const d = day();
    const h = new Date().getHours();
    const lines = [
      'ich suche neue Wörter für dich…',
      'ich lerne hier für dich – entspann dich',
      'hmm… was bringe ich dir heute bei?',
      'diese Schreibmaschine ist echt laut',
      'noch ein Kaffee vielleicht…',
      'ich poliere ein paar Sätze für dich',
      'der, die, das… puh',
    ];
    if (w) {
      lines.push(`„${fullDe(w)}“ – ich schreibe einen neuen Satz…`);
      lines.push(`${nameTag('', ', ')}vergiss „${w.de}“ nicht, ja?`);
      lines.push(`${fullDe(w)}… ${fullDe(w)}… okay, gemerkt`);
    }
    const nToday = todayAdded();
    if (nToday) lines.push(`heute schon ${nToday} neue Wörter – nicht schlecht!`);
    if (nToday < state.settings.dailyGoal && nToday > 0) lines.push(`noch ${state.settings.dailyGoal - nToday} Wörter bis zum Tagesziel`);
    if (h >= 23 || h < 6) lines.push('es ist spät, aber ich bin noch da', 'ich bin müde… aber weiter geht’s');
    if (h >= 6 && h < 11) lines.push(`guten Morgen${nameTag(', ')}! Der Kaffee geht auf mich`);
    lines.push(`${nameTag('', ', ')}ich bin stolz auf dich`, `${nameTag('', ', ')}wir schaffen das zusammen`);
    if (aiQueue.length) lines.push('ich habe ein paar Sätze vorbereitet…');
    if (scene.mood !== 'thinking' && Math.random() < 0.5) setMood('thinking', 4500);
    const fresh = lines.filter((l) => !recentThoughts.includes(l));
    const line = pick(fresh.length ? fresh : lines);
    recentThoughts = [...recentThoughts, line].slice(-12);
    think(line);
  }

  /* ---------- arkadaş: modelden gelen konuşma kuyruğu ---------- */
  let aiQueue = [];
  let aiFetching = false;
  let aiNextFetch = 0;
  let pendingNew = null;
  let askCtx = null;

  let lastFocus = new Set();
  function focusWords() {
    const now = Date.now();
    const score = (w) => (w.due <= now ? 0 : 10) + w.level - difficulty(w) * 2 + Math.random() * 3 + (lastFocus.has(w.id) ? 6 : 0);
    const list = [...state.words].map((w) => [score(w), w]).sort((a, b) => a[0] - b[0]).slice(0, 6).map((x) => x[1]);
    lastFocus = new Set(list.map((w) => w.id));
    return list.map((w) => ({
      id: w.id, de: w.de, art: w.art, tr: w.tr, level: w.level,
      avoid: [...(w.pool || []).map((p) => p.de), ...(w.asked || [])].slice(-8),
    }));
  }

  let poolFetchAt = 0;
  async function growPoolOffline() {
    if (Date.now() < poolFetchAt || !state.words.length || !navigator.onLine) return;
    poolFetchAt = Date.now() + 30 * 1000;
    const w = [...state.words].sort((a, b) => (a.pool || []).length - (b.pool || []).length || a.level - b.level)[0];
    if (!w || (w.pool || []).length >= 6) return;
    try {
      const ex = await T.findExample(w.de, w.pos, w.art, true);
      if (ex && ex.de && !seen(ex.de) && wordIn(ex.de, w)) { addToPool(w, ex.de, ex.tr); save(); }
    } catch (e) { /* sessizce geç */ }
  }

  async function refillQueue() {
    if (window.AI && !AI.available()) return growPoolOffline();
    if (!window.AI || !AI.available() || aiFetching || state.paused || aiQueue.length >= 2 || Date.now() < aiNextFetch) return;
    aiFetching = true;
    aiNextFetch = Date.now() + 2 * MIN; // sadece yeni kelime önerisi ve sohbet için: seyrek
    try {
      const n = state.words.length;
      const wantNew = n < 3 || (n < 15 ? Math.random() < 0.3 : Math.random() < 0.12);
      const known = [...state.words.map((w) => w.de), ...(state.skipped || [])].slice(-150);
      const items = (await AI.talk(focusWords(), known, true, 2, true)).filter((it) => it.type === 'new' || it.type === 'chat');
      items.forEach((it) => { it._t = Date.now(); });
      // daha önce gösterilenleri ele, aynı kelimeyi arka arkaya koyma
      items.filter((it) => !seen(it.de) && !seen(it.q_de) && !seen(it.text_de) && !aiQueue.some((q) => sentKey(q.de || q.q_de || q.text_de) === sentKey(it.de || it.q_de || it.text_de)))
        .forEach((it) => aiQueue.push(it));
      aiQueue.sort(() => Math.random() - 0.5);
    } catch (e) { /* model yoksa yerel konuşmaya devam */ }
    aiFetching = false;
  }

  function wordById(it) {
    return state.words.find((w) => w.id === it.id) ||
      (it.answer && state.words.find((w) => T.key(w.de) === T.key(it.answer))) || null;
  }

  let sinceRefresh = 0; // öğrenilmiş kelime tazelemesinden beri kaç soru geçti

  /** Aktif 2'li öğrenme çiftini canlı tut (mezun olanı çıkar, boşalan yere sıradaki yeni kelimeyi al) */
  function syncLearnPair(now = Date.now()) {
    const byId = new Map(state.words.map((w) => [w.id, w]));
    const prev = Array.isArray(state.learnPair) ? state.learnPair : [];
    const active = [];
    const seenIds = new Set();
    for (const id of prev) {
      const w = byId.get(id);
      if (w && needsPair(w) && (w.skippedUntil || 0) <= now && !seenIds.has(id)) {
        active.push(w);
        seenIds.add(id);
        if (active.length >= PAIR_SIZE) break;
      }
    }
    if (active.length < PAIR_SIZE) {
      // Son 24 saatte eklenen yeni kelimeler önce, kendi içlerinde eklenme sırasına göre (1-2, 3-4, 5-6)
      const candidates = state.words
        .filter((w) => needsPair(w) && !seenIds.has(w.id) && (w.skippedUntil || 0) <= now)
        .sort((a, b) => {
          const ra = now - (a.created || 0) < DAY ? 0 : 1;
          const rb = now - (b.created || 0) < DAY ? 0 : 1;
          if (ra !== rb) return ra - rb;
          return (a.created || 0) - (b.created || 0);
        });
      for (const w of candidates) {
        active.push(w);
        seenIds.add(w.id);
        if (active.length >= PAIR_SIZE) break;
      }
    }
    const nextIds = active.map((w) => w.id);
    if (nextIds.length !== prev.length || nextIds.some((id, i) => id !== prev[i])) {
      state.learnPair = nextIds;
      save(false);
    }
    return active;
  }

  /** Aktif 2'li çiftte sırada bekleyen (henüz çifte girmemiş) yeni kelime mi? */
  const isWaitingPair = (w) => needsPair(w) && !(state.learnPair || []).includes(w.id);

  /** Aktif 2'li çiftten sıradaki soruyu seç: iki kelime öğrenilene kadar aralarında döner */
  function pickPairWord(allowImmediate = false) {
    const now = Date.now();
    const pair = syncLearnPair(now);
    if (!pair.length) return null;
    const ready = pair.filter((w) => allowImmediate || (w.reviews || 0) > 0 || now - (w.created || 0) >= 15 * 1000);
    if (!ready.length) return null;
    // Yeni bir çifte henüz başlanmadıysa ve az önce mezun olmuş 3dk/5dk'lık bir kelimenin zamanı geldiyse önce onu pekiştir
    const pairStarted = pair.some((w) => (w.reviews || 0) > 0);
    if (!pairStarted && state.words.some((w) => w.pairDone && (w.level || 0) <= 1 && w.due <= now && !cooling(w))) {
      return null;
    }
    if (ready.length >= 2) {
      // 45 sn beklemesine takılmadan çiftteki iki kelime arasında sırayla dön
      return ready.find((w) => w.id !== lastWordId) || ready[0];
    }
    // Tek yeni kelime kaldıysa ve az önce onu sormadıysak hemen sor; az önce sorduysak araya 1 başka kelime girsin
    const only = ready[0];
    if (only.id !== lastWordId || state.words.length === 1) return only;
    return null;
  }

  /** Öğrenilmiş kelimelerden en uzun süredir görülmeyeni seç (nadiren tazeleme için) */
  function pickRefresher() {
    const pool = state.words.filter((w) => isMastered(w) && !cooling(w));
    if (!pool.length) return null;
    const sorted = [...pool].sort((a, b) => (a.last || a.seenAt || 0) - (b.last || b.seenAt || 0));
    return pick(sorted.slice(0, Math.min(3, sorted.length)));
  }

  /** Ekstra pratikte ağırlık yeni eklenen / düşük seviyeli kelimelerde; hepsi öğrenilmişse eskilerden seç */
  function pickPracticeWord(pool) {
    const now = Date.now();
    const visible = pool.filter((x) => !isWaitingPair(x));
    const base = visible.length ? visible : pool;
    const learning = base.filter((x) => !isMastered(x));
    const src = learning.length ? learning : base;
    const pscore = (x) => {
      const freshBonus = (now - (x.created || 0)) < 6 * HOUR && (x.level || 0) <= 2 ? -4 : 0;
      return (x.level || 0) * 3.5 + seenTodayOf(x) * 1.4 - difficulty(x) * 3.0 + freshBonus;
    };
    const top = [...src].sort((a, b) => pscore(a) - pscore(b) || (a.seenAt || 0) - (b.seenAt || 0)).slice(0, 3);
    return pick(top);
  }

  /** Zamanı gelmiş kelimelerde en düşük seviyeli / yeni kelimeler her zaman önce gelir */
  function pickDueWord(due) {
    if (!due.length) return null;
    return [...due].sort((a, b) => {
      const la = a.level || 0, lb = b.level || 0;
      if (la !== lb) return la - lb;
      return a.due - b.due;
    })[0];
  }

  /** Öğrenilmiş kelimeleri gerçekten nadiren (~8–10 soruda bir) tazeleme olarak getir; yeni çift çalışırken araya girmesin */
  function maybePickRefresher() {
    const now = Date.now();
    if (state.words.some((w) => needsPair(w) && (w.skippedUntil || 0) <= now)) return null;
    if (sinceRefresh < 7) return null;
    if (sinceRefresh < 10 && Math.random() >= 0.35) return null;
    return pickRefresher();
  }

  function askWithRefreshTrack(w) {
    if (!w) return;
    sinceRefresh = isMastered(w) ? 0 : sinceRefresh + 1;
    return startReview(w);
  }

  function nextTalk() {
    // 0) yeni eklenen kelimeleri 2'li çift halinde öğrenilene kadar döndür
    const pairWord = pickPairWord(false);
    if (pairWord) return askWithRefreshTrack(pairWord);
    // 1) öğrenilmiş kelimeleri unutmamak için nadiren (~8–10 soruda bir) tazeleme
    const refresh = maybePickRefresher();
    if (refresh) return askWithRefreshTrack(refresh);
    // 2) zamanı gelen kelime (en düşük seviyeli / yeni kelimeler önce, sonra eskiler; bekleyen çift dışı yeniler sızmaz)
    const due = dueWords().filter((w) => !cooling(w) && !isWaitingPair(w));
    if (due.length) return askWithRefreshTrack(pickDueWord(due));
    // 3) arada modelden yeni kelime önerisi ya da kısa bir sohbet satırı (aktif çift varken bölme)
    aiQueue = aiQueue.filter((it) => (it.type === 'new' || it.type === 'chat') && Date.now() - (it._t || 0) < 20 * MIN);
    if (!(state.learnPair && state.learnPair.length) && aiQueue.length && (Math.random() < 0.12 || state.words.length < 3)) {
      const it = aiQueue.shift();
      if (showAiItem(it)) return;
    }
    // 4) ekstra pratik: ağırlık düşük seviyeli / öğrenilmekte olan kelimelerde
    const rested = state.words.filter((w) => !cooling(w) && !isWaitingPair(w));
    if (rested.length) return askWithRefreshTrack(pickPracticeWord(rested));
    // hepsi yeni görüldüyse bile boş bekleme: yine önce öğrenilmekte olanlardan seç
    const others = state.words.filter((w) => (w.id !== lastWordId || state.words.length === 1) && !isWaitingPair(w));
    if (others.length) {
      const learning = others.filter((w) => !isMastered(w));
      const src = learning.length ? learning : others;
      return askWithRefreshTrack([...src].sort((a, b) => (a.level || 0) - (b.level || 0) || (a.seenAt || 0) - (b.seenAt || 0))[0]);
    }
    if (state.words.length < 5) aiNextFetch = Math.min(aiNextFetch, Date.now() + 3000);
    nextReviewAt = Date.now() + 5000;
    idleThought();
  }

  function showExample(w, de, tr, note, already) {
    if (!already) { markShown(de); addToPool(w, de, tr); save(); }
    touch(w);
    setMood('talking', 1400);
    const hl = highlight(de, w.de) || esc(de);
    showBubble(`<div class="b-tag">${pick(['Schau mal, dieser Satz:', 'So benutzt man das:', 'Damit du es dir merkst:'])}</div>
      <div class="b-ex" style="border:0;margin:0;padding:0">„${hl}“ <button class="btn speak" data-act="say-ex" data-text="${esc(de)}" aria-label="Sesli oku">${speakerSvg}</button>${tr ? `<span class="tr">${esc(tr)}</span>` : ''}</div>
      <div class="b-hint">${w.art ? esc(w.art) + ' ' : ''}<b>${esc(w.de)}</b> = ${esc(w.tr)}</div>
      ${note ? `<div class="b-say">${esc(note)}</div>` : ''}
      <div class="b-actions"><button class="btn sm" data-act="close">verstanden</button></div>`, 'chat', { autoClose: 18000 });
    return true;
  }

  function showAiItem(it) {
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    if (seen(it.de) || seen(it.q_de) || seen(it.text_de)) return false;
    if (it.type === 'chat' && s(it.text_de)) { markShown(it.text_de); think(s(it.text_de), 3500); nextReviewAt = Date.now() + 2500; return true; }
    if (it.type === 'new') return suggestNew(it);
    return false; // örnek / boşluk / soru / ipucu türleri kaldırıldı: soru sadece resimli ya da Türkçe → Almanca
  }

  const suggestQueue = [];
  let suggestBusy = false;
  let suggestBrowse = false;

  const isSkippedWord = (de) => {
    const k = T.key(de || '');
    return !!k && (state.skipped || []).some((x) => T.key(x) === k);
  };

  function normalizeSuggestion(it) {
    const s = (v, n = 220) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const de = s(it && it.de, 60).replace(/^(der|die|das)\s+/i, '');
    const tr = s(it && it.tr, 80);
    if (!de || !tr || findExisting(de) || isSkippedWord(de)) return null;
    const art = ['der', 'die', 'das'].includes(s(it.art, 10).toLowerCase()) ? s(it.art, 10).toLowerCase() : '';
    const cefr = ['B1', 'B2', 'C1'].includes(s(it.level_cefr, 4).toUpperCase()) ? s(it.level_cefr, 4).toUpperCase() : '';
    const alts = Array.isArray(it.alts) ? it.alts.map((a) => s(a, 40)).filter(Boolean).slice(0, 2) : [];
    const ex = it.example && s(it.example.de, 220) ? { de: s(it.example.de, 220), tr: s(it.example.tr, 220), src: 'muse' } : null;
    return {
      de, art, tr, alts,
      plural: s(it.plural, 60),
      pos: ['n', 'v', 'a', 'd'].includes(it.pos) ? it.pos : (art ? 'n' : ''),
      cefr,
      why_de: s(it.why_de, 160),
      why_tr: s(it.why_tr, 160),
      explain_de: s(it.explain_de, 260),
      ex,
      dir: 'tr2de',
      source: 'muse',
    };
  }

  function suggestNew(it, opts = {}) {
    const item = it && it.dir === 'tr2de' && it.de ? it : normalizeSuggestion(it);
    if (!item || findExisting(item.de) || isSkippedWord(item.de)) return false;
    if (item.ex && item.ex.de) markShown(item.ex.de);
    pendingNew = item;
    const browse = !!opts.browse;
    suggestBrowse = browse;
    $('suggestBtn').classList.toggle('on', browse);
    const badge = item.cefr ? `<span class="b-cefr">${esc(item.cefr)}</span>` : '';
    const tag = `${badge}${browse ? 'ana dilde çok sevilen öneri' : pick(['Das benutzen Muttersprachler ständig', 'Ein starkes Alltagswort für dich', 'Hier, ein neues Alltagswort'])}`;
    const toast = opts.toast ? `<div class="b-toast">${esc(opts.toast)}</div>` : '';
    const why = item.why_de
      ? `<div class="b-say">${esc(item.why_de)}${item.why_tr ? `<span class="tr"> (${esc(item.why_tr)})</span>` : ''}</div>`
      : '';
    setMood('talking', 1500);
    showBubble(`${toast}${wordCard(item, tag, { noImg: true })}${why}
      <div class="b-actions">
        <button class="btn sm solid" data-act="addnew">+ Listeye ekle</button>
        <button class="btn sm" data-act="skip">Biliyorum / Geç</button>
        ${browse ? '<button class="btn sm" data-act="close-suggest">Kapat</button>' : ''}
      </div>`, 'chat', { autoClose: browse ? 0 : 18000, focus: false });
    if (state.settings.voice === 'on' && browse) say(fullDe(item));
    return true;
  }

  function closeSuggest() {
    suggestBrowse = false;
    pendingNew = null;
    $('suggestBtn').classList.remove('on');
    hideBubble();
  }

  async function suggestNext(toast = '') {
    if (suggestBusy) return;
    if (state.paused) $('pauseBtn').click();
    suggestBrowse = true;
    $('suggestBtn').classList.add('on');
    // kuyrukta geçerli öneri varsa anında göster
    while (suggestQueue.length) {
      const next = suggestQueue.shift();
      if (suggestNew(next, { browse: true, toast })) return;
    }
    if (!window.AI || !AI.suggest) {
      showBubble(`<div class="b-tag">Kelime Önerisi</div><div>AI istemcisi hazır değil.</div>
        <div class="b-actions"><button class="btn sm" data-act="close-suggest">Kapat</button></div>`, 'chat', { focus: false });
      return;
    }
    suggestBusy = true;
    setMood('thinking', 8000);
    showBubble(`${toast ? `<div class="b-toast">${esc(toast)}</div>` : ''}<div class="b-tag">B1–C1 · Kelime Önerisi</div>
      <div class="b-say">Öğrendiğin kelimelere bakıp ana dilde çok sevilen yeni kelimeler seçiyorum…</div>`, 'chat', { focus: false });
    try {
      // öğrendiği kelimelerden örneklem (öncelik en yüksek seviyeli / çok çalışılanlarda)
      const learned = [...state.words]
        .sort((a, b) => (b.level || 0) - (a.level || 0) || (b.reviews || 0) - (a.reviews || 0))
        .slice(0, 80)
        .map((w) => fullDe(w));
      const known = [...new Set([
        ...state.words.map((w) => w.de),
        ...(state.skipped || []),
      ])].slice(-500);
      const raw = await AI.suggest(learned, known, 5);
      const fresh = raw.map(normalizeSuggestion).filter(Boolean);
      fresh.forEach((x) => {
        if (!suggestQueue.some((q) => T.key(q.de) === T.key(x.de))) suggestQueue.push(x);
      });
      suggestBusy = false;
      if (suggestQueue.length) {
        const first = suggestQueue.shift();
        if (suggestNew(first, { browse: true, toast })) return;
      }
      showBubble(`<div class="b-tag">B1–C1 · Kelime Önerisi</div><div>Şu an yeni bir öneri çıkmadı, tekrar deneyebilirsin.</div>
        <div class="b-actions"><button class="btn sm solid" data-act="more-suggest">Tekrar dene</button><button class="btn sm" data-act="close-suggest">Kapat</button></div>`, 'chat', { focus: false });
    } catch (e) {
      suggestBusy = false;
      const msg = String((e && e.message) || e || '');
      const text = msg === 'unknown_action'
        ? 'Cloudflare Worker henüz güncellenmemiş: cloudflare/worker.js dosyasını Cloudflare panelinde Deploy ettikten sonra tekrar dene.'
        : 'Öneri alınamadı (' + (msg || 'bağlantı hatası') + ').';
      showBubble(`<div class="b-tag">B1–C1 · Kelime Önerisi</div><div>${esc(text)}</div>
        <div class="b-actions"><button class="btn sm" data-act="close-suggest">Kapat</button></div>`, 'chat', { focus: false });
    }
  }

  function addSuggested() {
    if (!pendingNew) return closeSuggest();
    const item = pendingNew;
    const wasBrowse = suggestBrowse;
    logEvent('accepted_suggestion', { de: (item.art ? item.art + ' ' : '') + item.de, tr: item.tr, cefr: item.cefr || '' });
    const w = addWord(item);
    pendingNew = null;
    showUsage(w);
    setMood('happy', 1800);
    celebrateGoal();
    if (wasBrowse) {
      suggestNext(`✓ „${fullDe(w)}“ listene eklendi`);
      return;
    }
    showBubble(`${wordCard(w, 'steht im Heft ✓ ich frage dich oft')}<div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 9000 });
    if (state.settings.voice === 'on') say(fullDe(w));
  }

  function skipSuggested() {
    const wasBrowse = suggestBrowse;
    const skippedName = pendingNew ? pendingNew.de : '';
    if (pendingNew) {
      logEvent('skipped_suggestion', { de: pendingNew.de, tr: pendingNew.tr });
      state.skipped = [...new Set([...(state.skipped || []), pendingNew.de])].slice(-300);
      save();
    }
    pendingNew = null;
    if (wasBrowse) {
      suggestNext(skippedName ? `Geçildi: ${skippedName}` : '');
    } else {
      hideBubble();
    }
  }

  async function answerAsk(answer) {
    if (!askCtx) return hideBubble();
    const { w, q } = askCtx;
    askCtx = null;
    hideBubbleQuiet();
    busy = true;
    setMood('thinking');
    think('ich lese… hmm', 8000);
    let res = null;
    try { res = await AI.check(q, fullDe(w), answer); } catch (e) { /* yedek */ }
    busy = false;
    const used = new RegExp(w.de.slice(0, Math.max(3, w.de.length - 2)), 'i').test(answer);
    const ok = res ? !!res.ok : used;
    sfx(ok ? 'ok' : 'no');
    logEvent('answer', { question: q, answer, ok, fix: res && res.fix_de });
    record(w, ok ? 4 : used ? 3 : 2);
    setMood(ok ? 'happy' : 'talking', 2200);
    const fix = res && typeof res.fix_de === 'string' && res.fix_de.trim() && normalize(res.fix_de) !== normalize(answer) ? res.fix_de.trim() : '';
    const fb = res && (res.feedback_de || res.feedback) ? (res.feedback_de || res.feedback) : (ok ? `Gut gemacht${nameTag(', ')}!` : `Versuch, „${fullDe(w)}“ zu benutzen.`);
    showBubble(`<div class="b-tag">${ok ? 'stark!' : 'fast!'}</div>
      <div>${esc(fb)}</div>
      ${fix ? `<div class="b-ex">besser so: „${esc(fix)}“ <button class="btn speak" data-act="say-ex" data-text="${esc(fix)}" aria-label="Sesli oku">${speakerSvg}</button></div>` : ''}
      <div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'feedback', { autoClose: 15000 });
  }

  /* ---------- kelime görselleri (Muse Image) ---------- */
  // Kelime başına bir kez üretilir (sunucuda saklanır, cihazlar arası senkronlanır).
  const IMG_VERSION = 2; // v2: anlamı bir bakışta anlatan sahneler — eski görseller yeniden üretilir
  const hasCurrentImg = (w) => !!w.img && w.imgV === IMG_VERSION;
  const imgQueue = [];
  const imgTried = new Set();
  const imgFails = new Map();
  let imgBusy = false;
  let imgNextAt = 0;
  function ensureImage(w) {
    if (!w || hasCurrentImg(w) || imgTried.has(w.id) || imgQueue.includes(w)) return;
    imgQueue.push(w);
  }
  let imgBatchAnnounced = false;
  async function pumpImages() {
    if (imgBusy || !imgQueue.length || Date.now() < imgNextAt || !window.AI || !isActive()) return;
    const w = imgQueue.shift();
    if (!state.words.includes(w) || hasCurrentImg(w)) return;
    imgBusy = true;
    imgTried.add(w.id);
    const missingBefore = missingImages().length;
    if (missingBefore > 1 && !imgBatchAnnounced && bubble.hidden) {
      imgBatchAnnounced = true;
      think(`ich male Bilder für deine Wörter… noch ${missingBefore}`, 5000);
    }
    try {
      const url = await AI.image(w);
      if (url) { w.img = url; w.imgV = IMG_VERSION; save(); if (!$('sheet').hidden) renderList(); }
    } catch (e) {
      if (String(e.message).includes('daily_limit')) imgNextAt = Date.now() + HOUR;
      else {
        // geçici hata: biraz sonra (en fazla 3 kez) yeniden dene
        const n = (imgFails.get(w.id) || 0) + 1;
        imgFails.set(w.id, n);
        if (n < 3) { imgTried.delete(w.id); imgNextAt = Date.now() + 20000 * n; }
      }
    }
    imgBusy = false;
    imgNextAt = Math.max(imgNextAt, Date.now() + 1500);
    // eksik görsel kalmayana kadar sıradakine hemen geç
    const left = missingImages();
    if (left.length) backfillImages();
    else if (imgBatchAnnounced) {
      imgBatchAnnounced = false;
      if (bubble.hidden) think('fertig – jetzt hat jedes Wort ein Bild ✓', 5000);
    }
  }
  const missingImages = () => state.words.filter((x) => !hasCurrentImg(x) && !imgTried.has(x.id));
  // görseli olmayan kelimeleri tek tek, arka arkaya üret
  function backfillImages() {
    if (imgQueue.length || imgBusy) return;
    const w = [...state.words].reverse().find((x) => !hasCurrentImg(x) && !imgTried.has(x.id));
    if (w) ensureImage(w);
  }

  /* ---------- ikinci çalışan: kullanım uzmanı ---------- */
  // Kelimenin cevabı ortaya çıkınca, nasıl ve hangi bağlamda kullanıldığını kendi kartında gösterir.
  // Bilgi kelime başına bir kez üretilir, kelimeyle birlikte saklanır ve senkronlanır.
  const bubble2 = $('bubble2');
  const usageQueue = [];
  const usageFails = new Map();
  let usageBusy = false, usageNextAt = 0, usageTotal = 0, usageDone = 0;
  let usageShownId = null, usageExpanded = false, pendingUsageWord = null, lastUsageWord = null;
  let worker2NoticeTimer = 0;
  // fiil mi? (sözlük türü 'v' ya da artikelsiz, -en/-ern/-eln ile biten küçük harfli kelime)
  const isVerb = (w) => w.pos === 'v' || (!w.pos && !w.art && /^[a-zäöüß]+(en|ern|eln)$/.test(w.de || ''));
  // fiillerde çekim satırı da olmalı (eski kartlar bir kez yeniden hazırlanır)
  const hasUsage = (w) => !!(w && w.usage && Array.isArray(w.usage.collocations) && (!isVerb(w) || 'forms' in w.usage));
  const isNarrow = () => stage.clientWidth < 700;

  /** Ortadaki çalışanı sustur / tekrar aç */
  function toggleWorker2() {
    clearTimeout(worker2NoticeTimer);
    state.worker2Muted = !state.worker2Muted;
    save();
    if (state.worker2Muted) {
      sfx('off');
      bubble2.hidden = true;
      usageShownId = null;
      usageExpanded = false;
      pendingUsageWord = null;
      scene.setMood2('sleep');
      placeAllBubbles();
    } else {
      sfx('on');
      if (!state.paused && !dormant) scene.setMood2(usageQueue.length ? 'batch' : 'type');
      backfillUsage();
      const canShowLast = lastUsageWord && state.words.includes(lastUsageWord) && !(bubbleKind === 'review' && current && current.id === lastUsageWord.id);
      if (canShowLast) {
        showUsage(lastUsageWord);
      } else {
        bubble2.classList.remove('show-tr');
        bubble2.classList.add('compact');
        bubble2.innerHTML = '<div class="b-inner"><div class="u-tag">Bin wieder da ✓</div></div>';
        bubble2.hidden = false;
        placeAllBubbles();
        worker2NoticeTimer = setTimeout(() => {
          if (!usageShownId && !usageBusy) { bubble2.hidden = true; placeAllBubbles(); }
        }, 2200);
      }
    }
  }

  function cleanUsage(it) {
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const arr = (v, n, m) => (Array.isArray(v) ? v.map((x) => str(x, m)).filter(Boolean).slice(0, n) : []);
    return {
      pattern: str(it.pattern, 120),
      collocations: arr(it.collocations, 6, 60),
      examples: (Array.isArray(it.examples) ? it.examples : []).map((e) => ({ de: str(e && e.de, 160), tr: str(e && e.tr, 160) })).filter((e) => e.de).slice(0, 3),
      synonyms: arr(it.synonyms, 3, 40),
      opposite: str(it.opposite, 40),
      context_de: str(it.context_de, 220),
      context_tr: str(it.context_tr, 220),
      // fiil çekimi (fiil değilse boş nesne: tekrar istenmez)
      forms: it.forms && typeof it.forms === 'object' ? {
        praesens: str(it.forms.praesens, 60), praeteritum: str(it.forms.praeteritum, 60),
        perfekt: str(it.forms.perfekt, 60), trennbar: str(it.forms.trennbar, 60),
      } : {},
    };
  }
  function queueUsage(w, priority) {
    if (!w || hasUsage(w)) return;
    const i = usageQueue.indexOf(w);
    if (i >= 0) usageQueue.splice(i, 1);
    if (priority) usageQueue.unshift(w); else usageQueue.push(w);
  }
  function backfillUsage() {
    if (state.worker2Muted) return;
    state.words.forEach((w) => { if (!hasUsage(w) && (usageFails.get(w.id) || 0) < 3 && !usageQueue.includes(w)) usageQueue.push(w); });
  }
  async function pumpUsage() {
    if (state.worker2Muted || usageBusy || !usageQueue.length || Date.now() < usageNextAt || !window.AI || !isActive()) return;
    const batch = usageQueue.splice(0, 8).filter((w) => state.words.includes(w) && !hasUsage(w));
    if (!batch.length) return;
    usageBusy = true;
    const bulk = batch.length > 1 || usageQueue.length > 0;
    if (bulk) {
      if (!usageTotal) { usageTotal = batch.length + usageQueue.length; usageDone = 0; }
      scene.setMood2('batch');
      scene.progress2 = usageDone / usageTotal;
      showUsageProgress();
    } else scene.setMood2('search');
    try {
      const items = await AI.usage(batch.map((w) => ({ id: w.id, de: w.de, art: w.art || '', tr: w.tr || '', pos: w.pos || '' })));
      const byId = new Map(items.map((it) => [String(it.id), it]));
      batch.forEach((w) => {
        const it = byId.get(w.id);
        const u = it ? cleanUsage(it) : null;
        if (u && (u.collocations.length || u.examples.length)) w.usage = u;
        else usageFails.set(w.id, (usageFails.get(w.id) || 0) + 1);
      });
      save();
    } catch (e) {
      batch.forEach((w) => usageFails.set(w.id, (usageFails.get(w.id) || 0) + 1));
      usageNextAt = Date.now() + 20000;
    }
    usageBusy = false;
    if (state.worker2Muted) {
      usageTotal = 0;
      bubble2.hidden = true;
      scene.setMood2('sleep');
      placeAllBubbles();
      return;
    }
    if (bulk) {
      usageDone += batch.length;
      scene.progress2 = Math.min(1, usageDone / (usageTotal || 1));
      if (usageQueue.length) showUsageProgress();
      else {
        usageTotal = 0;
        if (!usageShownId) { bubble2.hidden = true; placeAllBubbles(); think('meine Kollegin hat jetzt zu jedem Wort eine Karte ✓', 5000); }
      }
    }
    if (!usageQueue.length && !state.paused) scene.setMood2('type');
    if (pendingUsageWord && hasUsage(pendingUsageWord)) { const w = pendingUsageWord; pendingUsageWord = null; showUsage(w); }
  }
  function showUsageProgress() {
    if (state.worker2Muted || usageShownId) return;
    clearTimeout(worker2NoticeTimer);
    bubble2.innerHTML = `<div class="b-inner"><div class="u-tag">Ich schreibe Karten zu deinen Wörtern… <b>${usageDone}/${usageTotal}</b></div></div>`;
    bubble2.classList.add('compact');
    bubble2.hidden = false;
    placeBubble2();
  }

  /** Cevap ortaya çıkınca: kelimenin kullanım kartını göster */
  function showUsage(w) {
    if (!w) return;
    lastUsageWord = w;
    if (state.worker2Muted) return;
    clearTimeout(worker2NoticeTimer);
    if (!hasUsage(w)) { pendingUsageWord = w; queueUsage(w, true); scene.setMood2('search'); return; }
    usageShownId = w.id;
    renderUsage(w);
    scene.setMood2('present');
    setTimeout(() => { if (!state.worker2Muted && scene.mood2 === 'present') scene.setMood2(usageQueue.length ? 'batch' : 'type'); }, 2600);
  }
  function renderUsage(w) {
    const u = w.usage;
    const compact = isNarrow() && !usageExpanded;
    let html;
    if (compact) {
      html = `<div class="u-tag">So benutzt man <b>${esc(fullDe(w))}</b> ▸</div>`;
    } else {
      const ex = u.examples.map((e) => `<li>${highlight(e.de, w.de) || esc(e.de)}${e.tr ? `<span class="tr">${esc(e.tr)}</span>` : ''}</li>`).join('');
      const syn = u.synonyms.length ? `<span>ähnlich:</span> ${esc(u.synonyms.join(', '))}` : '';
      const opp = u.opposite ? `${syn ? ' · ' : ''}<span>Gegenteil:</span> ${esc(u.opposite)}` : '';
      html = `<div class="u-tag">So benutzt man <b>${esc(fullDe(w))}</b></div>
        ${u.pattern ? `<div class="u-pat">${esc(u.pattern)}</div>` : ''}
        ${u.forms && (u.forms.praeteritum || u.forms.perfekt) ? `<div class="u-forms">
          ${u.forms.praesens ? `<div><span class="lbl">Präsens</span><em>${esc(u.forms.praesens)}</em></div>` : ''}
          ${u.forms.praeteritum ? `<div><span class="lbl">Präteritum</span><em>${esc(u.forms.praeteritum)}</em></div>` : ''}
          ${u.forms.perfekt ? `<div><span class="lbl">Perfekt</span><em>${esc(u.forms.perfekt).replace(/\b(hat|ist)\b/, '<b>$1</b>')}</em></div>` : ''}
          ${u.forms.trennbar ? `<div class="sep"><span class="lbl">trennbar</span><em>${esc(u.forms.trennbar)}</em></div>` : ''}
        </div>` : ''}
        ${u.collocations.length ? `<div class="u-chips">${u.collocations.slice(0, 5).map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
        ${ex ? `<ol class="u-ex">${ex}</ol>` : ''}
        ${syn || opp ? `<div class="u-row">${syn}${opp}</div>` : ''}
        ${u.context_de ? `<div class="u-row"><span>Wann?</span> ${esc(u.context_de)}${u.context_tr ? `<span class="tr">${esc(u.context_tr)}</span>` : ''}</div>` : ''}
        ${isNarrow() ? '<div class="b-actions"><button class="btn sm" data-act="u-close">zu</button></div>' : ''}`;
    }
    bubble2.classList.remove('show-tr');
    bubble2.classList.toggle('compact', compact);
    bubble2.innerHTML = `<div class="b-inner">${html}</div>`;
    if (!compact && bubble2.querySelector('.tr')) bubble2.firstElementChild.insertAdjacentHTML('afterbegin', '<button class="tr-toggle" data-act="tr" aria-label="Türkçe çeviri">TR</button>');
    bubble2.hidden = false;
    placeBubble2();
  }
  /** Soru bu kelimeyi soruyorsa kartı gizle (cevabı ele vermesin) */
  function hideUsageFor(w) {
    if (w && usageShownId === w.id) { bubble2.hidden = true; usageShownId = null; usageExpanded = false; placeAllBubbles(); }
  }
  function placeBubble2() { placeAllBubbles(); }
  bubble2.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && b.dataset.act === 'tr') { bubble2.classList.toggle('show-tr'); placeAllBubbles(); return; }
    if (b && b.dataset.act === 'u-close') { usageExpanded = false; const w = state.words.find((x) => x.id === usageShownId); if (w) renderUsage(w); return; }
    if (bubble2.classList.contains('compact') && usageShownId) {
      // dar ekranda: dokununca aç, okurken soru gelmesin
      usageExpanded = true;
      nextReviewAt = Date.now() + 25000;
      const w = state.words.find((x) => x.id === usageShownId);
      if (w) renderUsage(w);
    }
  });

  /* ---------- üçüncü çalışan: kafasının üstündeki baloncukla metin yazarı ---------- */
  const bubble3 = $('bubble3');
  const storySelected = new Set(); // seçili kelime id'leri
  let storyBusy = false;
  let activeStory = null;
  let storyMode = 'pick'; // 'pick' | 'story' | 'history'
  let storyErr = '';
  let storySearchVal = '';
  let storyExtraVal = '';

  function parseExtraWords() {
    return (storyExtraVal || '')
      .split(/[,;\n]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 15)
      .map((raw) => {
        const m = raw.match(/^(der|die|das)\s+(.+)$/i);
        return { de: m ? m[2].trim() : raw, art: m ? m[1].toLowerCase() : '', tr: '' };
      });
  }

  function collectSelectedWords() {
    const picked = [];
    const seen = new Set();
    state.words.forEach((w) => {
      if (!storySelected.has(w.id)) return;
      const k = w.de.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      picked.push({ id: w.id, de: w.de, art: w.art || '', tr: w.tr || '' });
    });
    parseExtraWords().forEach((w) => {
      const k = w.de.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      picked.push(w);
    });
    return picked.slice(0, 15);
  }

  function findTargetMeaning(token, targets) {
    const low = token.toLowerCase();
    const hit = targets.find((w) => {
      const d = (w.de || '').toLowerCase();
      if (!d) return false;
      if (d === low) return true;
      return d.length >= 4 && (low.startsWith(d.slice(0, Math.min(d.length, 5))) || d.startsWith(low.slice(0, Math.min(low.length, 5))));
    });
    return hit ? { label: (hit.art ? hit.art + ' ' : '') + hit.de, tr: hit.tr || '' } : null;
  }

  /** Metni paragraflara ayır; [[...]] içindeki ve seçili hedef kelimeleri altı çizili yap */
  function renderUnderlinedStory(textDe, targets) {
    const exactMap = new Map();
    targets.forEach((w) => {
      if (!w.de) return;
      exactMap.set(w.de.toLowerCase(), w);
      w.de.split(/\s+/).filter((p) => p.length >= 4).forEach((p) => {
        if (!exactMap.has(p.toLowerCase())) exactMap.set(p.toLowerCase(), w);
      });
    });

    const wrapHit = (word, info) => {
      const label = info ? ((info.art ? info.art + ' ' : '') + info.de) : word;
      const tr = info && info.tr ? info.tr : '';
      return `<u class="st-hit" data-word="${esc(word)}" data-label="${esc(label)}" data-tr="${esc(tr)}" title="${esc(tr || label)}">${esc(word)}</u>`;
    };

    const decoratePlain = (seg) => {
      let out = '', last = 0;
      const re = /[A-Za-zÄÖÜäöüß]+/g;
      let m;
      while ((m = re.exec(seg))) {
        if (m.index > last) out += esc(seg.slice(last, m.index));
        const tok = m[0];
        const hit = exactMap.get(tok.toLowerCase());
        out += hit ? wrapHit(tok, hit) : esc(tok);
        last = m.index + tok.length;
      }
      if (last < seg.length) out += esc(seg.slice(last));
      return out;
    };

    return String(textDe || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((para) => {
        const parts = para.split(/(\[\[[^\]]+\]\])/g);
        const html = parts.map((part) => {
          if (part.startsWith('[[') && part.endsWith(']]')) {
            const inner = part.slice(2, -2).trim();
            if (!inner) return '';
            const guess = findTargetMeaning(inner, targets);
            return wrapHit(inner, guess ? { de: guess.label, art: '', tr: guess.tr } : null);
          }
          return decoratePlain(part);
        }).join('');
        return `<p>${html}</p>`;
      })
      .join('');
  }

  function placeBubble3() { placeAllBubbles(); }

  function buildChipsHtml() {
    const validIds = new Set(state.words.map((w) => w.id));
    [...storySelected].forEach((id) => { if (!validIds.has(id)) storySelected.delete(id); });
    const q = (storySearchVal || '').trim().toLowerCase();
    const list = [...state.words].reverse().filter((w) => !q || w.de.toLowerCase().includes(q) || (w.tr || '').toLowerCase().includes(q));
    if (!state.words.length) return '<div class="st-empty">Henüz kayıtlı kelime yok — aşağıya virgülle birkaç Almanca kelime yazabilirsin.</div>';
    if (!list.length) return '<div class="st-empty">Eşleşen kelime bulunamadı.</div>';
    return list.map((w) => {
      const on = storySelected.has(w.id);
      return `<button type="button" class="st-chip${on ? ' on' : ''}" data-sid="${esc(w.id)}"><i>${esc(fullDe(w))}</i><small>${esc(w.tr)}</small></button>`;
    }).join('');
  }

  function updatePickerParts() {
    const chips = bubble3.querySelector('#storyChips');
    if (chips) chips.innerHTML = buildChipsHtml();
    const picked = collectSelectedWords();
    const n = picked.length;
    const cnt = bubble3.querySelector('#storyCount');
    if (cnt) cnt.textContent = n ? `${n} kelime${n >= 15 ? ' (maks 15)' : ''}` : 'Kelime seç';
    const wb = bubble3.querySelector('#storyWriteBtn');
    if (wb) {
      wb.disabled = storyBusy || !n;
      wb.textContent = n ? `Metin yaz (${n})` : 'Metin yaz';
    }
    placeBubble3();
  }

  function renderBubble3() {
    const histCount = (state.stories || []).length;
    bubble3.classList.remove('show-tr');
    let html = '';

    if (storyBusy) {
      const picked = collectSelectedWords();
      html = `
        <div class="st-head">
          <div class="b-tag">Metin Yazarı</div>
          <div class="st-head-tools"><button type="button" class="st-x" data-sact="close" aria-label="Kapat">×</button></div>
        </div>
        <div class="st-loading">Rastgele bir konu seçip kelimelerinle metni yazıyorum…</div>
        ${picked.length ? `<div class="st-used">${picked.map((w) => `<button type="button" data-sword="${esc((w.art ? w.art + ' ' : '') + w.de)}" data-str="${esc(w.tr || '')}">${esc((w.art ? w.art + ' ' : '') + w.de)}</button>`).join('')}</div>` : ''}`;
    } else if (storyMode === 'story' && activeStory) {
      const st = activeStory;
      const words = Array.isArray(st.words) ? st.words : [];
      const bodyHtml = renderUnderlinedStory(st.text_de, words);
      const trHtml = (st.text_tr || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
      html = `
        <div class="st-head">
          <div class="st-topic">Konu: <b>${esc(st.topic_de || 'Zufälliges Thema')}</b>${st.topic_tr ? ` <span class="tr">(${esc(st.topic_tr)})</span>` : ''}</div>
          <div class="st-head-tools">
            <button type="button" class="btn speak" data-sact="listen" aria-label="Metni sesli dinle">${speakerSvg}</button>
            ${trHtml ? '<button type="button" class="tr-toggle" data-sact="tr" aria-label="Türkçe çeviri">TR</button>' : ''}
            <button type="button" class="st-x" data-sact="close" aria-label="Kapat">×</button>
          </div>
        </div>
        ${storyErr ? `<div class="st-err">${esc(storyErr)}</div>` : ''}
        ${st.title_de ? `<h3 class="st-title">${esc(st.title_de)}</h3>` : ''}
        <div class="st-body">${bodyHtml}</div>
        <div class="st-gloss" id="storyGloss">Altı çizili kelimeye dokun: dinle &amp; anlamı gör.</div>
        ${trHtml ? `<div class="st-tr tr">${trHtml}</div>` : ''}
        ${words.length ? `<div class="st-used">${words.map((w) => `<button type="button" data-sword="${esc((w.art ? w.art + ' ' : '') + w.de)}" data-str="${esc(w.tr || '')}">${esc((w.art ? w.art + ' ' : '') + w.de)}</button>`).join('')}</div>` : ''}
        <div class="st-actions">
          <button type="button" class="btn sm" data-sact="rewrite">Yeni konu</button>
          <button type="button" class="btn sm" data-sact="pick">Kelimeler</button>
          ${histCount > 1 ? `<button type="button" class="btn sm" data-sact="history">Geçmiş (${histCount})</button>` : ''}
        </div>`;
    } else if (storyMode === 'history') {
      const list = state.stories || [];
      html = `
        <div class="st-head">
          <div class="b-tag">Son yazılan metinler (${list.length})</div>
          <div class="st-head-tools">
            <button type="button" class="btn sm" data-sact="pick">Yeni</button>
            <button type="button" class="st-x" data-sact="close" aria-label="Kapat">×</button>
          </div>
        </div>
        ${list.length ? `<div class="st-hist-list">${list.map((st) => `
          <div class="st-hist-item">
            <button type="button" class="st-hist-open" data-sopen="${esc(st.id)}">
              <b>${esc(st.title_de || st.topic_de || 'Metin')}</b>
              <small>${esc((st.words || []).map((w) => w.de).join(', '))}</small>
            </button>
            <button type="button" class="st-hist-del" data-sdel="${esc(st.id)}" aria-label="Metni sil">×</button>
          </div>`).join('')}</div>` : '<div class="st-empty">Henüz kaydedilmiş metin yok.</div>'}`;
    } else {
      const picked = collectSelectedWords();
      const n = picked.length;
      html = `
        <div class="st-head">
          <div class="b-tag">Metin Yazarı · kelimelerini seç</div>
          <div class="st-head-tools">
            ${activeStory ? '<button type="button" class="btn sm" data-sact="show-story">Metin</button>' : ''}
            ${histCount ? `<button type="button" class="btn sm" data-sact="history">Geçmiş</button>` : ''}
            <button type="button" class="st-x" data-sact="close" aria-label="Kapat">×</button>
          </div>
        </div>
        ${storyErr ? `<div class="st-err">${esc(storyErr)}</div>` : ''}
        <div class="st-picker">
          <div class="st-bar">
            <input id="storySearch" type="search" placeholder="kelime ara…" autocomplete="off" value="${esc(storySearchVal)}">
            <div class="st-quick">
              <button class="btn sm" type="button" data-sact="rand">rastgele 5</button>
              <button class="btn sm" type="button" data-sact="recent">son 5</button>
              <button class="btn sm" type="button" data-sact="clear">temizle</button>
            </div>
          </div>
          <div class="st-chips" id="storyChips">${buildChipsHtml()}</div>
          <div class="st-custom">
            <input id="storyExtra" type="text" placeholder="listede olmayan kelime ekle (virgülle)…" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(storyExtraVal)}">
          </div>
          <div class="st-foot">
            <span class="muted" id="storyCount">${n ? `${n} kelime${n >= 15 ? ' (maks 15)' : ''}` : 'Kelime seç'}</span>
            <button class="btn sm solid" id="storyWriteBtn" type="button" data-sact="write"${n ? '' : ' disabled'}>${n ? `Metin yaz (${n})` : 'Metin yaz'}</button>
          </div>
        </div>`;
    }

    bubble3.innerHTML = `<div class="b-inner">${html}</div>`;
    bubble3.hidden = false;
    $('storyBtn').classList.add('on');
    placeBubble3();
  }

  function openStory(mode) {
    storyErr = '';
    if (mode) storyMode = mode;
    else if (!storyBusy) storyMode = storyMode === 'history' ? 'pick' : (activeStory ? 'story' : 'pick');
    renderBubble3();
    readerQuietUntil = Date.now() + 60000;
  }

  function closeStory() {
    bubble3.hidden = true;
    $('storyBtn').classList.remove('on');
    placeAllBubbles();
  }

  function toggleStory() {
    if (!bubble3.hidden) closeStory();
    else openStory();
  }

  async function generateStory(reuseWords) {
    const words = reuseWords && reuseWords.length ? reuseWords : collectSelectedWords();
    if (!words.length || storyBusy) return;
    if (!window.AI) { storyErr = 'AI istemcisi yüklenemedi.'; renderBubble3(); return; }
    storyBusy = true;
    storyErr = '';
    scene.setMood3('write');
    renderBubble3();
    try {
      const avoidTopics = (state.stories || []).slice(0, 8).map((x) => x.topic_seed).filter(Boolean);
      const res = await AI.story(words.map((w) => ({ de: w.de, art: w.art || '', tr: w.tr || '' })), avoidTopics);
      const entry = {
        id: 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: Date.now(),
        words: words.map((w) => ({ de: w.de, art: w.art || '', tr: w.tr || '' })),
        topic_seed: res.topic_seed,
        topic_de: res.topic_de,
        topic_tr: res.topic_tr,
        title_de: res.title_de,
        text_de: res.text_de,
        text_tr: res.text_tr,
      };
      activeStory = entry;
      storyMode = 'story';
      state.stories = [entry, ...(state.stories || [])].slice(0, 10);
      save();
      scene.setMood3('present');
      sfx('coin');
      setTimeout(() => { if (!state.paused && !storyBusy && scene.mood3 === 'present') scene.setMood3('idle'); }, 3500);
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      storyErr = msg === 'unknown_action'
        ? 'Cloudflare Worker henüz güncellenmemiş: cloudflare/worker.js dosyasını Cloudflare panelinde Deploy ettikten sonra tekrar dene.'
        : 'Metin şu an yazılamadı (' + (msg || 'bağlantı hatası') + '). Biraz sonra tekrar dene.';
      storyMode = 'pick';
      scene.setMood3(state.paused ? 'sleep' : 'idle');
    } finally {
      storyBusy = false;
      renderBubble3();
    }
  }

  $('storyBtn').addEventListener('click', toggleStory);

  bubble3.addEventListener('input', (e) => {
    if (e.target.id === 'storySearch') { storySearchVal = e.target.value; updatePickerParts(); }
    else if (e.target.id === 'storyExtra') { storyExtraVal = e.target.value; updatePickerParts(); }
  });
  bubble3.addEventListener('keydown', (e) => {
    if (e.target.id === 'storyExtra' && e.key === 'Enter') { e.preventDefault(); generateStory(); }
  });
  bubble3.addEventListener('click', (e) => {
    const sid = e.target.closest('[data-sid]');
    if (sid) {
      const id = sid.dataset.sid;
      if (storySelected.has(id)) storySelected.delete(id);
      else if (collectSelectedWords().length < 15) storySelected.add(id);
      updatePickerParts();
      return;
    }
    const hit = e.target.closest('.st-hit');
    if (hit) {
      const w = hit.dataset.word || hit.textContent;
      const lbl = hit.dataset.label || w;
      const tr = hit.dataset.tr || '';
      say(w);
      const g = bubble3.querySelector('#storyGloss');
      if (g) g.innerHTML = tr ? `<b>${esc(lbl)}</b> — ${esc(tr)}` : `<b>${esc(lbl)}</b>`;
      placeBubble3();
      return;
    }
    const chip = e.target.closest('[data-sword]');
    if (chip) {
      const w = chip.dataset.sword;
      const tr = chip.dataset.str || '';
      say(w);
      const g = bubble3.querySelector('#storyGloss');
      if (g) g.innerHTML = tr ? `<b>${esc(w)}</b> — ${esc(tr)}` : `<b>${esc(w)}</b>`;
      placeBubble3();
      return;
    }
    const del = e.target.closest('[data-sdel]');
    if (del) {
      const id = del.dataset.sdel;
      state.stories = (state.stories || []).filter((x) => x.id !== id);
      if (activeStory && activeStory.id === id) activeStory = state.stories[0] || null;
      save();
      renderBubble3();
      return;
    }
    const open = e.target.closest('[data-sopen]');
    if (open) {
      const found = (state.stories || []).find((x) => x.id === open.dataset.sopen);
      if (found) { activeStory = found; storyErr = ''; storyMode = 'story'; renderBubble3(); }
      return;
    }
    const b = e.target.closest('[data-sact]');
    if (!b) return;
    const act = b.dataset.sact;
    if (act === 'close') { closeStory(); }
    else if (act === 'tr') { bubble3.classList.toggle('show-tr'); placeBubble3(); }
    else if (act === 'listen' && activeStory) {
      const plain = String(activeStory.text_de || '').replace(/\[\[|\]\]/g, '');
      say((activeStory.title_de ? activeStory.title_de + '. ' : '') + plain);
    } else if (act === 'write') { generateStory(); }
    else if (act === 'rewrite' && activeStory) { generateStory(activeStory.words); }
    else if (act === 'pick') { storyMode = 'pick'; storyErr = ''; renderBubble3(); }
    else if (act === 'show-story' && activeStory) { storyMode = 'story'; renderBubble3(); }
    else if (act === 'history') { storyMode = 'history'; renderBubble3(); }
    else if (act === 'rand') {
      storySelected.clear();
      [...state.words].sort(() => Math.random() - 0.5).slice(0, 5).forEach((w) => storySelected.add(w.id));
      updatePickerParts();
    } else if (act === 'recent') {
      storySelected.clear();
      state.words.slice(-5).forEach((w) => storySelected.add(w.id));
      updatePickerParts();
    } else if (act === 'clear') {
      storySelected.clear();
      storyExtraVal = '';
      const ex = bubble3.querySelector('#storyExtra');
      if (ex) ex.value = '';
      updatePickerParts();
    }
  });

  /* ---------- kitap: kelimeye dokun → anlamı, deftere ekle ---------- */
  let readerQuietUntil = 0;
  let pendingBook = null;
  const bookCache = new Map();
  async function lookupFromBook(word, sentence) {
    readerQuietUntil = Date.now() + 30000;
    if (busy) return;
    hideBubbleQuiet();
    hideThought();
    busy = true;
    setMood('thinking');
    think(pick(['Moment, ich schaue nach…', 'hmm, was heißt das hier…', 'zeig mal…']), 6000);
    const ck = word.toLowerCase() + '|' + sentence.slice(0, 80);
    let res = bookCache.get(ck) || null;
    if (!res) {
      try { res = await T.lookup(word, sentence); } catch (e) { res = null; }
      if (res && res.de) bookCache.set(ck, res);
    }
    busy = false;
    hideThought();
    if (!res || !res.de) {
      setMood('sad', 2000);
      showBubble(`<div class="b-tag">„${esc(word)}“</div><div>Ich komme gerade nicht ins Internet – versuch es gleich nochmal.</div>
        <div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 8000 });
      return;
    }
    // Kitaptaki cümle örnek olsun (model kısaltmış olabilir)
    const ex = res.ex && res.ex.de ? res.ex : { de: sentence, tr: '' };
    logEvent('book_word', { q: word, de: (res.art ? res.art + ' ' : '') + res.de, tr: res.tr, sentence });
    const known = findByDe(res.de);
    setMood('talking', 1500);
    if (known) {
      pendingBook = null;
      showUsage(known);
      showBubble(`${wordCard(known, 'aus deinem Buch · kennen wir schon ✓', { ex, mark: word })}
        <div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 20000, focus: false });
      if (known.ex !== ex) { addToPool(known, ex.de, ex.tr); save(); }
    } else {
      pendingBook = { ...res, ex };
      showBubble(`${wordCard(pendingBook, 'aus deinem Buch', { ex, mark: word, say: true })}
        <div class="b-actions"><button class="btn sm solid" data-act="addbook">ins Heft</button><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 30000, focus: false });
    }
    if (state.settings.voice === 'on') say((res.art ? res.art + ' ' : '') + res.de);
  }
  function addFromBook() {
    if (!pendingBook) return hideBubble();
    const w = addWord(pendingBook);
    logEvent('book_word_added', { de: fullDe(w), tr: w.tr });
    showUsage(w);
    pendingBook = null;
    setMood('happy', 1800);
    showBubble(`${wordCard(w, 'steht im Heft ✓ ich frage dich oft')}<div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 8000, focus: false });
    celebrateGoal();
    readerQuietUntil = Date.now() + 20000;
  }
  /* kitap penceresi: istediğinde aç/kapat (varsayılan kapalı, bu cihaza özel) */
  let readerOpen = false;
  try { readerOpen = localStorage.getItem('kelime-reader-open') === '1'; } catch (e) { /* yok */ }
  function applyReader() {
    $('reader').hidden = !readerOpen;
    $('topArea').classList.toggle('with-reader', readerOpen);
    $('bookBtn').classList.toggle('on', readerOpen);
    $('bookBtn').setAttribute('aria-pressed', readerOpen ? 'true' : 'false');
    if (readerOpen && window.Reader) Reader.relayout();
    if (!readerOpen) { readerQuietUntil = 0; if (window.Reader) Reader.clearMark(); }
    scheduleFit();
  }
  $('bookBtn').addEventListener('click', () => {
    readerOpen = !readerOpen;
    try { localStorage.setItem('kelime-reader-open', readerOpen ? '1' : '0'); } catch (e) { /* yok */ }
    applyReader();
  });
  if (window.Reader) {
    Reader.init({
      onLayout: scheduleFit,
      onWord: lookupFromBook,
      onPage: () => { readerQuietUntil = Date.now() + 25000; if (bubbleKind && bubbleKind !== 'review') hideBubble(); },
      onOpen: (b) => {
        if (!readerOpen) { readerOpen = true; applyReader(); }
        logEvent('book_opened', { title: b.title });
        setMood('happy', 1500);
        think(`„${b.title.slice(0, 40)}“ – schön! Tipp ein Wort an, ich erkläre es dir.`, 6000);
      },
    });
  }
  applyReader();

  /* ---------- olaylar ---------- */
  $('wordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('wordInput');
    const v = inp.value;
    inp.value = '';
    submitWord(v);
  });
  $('wordInput').addEventListener('focus', () => { if (!busy && !bubbleKind) setMood('listening', 6000); });
  $('wordInput').addEventListener('input', () => { if (!busy && !bubbleKind) setMood('listening', 6000); });

  bubble.addEventListener('click', (e) => {
    const sayBtn = e.target.closest('[data-say]');
    if (sayBtn) { say(sayBtn.dataset.say); return; }
    const b = e.target.closest('[data-act]');
    if (!b) { clearTimeout(bubbleTimer); return; }
    if (b.dataset.act === 'say-ex') { say(b.dataset.text); return; }
    const act = b.dataset.act;
    if (act === 'tr') { bubble.classList.toggle('show-tr'); clearTimeout(bubbleTimer); placeBubble(); return; }
    if (act === 'close') hideBubble();
    else if (act === 'edit') editWord(b.dataset.id);
    else if (act === 'delete') { deleteWord(b.dataset.id); hideBubble(); }
    else if (act === 'reveal') reveal();
    else if (act === 'knew') grade(true, '');
    else if (act === 'forgot') grade(false, '');
    else if (act === 'giveup') grade(false, '');
    else if (act === 'hint' && current) {
      current.hinted = true;
      const w = current.w;
      const inp = bubble.querySelector('form[data-form=answer] input');
      const tip = (w.art ? w.art + ' ' : '') + w.de.slice(0, Math.max(2, Math.ceil(w.de.length / 3))) + '…';
      if (inp) { inp.placeholder = tip; inp.value = ''; inp.focus({ preventScroll: true }); }
      b.disabled = true; b.textContent = tip;
    }
    else if (act === 'later') { if (current) logEvent('postponed', { de: fullDe(current.w), mode: current.mode }); postpone(); hideBubble(); }
    else if (act === 'addnew') addSuggested();
    else if (act === 'addbook') addFromBook();
    else if (act === 'skip') skipSuggested();
    else if (act === 'close-suggest') closeSuggest();
    else if (act === 'more-suggest') suggestNext();
    else if (act === 'say-ex') say(b.dataset.text);
  });

  bubble.addEventListener('focusin', () => clearTimeout(bubbleTimer));
  bubble.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const kind = f.dataset.form;
    if (kind === 'ask') {
      const v = f.elements.a.value;
      if (!v.trim()) { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); return; }
      answerAsk(v);
    } else if (kind === 'answer') {
      const v = f.elements.a.value;
      if (!v.trim()) { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); return; }
      checkAnswer(v);
    } else if (kind === 'manual' || kind === 'edit') {
      let de = f.elements.de.value.trim();
      const tr = f.elements.tr.value.trim();
      let art = f.elements.art.value;
      const m = de.match(/^(der|die|das)\s+(.+)$/i);
      if (m) { art = m[1].toLowerCase(); de = m[2]; }
      if (!de || !tr) { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); return; }
      if (art) de = de.charAt(0).toUpperCase() + de.slice(1);
      if (kind === 'manual') {
        if (f.dataset.busy) return;
        f.dataset.busy = '1';
        const dupM = findByDe(de);
        if (dupM) return showKnown(dupM, de);
        const pos = art ? 'n' : '';
        T.findExample(de, pos, art, navigator.onLine).then((ex) => {
          const w = addWord({ de, art, tr: T.lowerTr(tr), pos, ex, dir: 'tr2de', source: 'elle' });
          setMood('happy', 1800);
          showBubble(`${wordCard(w, 'steht im Heft ✓')}<div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 15000 });
        });
      } else {
        const w = state.words.find((x) => x.id === f.dataset.id);
        if (!w) return hideBubble();
        const clash = findByDe(de);
        if (clash && clash.id !== w.id) {
          f.insertAdjacentHTML('afterbegin', `<div class="b-hint">„${esc(fullDe(clash))}“ steht schon im Heft</div>`);
          f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
          return;
        }
        const exTxt = f.elements.ex.value.trim();
        w.de = de; w.tr = tr; w.art = art; w.edited = Date.now();
        if (art) w.pos = 'n';
        if (exTxt && (!w.ex || exTxt !== w.ex.de)) w.ex = { de: exTxt, tr: '', src: 'elle' };
        if (!exTxt) w.ex = null;
        save(); render();
        setMood('happy', 1500);
        showBubble(`${wordCard(w, 'aktualisiert ✓')}<div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 12000 });
      }
    }
  });

  function deleteWord(id) {
    const gone = state.words.find((w) => w.id === id);
    if (gone) state.deleted[deKey(gone.de)] = Date.now();
    state.words = state.words.filter((w) => w.id !== id);
    day().added = todayAdded();
    save(); render();
  }

  $('pauseBtn').addEventListener('click', () => {
    state.paused = !state.paused;
    save();
    render();
    if (state.paused) {
      hideBubbleQuiet();
      current = null;
      scene.setMood('sleep');
      scene.setMood2('sleep');
      scene.setMood3('sleep');
    } else {
      setMood('happy', 1200);
      scene.setMood2(state.worker2Muted ? 'sleep' : 'type');
      scene.setMood3(storyBusy ? 'write' : 'idle');
      nextReviewAt = Date.now() + 8000;
    }
  });

  function askNow() {
    if (state.paused) { $('pauseBtn').click(); }
    if (busy) return;
    if (!state.words.length) {
      setMood('talking', 1500);
      showBubble(`<div class="b-tag">Hey${nameTag(' ')}!</div><div>Mein Heft ist noch leer. Schreib unten ein Wort – oder warte kurz, ich bringe dir neue Wörter.</div>
        <div class="b-actions"><button class="btn sm" data-act="close">ok</button></div>`, 'info', { autoClose: 12000 });
      return;
    }
    const pairWord = pickPairWord(true);
    if (pairWord) return askWithRefreshTrack(pairWord);
    const refresh = maybePickRefresher();
    if (refresh) return askWithRefreshTrack(refresh);
    const due = dueWords().filter((x) => !cooling(x) && !isWaitingPair(x));
    const rested = state.words.filter((x) => !cooling(x) && !isWaitingPair(x));
    const fallback = state.words.filter((x) => !isWaitingPair(x));
    const w = pickDueWord(due) || pickPracticeWord(rested.length ? rested : (fallback.length ? fallback : state.words));
    askWithRefreshTrack(w);
  }
  $('askBtn').addEventListener('click', askNow);
  $('suggestBtn').addEventListener('click', () => {
    if (suggestBrowse && !bubble.hidden) closeSuggest();
    else suggestNext();
  });
  canvas.addEventListener('click', (e) => {
    const cr = canvas.getBoundingClientRect();
    const who = scene.workerAt ? scene.workerAt(e.clientX - cr.left) : 1;
    if (who === 2) { toggleWorker2(); return; }
    if (who === 3) { sfx(bubble3.hidden ? 'reveal' : 'menuClose'); toggleStory(); return; }
    sfx('boop');
    if (!bubbleKind) askNow();
  });

  /* ---------- sürekli döngü ---------- */
  /** Balon kapanınca sıradaki soruyu hemen getir (1 sn'lik döngüyü beklemeden) */
  function tickTalk() {
    const now = Date.now();
    if (state.paused || !isActive() || busy || bubbleKind || !bubble3.hidden) return;
    const typingNow = document.activeElement === $('wordInput') && $('wordInput').value;
    if (typingNow || now < readerQuietUntil || now < nextReviewAt) return;
    nextTalk();
  }

  setInterval(() => {
    const now = Date.now();
    if (state.paused) { scene.setMood('sleep'); scene.setMood2('sleep'); scene.setMood3('sleep'); return; }
    if (!isActive()) { if (!dormant) fallAsleep(); return; } // bakmıyorsan hiçbir şey çağrılmaz
    if (busy) return;
    if (!bubbleKind && now < readerQuietUntil && now > moodUntil) {
      setMood('reading', 3000); // sen okurken o da okuyor
    } else if (!bubbleKind && now > moodUntil) {
      const r = Math.random();
      const m = r < 0.5 ? 'typing' : r < 0.66 ? 'thinking' : r < 0.77 ? 'window' : r < 0.9 ? 'coffee' : 'stretch';
      const dur = { typing: 7000 + Math.random() * 6000, thinking: 3500 + Math.random() * 4000, window: 3500 + Math.random() * 4000, coffee: 2900, stretch: 2400 }[m];
      setMood(m, dur);
    } else if (bubbleKind && now > moodUntil && ['talking', 'happy', 'sad', 'listening', 'reading'].includes(scene.mood)) {
      scene.setMood('waiting');
    }
    const typingNow = document.activeElement === $('wordInput') && $('wordInput').value;
    const reading = now < readerQuietUntil || !bubble3.hidden; // okurken / metin yazarken kanka araya girmez
    if (!bubbleKind && !typingNow && !reading && now >= nextReviewAt) {
      nextTalk();
    } else if (!bubbleKind && !typingNow && !reading && thought.hidden && now >= nextThoughtAt) {
      idleThought();
    }
    refillQueue();
    pumpImages();
    pumpUsage();
    if (now % 10000 < 1000) backfillUsage();
    backfillImages();
    if (now % 15000 < 1000) maybeUpdateProfile();
    // senkron: değişiklik varsa 45 sn'de bir, yoksa 4 dk'da bir (diğer cihazdan gelenler için)
    if (state.sync.code && !syncing && (syncDirty ? now - lastSyncTry > 45000 : now - lastSyncTry > 4 * MIN)) syncNow();
    updateTitle();
  }, 1000);

  function fallAsleep() {
    dormant = true;
    scene.setMood('sleep');
    scene.setMood2('sleep');
    scene.setMood3('sleep');
    if (!document.hidden && bubble.hidden) think('ich mache ein kleines Nickerchen… tipp mich an', 12000);
  }
  function wakeUp() {
    dormant = false;
    if (state.paused) return;
    scene.setMood2(state.worker2Muted ? 'sleep' : 'type');
    scene.setMood3(storyBusy ? 'write' : 'idle');
    hideThought();
    setMood('happy', 1500);
    think(pick([`Da bist du ja${nameTag(', ')}! Weiter geht’s`, `Hallo${nameTag(' ')}! Ich habe auf dich gewartet`, 'Ich bin wach – los geht’s']), 4000);
    nextReviewAt = Math.max(nextReviewAt, Date.now() + 2000);
  }

  function updateTitle() {
    const n = dueWords().length;
    document.title = (bubbleKind === 'review' && document.hidden ? '(?) ' : n ? `(${n}) ` : '') + 'Kelime Defteri';
  }

  /* ---------- ayarlar ---------- */
  const sheet = $('sheet');
  $('menuBtn').addEventListener('click', openSheet);
  $('closeSheet').addEventListener('click', () => { sheet.hidden = true; });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!bubble3.hidden) closeStory();
      else if (!sheet.hidden) sheet.hidden = true;
      else if (bubbleKind && bubbleKind !== 'review') hideBubble();
    }
  });

  function openSheet() {
    renderSheet();
    sheet.hidden = false;
  }
  function renderSheet() {
    document.querySelectorAll('.stepper').forEach((s) => { s.querySelector('b').textContent = state.settings[s.dataset.key]; });
    document.querySelectorAll('#freqSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.freq));
    $('nameInput').value = state.settings.name || '';
    document.querySelectorAll('#sfxSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === (state.settings.sfx || 'on')));
    document.querySelectorAll('#voiceSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.voice));
    renderEngine();
    const mastered = state.words.filter((w) => (w.ivl || 0) >= 3 * DAY * 0.95).length;
    const reviews = Object.values(state.days).reduce((s, d) => s + (d.reviewed || 0), 0);
    const correct = Object.values(state.days).reduce((s, d) => s + (d.correct || 0), 0);
    renderProfile();
    renderSync();
    $('stats').innerHTML = `
      <div><b>${state.words.length}</b>kelime</div>
      <div><b>${mastered}</b>öğrenildi</div>
      <div><b>${dueWords().length}</b>tekrar bekliyor</div>
      <div><b>%${reviews ? Math.round((correct / reviews) * 100) : 0}</b>başarı</div>`;
    renderList();
  }
  function renderSync() {
    const el = $('syncBox');
    if (!el) return;
    const sy = state.sync;
    if (!sy.code) {
      el.innerHTML = `<p class="muted">Kelimelerin, ilerlemen ve kankanın notları iPad ile telefon arasında eşitlensin.</p>
        <div class="sync-row"><button class="btn sm solid" id="syncCreate">senkronu aç</button></div>
        <div class="sync-row"><input id="syncCodeIn" placeholder="diğer cihazdaki kod" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="btn sm" id="syncJoin">bağlan</button></div>`;
      return;
    }
    const status = syncing ? 'eşitleniyor…'
      : sy.err ? `eşitlenemedi (${esc(sy.err)})`
      : sy.lastAt ? `son eşitleme: ${humanizePast(Date.now() - sy.lastAt)} ✓` : 'henüz eşitlenmedi';
    const others = Object.keys(state.costOthers || {}).length;
    el.innerHTML = `<div class="sync-code">${esc(prettyCode(sy.code))}</div>
      <p class="muted">${status}${others ? ` · ${others + 1} cihaz bağlı` : ''}</p>
      <p class="muted">Diğer cihazda: Ayarlar → Senkron → bu kodu gir. Ya da bağlantıyı kopyalayıp diğer cihazda aç.</p>
      <div class="sync-row"><button class="btn sm solid" id="syncNowBtn">şimdi eşitle</button><button class="btn sm" id="syncCopy">bağlantıyı kopyala</button><button class="btn sm danger" id="syncOff">kapat</button></div>`;
  }

  function renderProfile() {
    const p = state.profile;
    const el = $('profileBox');
    if (!p) {
      el.innerHTML = `<p class="muted">Henüz seni tanımıyorum kanka. Birkaç kelime sor, birkaç soruya cevap ver; arka planda notlar alıp sana göre ders yapmaya başlarım.</p>`;
      return;
    }
    const chips = (arr) => (arr || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('');
    el.innerHTML = `
      <p>${esc(p.summary_tr || '')}${p.level ? ` <span class="chip solid">${esc(p.level)}</span>` : ''}</p>
      ${p.interests && p.interests.length ? `<div class="prow"><span>ilgi alanların</span>${chips(p.interests)}</div>` : ''}
      ${p.goals && p.goals.length ? `<div class="prow"><span>öğrenmek istediklerin</span>${chips(p.goals)}</div>` : ''}
      ${p.weak_points && p.weak_points.length ? `<div class="prow"><span>üzerinde çalıştığımız</span>${chips(p.weak_points)}</div>` : ''}
      ${p.life && p.life.length ? `<div class="prow"><span>hayatından</span>${chips(p.life)}</div>` : ''}
      <p class="muted">son güncelleme: ${humanizePast(Date.now() - state.profileAt)}</p>`;
  }
  function humanizePast(ms) {
    if (ms < 2 * MIN) return 'az önce';
    if (ms < HOUR) return Math.round(ms / MIN) + ' dk önce';
    if (ms < DAY) return Math.round(ms / HOUR) + ' saat önce';
    return Math.round(ms / DAY) + ' gün önce';
  }

  function renderList() {
    const q = T.key($('search').value || '');
    const list = state.words.filter((w) => !q || T.key(w.de).includes(q) || T.lowerTr(w.tr).includes(q)).slice().reverse();
    $('wordList').innerHTML = list.length ? list.map((w) => {
      const lv = Math.min(5, Math.ceil(w.level / 2));
      return `<li>${w.img ? `<img class="li-img" src="${esc(w.img)}" alt="" loading="lazy">` : '<span class="li-img"></span>'}<div><span class="de">${w.art ? `<small>${esc(w.art)}</small> ` : ''}${esc(w.de)}</span><span class="tr">${esc(w.tr)}</span></div>
        <span class="seen">${seenTodayOf(w) ? seenTodayOf(w) + '×' : ''}</span><span class="lv" title="seviye ${w.level} · sonraki tekrar ${humanize(Math.max(0, w.due - Date.now()))}${difficulty(w) > 1.4 ? ' · zor kelime' : ''}">${difficulty(w) > 1.4 ? '<b class="hard">!</b>' : ''}${[0, 1, 2, 3, 4].map((i) => `<i class="${i < lv ? 'f' : ''}"></i>`).join('')}</span>
        <button class="del" data-id="${w.id}" aria-label="sil">×</button></li>`;
    }).join('') : '<li class="empty">Henüz kelime yok.</li>';
  }
  $('syncBox').addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id === 'syncCreate') {
      state.sync.code = newSyncCode();
      save(false); renderSync();
      await syncNow();
    } else if (id === 'syncJoin') {
      const c = cleanCode($('syncCodeIn').value);
      if (c.length < 12) { $('syncCodeIn').classList.remove('shake'); void $('syncCodeIn').offsetWidth; $('syncCodeIn').classList.add('shake'); return; }
      state.sync.code = prettyCode(c);
      save(false); renderSync();
      await syncNow();
      renderSheet();
    } else if (id === 'syncNowBtn') {
      e.target.textContent = 'eşitleniyor…';
      await syncNow();
      renderSheet();
    } else if (id === 'syncCopy') {
      const link = location.origin + location.pathname + '?sync=' + cleanCode(state.sync.code);
      try { await navigator.clipboard.writeText(link); e.target.textContent = 'kopyalandı ✓'; } catch (err) { prompt('Bu bağlantıyı diğer cihazda aç:', link); }
    } else if (id === 'syncOff') {
      if (!confirm('Bu cihazda senkron kapatılsın mı? (Veriler silinmez.)')) return;
      state.sync = { code: '', lastAt: 0, err: '' };
      state.costOthers = {};
      save(false); renderSheet();
    }
  });
  $('search').addEventListener('input', renderList);
  $('wordList').addEventListener('click', (e) => {
    const b = e.target.closest('.del');
    if (b && confirm('Bu kelime silinsin mi?')) { deleteWord(b.dataset.id); renderSheet(); }
  });
  document.querySelectorAll('.stepper').forEach((s) => {
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      const k = s.dataset.key, step = +s.dataset.step;
      const v = Math.max(+s.dataset.min, Math.min(+s.dataset.max, state.settings[k] + step * +b.dataset.d));
      state.settings[k] = v; state.settingsAt = Date.now();
      save(); render(); renderSheet();
    });
  });
  $('freqSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.settings.freq = b.dataset.v; state.settingsAt = Date.now(); save(); renderSheet();
    nextReviewAt = Math.min(nextReviewAt, Date.now() + GAPS[state.settings.freq]);
  });
  $('nameInput').addEventListener('change', (e) => {
    state.settings.name = e.target.value.trim().slice(0, 30);
    state.settingsAt = Date.now();
    save();
  });
  $('sfxSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.settings.sfx = b.dataset.v; state.settingsAt = Date.now(); save(); renderSheet();
    if (b.dataset.v === 'on') sfx('on');
  });
  $('engineSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'engineTest') {
      const txt = `Hallo${nameTag(' ')}! Das ist meine neue Stimme. Wie findest du sie?`;
      const eng = state.settings.engine || 'thorsten';
      if (eng === 'device' || !window.Voice) { deviceSay(txt); $('engineStatus').textContent = '· cihaz sesi çalındı'; return; }
      $('engineStatus').textContent = '· hazırlanıyor…';
      Voice.speak(txt, eng)
        .then(() => { $('engineStatus').textContent = '· çalındı ✓ (duymadıysan ses düzeyini kontrol et)'; })
        .catch((err) => { deviceSay(txt); $('engineStatus').textContent = `· Piper çalamadı (${String((err && err.message) || err).slice(0, 60)}) – cihaz sesi kullanıldı`; });
      return;
    }
    if (!b.dataset.v) return;
    const prev = state.settings.engine || 'thorsten';
    state.settings.engine = b.dataset.v; state.settingsAt = Date.now(); save(); renderSheet();
    if (b.dataset.v === 'device' || !window.Voice) return;
    // bir Piper sesi zaten yüklüyse yenisi için sayfa bir kez yenilenir
    if (prev !== 'device' && prev !== b.dataset.v && Voice.status().status !== 'idle') { setTimeout(() => location.reload(), 250); return; }
    Voice.load(b.dataset.v).catch(() => {});
  });
  if (window.Voice) Voice.onChange(() => { if (!$('sheet').hidden) renderEngine(); });
  function renderEngine() {
    const eng = state.settings.engine || 'thorsten';
    document.querySelectorAll('#engineSeg [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === eng));
    const st = window.Voice ? Voice.status() : { status: 'error' };
    $('engineStatus').textContent = eng === 'device' ? '' :
      st.status === 'loading' ? `· yükleniyor %${st.percent}` :
      st.status === 'ready' ? '· hazır ✓' :
      st.status === 'error' ? `· yüklenemedi: ${String(st.error || '').slice(0, 60)} (cihaz sesi kullanılıyor)` :
      lastVoiceError ? `· son hata: ${lastVoiceError.slice(0, 50)}` : '· ilk kullanımda ~90 MB iner';
  }
  $('voiceSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.settings.voice = b.dataset.v; state.settingsAt = Date.now(); save(); renderSheet();
  });
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kelime-defteri-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.words)) throw new Error('biçim');
      const known = new Set(state.words.map((w) => T.key(w.de)));
      let added = 0;
      data.words.forEach((w) => { if (w.de && w.tr && !known.has(T.key(w.de))) { state.words.push(w); added++; } });
      save(); render(); renderSheet();
      alert(`${added} kelime eklendi.`);
    } catch (err) { alert('Dosya okunamadı.'); }
    e.target.value = '';
  });
  $('profileRefresh').addEventListener('click', () => { state.profileAt = 0; maybeUpdateProfile(true); $('profileBox').insertAdjacentHTML('beforeend', '<p class="muted">düşünüyorum…</p>'); });
  $('profileForget').addEventListener('click', () => {
    if (!confirm('Kanka seninle ilgili tüm notlarını silsin mi?')) return;
    state.profile = null; state.log = []; state.logCount = 0; state.logAtProfile = 0; state.profileAt = 0;
    save(); renderSheet();
  });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Tüm kelimeler ve ilerleme silinsin mi?')) return;
    const keepCost = state.cost, keepSync = state.sync, keepDev = state.deviceId;
    const gone = Object.fromEntries(state.words.map((w) => [deKey(w.de), Date.now()]));
    state = defaults();
    state.cost = keepCost; state.sync = keepSync; state.deviceId = keepDev;
    state.deleted = gone; // senkronda diğer cihazdan geri gelmesin
    save(); render(); renderSheet();
  });

  /* ---------- başlangıç ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  render();
  requestAnimationFrame(syncGround);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { scene.resize(); scheduleFit(); });
  scheduleFit();
  if (state.paused) { scene.setMood('sleep'); scene.setMood2('sleep'); scene.setMood3('sleep'); }
  else {
    if (state.worker2Muted) scene.setMood2('sleep');
    if (!state.words.length) {
      setTimeout(() => {
        if (bubbleKind || busy) return;
        setMood('talking', 1500);
        showBubble(`<div class="b-tag">Hallo${nameTag(' ')}!</div><div>Ich bin da und lerne mit dir Deutsch. Schreib unten ein Wort – auf Türkisch oder Deutsch – und ich erkläre es dir. Danach bringe ich dir den ganzen Tag Sätze und Fragen.</div>
          <div class="b-actions"><button class="btn sm" data-act="close">alles klar</button></div>`, 'info', { autoClose: 20000, focus: false });
      }, 1200);
    }
  }
  if (state.sync.code) setTimeout(syncNow, 1500);
  setTimeout(() => { if (typeof backfillUsage === 'function') backfillUsage(); }, 2500);
  // kaliteli ses: arka planda hazırla; ilk indirmede kanka haber verir
  setTimeout(() => {
    const eng = state.settings.engine || 'thorsten';
    if (state.settings.voice !== 'on' || eng === 'device' || !window.Voice || !isActive()) return;
    let told = false;
    const off = Voice.onChange((st) => {
      if (st.status === 'loading' && st.percent > 0 && st.percent < 100 && !told && bubble.hidden) { told = true; think(`ich lade meine neue Stimme… %${st.percent}`, 4000); }
      if (st.status === 'ready') { off(); if (told && bubble.hidden) think('neue Stimme ist bereit ✓', 4000); }
    });
    Voice.load(eng).catch(() => {});
  }, 4000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // test için
  window.__app = { state: () => state, startReview, scene, submitWord, setMood, hideBubble, nextTalkNow: () => { hideBubbleQuiet(); nextTalk(); }, think, showAiItem: (it) => { hideBubbleQuiet(); return showAiItem(it); }, refill: () => { aiNextFetch = 0; return refillQueue(); }, queueLen: () => aiQueue.length, profileNow: () => maybeUpdateProfile(true), idleFor: (ms) => { lastInteraction = Date.now() - ms; }, isActive: () => isActive(), review: (w, q) => review(w, q), syncNow: () => syncNow(), openStory, renderUnderlinedStory, toggleWorker2, suggestNext, dbg: () => ({ bubbleKind, busy, nextIn: nextReviewAt - Date.now(), quietIn: readerQuietUntil - Date.now(), paused: state.paused, worker2Muted: !!state.worker2Muted, words: state.words.length, mood: scene.mood, mood2: scene.mood2, mood3: scene.mood3, thought: thought.hidden ? '' : thought.textContent, dormant }) };
})();
