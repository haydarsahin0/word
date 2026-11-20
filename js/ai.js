/* Meta Muse Ember istemcisi — Supabase Edge Function üzerinden konuşur.
   API anahtarı tarayıcıda DEĞİL, Supabase secret'ında ("musebaba") durur. */
(function () {
  const ENDPOINT = 'https://jckoovsocynnxbrsalld.supabase.co/functions/v1/kelime-ai';
  let downUntil = 0;
  let lastError = '';

  async function call(action, payload, ms = 25000) {
    if (Date.now() < downUntil) throw new Error('ai_down');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
        signal: ctl.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        lastError = j.error || 'http_' + r.status;
        // sunucu tarafı sorunlarında bir süre rahat bırak
        if (r.status >= 500 || r.status === 404 || r.status === 429 || j.error === 'missing_key') downUntil = Date.now() + 2 * 60 * 1000;
        throw new Error(lastError);
      }
      lastError = '';
      return j;
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) {
        lastError = 'network';
        downUntil = Date.now() + 60 * 1000;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

  async function lookup(q) {
    const j = await call('lookup', { q });
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
      say_tr: s(j.say_tr, 160),
      ex,
      dir: j.lang === 'de' ? 'de2tr' : 'tr2de',
      source: 'muse',
    };
  }

  async function talk(words, known, wantNew, n = 3) {
    const j = await call('talk', { words, known, wantNew, n }, 35000);
    return Array.isArray(j.items) ? j.items.filter((it) => it && typeof it.type === 'string') : [];
  }

  async function check(q_de, word, answer) {
    return call('check', { q_de, word, answer });
  }

  window.AI = {
    lookup, talk, check,
    available: () => Date.now() >= downUntil,
    lastError: () => lastError,
    endpoint: ENDPOINT,
  };
})();
