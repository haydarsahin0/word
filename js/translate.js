/* Çeviri, dil tespiti, artikel ve örnek cümle bulma. */
(function () {
  const ARTS = ['der', 'die', 'das'];

  function lowerTr(s) {
    return s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  }
  function key(s) {
    return (s || '').normalize('NFC').trim().replace(/İ/g, 'i').toLowerCase()
      .replace(/^(der|die|das)\s+/, '');
  }
  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function fetchT(url, ms = 6000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
  }

  /** Harflere bakarak dil tahmini: 'tr' | 'de' | null */
  function guessLang(q) {
    if (/[ıİğĞşŞçÇ]/.test(q)) return 'tr';
    if (/[äÄß]/.test(q)) return 'de';
    if (/^(der|die|das)\s+\S/i.test(q)) return 'de';
    const s = q.toLowerCase();
    if (/(mak|mek)$/.test(s)) return 'tr';
    if (/(sch|tz|pf|ck|eu|ie|ei|chen|ung|keit|heit|lich)/.test(s) && !/[ıüöç]/.test(s)) return 'de';
    return null;
  }

  function seedLookup(q) {
    const k = key(q);
    const exact = window.SEED_DICT.find((e) => e.de === q.trim().replace(/^(der|die|das)\s+/i, ''));
    if (exact) return { ...exact, dir: 'de2tr' };
    const byTr = window.SEED_DICT.find((e) => lowerTr(e.tr) === lowerTr(q.trim()));
    if (byTr) return { ...byTr, dir: 'tr2de' };
    const byDe = window.SEED_DICT.find((e) => e.de.toLowerCase() === k);
    if (byDe) return { ...byDe, dir: 'de2tr' };
    return null;
  }

  /* ---------- Google (gtx) ---------- */
  async function gtx(q, sl, tl) {
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&dj=1&hl=tr' +
      `&sl=${sl}&tl=${tl}&dt=t&dt=bd&q=${encodeURIComponent(q)}`;
    const r = await fetchT(u);
    if (!r.ok) throw new Error('gtx ' + r.status);
    const j = await r.json();
    const text = (j.sentences || []).map((s) => s.trans || '').join('').trim();
    return { text, src: j.src, dict: j.dict || [] };
  }

  /* ---------- MyMemory (yedek) ---------- */
  async function mymemory(q, sl, tl) {
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${sl}|${tl}`;
    const r = await fetchT(u);
    const j = await r.json();
    const text = (j.responseData && j.responseData.translatedText || '').trim();
    if (!text || /MYMEMORY WARNING|QUERY LENGTH/i.test(text)) throw new Error('mymemory');
    return { text, src: sl, dict: [] };
  }

  async function translate(q, sl, tl) {
    try { return await gtx(q, sl, tl); } catch (e) {
      if (sl === 'auto') throw e;
      return mymemory(q, sl, tl);
    }
  }

  function dictInfo(dict) {
    const d = dict && dict[0];
    if (!d) return { pos: '', alts: [], art: '' };
    const posMap = { 1: 'n', 2: 'v', 3: 'a', 4: 'd' };
    const alts = [];
    let art = '';
    dict.forEach((dd) => (dd.entry || []).slice(0, 4).forEach((e) => {
      if (e.word && !alts.includes(e.word)) alts.push(e.word);
      if (!art && e.article && ARTS.includes(String(e.article).toLowerCase())) art = String(e.article).toLowerCase();
    }));
    return { pos: posMap[d.pos_enum] || '', alts, art };
  }

  /** İngilizce üzerinden artikel bulma: Haus → house → "the house" → das Haus */
  async function findArticle(noun) {
    try {
      const en = (await translate(noun, 'de', 'en')).text.replace(/^(the|a|an)\s+/i, '');
      if (!en) return '';
      const r = await translate('the ' + en, 'en', 'de');
      const m = r.text.match(/^(der|die|das)\s+([^\s.,!?]+)/i);
      if (m && m[2].toLowerCase() === noun.toLowerCase()) return m[1].toLowerCase();
    } catch (e) { /* yok say */ }
    return '';
  }

  /* ---------- Örnek cümleler ---------- */
  function containsWord(sentence, word) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${esc}(?=$|[^\\p{L}])`, 'iu').test(sentence);
  }

  function collectSentences(json) {
    const out = [];
    const list = json.results || json.data || [];
    list.forEach((s) => {
      if (!s || !s.text) return;
      let tr = '';
      const walk = (t) => {
        if (!t) return;
        if (Array.isArray(t)) return t.forEach(walk);
        if (typeof t === 'object' && t.text && (t.lang === 'tur' || t.lang === 'tr') && !tr) tr = t.text;
      };
      walk(s.translations);
      out.push({ de: s.text, tr });
    });
    return out;
  }

  async function tatoeba(word) {
    const q = encodeURIComponent('=' + word);
    const urls = [
      `https://tatoeba.org/en/api_v0/search?from=deu&to=tur&query=${q}&sort=random&orphans=no&unapproved=no`,
      `https://api.tatoeba.org/unstable/sentences?lang=deu&q=${q}&trans:lang=tur&sort=random&limit=10`,
      `https://tatoeba.org/en/api_v0/search?from=deu&query=${q}&sort=random&orphans=no&unapproved=no`,
    ];
    for (const u of urls) {
      try {
        const r = await fetchT(u, 5000);
        if (!r.ok) continue;
        const list = collectSentences(await r.json())
          .filter((s) => s.de.length >= 12 && s.de.length <= 90 && containsWord(s.de, word));
        if (!list.length) continue;
        list.sort((a, b) => (b.tr ? 1 : 0) - (a.tr ? 1 : 0) || a.de.length - b.de.length);
        const pick = list[Math.floor(Math.random() * Math.min(3, list.length))];
        return pick;
      } catch (e) { /* sıradakini dene */ }
    }
    return null;
  }

  const ACC = { der: 'den', die: 'die', das: 'das' };
  const DAT = { der: 'dem', die: 'der', das: 'dem' };
  function templateSentence(de, pos, art) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (pos === 'n' || (!pos && /^[A-ZÄÖÜ]/.test(de))) {
      const a = art || 'das';
      return pick([
        `${capitalize(a)} ${de} ist hier.`,
        `Wo ist ${a} ${de}?`,
        `Ich sehe ${ACC[a]} ${de}.`,
        `${capitalize(a)} ${de} gefällt mir sehr.`,
        `Hast du ${ACC[a]} ${de} gesehen?`,
        `Ich brauche ${ACC[a]} ${de} morgen.`,
        `Mit ${DAT[a]} ${de} ist alles einfacher.`,
        `${capitalize(a)} ${de} war gestern nicht da.`,
        `Kannst du mir ${ACC[a]} ${de} zeigen?`,
        `Wir sprechen heute über ${ACC[a]} ${de}.`,
      ]);
    }
    if (pos === 'v' || /(en|ern|eln)$/.test(de)) {
      return pick([
        `Ich möchte heute ${de}.`,
        `Wir können morgen zusammen ${de}.`,
        `Ich will nicht ${de}.`,
        `Kannst du heute Abend ${de}?`,
        `Sie muss jetzt ${de}.`,
        `Am Wochenende wollen wir ${de}.`,
        `Ich werde bald ${de}.`,
        `Darf ich hier ${de}?`,
      ]);
    }
    if (pos === 'a') {
      return pick([
        `Das ist wirklich ${de}.`,
        `Heute ist alles so ${de}.`,
        `Er ist sehr ${de}.`,
        `Ich finde das ziemlich ${de}.`,
        `War der Film ${de}?`,
        `Meine Nachbarin ist immer ${de}.`,
        `Das Essen war nicht ${de}.`,
      ]);
    }
    return pick([`Ich habe das Wort „${de}“ heute gelernt.`, `„${de}“ höre ich oft in Berlin.`, `Sag mal: „${de}“!`]);
  }

  async function findExample(de, pos, art, online) {
    if (online) {
      const t = await tatoeba(de);
      if (t) {
        if (!t.tr) { try { t.tr = (await translate(t.de, 'de', 'tr')).text; } catch (e) { /* boş kalsın */ } }
        return { de: t.de, tr: t.tr || '', src: 'tatoeba' };
      }
    }
    const s = templateSentence(de, pos, art);
    let tr = '';
    if (online) { try { tr = (await translate(s, 'de', 'tr')).text; } catch (e) { /* boş */ } }
    return { de: s, tr, src: 'şablon' };
  }

  /**
   * Bir kelimeyi çevirir. Sonuç:
   * { de, art, tr, alts, pos, ex, dir, source }
   */
  async function lookup(q) {
    q = q.trim().replace(/\s+/g, ' ');
    // 1) Meta Muse Ember (anlam, basit Almanca açıklama, örnek cümle)
    if (window.AI && window.AI.available()) {
      try { return await window.AI.lookup(q); } catch (e) { /* yedeklere geç */ }
    }
    const seed = seedLookup(q);
    if (seed) return { ...seed, alts: [], source: 'sözlük' };

    let hint = guessLang(q);
    let first = null;
    if (!hint) {
      first = await gtx(q, 'auto', 'de');
      if (first.src === 'de') hint = 'de';
      else if (first.src === 'tr') hint = 'tr';
      else {
        // Emin değil: iki yönü de dene
        const [toDe, toTr] = await Promise.all([gtx(q, 'tr', 'de').catch(() => null), gtx(q, 'de', 'tr').catch(() => null)]);
        if (toDe && toDe.text && key(toDe.text) === key(q)) hint = 'de';
        else if (toTr && toTr.text && key(toTr.text) === key(q)) hint = 'tr';
        else hint = /^[A-ZÄÖÜ]/.test(q) ? 'de' : 'tr';
        first = hint === 'tr' ? toDe : null;
      }
    }

    let de, tr, art = '', pos = '', alts = [];
    if (hint === 'tr') {
      const r = first && first.src !== 'de' && first.text ? first : await translate(q, 'tr', 'de');
      const info = dictInfo(r.dict);
      tr = lowerTr(q);
      de = r.text.replace(/[.!?]$/, '');
      const m = de.match(/^(der|die|das)\s+(.+)$/i);
      if (m) { art = m[1].toLowerCase(); de = m[2]; }
      pos = info.pos;
      art = art || info.art;
      alts = []; // Almanca eş anlamlılar Türkçe satırında gösterilmesin
    } else {
      const m = q.match(/^(der|die|das)\s+(.+)$/i);
      if (m) { art = m[1].toLowerCase(); de = capitalize(m[2]); } else de = q;
      const r = await translate(de, 'de', 'tr');
      const info = dictInfo(r.dict);
      tr = lowerTr(r.text.replace(/[.!?]$/, ''));
      pos = info.pos || (art ? 'n' : '');
      art = art || info.art;
      alts = info.alts.map(lowerTr).filter((a) => a !== tr).slice(0, 3);
    }

    const isNoun = pos === 'n' || (!pos && /^[A-ZÄÖÜ]/.test(de) && !de.includes(' '));
    if (isNoun) {
      pos = 'n';
      de = capitalize(de);
      if (!art) art = await findArticle(de);
    } else if (de && !de.includes(' ') && pos) {
      de = de.charAt(0).toLowerCase() + de.slice(1);
    }

    const ex = await findExample(de, pos, art, true);
    return { de, art, tr, alts, pos, ex, dir: hint === 'tr' ? 'tr2de' : 'de2tr', source: 'çevrimiçi' };
  }

  window.Translator = { lookup, findExample, guessLang, containsWord, key, lowerTr, seedLookup };
})();
