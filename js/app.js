/* Kelime Defteri — ana uygulama mantığı */
(function () {
  const STORE = 'kelime-defteri-v1';
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  // Aralıklı tekrar seviyeleri (Leitner benzeri)
  const INTERVALS = [45 * 1000, 3 * MIN, 15 * MIN, HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 90 * DAY];
  const MASTERED = 5;
  const GAPS = { often: 10 * 1000, normal: 22 * 1000, rare: 60 * 1000 };

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
        s.days = s.days || {};
        s.recent = Array.isArray(s.recent) ? s.recent : [];
        s.log = Array.isArray(s.log) ? s.log : [];
        s.profile = s.profile && typeof s.profile === 'object' ? s.profile : null;
        s.profileAt = s.profileAt || 0;
        s.logAtProfile = s.logAtProfile || 0;
        s.words.forEach((w) => {
          if (!Array.isArray(w.pool)) w.pool = w.ex ? [{ de: w.ex.de, tr: w.ex.tr || '', n: 0, last: 0 }] : [];
          if (!Array.isArray(w.asked)) w.asked = [];
        });
        return s;
      }
    } catch (e) { /* boş başla */ }
    return defaults();
  }
  function defaults() {
    return { words: [], days: {}, recent: [], log: [], profile: null, profileAt: 0, logAtProfile: 0, settings: { dailyGoal: 10, totalGoal: 500, freq: 'normal', voice: 'on', sfx: 'on' }, paused: false };
  }
  function save() {
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

  /* ---------- ses efektleri ---------- */
  if (window.SFX) SFX.setEnabled(() => state.settings.sfx !== 'off');
  const sfx = (n) => window.SFX && SFX.play(n);
  const ACT_SOUNDS = {
    close: 'pop', edit: 'edit', delete: 'del', reveal: 'reveal', later: 'later',
    addnew: 'coin', skip: 'whoosh', 'say-ex': 'bell',
  };
  const ID_SOUNDS = {
    menuBtn: 'menuOpen', closeSheet: 'menuClose', askBtn: 'ask', exportBtn: 'export',
    resetBtn: 'reset', profileRefresh: 'refresh', profileForget: 'forget',
  };
  function soundFor(b) {
    if (b.id === 'pauseBtn') return state.paused ? 'resume' : 'pause';
    if (ID_SOUNDS[b.id]) return ID_SOUNDS[b.id];
    if (b.matches('label.btn') && b.querySelector('#importFile')) return 'import';
    if (b.dataset.say) return 'bell';
    const act = b.dataset.act;
    if (act === 'knew' || act === 'forgot' || act === 'giveup') return null; // sonuç sesi çalacak
    if (ACT_SOUNDS[act]) return ACT_SOUNDS[act];
    if (b.dataset.d) return +b.dataset.d > 0 ? 'plus' : 'minus';
    if (b.closest('#freqSeg')) return 'choice' + ['often', 'normal', 'rare'].indexOf(b.dataset.v);
    if (b.closest('#voiceSeg')) return b.dataset.v === 'on' ? 'on' : 'off';
    if (b.closest('#sfxSeg')) return b.dataset.v === 'on' ? null : 'off';
    if (b.classList.contains('del')) return 'crumple';
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
  scene.onResize = () => { syncGround(); placeBubble(); if (typeof placeThought === 'function') placeThought(); };
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
    document.body.classList.toggle('paused', !!state.paused);
    renderTicker();
  }

  function renderTicker() {
    const recent = state.words.slice(-12).reverse();
    const items = recent.length
      ? recent.map((w) => `<span><b>${esc(fullDe(w))}</b> — ${esc(w.tr)}</span>`).join('')
      : '<span>Bir kelime yaz, birlikte öğrenelim</span><span>Türkçe ⇄ Deutsch</span><span>Schritt für Schritt</span>';
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
  let nextReviewAt = Date.now() + 20 * 1000;
  let busy = false;
  let moodUntil = 0;

  function showBubble(html, kind, opts = {}) {
    clearTimeout(bubbleTimer);
    bubble.innerHTML = html;
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
    bubble.hidden = true;
    bubbleKind = null;
    nextReviewAt = Date.now() + GAPS[state.settings.freq];
    if (!state.paused) setMood('typing', 4000);
    updateTitle();
  }
  function placeBubble() {
    if (bubble.hidden) return;
    const a = scene.headAnchor();
    const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const hx = cr.left - sr.left + a.x;
    const hy = cr.top - sr.top + a.y;
    const bw = bubble.offsetWidth;
    let left = hx - bw * 0.42;
    left = Math.max(8, Math.min(left, sr.width - bw - 8));
    bubble.style.left = left + 'px';
    bubble.style.bottom = (sr.height - hy + 14) + 'px';
    const cardTop = $('card').getBoundingClientRect().top;
    bubble.style.maxHeight = Math.max(160, sr.top - cardTop + hy - 30) + 'px';
    bubble.style.setProperty('--tail', Math.max(16, Math.min(bw - 16, hx - left)) + 'px');
  }
  window.addEventListener('resize', placeBubble);

  function setMood(m, ms = 0) {
    scene.setMood(m);
    moodUntil = Date.now() + ms;
  }

  const speakerSvg = '<svg viewBox="0 0 10 9" shape-rendering="crispEdges"><rect x="0" y="3" width="2" height="3"/><rect x="2" y="2" width="1" height="5"/><rect x="3" y="1" width="1" height="7"/><rect x="4" y="0" width="1" height="9"/><rect x="6" y="3" width="1" height="3"/><rect x="8" y="1" width="1" height="7"/></svg>';
  const speakBtn = (text) => `<button class="btn speak" data-say="${esc(text)}" aria-label="Sesli oku">${speakerSvg}</button>`;

  function say(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      u.rate = 0.9;
      const v = speechSynthesis.getVoices().find((x) => /^de/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
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
    if (!p) return '';
    const parts = [];
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
      const prevObs = state.profile && state.profile.observation_tr;
      state.profile = {
        summary_tr: str(r.summary_tr, 400), level: str(r.level, 3),
        interests: arr(r.interests, 6), life: arr(r.life, 5), goals: arr(r.goals, 5), weak_points: arr(r.weak_points, 5),
        style: str(r.style, 300), next_focus: str(r.next_focus, 200), observation_tr: str(r.observation_tr, 160),
      };
      state.profileAt = Date.now();
      state.logAtProfile = state.logCount || 0;
      save();
      if (state.profile.observation_tr && state.profile.observation_tr !== prevObs) {
        setTimeout(() => { if (bubble.hidden) { setMood('thinking', 6000); think(state.profile.observation_tr, 8000); } }, 1500);
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
    const ex = e ? `<div class="b-ex">„${highlight(e.de, w.de) || esc(e.de)}“${e.tr ? `<span class="tr">${esc(e.tr)}</span>` : ''}</div>` : '';
    const plural = w.plural ? ` <span class="alt">· çoğul: ${esc(w.plural)}</span>` : '';
    const meaning = w.meaning_tr ? `<div class="b-hint">${esc(w.meaning_tr)}</div>` : '';
    const simple = w.explain_de ? `<div class="b-simple"><span>einfach gesagt</span>${esc(w.explain_de)}</div>` : '';
    const sayLine = opts.say && w.say_tr ? `<div class="b-say">${esc(w.say_tr)}</div>` : '';
    return `<div class="b-tag">${tag}</div>${sayLine}
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
    think(pick(['dur bakayım… sözlüğü karıştırıyorum', 'hmm, bunu sana güzel anlatayım', 'tamam kanka, hemen bakıyorum', 'bir saniye, not alıyorum']) + '…', 6000);
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
    think('defterime yazıyorum…', 1200);
    await sleep(900);
    const w = addWord(res);
    logEvent('lookup', { q, de: fullDe(w), tr: w.tr, pos: w.pos });
    busy = false;
    setMood('talking', 1500);
    showBubble(`${wordCard(w, 'yeni kelime · defterime yazdım', { say: true })}
      <div class="b-actions"><button class="btn sm" data-act="close">tamam</button><button class="btn sm" data-act="edit" data-id="${w.id}">düzelt</button></div>`,
      'info', { autoClose: 25000 });
    if (state.settings.voice === 'on') say(fullDe(w));
    celebrateGoal();
  }

  function showKnown(w, q) {
    logEvent('lookup_again', { q, de: fullDe(w), level: w.level });
    const typo = q && deKey(q) !== deKey(w.de) && T.lowerTr(q.trim()) !== T.lowerTr(w.tr)
      ? `<div class="b-hint">yazılışı: <b>${esc(fullDe(w))}</b></div>` : '';
    setMood('happy', 1800);
    showBubble(`${wordCard(w, 'bunu zaten biliyoruz kanka ✓', { ex: nextSentence(w, false, false) || w.ex })}${typo}
      <div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 15000 });
    if (state.settings.voice === 'on') say(fullDe(w));
  }

  function hideBubbleQuiet() {
    clearTimeout(bubbleTimer);
    bubble.hidden = true;
    bubbleKind = null;
  }

  function addWord(res) {
    const already = findByDe(res.de);
    if (already) return already; // aynı kelime ikinci kez eklenmez
    const now = Date.now();
    const w = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      de: res.de, art: res.art || '', tr: res.tr, alts: res.alts || [], pos: res.pos || '',
      plural: res.plural || '', meaning_tr: res.meaning_tr || '', explain_de: res.explain_de || '', say_tr: res.say_tr || '',
      ex: res.ex || null, dir: res.dir || 'tr2de', source: res.source || '',
      level: 0, due: now + INTERVALS[0], created: now, reviews: 0, correct: 0, lapses: 0, last: 0,
      pool: res.ex ? [{ de: res.ex.de, tr: res.ex.tr || '', n: 1, last: now }] : [], asked: [],
    };
    if (res.ex) markShown(res.ex.de);
    state.words.push(w);
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
        showBubble(`<div class="b-tag">günlük hedef</div><div class="b-big">Tamamlandı!</div>
          <div class="b-hint">Bugün ${n} yeni kelime kanka, helal olsun. Toll gemacht!</div>`, 'info', { autoClose: 5000 });
      }, 6000);
    }
  }

  function manualEntry(q) {
    const g = T.guessLang(q);
    const deV = g === 'de' ? q : '', trV = g === 'de' ? '' : q;
    showBubble(`<div class="b-tag">internete ulaşamadım</div>
      <div class="b-hint">Anlamını sen yazar mısın? Ben hafızama alırım.</div>
      <form class="b-edit" data-form="manual">
        <div class="row"><label>artikel<select name="art"><option value=""></option><option>der</option><option>die</option><option>das</option></select></label>
        <label style="flex:1">almanca<input name="de" value="${esc(deV)}" autocapitalize="off"></label></div>
        <label>türkçe<input name="tr" value="${esc(trV)}" autocapitalize="off"></label>
        <div class="b-actions"><button class="btn sm solid" type="submit">kaydet</button><button class="btn sm" type="button" data-act="close">vazgeç</button></div>
      </form>`, 'edit');
  }

  function editWord(id) {
    const w = state.words.find((x) => x.id === id);
    if (!w) return;
    showBubble(`<div class="b-tag">düzelt</div>
      <form class="b-edit" data-form="edit" data-id="${w.id}">
        <div class="row"><label>artikel<select name="art">${['', 'der', 'die', 'das'].map((a) => `<option${a === w.art ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
        <label style="flex:1">almanca<input name="de" value="${esc(w.de)}" autocapitalize="off"></label></div>
        <label>türkçe<input name="tr" value="${esc(w.tr)}" autocapitalize="off"></label>
        <label>örnek cümle<input name="ex" value="${esc(w.ex ? w.ex.de : '')}" autocapitalize="off"></label>
        <div class="b-actions"><button class="btn sm solid" type="submit">kaydet</button><button class="btn sm" type="button" data-act="delete" data-id="${w.id}">sil</button><button class="btn sm" type="button" data-act="close">vazgeç</button></div>
      </form>`, 'edit');
  }

  /* ---------- tekrar (aralıklı tekrar) ---------- */
  let current = null; // {w, mode, answer}

  function dueWords() {
    const now = Date.now();
    return state.words.filter((w) => w.due <= now).sort((a, b) => a.due - b.due);
  }

  function pickMode(w, hasSentence) {
    let modes;
    if (w.level <= 1) modes = hasSentence ? ['recall', 'cloze', 'recall'] : ['recall', 'reverse'];
    else modes = hasSentence ? ['cloze', 'cloze', 'reverse', 'recall'] : ['reverse', 'reverse', 'recall'];
    const other = modes.filter((m) => m !== w.lastMode);
    return pick(other.length ? other : modes);
  }

  const REVIEW_OPTS = { autoClose: 120000, onTimeout: () => postpone() };
  function postpone() {
    if (current && current.w) current.w.due = Math.max(current.w.due, Date.now() + 5 * MIN);
    current = null;
    save();
  }

  function startReview(w, mode) {
    if (!w) return;
    const hasSentence = freshSentences(w) > 0;
    mode = mode || pickMode(w, hasSentence);
    const ex = mode === 'reverse' ? null : nextSentence(w, true);
    const exW = ex && wordIn(ex.de, w);
    if (mode === 'cloze' && !exW) mode = 'reverse';
    w.lastMode = mode;
    current = { w, mode, ex, revealed: false };
    setMood('talking', 1200);
    if (mode === 'cloze') {
      current.answer = exW;
      showBubble(`<div class="b-tag">${pick(['boşluğu doldurur musun?', 'kanka buraya ne gelir?', 'şunu tamamla bakalım'])}</div>
        <div class="b-ex" style="border:0;margin:0;padding:0">„${highlight(ex.de, exW, 'gap')}“</div>
        <div class="b-hint">ipucu: ${esc(w.tr)}${ex.tr ? ` · <i>${esc(ex.tr)}</i>` : ''}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="hangi kelime?" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">bilmiyorum</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review', REVIEW_OPTS);
    } else if (mode === 'reverse') {
      current.answer = w.de;
      showBubble(`<div class="b-tag">${pick(['almancası neydi?', 'kanka bunu Almanca nasıl derdik?', 'hadi, Almancası?'])}</div>
        <div class="b-big">${esc(w.tr)}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="${w.pos === 'n' ? 'artikel + kelime' : 'almanca'}" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">bilmiyorum</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review', REVIEW_OPTS);
    } else {
      current.mode = 'recall';
      const sentence = ex ? `<div class="b-ex" style="border:0;margin:0;padding:0">„${highlight(ex.de, w.de) || esc(ex.de)}“</div>` : '';
      showBubble(`<div class="b-tag">${pick(['bunu hatırlıyor musun?', 'kanka bu neydi?', 'hadi bakalım, bu neydi?'])}</div>
        <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
        ${sentence}
        <div class="b-actions"><button class="btn sm solid" data-act="reveal">göster</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review', { ...REVIEW_OPTS, focus: false });
    }
    updateTitle();
  }

  function reveal() {
    const w = current.w;
    current.revealed = true;
    showBubble(`${wordCard(w, 'hatırladın mı?', { ex: current.ex })}
      <div class="b-actions"><button class="btn sm solid" data-act="knew">bildim ✓</button><button class="btn sm" data-act="forgot">bilemedim</button></div>`, 'review', { focus: false });
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
    if (!ok && b.length >= 5 && lev(a, b) <= 1) { ok = true; note = `küçük bir yazım farkı: <b>${esc(current.answer)}</b>`; }
    if (ok && current.mode === 'reverse' && w.art) {
      const m = input.trim().toLowerCase().match(/^(der|die|das)\s/);
      if (!m) note = note || `artikeliyle: <b>${esc(fullDe(w))}</b>`;
      else if (m[1] !== w.art) note = `artikel <b>${esc(w.art)}</b> olacak: ${esc(fullDe(w))}`;
    }
    current.input = input;
    grade(ok, note);
  }

  function record(w, ok) {
    const now = Date.now();
    w.reviews++;
    w.last = now;
    if (ok) { w.correct++; w.level = Math.min(INTERVALS.length - 1, w.level + 1); }
    w.due = now + INTERVALS[w.level] * (0.9 + Math.random() * 0.2);
    const d = day();
    d.reviewed++;
    if (ok) d.correct++;
    save();
    render();
  }

  function grade(ok, note) {
    const w = current.w;
    const shownEx = current.ex || null;
    logEvent('quiz', { mode: current.mode, de: fullDe(w), tr: w.tr, ok, answer: current.input || (ok ? '(bildim)' : '(bilemedim)'), expected: current.answer });
    const now = Date.now();
    w.reviews++;
    w.last = now;
    if (ok) {
      w.correct++;
      w.level = Math.min(INTERVALS.length - 1, w.level + 1);
    } else {
      w.lapses++;
      w.level = w.level >= 4 ? 2 : 0;
    }
    w.due = now + INTERVALS[w.level] * (ok ? 0.9 + Math.random() * 0.2 : 1);
    const d = day();
    d.reviewed++;
    if (ok) d.correct++;
    save();
    render();
    const nextTxt = humanize(w.due - now);
    sfx(ok ? 'ok' : 'no');
    if (ok) {
      setMood('happy', 2200);
      const praise = pick(['helal kanka!', 'Super!', 'Sehr gut!', 'işte bu!', 'Genau!', 'sen bu işi biliyorsun']);
      showBubble(`<div class="b-tag">${praise}</div>
        <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
        <div class="b-mean">${esc(w.tr)}</div>
        ${note ? `<div class="b-hint">${note}</div>` : ''}
        <div class="b-hint">bir dahaki tekrar: ${nextTxt}</div>`, 'feedback', { autoClose: note ? 5000 : 3200 });
    } else {
      setMood('sad', 2500);
      showBubble(`${wordCard(w, 'olsun kanka, doğrusu bu — yine soracağım', { ex: shownEx })}
        <div class="b-actions"><button class="btn sm solid" data-act="close">tamam</button></div>`, 'feedback', { autoClose: 20000, focus: false });
    }
    if (state.settings.voice === 'on') say(fullDe(w));
    current = null;
  }

  function humanize(ms) {
    if (ms < MIN) return 'birazdan';
    if (ms < HOUR) return Math.round(ms / MIN) + ' dk sonra';
    if (ms < DAY) return Math.round(ms / HOUR) + ' saat sonra';
    return Math.round(ms / DAY) + ' gün sonra';
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
      'sana yeni kelimeler getiriyorum kanka…',
      'senin yerine çalışıyorum, sen keyfine bak',
      'hmm… bugün sana ne öğretsem',
      'şu daktilo da hiç susmuyor valla',
      'bir kahve daha mı içsem…',
      'cümleleri senin için cilalıyorum',
      'Almanca artikeller… der, die, das… off',
    ];
    if (w) {
      lines.push(`„${fullDe(w)}“ için yeni bir cümle düşünüyorum…`);
      lines.push(`„${w.de}“ kelimesini unutmadın değil mi?`);
      lines.push(`${w.tr}… ${fullDe(w)}… tamam not aldım`);
    }
    const nToday = todayAdded();
    if (nToday) lines.push(`bugün ${nToday} kelime yaptık, fena değiliz!`);
    if (nToday < state.settings.dailyGoal && nToday > 0) lines.push(`hedefe ${state.settings.dailyGoal - nToday} kelime kaldı kanka`);
    if (h >= 23 || h < 6) lines.push('geç oldu ama ben buradayım', 'uykum geldi ama devam…');
    if (h >= 6 && h < 11) lines.push('günaydın kanka, kahveler benden');
    if (aiQueue.length) lines.push('sana birkaç cümle hazırladım, birazdan…');
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
    const score = (w) => (w.due <= now ? 0 : 10) + w.level + Math.random() * 3 + (lastFocus.has(w.id) ? 6 : 0);
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
    aiNextFetch = Date.now() + 20 * 1000;
    try {
      const n = state.words.length;
      const wantNew = n === 0 || (n < 20 ? Math.random() < 0.5 : Math.random() < 0.2);
      const items = await AI.talk(focusWords(), state.words.map((w) => w.de).slice(-150), wantNew, 3);
      // daha önce gösterilenleri ele, aynı kelimeyi arka arkaya koyma
      items.filter((it) => !seen(it.de) && !seen(it.q_de) && !seen(it.text_tr) && !aiQueue.some((q) => sentKey(q.de || q.q_de || q.text_tr) === sentKey(it.de || it.q_de || it.text_tr)))
        .forEach((it) => aiQueue.push(it));
      aiQueue.sort(() => Math.random() - 0.5);
    } catch (e) { /* model yoksa yerel konuşmaya devam */ }
    aiFetching = false;
  }

  function wordById(it) {
    return state.words.find((w) => w.id === it.id) ||
      (it.answer && state.words.find((w) => T.key(w.de) === T.key(it.answer))) || null;
  }

  function nextTalk() {
    const due = dueWords();
    // 1) Zamanı gelen kelimeler öncelikli (aralıklı tekrar)
    if (due.length && (Math.random() < 0.65 || !aiQueue.length)) {
      const w0 = due[0];
      const ai = aiQueue.findIndex((it) => ['cloze', 'ask', 'example'].includes(it.type) && it.id === w0.id);
      if (ai >= 0 && showAiItem(aiQueue.splice(ai, 1)[0])) return;
      // elimizde taze cümle yoksa: cümlesiz soru sor, model yenilerini hazırlasın
      if (!freshSentences(w0)) { aiNextFetch = 0; return startReview(w0, w0.lastMode === 'reverse' ? 'recall' : 'reverse'); }
      return startReview(w0);
    }
    // 2) Modelin hazırladığı konuşmalar
    while (aiQueue.length) {
      const it = aiQueue.shift();
      if (showAiItem(it)) return;
    }
    // 3) Yerel yedek: bir kelimeyi örnek cümlesiyle hatırlat
    if (state.words.length && Math.random() < 0.6) {
      const w = pick([...state.words].sort((a, b) => a.level - b.level || a.last - b.last).slice(0, 6));
      if (freshSentences(w)) {
        const ex = nextSentence(w, true);
        return showExample(w, ex.de, ex.tr, '', true);
      }
      return startReview(w, w.lastMode === 'reverse' ? 'recall' : 'reverse');
    }
    nextReviewAt = Date.now() + 8000;
    idleThought();
  }

  function showExample(w, de, tr, note, already) {
    if (!already) { markShown(de); addToPool(w, de, tr); save(); }
    setMood('talking', 1400);
    const hl = highlight(de, w.de) || esc(de);
    showBubble(`<div class="b-tag">${pick(['bak şu cümleye kanka', 'bunu da böyle kullanırsın', 'aklında kalsın diye'])}</div>
      <div class="b-ex" style="border:0;margin:0;padding:0">„${hl}“ <button class="btn speak" data-act="say-ex" data-text="${esc(de)}" aria-label="Sesli oku">${speakerSvg}</button>${tr ? `<span class="tr">${esc(tr)}</span>` : ''}</div>
      <div class="b-hint">${w.art ? esc(w.art) + ' ' : ''}<b>${esc(w.de)}</b> = ${esc(w.tr)}</div>
      ${note ? `<div class="b-say">${esc(note)}</div>` : ''}
      <div class="b-actions"><button class="btn sm" data-act="close">anladım</button></div>`, 'chat', { autoClose: 18000 });
    return true;
  }

  function showAiItem(it) {
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    if (seen(it.de) || seen(it.q_de) || seen(it.text_tr)) return false;
    if (it.type === 'chat' && s(it.text_tr)) { markShown(it.text_tr); think(s(it.text_tr), 6000); nextReviewAt = Date.now() + 6000; return true; }
    if (it.type === 'new') return suggestNew(it);
    const w = wordById(it);
    if (!w) return false;
    if (it.type === 'example' && s(it.de)) return showExample(w, s(it.de), s(it.tr), s(it.note_tr));
    if (it.type === 'cloze' && s(it.de).includes('___') && s(it.answer)) {
      const full = s(it.de).replace('___', s(it.answer));
      if (seen(full)) return false;
      markShown(s(it.de)); markShown(full);
      addToPool(w, full, s(it.tr));
      save();
      w.lastMode = 'cloze';
      current = { w, mode: 'cloze', answer: s(it.answer), ex: { de: full, tr: s(it.tr) } };
      setMood('talking', 1200);
      const parts = s(it.de).split('___').map(esc);
      showBubble(`<div class="b-tag">${pick(['boşluğu doldur bakalım', 'kanka buraya ne gelir?', 'hadi şunu tamamla'])}</div>
        <div class="b-ex" style="border:0;margin:0;padding:0">„${parts.join('<span class="gap">&nbsp;</span>')}“</div>
        <div class="b-hint">ipucu: ${esc(w.tr)}${s(it.tr) ? ` · <i>${esc(s(it.tr))}</i>` : ''}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="hangi kelime?" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">bilmiyorum</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review', REVIEW_OPTS);
      return true;
    }
    if (it.type === 'ask' && s(it.q_de)) {
      askCtx = { w, q: s(it.q_de) };
      markShown(s(it.q_de));
      w.asked = [...(w.asked || []), s(it.q_de)].slice(-10);
      save();
      setMood('talking', 1400);
      showBubble(`<div class="b-tag">${pick(['sana bir soru', 'kanka bir şey soracağım', 'hadi biraz konuşalım'])}</div>
        <div class="b-big" style="font-size:20px">${esc(s(it.q_de))} <button class="btn speak" data-act="say-ex" data-text="${esc(s(it.q_de))}" aria-label="Sesli oku">${speakerSvg}</button></div>
        ${s(it.q_tr) ? `<div class="b-hint">${esc(s(it.q_tr))}</div>` : ''}
        <div class="b-hint">„${esc(fullDe(w))}“ kelimesini kullanmaya çalış</div>
        <form class="b-form" data-form="ask"><input name="a" placeholder="Almanca cevap ver…" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="close">geç</button></div>`, 'review', { autoClose: 120000 });
      return true;
    }
    if (it.type === 'tip' && s(it.text_tr)) {
      markShown(s(it.text_tr));
      if (s(it.de) && wordIn(s(it.de), w)) addToPool(w, s(it.de), '');
      setMood('talking', 1400);
      showBubble(`<div class="b-tag">küçük bir ipucu · ${esc(fullDe(w))}</div>
        <div>${esc(s(it.text_tr))}</div>
        ${s(it.de) ? `<div class="b-ex">„${highlight(s(it.de), w.de) || esc(s(it.de))}“</div>` : ''}
        <div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'chat', { autoClose: 16000 });
      return true;
    }
    return false;
  }

  function suggestNew(it) {
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    const de = s(it.de).replace(/^(der|die|das)\s+/i, '');
    if (!de || !s(it.tr) || findExisting(de)) return false;
    const art = ['der', 'die', 'das'].includes(s(it.art)) ? s(it.art) : '';
    if (it.example && s(it.example.de)) markShown(s(it.example.de));
    pendingNew = {
      de, art, tr: s(it.tr), pos: it.pos || (art ? 'n' : ''), explain_de: s(it.explain_de),
      ex: it.example && s(it.example.de) ? { de: s(it.example.de), tr: s(it.example.tr), src: 'muse' } : null,
      dir: 'tr2de', source: 'muse',
    };
    setMood('talking', 1500);
    showBubble(`${wordCard(pendingNew, pick(['sana yeni bir kelime getirdim kanka', 'bunu bilmen lazım bence', 'yeni bir tane buldum']))}
      <div class="b-actions"><button class="btn sm solid" data-act="addnew">deftere ekle</button><button class="btn sm" data-act="skip">geç</button></div>`, 'chat', { autoClose: 30000 });
    return true;
  }

  function addSuggested() {
    if (!pendingNew) return hideBubble();
    logEvent('accepted_suggestion', { de: (pendingNew.art ? pendingNew.art + ' ' : '') + pendingNew.de, tr: pendingNew.tr });
    const w = addWord(pendingNew);
    pendingNew = null;
    setMood('happy', 1800);
    showBubble(`${wordCard(w, 'yazdım kanka ✓ ara ara soracağım')}<div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 9000 });
    if (state.settings.voice === 'on') say(fullDe(w));
    celebrateGoal();
  }

  async function answerAsk(answer) {
    if (!askCtx) return hideBubble();
    const { w, q } = askCtx;
    askCtx = null;
    hideBubbleQuiet();
    busy = true;
    setMood('thinking');
    think('okuyorum… hmm', 8000);
    let res = null;
    try { res = await AI.check(q, fullDe(w), answer); } catch (e) { /* yedek */ }
    busy = false;
    const used = new RegExp(w.de.slice(0, Math.max(3, w.de.length - 2)), 'i').test(answer);
    const ok = res ? !!res.ok : used;
    sfx(ok ? 'ok' : 'no');
    logEvent('answer', { question: q, answer, ok, fix: res && res.fix_de });
    record(w, ok);
    setMood(ok ? 'happy' : 'talking', 2200);
    const fix = res && typeof res.fix_de === 'string' && res.fix_de.trim() && normalize(res.fix_de) !== normalize(answer) ? res.fix_de.trim() : '';
    const fb = res && res.feedback_tr ? res.feedback_tr : (ok ? 'helal kanka, güzel cevap!' : `„${fullDe(w)}“ kelimesini de kullanmayı dene kanka`);
    showBubble(`<div class="b-tag">${ok ? 'süpersin' : 'az kaldı'}</div>
      <div>${esc(fb)}</div>
      ${fix ? `<div class="b-ex">daha doğal: „${esc(fix)}“ <button class="btn speak" data-act="say-ex" data-text="${esc(fix)}" aria-label="Sesli oku">${speakerSvg}</button></div>` : ''}
      <div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'feedback', { autoClose: 15000 });
  }

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
    if (act === 'close') hideBubble();
    else if (act === 'edit') editWord(b.dataset.id);
    else if (act === 'delete') { deleteWord(b.dataset.id); hideBubble(); }
    else if (act === 'reveal') reveal();
    else if (act === 'knew') grade(true, '');
    else if (act === 'forgot') grade(false, '');
    else if (act === 'giveup') grade(false, '');
    else if (act === 'later') { if (current) logEvent('postponed', { de: fullDe(current.w), mode: current.mode }); postpone(); hideBubble(); }
    else if (act === 'addnew') addSuggested();
    else if (act === 'skip') { if (pendingNew) logEvent('skipped_suggestion', { de: pendingNew.de, tr: pendingNew.tr }); pendingNew = null; hideBubble(); }
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
          showBubble(`${wordCard(w, 'hafızama yazdım ✓')}<div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 15000 });
        });
      } else {
        const w = state.words.find((x) => x.id === f.dataset.id);
        if (!w) return hideBubble();
        const clash = findByDe(de);
        if (clash && clash.id !== w.id) {
          f.insertAdjacentHTML('afterbegin', `<div class="b-hint">„${esc(fullDe(clash))}“ zaten defterde kanka</div>`);
          f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
          return;
        }
        const exTxt = f.elements.ex.value.trim();
        w.de = de; w.tr = tr; w.art = art;
        if (art) w.pos = 'n';
        if (exTxt && (!w.ex || exTxt !== w.ex.de)) w.ex = { de: exTxt, tr: '', src: 'elle' };
        if (!exTxt) w.ex = null;
        save(); render();
        setMood('happy', 1500);
        showBubble(`${wordCard(w, 'güncelledim ✓')}<div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 12000 });
      }
    }
  });

  function deleteWord(id) {
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
    } else {
      setMood('happy', 1200);
      nextReviewAt = Date.now() + 8000;
    }
  });

  function askNow() {
    if (state.paused) { $('pauseBtn').click(); }
    if (busy) return;
    if (!state.words.length) {
      setMood('talking', 1500);
      showBubble(`<div class="b-tag">kanka!</div><div>Defterim daha boş. Aşağıya bir kelime yaz ya da biraz bekle, sana ben de yeni kelimeler getiririm.</div>
        <div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 12000 });
      return;
    }
    const due = dueWords();
    const w = due[0] || [...state.words].sort((a, b) => a.level - b.level || a.last - b.last)[0];
    startReview(w);
  }
  $('askBtn').addEventListener('click', askNow);
  canvas.addEventListener('click', () => { sfx('boop'); if (!bubbleKind) askNow(); });

  /* ---------- sürekli döngü ---------- */
  setInterval(() => {
    const now = Date.now();
    if (state.paused) { scene.setMood('sleep'); return; }
    if (busy) return;
    if (!bubbleKind && now > moodUntil) {
      const r = Math.random();
      const m = r < 0.62 ? 'typing' : r < 0.82 ? 'thinking' : 'window';
      setMood(m, (m === 'typing' ? 7000 : 3500) + Math.random() * 6000);
    } else if (bubbleKind && now > moodUntil && ['talking', 'happy', 'sad', 'listening'].includes(scene.mood)) {
      scene.setMood('waiting');
    }
    const typingNow = document.activeElement === $('wordInput') && $('wordInput').value;
    if (!bubbleKind && !typingNow && now >= nextReviewAt) {
      nextTalk();
    } else if (!bubbleKind && !typingNow && thought.hidden && now >= nextThoughtAt) {
      idleThought();
    }
    refillQueue();
    if (now % 15000 < 1000) maybeUpdateProfile();
    updateTitle();
  }, 1000);

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
    if (e.key === 'Escape') { if (!sheet.hidden) sheet.hidden = true; else if (bubbleKind && bubbleKind !== 'review') hideBubble(); }
  });

  function openSheet() {
    renderSheet();
    sheet.hidden = false;
  }
  function renderSheet() {
    document.querySelectorAll('.stepper').forEach((s) => { s.querySelector('b').textContent = state.settings[s.dataset.key]; });
    document.querySelectorAll('#freqSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.freq));
    document.querySelectorAll('#sfxSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === (state.settings.sfx || 'on')));
    document.querySelectorAll('#voiceSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.voice));
    const mastered = state.words.filter((w) => w.level >= MASTERED).length;
    const reviews = Object.values(state.days).reduce((s, d) => s + (d.reviewed || 0), 0);
    const correct = Object.values(state.days).reduce((s, d) => s + (d.correct || 0), 0);
    renderProfile();
    $('stats').innerHTML = `
      <div><b>${state.words.length}</b>kelime</div>
      <div><b>${mastered}</b>öğrenildi</div>
      <div><b>${dueWords().length}</b>tekrar bekliyor</div>
      <div><b>%${reviews ? Math.round((correct / reviews) * 100) : 0}</b>başarı</div>`;
    renderList();
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
      return `<li><div><span class="de">${w.art ? `<small>${esc(w.art)}</small> ` : ''}${esc(w.de)}</span><span class="tr">${esc(w.tr)}</span></div>
        <span class="lv" title="seviye ${w.level}">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < lv ? 'f' : ''}"></i>`).join('')}</span>
        <button class="del" data-id="${w.id}" aria-label="sil">×</button></li>`;
    }).join('') : '<li class="empty">Henüz kelime yok.</li>';
  }
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
      state.settings[k] = v;
      save(); render(); renderSheet();
    });
  });
  $('freqSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.settings.freq = b.dataset.v; save(); renderSheet();
    nextReviewAt = Math.min(nextReviewAt, Date.now() + GAPS[state.settings.freq]);
  });
  $('sfxSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.settings.sfx = b.dataset.v; save(); renderSheet();
    if (b.dataset.v === 'on') sfx('on');
  });
  $('voiceSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.settings.voice = b.dataset.v; save(); renderSheet();
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
    state = defaults();
    save(); render(); renderSheet();
  });

  /* ---------- başlangıç ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  render();
  requestAnimationFrame(syncGround);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { scene.resize(); });
  if (state.paused) scene.setMood('sleep');
  else if (!state.words.length) {
    setTimeout(() => {
      if (bubbleKind || busy) return;
      setMood('talking', 1500);
      showBubble(`<div class="b-tag">selam kanka!</div><div>Ben buradayım, senin için Almanca çalışıyorum. Aşağıya bir kelime yaz — Türkçe yazarsan Almancasını, Almanca yazarsan Türkçesini söylerim. Sonra gün boyu cümleler getirir, sorular sorarım.</div>
        <div class="b-actions"><button class="btn sm" data-act="close">anlaştık</button></div>`, 'info', { autoClose: 20000, focus: false });
    }, 1200);
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // test için
  window.__app = { state: () => state, startReview, scene, submitWord, setMood, hideBubble, nextTalkNow: () => { hideBubbleQuiet(); nextTalk(); }, think, showAiItem: (it) => { hideBubbleQuiet(); return showAiItem(it); }, refill: () => { aiNextFetch = 0; return refillQueue(); }, queueLen: () => aiQueue.length, profileNow: () => maybeUpdateProfile(true) };
})();
