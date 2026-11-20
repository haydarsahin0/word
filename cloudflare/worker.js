// Kelime Defteri — Meta Muse Ember ile çalışan küçük öğretmen (Cloudflare Worker).
// API anahtarı Worker secret'ından okunur ("musebaba"); tarayıcıya hiç gönderilmez.

const BASE = "https://api.meta.ai/v1";
let ENV = {};
let USAGE = null; // bu istekte harcanan token'lar (maliyet takibi için)
let EFFORT = ""; // modelin düşünme seviyesi (aşağıdaki DEFAULT_EFFORT)
const modelName = () => ENV.MUSE_MODEL || "muse-ember-1.0";

const ALLOWED_ORIGINS = [
  /^https:\/\/haydarsahin0\.github\.io$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^null$/, // dosyadan açıldığında (file://)
];

function apiKey() {
  for (const k of ["musebaba", "MUSEBABA", "Musebaba", "MUSE_BABA", "muse_baba"]) {
    const v = ENV[k];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/* ---------- basit hız sınırı (örnek başına, IP'ye göre) ---------- */
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n++;
  return h.n > 40;
}

function cors(origin) {
  const ok = origin && ALLOWED_ORIGINS.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin : "https://haydarsahin0.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ---------- model çağrısı ---------- */
function textFromContent(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === "string" ? p : (p?.text ?? p?.content ?? ""))).join("");
  }
  return "";
}

async function callModel(messages, temperature = 0.7) {
  const key = apiKey();
  if (!key) throw new Error("missing_key");
  const headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };

  // 1) OpenAI uyumlu Chat Completions
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelName(), messages, temperature, ...(EFFORT ? { reasoning_effort: EFFORT } : {}) }),
  });
  if (r.ok) {
    const j = await r.json();
    addUsage(j.usage);
    const t = textFromContent(j?.choices?.[0]?.message?.content);
    if (t) return t;
  } else if (r.status === 401 || r.status === 403) {
    throw new Error(`auth_${r.status}: ${(await r.text()).slice(0, 300)}`);
  } else {
    console.log("chat/completions failed", r.status, (await r.text()).slice(0, 500));
  }

  // 2) Yedek: Responses uç noktası
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const input = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const r2 = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelName(), instructions: system, input, temperature, ...(EFFORT ? { reasoning: { effort: EFFORT } } : {}) }),
  });
  if (!r2.ok) throw new Error(`model_${r2.status}: ${(await r2.text()).slice(0, 300)}`);
  const j2 = await r2.json();
  addUsage(j2.usage);
  if (typeof j2.output_text === "string" && j2.output_text) return j2.output_text;
  const parts = [];
  for (const o of j2.output ?? []) {
    if (o?.type && o.type !== "message") continue;
    for (const c of o?.content ?? []) if (c?.text) parts.push(c.text);
  }
  return parts.join("");
}

function addUsage(u) {
  if (!u || !USAGE) return;
  const inp = u.prompt_tokens ?? u.input_tokens ?? 0;
  const out = u.completion_tokens ?? u.output_tokens ?? 0;
  const rea = u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? 0;
  USAGE.in += inp; USAGE.out += out; USAGE.reasoning += rea; USAGE.calls++;
}

function parseJson(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function askJson(system, user, temperature = 0.7) {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  const first = await callModel(messages, temperature);
  try {
    return parseJson(first);
  } catch {
    messages.push({ role: "assistant", content: first });
    messages.push({ role: "user", content: "That was not valid JSON. Reply again with ONLY the JSON object." });
    return parseJson(await callModel(messages, 0.2));
  }
}

/* ---------- istemler ---------- */
const PERSONA =
  "You are 'Kelime', the learner's close friend who sits at a little desk and studies German FOR them all day. " +
  "The learner is a native Turkish speaker (about A2) learning German. YOU ONLY SPEAK GERMAN: every line you say to " +
  "them (explanations, hints, questions, feedback, small talk) is simple, natural, friendly German with A1–A2 words and " +
  "short sentences. Sound like their real close friend: warm, relaxed, a little playful, genuinely happy to help. " +
  "If their name is given (line 'Name: ...' in the notes), call them by their first name naturally now and then " +
  "(not in every line). Never call them 'Kumpel', 'Bro', 'Alter' or similar. Never use emojis. " +
  "Turkish appears ONLY inside fields that are explicitly translations (tr, alts, q_tr, meaning_tr, summary/profile fields " +
  "marked _tr). German must be correct and natural. Always answer with ONLY a JSON object, no markdown, no commentary.";

/** Öğrenci profili (tarayıcıda tutulur, her istekle gelir) */
function profileText(body) {
  const p = typeof body?.profile === "string" ? body.profile.trim().slice(0, 1500) : "";
  if (!p) return "";
  return `\n\nWHAT YOU KNOW ABOUT YOUR FRIEND (inferred from their activity, keep using it):\n${p}\n` +
    "Use this: build sentences around their life, interests and goals; match their level; quietly revisit their weak points; " +
    "and mirror their way of talking (tone, casualness, slang, sentence length, how they write) so you sound like them.";
}
function withProfile(system, body) {
  return system + profileText(body);
}

const PROFILE = `${PERSONA}

You quietly study your friend so you can teach them better. You get your previous notes about them and a log of their
recent activity in this app: words they looked up (exactly as they typed them), quiz results, their own German answers,
suggested words they accepted or skipped, things they postponed.
Infer carefully from evidence: who they are, what their daily life looks like, what topics they care about, what they want
to learn, their real level, their recurring mistakes, and their personal style of writing/talking. Keep what still holds
from the old notes, update with new evidence, never invent facts without a hint in the data.
Return:
{
  "summary_tr": "<2–3 short Turkish sentences: who they are as a learner>",
  "level": "A1" | "A2" | "B1" | "B2",
  "interests": ["<up to 6 short Turkish topics>"],
  "life": ["<up to 5 short Turkish facts/guesses about their daily life, only with evidence>"],
  "goals": ["<up to 5: what kinds of words/topics they want to learn>"],
  "weak_points": ["<up to 5 short Turkish items, e.g. 'artikeller', 'fiil çekimi', 'isimleri büyük yazmak'>"],
  "style": "<1–2 English sentences describing how they write and talk (tone, casing, slang, length) so you can mirror it>",
  "next_focus": "<one English sentence: what to emphasize in the next lessons>",
  "observation_de": "<one casual, simple German friend line (max 15 words) telling them something new you noticed about them, or empty>"
}`;

const LOOKUP = `${PERSONA}

The learner typed a word or short phrase (maybe with a typo). It is either Turkish or German — detect which.
Return this JSON:
{
  "lang": "tr" or "de" (language of the input),
  "de": German equivalent in dictionary form WITHOUT article (nouns capitalized, verbs in infinitive),
  "art": "der" | "die" | "das" for nouns, otherwise "",
  "plural": plural with article for nouns (e.g. "die Häuser"); "" if the noun is normally used without a plural (e.g. Geduld, Milch) or if it is not a noun,
  "pos": "n" (noun) | "v" (verb) | "a" (adjective) | "d" (anything else),
  "tr": the most common Turkish equivalent (lowercase unless proper noun),
  "alts": up to 2 other Turkish meanings (array, may be empty),
  "meaning_tr": ONE short Turkish sentence explaining what it means / when it is used (only shown as a hidden translation),
  "explain_de": at most 2 VERY simple German sentences (A1–A2 words only) explaining the meaning, as a teacher would to a beginner,
  "say_de": one short, casual German friend line about this word (a tiny joke or memory trick, e.g. "Das brauchst du jeden Tag, Haydar!"),
  "example": { "de": a natural everyday German sentence (6–12 words) that contains exactly the word form given in "de", "tr": its Turkish translation }
}`;

const TALK = `${PERSONA}

You keep talking to the learner all day. They want to meet each of their words MANY times a day (dozens of times)
until it sticks — so practice the focus words intensively, but every time in a NEW sentence, context or question.
Using the learner's words below, create exactly {N} short, varied teaching moments. Mix these types:
- {"type":"example","id":"<word id>","de":"<NEW natural German sentence (6–12 words) containing the word in exactly the given form>","tr":"<Turkish translation>","note_de":"<optional, max 1 short simple German sentence: a useful hint>"}
- {"type":"cloze","id":"<word id>","de":"<German sentence where the word is replaced by ___>","answer":"<the exact missing word form>","tr":"<Turkish translation of the full sentence>"}
- {"type":"ask","id":"<word id>","q_de":"<a simple, friendly German question (A2) the learner can answer using the word>","q_tr":"<Turkish translation>"}
- {"type":"tip","id":"<word id>","text_de":"<max 2 short, simple, casual German sentences: article, plural, conjugation, a false friend, or a memory trick>","de":"<one short German example>"}
- {"type":"chat","text_de":"<one casual German friend line (max 12 words): what you are doing for them right now, a cheer, or a tiny joke about one of their words>"}
- {"type":"new","de":"<a useful everyday A2 word NOT in the known list, without article>","art":"der|die|das or empty","pos":"n|v|a|d","tr":"<Turkish>","explain_de":"<max 2 very simple German sentences>","example":{"de":"<sentence containing exactly that form>","tr":"<Turkish>"}}
Each word may have an "avoid" list: sentences/questions the learner has ALREADY seen. Never reuse, copy or closely
paraphrase them — every sentence must be brand new. Keep it fresh and varied:
- situation/theme for this batch: {THEME} (but stay natural for each word),
- vary tense (Präsens, Perfekt, Futur, modal verbs), person (ich, du, er/sie, wir, ihr), and sentence type (statement, question, negation, imperative),
- use different collocations and contexts than in the avoid list, and different item types for different words.
Prefer words with a low level (they need practice). Use each word at most once. Include at most one \"chat\" item. {NEW_HINT}
Return: {"items":[ ... ]}`;

const CHECK = `${PERSONA}

You asked the learner a question in German. Judge their answer kindly. Small mistakes are fine if it is understandable.
Return: {"ok": true|false (did they answer sensibly and use German reasonably?), "fix_de": "<a corrected / more natural version of their answer, or empty if already perfect>", "feedback_de": "<one short, warm, casual German friend sentence (warm and happy if good, e.g. "Stark, Haydar!"; gentle and encouraging if not)>"}`;

const THEMES = [
  "at home in the morning", "in the supermarket", "at work / in the office", "on the train or bus",
  "cooking and eating", "with friends on the weekend", "at the doctor", "on holiday", "the weather and seasons",
  "shopping for clothes", "sports and hobbies", "at a café", "phone calls and messages", "family life",
  "at school or a language course", "in the city, asking for directions", "feelings and plans", "a funny little story",
  "in the park", "at a party", "money and banking", "renting a flat", "the internet and phones", "the evening routine",
];

/* ---------- sunucu ---------- */
async function handle(req) {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method" }, 405, h);
  if (origin && !ALLOWED_ORIGINS.some((r) => r.test(origin))) return json({ error: "origin" }, 403, h);

  const ip = req.headers.get("cf-connecting-ip") ?? "?";
  if (limited(ip)) return json({ error: "rate_limited" }, 429, h);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400, h);
  }
  // Düşünme seviyesi: ölçümlerde 'minimal' çıktı token'larını ~%85 azalttı, kalite aynı kaldı.
  // Profil çıkarımı seyrek ve daha zor olduğu için 'low'. (İstemci seviyeyi seçemez.)
  const DEFAULT_EFFORT = { lookup: "minimal", talk: "minimal", check: "minimal", profile: "low" };
  const eff = String(ENV.MUSE_EFFORT || DEFAULT_EFFORT[body?.action] || "");
  EFFORT = ["minimal", "low", "medium", "high"].includes(eff) ? eff : "";

  try {
    switch (body?.action) {
      // ---------- senkron: cihazlar arası defter (Durable Object "SyncRoom") ----------
      // Anahtar, senkron kodunun SHA-256 özetidir; kodu bilmeyen veriye ulaşamaz.
      // Her senkron kodu kendi odasına (Durable Object) sahiptir: okumalar her zaman günceldir.
      // Her cihaz yalnızca kendi kaydına yazar, diğerlerininkini okuyup birleştirir.
      case "sync_get":
      case "sync_put": {
        const key = String(body.key || "");
        const dev = String(body.device || "");
        if (!/^[a-f0-9]{64}$/.test(key)) return json({ error: "bad_key" }, 400, h);
        if (body.action === "sync_put" && !/^[a-z0-9]{4,16}$/.test(dev)) return json({ error: "bad_device" }, 400, h);
        if (!ENV.SYNCROOM) return json({ error: "no_store" }, 500, h);
        const payload = body.action === "sync_put" ? { op: "put", device: dev, doc: body.doc ?? null } : { op: "get" };
        const str = JSON.stringify(payload);
        if (str.length > 1_900_000) return json({ error: "too_big" }, 413, h);
        const stub = ENV.SYNCROOM.get(ENV.SYNCROOM.idFromName(key));
        const r = await stub.fetch("https://sync-room/", { method: "POST", body: str });
        return json(await r.json(), r.status, h);
      }

      case "ping":
        return json({ ok: true, hasKey: !!apiKey(), model: modelName() }, 200, h);

      case "lookup": {
        const q = String(body.q ?? "").trim().slice(0, 80);
        if (!q) return json({ error: "empty" }, 400, h);
        const ctx = String(body.context ?? "").trim().slice(0, 400);
        const msg = `Input: "${q}"` + (ctx
          ? `\nThe learner tapped this word while reading a book. Sentence from the book: "${ctx}"\n` +
            `Give the meaning used in THIS sentence ("de" = dictionary form, e.g. ging -> gehen). ` +
            `Use this book sentence (shortened if very long, keep the word as written) as the example and translate it.`
          : "");
        const out = await askJson(withProfile(LOOKUP, body), msg, 0.3);
        return json({ ...out, _usage: USAGE }, 200, h);
      }

      case "talk": {
        const words = (Array.isArray(body.words) ? body.words : []).slice(0, 12).map((w) => ({
          id: String(w.id ?? "").slice(0, 20),
          de: String(w.de ?? "").slice(0, 40),
          art: String(w.art ?? "").slice(0, 3),
          tr: String(w.tr ?? "").slice(0, 40),
          level: Number(w.level) || 0,
          avoid: (Array.isArray(w.avoid) ? w.avoid : []).slice(-8).map((a) => String(a).slice(0, 140)),
        }));
        const known = (Array.isArray(body.known) ? body.known : []).slice(0, 150).map((s) => String(s).slice(0, 30));
        const n = Math.max(1, Math.min(5, Number(body.n) || 3));
        const newHint = body.wantNew
          ? 'Include exactly one item of type "new".'
          : 'Do not use type "new" unless the word list is empty.';
        const interests = (Array.isArray(body.interests) ? body.interests : []).map((x) => String(x).slice(0, 40)).slice(0, 6);
        const theme = interests.length && Math.random() < 0.6
          ? `${interests[Math.floor(Math.random() * interests.length)]} (one of their interests)`
          : THEMES[Math.floor(Math.random() * THEMES.length)];
        const sys = TALK.replace("{N}", String(n)).replace("{NEW_HINT}", newHint).replace("{THEME}", theme);
        const user = `Learner's words (focus):\n${JSON.stringify(words)}\n\nAll known words (do not suggest these as new):\n${known.join(", ")}`;
        const out = await askJson(withProfile(sys, body), user, 0.9);
        return json({ items: Array.isArray(out?.items) ? out.items : [], _usage: USAGE }, 200, h);
      }

      case "check": {
        const user = JSON.stringify({
          question_de: String(body.q_de ?? "").slice(0, 200),
          target_word: String(body.word ?? "").slice(0, 40),
          learner_answer: String(body.answer ?? "").slice(0, 300),
        });
        const out = await askJson(withProfile(CHECK, body), user, 0.3);
        return json({ ...out, _usage: USAGE }, 200, h);
      }

      case "profile": {
        const old = body.old && typeof body.old === "object" ? JSON.stringify(body.old).slice(0, 2500) : "{}";
        const events = (Array.isArray(body.events) ? body.events : []).slice(-80).map((e) => JSON.stringify(e).slice(0, 300));
        const user = `Previous notes:\n${old}\n\nRecent activity (oldest first):\n${events.join("\n")}`;
        const out = await askJson(PROFILE, user, 0.4);
        return json({ ...out, _usage: USAGE }, 200, h);
      }

      default:
        return json({ error: "unknown_action" }, 400, h);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("kelime-ai error:", msg);
    return json({ error: msg.startsWith("missing_key") ? "missing_key" : "model_error", detail: msg.slice(0, 300) }, 502, h);
  }
}

export default {
  async fetch(req, env) {
    ENV = env;
    USAGE = { in: 0, out: 0, reasoning: 0, calls: 0 };
    EFFORT = "";
    return handle(req);
  },
};

/** Bir senkron kodunun odası: cihaz başına bir kayıt tutar (güçlü tutarlılık). */
export class SyncRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch(req) {
    const { op, device, doc } = await req.json();
    if (op === "put") {
      await this.ctx.storage.put("dev:" + device, doc);
      return Response.json({ ok: true, at: Date.now() });
    }
    const all = await this.ctx.storage.list({ prefix: "dev:" });
    return Response.json({ docs: [...all.values()].filter(Boolean) });
  }
}
