/* Kelime Defteri — ana uygulama mantığı */
(function () {
  const STORE = 'kelime-defteri-v1';
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  // Aralıklı tekrar seviyeleri (Leitner benzeri)
  const INTERVALS = [45 * 1000, 3 * MIN, 15 * MIN, HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 90 * DAY];
  const MASTERED = 5;
  const GAPS = { often: 15 * 1000, normal: 40 * 1000, rare: 2 * MIN };

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
        return s;
      }
    } catch (e) { /* boş başla */ }
    return defaults();
  }
  function defaults() {
    return { words: [], days: {}, settings: { dailyGoal: 10, totalGoal: 500, freq: 'normal', voice: 'on' }, paused: false };
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

  /* ---------- sahne ---------- */
  const canvas = $('scene');
  const stage = $('stage');
  const bubble = $('bubble');
  const scene = new window.Scene(canvas);
  scene.onResize = () => { syncGround(); placeBubble(); };
  function syncGround() {
    const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    stage.style.setProperty('--ground', (cr.top - sr.top + scene.groundY()) + 'px');
    stage.style.setProperty('--px', scene.pcss + 'px');
  }

  /* ---------- arayüz güncelleme ---------- */
  function render() {
    const total = state.words.length;
    const goal = state.settings.totalGoal;
    const d = day();
    $('total').textContent = `${total.toLocaleString('tr-TR')} / ${goal.toLocaleString('tr-TR')}`;
    const pct = Math.min(100, Math.floor((total / goal) * 100));
    $('totalPct').textContent = '%' + pct;
    $('totalBar').style.width = pct + '%';
    $('today').textContent = `${d.added} / ${state.settings.dailyGoal}`;
    const dp = Math.min(100, (d.added / state.settings.dailyGoal) * 100);
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
    const html = items + items;
    const el = $('ticker');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
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
    placeBubble();
    if (opts.autoClose) bubbleTimer = setTimeout(() => hideBubble(), opts.autoClose);
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

  function wordCard(w, tag) {
    const alts = (w.alts || []).length ? ` <span class="alt">· ${esc(w.alts.slice(0, 2).join(', '))}</span>` : '';
    const ex = w.ex ? `<div class="b-ex">„${highlight(w.ex.de, w.de) || esc(w.ex.de)}“${w.ex.tr ? `<span class="tr">${esc(w.ex.tr)}</span>` : ''}</div>` : '';
    return `<div class="b-tag">${tag}</div>
      <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
      <div class="b-mean">${esc(w.tr)}${alts}</div>${ex}`;
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
    if (existing) {
      setMood('happy', 1800);
      showBubble(`${wordCard(existing, 'bunu zaten biliyoruz ✓')}
        <div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 15000 });
      if (state.settings.voice === 'on') say(fullDe(existing));
      return;
    }
    busy = true;
    hideBubbleQuiet();
    setMood('thinking');
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
    setMood('typing');
    await sleep(900);
    const w = addWord(res);
    busy = false;
    setMood('talking', 1500);
    showBubble(`${wordCard(w, 'yeni kelime · hafızama yazdım')}
      <div class="b-actions"><button class="btn sm" data-act="close">tamam</button><button class="btn sm" data-act="edit" data-id="${w.id}">düzelt</button></div>`,
      'info', { autoClose: 25000 });
    if (state.settings.voice === 'on') say(fullDe(w));
    celebrateGoal();
  }

  function hideBubbleQuiet() {
    clearTimeout(bubbleTimer);
    bubble.hidden = true;
    bubbleKind = null;
  }

  function addWord(res) {
    const now = Date.now();
    const w = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      de: res.de, art: res.art || '', tr: res.tr, alts: res.alts || [], pos: res.pos || '',
      ex: res.ex || null, dir: res.dir || 'tr2de', source: res.source || '',
      level: 0, due: now + INTERVALS[0], created: now, reviews: 0, correct: 0, lapses: 0, last: 0,
    };
    state.words.push(w);
    day().added++;
    save();
    render();
    return w;
  }

  let celebratedDay = '';
  function celebrateGoal() {
    const d = day();
    if (d.added === state.settings.dailyGoal && celebratedDay !== todayKey()) {
      celebratedDay = todayKey();
      setTimeout(() => {
        if (bubbleKind) return;
        setMood('happy', 3000);
        showBubble(`<div class="b-tag">günlük hedef</div><div class="b-big">Tamamlandı!</div>
          <div class="b-hint">Bugün ${d.added} yeni kelime. Toll gemacht!</div>`, 'info', { autoClose: 5000 });
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

  function pickMode(w) {
    const exW = exampleWord(w);
    const r = Math.random();
    if (w.level <= 1) return exW && r < 0.3 ? 'cloze' : 'recall';
    if (exW && r < 0.5) return 'cloze';
    if (r < 0.8) return 'reverse';
    return 'recall';
  }

  function startReview(w, mode) {
    if (!w) return;
    mode = mode || pickMode(w);
    current = { w, mode, revealed: false };
    setMood('talking', 1200);
    const exW = exampleWord(w);
    if (mode === 'cloze' && exW) {
      current.answer = exW;
      showBubble(`<div class="b-tag">boşluğu doldurur musun?</div>
        <div class="b-ex" style="border:0;margin:0;padding:0">„${highlight(w.ex.de, exW, 'gap')}“</div>
        <div class="b-hint">ipucu: ${esc(w.tr)}${w.ex.tr ? ` · <i>${esc(w.ex.tr)}</i>` : ''}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="hangi kelime?" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">bilmiyorum</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review');
    } else if (mode === 'reverse') {
      current.answer = w.de;
      showBubble(`<div class="b-tag">almancası neydi?</div>
        <div class="b-big">${esc(w.tr)}</div>
        <form class="b-form" data-form="answer"><input name="a" placeholder="${w.pos === 'n' ? 'artikel + kelime' : 'almanca'}" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn sm solid" type="submit">✓</button></form>
        <div class="b-actions"><button class="btn sm" data-act="giveup">bilmiyorum</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review');
    } else {
      current.mode = 'recall';
      const sentence = w.ex ? `<div class="b-ex" style="border:0;margin:0;padding:0">„${highlight(w.ex.de, w.de) || esc(w.ex.de)}“</div>` : '';
      showBubble(`<div class="b-tag">bunu hatırlıyor musun?</div>
        <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
        ${sentence}
        <div class="b-actions"><button class="btn sm solid" data-act="reveal">göster</button><button class="btn sm" data-act="later">sonra</button></div>`, 'review', { focus: false });
    }
    updateTitle();
  }

  function reveal() {
    const w = current.w;
    current.revealed = true;
    showBubble(`${wordCard(w, 'hatırladın mı?')}
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
    grade(ok, note);
  }

  function grade(ok, note) {
    const w = current.w;
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
    if (ok) {
      setMood('happy', 2200);
      const praise = ['Harika!', 'Super!', 'Sehr gut!', 'Aferin!', 'Genau!'][Math.floor(Math.random() * 5)];
      showBubble(`<div class="b-tag">${praise}</div>
        <div class="b-word">${w.art ? `<span class="art">${esc(w.art)}</span>` : ''}${esc(w.de)} ${speakBtn(fullDe(w))}</div>
        <div class="b-mean">${esc(w.tr)}</div>
        ${note ? `<div class="b-hint">${note}</div>` : ''}
        <div class="b-hint">bir dahaki tekrar: ${nextTxt}</div>`, 'feedback', { autoClose: note ? 5000 : 3200 });
    } else {
      setMood('sad', 2500);
      showBubble(`${wordCard(w, 'doğrusu bu — tekrar soracağım')}
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
    const act = b.dataset.act;
    if (act === 'close') hideBubble();
    else if (act === 'edit') editWord(b.dataset.id);
    else if (act === 'delete') { deleteWord(b.dataset.id); hideBubble(); }
    else if (act === 'reveal') reveal();
    else if (act === 'knew') grade(true, '');
    else if (act === 'forgot') grade(false, '');
    else if (act === 'giveup') grade(false, '');
    else if (act === 'later') { if (current) current.w.due = Date.now() + 5 * MIN; save(); current = null; hideBubble(); }
  });

  bubble.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const kind = f.dataset.form;
    if (kind === 'answer') {
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
        const pos = art ? 'n' : '';
        T.findExample(de, pos, art, navigator.onLine).then((ex) => {
          const w = addWord({ de, art, tr: T.lowerTr(tr), pos, ex, dir: 'tr2de', source: 'elle' });
          setMood('happy', 1800);
          showBubble(`${wordCard(w, 'hafızama yazdım ✓')}<div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 15000 });
        });
      } else {
        const w = state.words.find((x) => x.id === f.dataset.id);
        if (!w) return hideBubble();
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
      showBubble(`<div class="b-tag">merhaba!</div><div>Henüz hafızamda kelime yok. Aşağıya Türkçe ya da Almanca bir kelime yaz — çevirip öğretmeye başlarım.</div>
        <div class="b-actions"><button class="btn sm" data-act="close">tamam</button></div>`, 'info', { autoClose: 12000 });
      return;
    }
    const due = dueWords();
    const w = due[0] || [...state.words].sort((a, b) => a.level - b.level || a.last - b.last)[0];
    startReview(w);
  }
  $('askBtn').addEventListener('click', askNow);
  canvas.addEventListener('click', () => { if (!bubbleKind) askNow(); });

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
      const due = dueWords();
      if (due.length) startReview(due[0]);
      else nextReviewAt = now + 10 * 1000;
    }
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
    document.querySelectorAll('#voiceSeg .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings.voice));
    const mastered = state.words.filter((w) => w.level >= MASTERED).length;
    const reviews = Object.values(state.days).reduce((s, d) => s + (d.reviewed || 0), 0);
    const correct = Object.values(state.days).reduce((s, d) => s + (d.correct || 0), 0);
    $('stats').innerHTML = `
      <div><b>${state.words.length}</b>kelime</div>
      <div><b>${mastered}</b>öğrenildi</div>
      <div><b>${dueWords().length}</b>tekrar bekliyor</div>
      <div><b>%${reviews ? Math.round((correct / reviews) * 100) : 0}</b>başarı</div>`;
    renderList();
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
      showBubble(`<div class="b-tag">hallo!</div><div>Aşağıya bir kelime yaz: Türkçe yazarsan Almancasını, Almanca yazarsan Türkçesini söylerim. Sonra ara ara sorarım.</div>
        <div class="b-actions"><button class="btn sm" data-act="close">anlaştık</button></div>`, 'info', { autoClose: 20000, focus: false });
    }, 1200);
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // test için
  window.__app = { state: () => state, startReview, scene, submitWord, setMood, hideBubble };
})();
