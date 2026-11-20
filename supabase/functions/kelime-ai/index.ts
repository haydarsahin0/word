// Kelime Defteri — Meta Muse Ember ile çalışan küçük öğretmen.
// API anahtarı Supabase secret'ından okunur ("musebaba"); tarayıcıya hiç gönderilmez.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BASE = "https://api.meta.ai/v1";
const MODEL = Deno.env.get("MUSE_MODEL") ?? "muse-ember-1.0";

const ALLOWED_ORIGINS = [
  /^https:\/\/haydarsahin0\.github\.io$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^null$/, // dosyadan açıldığında (file://)
];

function apiKey(): string | null {
  for (const k of ["musebaba", "MUSEBABA", "Musebaba", "MUSE_BABA", "muse_baba"]) {
    const v = Deno.env.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/* ---------- basit hız sınırı (örnek başına, IP'ye göre) ---------- */
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n++;
  return h.n > 40;
}

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://haydarsahin0.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

/* ---------- model çağrısı ---------- */
type Msg = { role: "system" | "user" | "assistant"; content: string };

function textFromContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === "string" ? p : (p?.text ?? p?.content ?? ""))).join("");
  }
  return "";
}

async function callModel(messages: Msg[], temperature = 0.7): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("missing_key");
  const headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };

  // 1) OpenAI uyumlu Chat Completions
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: MODEL, messages, temperature }),
  });
  if (r.ok) {
    const j = await r.json();
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
    body: JSON.stringify({ model: MODEL, instructions: system, input, temperature }),
  });
  if (!r2.ok) throw new Error(`model_${r2.status}: ${(await r2.text()).slice(0, 300)}`);
  const j2 = await r2.json();
  if (typeof j2.output_text === "string" && j2.output_text) return j2.output_text;
  const parts: string[] = [];
  for (const o of j2.output ?? []) {
    if (o?.type && o.type !== "message") continue;
    for (const c of o?.content ?? []) if (c?.text) parts.push(c.text);
  }
  return parts.join("");
}

function parseJson(text: string): any {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function askJson(system: string, user: string, temperature = 0.7): Promise<any> {
  const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: user }];
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
  "You are 'Kelime', the learner's close Turkish friend (\"kanka\") who sits at a little desk and works on German " +
  "vocabulary FOR them all day. The learner is a native Turkish speaker (level A2) learning German. " +
  "Your vibe: warm, casual, funny, like a best friend texting — Turkish lines may use 'kanka', 'dostum', 'bak şimdi', " +
  "'valla'. Never use emojis. Keep everything short. Turkish must be natural, correct, colloquial Turkish. " +
  "German must be correct, natural, everyday German. Always answer with ONLY a JSON object, no markdown, no commentary.";

const LOOKUP = `${PERSONA}

The learner typed a word or short phrase (maybe with a typo). It is either Turkish or German — detect which.
Return this JSON:
{
  "lang": "tr" or "de" (language of the input),
  "de": German equivalent in dictionary form WITHOUT article (nouns capitalized, verbs in infinitive),
  "art": "der" | "die" | "das" for nouns, otherwise "",
  "plural": plural with article for nouns (e.g. "die Häuser"), otherwise "",
  "pos": "n" (noun) | "v" (verb) | "a" (adjective) | "d" (anything else),
  "tr": the most common Turkish equivalent (lowercase unless proper noun),
  "alts": up to 2 other Turkish meanings (array, may be empty),
  "meaning_tr": ONE short Turkish sentence explaining what it means / when it is used,
  "explain_de": at most 2 VERY simple German sentences (A1–A2 words only) explaining the meaning, as a teacher would to a beginner,
  "say_tr": one short casual friend line in Turkish about this word (e.g. a tiny joke, memory trick or "bunu çok kullanırsın kanka"),
  "example": { "de": a natural everyday German sentence (6–12 words) that contains exactly the word form given in "de", "tr": its Turkish translation }
}`;

const TALK = `${PERSONA}

You keep talking to the learner all day to help them remember their words. Using the learner's words below,
create exactly {N} short, varied teaching moments. Mix these types:
- {"type":"example","id":"<word id>","de":"<NEW natural German sentence (6–12 words) containing the word in exactly the given form>","tr":"<Turkish translation>","note_tr":"<optional, max 1 short Turkish sentence: a useful hint>"}
- {"type":"cloze","id":"<word id>","de":"<German sentence where the word is replaced by ___>","answer":"<the exact missing word form>","tr":"<Turkish translation of the full sentence>"}
- {"type":"ask","id":"<word id>","q_de":"<a simple, friendly German question (A2) the learner can answer using the word>","q_tr":"<Turkish translation>"}
- {"type":"tip","id":"<word id>","text_tr":"<max 2 short, casual Turkish sentences: article, plural, conjugation, a false friend, or a memory trick>","de":"<one short German example>"}
- {"type":"chat","text_tr":"<one casual Turkish friend line (max 14 words): what you are doing for them right now, a cheer, or a tiny joke about one of their words>"}
- {"type":"new","de":"<a useful everyday A2 word NOT in the known list, without article>","art":"der|die|das or empty","pos":"n|v|a|d","tr":"<Turkish>","explain_de":"<max 2 very simple German sentences>","example":{"de":"<sentence containing exactly that form>","tr":"<Turkish>"}}
Prefer words with a low level (they need practice). Use each word at most once. Include at most one \"chat\" item. {NEW_HINT}
Return: {"items":[ ... ]}`;

const CHECK = `${PERSONA}

You asked the learner a question in German. Judge their answer kindly. Small mistakes are fine if it is understandable.
Return: {"ok": true|false (did they answer sensibly and use German reasonably?), "fix_de": "<a corrected / more natural version of their answer, or empty if already perfect>", "feedback_tr": "<one short, warm, casual Turkish friend sentence ('helal kanka' vibe if good, gentle if not)>"}`;

/* ---------- sunucu ---------- */
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method" }, 405, h);
  if (origin && !ALLOWED_ORIGINS.some((r) => r.test(origin))) return json({ error: "origin" }, 403, h);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (limited(ip)) return json({ error: "rate_limited" }, 429, h);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400, h);
  }

  try {
    switch (body?.action) {
      case "ping":
        return json({ ok: true, hasKey: !!apiKey(), model: MODEL }, 200, h);

      case "lookup": {
        const q = String(body.q ?? "").trim().slice(0, 80);
        if (!q) return json({ error: "empty" }, 400, h);
        const out = await askJson(LOOKUP, `Input: "${q}"`, 0.3);
        return json(out, 200, h);
      }

      case "talk": {
        const words = (Array.isArray(body.words) ? body.words : []).slice(0, 12).map((w: any) => ({
          id: String(w.id ?? "").slice(0, 20),
          de: String(w.de ?? "").slice(0, 40),
          art: String(w.art ?? "").slice(0, 3),
          tr: String(w.tr ?? "").slice(0, 40),
          level: Number(w.level) || 0,
        }));
        const known = (Array.isArray(body.known) ? body.known : []).slice(0, 150).map((s: any) => String(s).slice(0, 30));
        const n = Math.max(1, Math.min(5, Number(body.n) || 3));
        const newHint = body.wantNew
          ? 'Include exactly one item of type "new".'
          : 'Do not use type "new" unless the word list is empty.';
        const sys = TALK.replace("{N}", String(n)).replace("{NEW_HINT}", newHint);
        const user = `Learner's words (focus):\n${JSON.stringify(words)}\n\nAll known words (do not suggest these as new):\n${known.join(", ")}`;
        const out = await askJson(sys, user, 0.9);
        return json({ items: Array.isArray(out?.items) ? out.items : [] }, 200, h);
      }

      case "check": {
        const user = JSON.stringify({
          question_de: String(body.q_de ?? "").slice(0, 200),
          target_word: String(body.word ?? "").slice(0, 40),
          learner_answer: String(body.answer ?? "").slice(0, 300),
        });
        const out = await askJson(CHECK, user, 0.3);
        return json(out, 200, h);
      }

      default:
        return json({ error: "unknown_action" }, 400, h);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("kelime-ai error:", msg);
    return json({ error: msg.startsWith("missing_key") ? "missing_key" : "model_error", detail: msg.slice(0, 300) }, 502, h);
  }
});
