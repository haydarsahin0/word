/* Kitap okuyucu: EPUB / TXT açar, 5 satırlık sayfalarla gösterir, kelimeye dokununca haber verir.
   EPUB için ek kütüphane yok: küçük bir ZIP okuyucu + tarayıcının DecompressionStream'i. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- IndexedDB (kitap burada saklanır; localStorage'a sığmaz) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('kelime-defteri', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const db = await idb();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }
  async function idbSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  /* ---------- küçük ZIP okuyucu ---------- */
  function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Bu dosya bir EPUB (zip) değil gibi.');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder('utf-8');
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commLen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = dec.decode(new Uint8Array(buf, off + 46, nameLen));
      files[name] = { method, csize, lho };
      off += 46 + nameLen + extraLen + commLen;
    }
    return {
      has: (name) => !!files[name],
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const ln = dv.getUint16(f.lho + 26, true), le = dv.getUint16(f.lho + 28, true);
        const data = new Uint8Array(buf, f.lho + 30 + ln + le, f.csize);
        if (f.method === 0) return dec.decode(data);
        if (f.method !== 8) throw new Error('desteklenmeyen sıkıştırma');
        const ds = new DecompressionStream('deflate-raw');
        const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        return dec.decode(out);
      },
    };
  }

  function joinPath(dir, href) {
    const parts = (dir ? dir.split('/') : []).concat(decodeURIComponent(href.split('#')[0]).split('/'));
    const out = [];
    parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }
  function parseXml(text, type) {
    let d = new DOMParser().parseFromString(text, type || 'application/xhtml+xml');
    if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(text, 'text/html');
    return d;
  }

  const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt';
  function blocksOf(doc) {
    const body = doc.body || doc.documentElement;
    const els = [...body.querySelectorAll(BLOCKS)].filter((el) => !el.parentElement || !el.parentElement.closest(BLOCKS));
    const paras = [];
    if (els.length) {
      els.forEach((el) => {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) paras.push({ t, h: /^H[1-6]$/i.test(el.tagName) });
      });
    } else {
      body.textContent.split(/\n\s*\n/).forEach((x) => { const t = x.replace(/\s+/g, ' ').trim(); if (t) paras.push({ t }); });
    }
    return paras;
  }

  async function parseEpub(buf) {
    const z = unzip(buf);
    const cont = await z.text('META-INF/container.xml');
    if (!cont) throw new Error('EPUB içinde container.xml yok.');
    const opfPath = parseXml(cont, 'application/xml').querySelector('rootfile').getAttribute('full-path');
    const opf = parseXml(await z.text(opfPath), 'application/xml');
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const title = (opf.getElementsByTagName('dc:title')[0] || opf.querySelector('title') || {}).textContent || 'Buch';
    const items = {};
    [...opf.getElementsByTagName('item')].forEach((it) => { items[it.getAttribute('id')] = it.getAttribute('href'); });
    const chapters = [];
    for (const ref of [...opf.getElementsByTagName('itemref')]) {
      const href = items[ref.getAttribute('idref')];
      if (!href) continue;
      const path = joinPath(dir, href);
      const txt = await z.text(path);
      if (!txt) continue;
      const paras = blocksOf(parseXml(txt));
      if (!paras.length) continue;
      const h = paras.find((p) => p.h);
      chapters.push({ title: h ? h.t.slice(0, 60) : '', paras });
    }
    if (!chapters.length) throw new Error('Kitapta okunacak metin bulunamadı.');
    return { title: title.trim(), chapters };
  }

  function parseTxt(text, name) {
    const paras = text.split(/\r?\n\s*\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).map((t) => ({ t }));
    const chapters = [];
    for (let i = 0; i < paras.length; i += 60) chapters.push({ title: '', paras: paras.slice(i, i + 60) });
    return { title: name.replace(/\.[^.]+$/, ''), chapters };
  }

  /* ---------- okuyucu ---------- */
  const LINES = 5;
  let book = null;
  let pos = { chapter: 0, ratio: 0 };
  let page = 0, pages = 1, step = 1;
  let opts = {};
  let chapterChars = [], totalChars = 1;

  function savePos() {
    try { localStorage.setItem('kelime-reader-pos', JSON.stringify(pos)); } catch (e) { /* yok */ }
  }
  function loadPos() {
    try { return JSON.parse(localStorage.getItem('kelime-reader-pos')) || { chapter: 0, ratio: 0 }; } catch (e) { return { chapter: 0, ratio: 0 }; }
  }

  function renderEmpty(msg) {
    const r = $('reader');
    r.classList.add('empty');
    r.innerHTML = `<button class="r-open" id="rOpen">
        <b>Buch öffnen</b>
        <span>${esc(msg || 'EPUB oder TXT – tipp ein Wort an, ich erkläre es dir')}</span>
      </button>
      <input type="file" id="rFile" accept=".epub,.txt,application/epub+zip,text/plain" hidden>`;
  }

  function renderShell() {
    const r = $('reader');
    r.classList.remove('empty');
    r.innerHTML = `<div class="r-head"><span class="r-title" title="${esc(book.title)}">${esc(book.title)}</span>
        <button class="r-btn" id="rChange" aria-label="Buch wechseln">Buch</button></div>
      <div class="r-view" id="rView"><div class="r-flow" id="rFlow"></div><span class="r-mark" id="rMark" hidden></span></div>
      <div class="r-foot"><button class="r-btn" id="rPrev" aria-label="zurück">‹</button>
        <span class="r-prog" id="rProg"></span>
        <button class="r-btn" id="rNext" aria-label="weiter">›</button></div>
      <input type="file" id="rFile" accept=".epub,.txt,application/epub+zip,text/plain" hidden>`;
  }

  function layoutChapter(targetRatio, toEnd) {
    const view = $('rView'), flow = $('rFlow');
    if (!view || !book) return;
    const ch = book.chapters[pos.chapter];
    flow.innerHTML = ch.paras.map((p) => (p.h ? `<p class="h">${esc(p.t)}</p>` : `<p>${esc(p.t)}</p>`)).join('');
    const lh = parseFloat(getComputedStyle(flow).lineHeight) || 22;
    const h = Math.ceil(lh * LINES) + 1;
    view.style.height = h + 'px';
    const w = view.clientWidth;
    const gap = 24;
    flow.style.height = h + 'px';
    flow.style.width = w + 'px';
    flow.style.columnWidth = w + 'px';
    flow.style.columnGap = gap + 'px';
    step = w + gap;
    pages = Math.max(1, Math.round((flow.scrollWidth + gap) / step));
    page = toEnd ? pages - 1 : Math.min(pages - 1, Math.max(0, Math.round((targetRatio || 0) * pages)));
    show();
  }

  function show() {
    const flow = $('rFlow');
    if (!flow) return;
    flow.style.transform = `translateX(${-page * step}px)`;
    $('rMark').hidden = true;
    pos.ratio = pages > 1 ? page / pages : 0;
    savePos();
    const done = chapterChars.slice(0, pos.chapter).reduce((a, b) => a + b, 0) + (chapterChars[pos.chapter] || 0) * (pages > 1 ? page / (pages - 1 || 1) : 1);
    const pct = Math.min(100, Math.floor((done / totalChars) * 100));
    $('rProg').textContent = `${book.chapters.length > 1 ? `Kap. ${pos.chapter + 1} · ` : ''}S. ${page + 1}/${pages} · %${pct}`;
    $('rPrev').disabled = pos.chapter === 0 && page === 0;
    $('rNext').disabled = pos.chapter === book.chapters.length - 1 && page === pages - 1;
  }

  function next() {
    if (page < pages - 1) { page++; show(); }
    else if (pos.chapter < book.chapters.length - 1) { pos.chapter++; layoutChapter(0); }
    if (opts.onPage) opts.onPage();
  }
  function prev() {
    if (page > 0) { page--; show(); }
    else if (pos.chapter > 0) { pos.chapter--; layoutChapter(0, true); }
    if (opts.onPage) opts.onPage();
  }

  /** Dokunulan noktadaki kelimeyi ve cümlesini bul */
  function wordAt(x, y) {
    let node, offset;
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; offset = r.startOffset;
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode; offset = p.offset;
    }
    if (!node || node.nodeType !== 3 || !$('rFlow').contains(node)) return null;
    const text = node.textContent;
    const isL = (c) => /[\p{L}\p{M}'’-]/u.test(c);
    let a = offset, b = offset;
    while (a > 0 && isL(text[a - 1])) a--;
    while (b < text.length && isL(text[b])) b++;
    let word = text.slice(a, b).replace(/^['’-]+|['’-]+$/g, '');
    if (!word || word.length < 2) return null;
    const range = document.createRange();
    range.setStart(node, a); range.setEnd(node, b);
    // cümle: paragraf içinde kelimenin etrafındaki . ! ? sınırları
    const para = node.parentElement.closest('p');
    const pt = para ? para.textContent : text;
    const pre = document.createRange();
    pre.setStart(para || node, 0); pre.setEnd(node, a);
    const idx = pre.toString().length;
    let s0 = idx, s1 = idx;
    while (s0 > 0 && !/[.!?…]/.test(pt[s0 - 1])) s0--;
    while (s1 < pt.length && !/[.!?…]/.test(pt[s1])) s1++;
    const sentence = pt.slice(s0, Math.min(pt.length, s1 + 1)).trim().slice(0, 400);
    return { word, sentence, range };
  }

  function markRange(range) {
    const m = $('rMark'), view = $('rView');
    const rect = range.getClientRects()[0];
    if (!rect) return;
    const vr = view.getBoundingClientRect();
    m.style.left = rect.left - vr.left - 2 + 'px';
    m.style.top = rect.top - vr.top + 'px';
    m.style.width = rect.width + 4 + 'px';
    m.style.height = rect.height + 'px';
    m.hidden = false;
  }

  async function openFile(file) {
    if (!file) return;
    renderEmpty('lese das Buch…');
    try {
      let b;
      if (/\.txt$/i.test(file.name) || file.type === 'text/plain') b = parseTxt(await file.text(), file.name);
      else b = await parseEpub(await file.arrayBuffer());
      book = b;
      await idbSet('book', book);
      pos = { chapter: 0, ratio: 0 };
      start();
      if (opts.onOpen) opts.onOpen(book);
    } catch (e) {
      renderEmpty('Konnte das Buch nicht öffnen: ' + (e.message || e));
    }
  }

  function start() {
    chapterChars = book.chapters.map((c) => c.paras.reduce((a, p) => a + p.t.length, 0));
    totalChars = chapterChars.reduce((a, b) => a + b, 0) || 1;
    if (pos.chapter >= book.chapters.length) pos = { chapter: 0, ratio: 0 };
    renderShell();
    layoutChapter(pos.ratio);
  }

  function bind() {
    const r = $('reader');
    r.addEventListener('click', (e) => {
      const id = e.target.closest('button, input') && e.target.closest('button, input').id;
      if (id === 'rOpen' || id === 'rChange') { $('rFile').click(); return; }
      if (id === 'rNext') return next();
      if (id === 'rPrev') return prev();
      if (e.target.closest('#rView') && !swiped) {
        const hit = wordAt(e.clientX, e.clientY);
        if (hit) { markRange(hit.range); if (opts.onWord) opts.onWord(hit.word, hit.sentence); }
      }
    });
    r.addEventListener('change', (e) => { if (e.target.id === 'rFile') openFile(e.target.files[0]); });
    // kaydırarak sayfa çevir
    let sx = 0, sy = 0, swiped = false;
    r.addEventListener('touchstart', (e) => { if (!e.target.closest('#rView')) return; swiped = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    r.addEventListener('touchend', (e) => {
      if (!e.target.closest('#rView')) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; dx < 0 ? next() : prev(); setTimeout(() => { swiped = false; }, 400); }
    }, { passive: true });
    // masaüstünde sürükle-bırak
    r.addEventListener('dragover', (e) => { e.preventDefault(); });
    r.addEventListener('drop', (e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); });
    // klavye okları (yazı kutusunda değilken)
    document.addEventListener('keydown', (e) => {
      if (!book || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    });
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => book && layoutChapter(pos.ratio), 150); });
  }

  window.Reader = {
    async init(o) {
      opts = o || {};
      bind();
      renderEmpty();
      try {
        const b = await idbGet('book');
        if (b && b.chapters && b.chapters.length) { book = b; pos = loadPos(); start(); }
      } catch (e) { /* IndexedDB yok: boş başla */ }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => book && layoutChapter(pos.ratio));
    },
    clearMark() { const m = $('rMark'); if (m) m.hidden = true; },
    hasBook: () => !!book,
  };
})();
