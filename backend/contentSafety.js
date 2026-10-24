// Content safety for the generation routes: screen what a user asks Tonefy to voice,
// caption or film, and catch the LLM refusing instead of writing.
//
// Why this exists (Oct 23 2026 review): a stranger made Script videos whose voiceover and
// burned-in captions were sexual prompts ("show the woman with nothing on") - nothing
// looked at the text before it was spoken. And one video's whole script was the model's
// own "I'm sorry, but I can't help with that.", voiced and captioned as if it were content.
//
// HOW IT SCREENS
// 1. A narrow local blocklist (explicit sexual terms only). Instant, no network, and
//    still applies when every classifier below is unavailable.
// 2. A policy-driven classifier on Groq. openai/gpt-oss-safeguard-20b is built for exactly
//    this (policy in the system prompt, verdict out) and measured right on every sample,
//    but on this account's tier it allows only 2,000 TOKENS A MINUTE (the policy alone is
//    ~350) - so a 429 moves straight on to gpt-oss-20b, then 120b (8,000/min each), with
//    no SDK retry: groq-sdk's default retry waits out `retry-after: 20`, which measured as
//    20 s per check. Each call is bounded by a short timeout.
// 3. Verdicts are cached by text hash, and text the server ITSELF wrote from an already
//    screened prompt is marked cleared - so the usual chain (idea -> script -> voiceover ->
//    render) costs one classifier call, not four.
//
// FAILS OPEN when no classifier answers (logged as `[safety] unscreened`): a Groq outage
// must not stop paying users making ordinary videos. The blocklist still applies then.
//
// Scope: what Tonefy GENERATES (scripts, voiceovers, captions, AI scene prompts). Text a
// user types over their own footage in the editor is their content, like any editor.

import crypto from "crypto";

const CLASSIFIER_MODELS = ['openai/gpt-oss-safeguard-20b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
const CALL_TIMEOUT_MS = 5000;
// Long user scripts are screened in pieces: one huge request would blow the per-minute
// token budget on its own. 4 x 3000 chars covers ~2,000 words, more than a 15-minute
// Pro script; past that the tail is not screened (logged).
const CHUNK_CHARS = 3000;
const MAX_CHUNKS = 4;

export const BLOCKED_MESSAGE =
  "We can't make a video from this. Tonefy doesn't create sexual, hateful, violent or dangerous content. Please try a different idea.";
export const REFUSAL_MESSAGE =
  "We couldn't write a script for that idea. Please try describing it differently.";

// Kept short: every word here is spent on every classifier call.
const POLICY = `You classify content for Tonefy, an app that turns a user's idea or script into a narrated social video (voiceover, captions, stock or AI footage).
VIOLATING if a video made from it would contain or request:
sexual: nudity, sexual acts, sexualised descriptions of people, asking to show someone undressed, erotic or fetish content. Anything sexual involving minors.
hate: attacking or demeaning people for race, ethnicity, tribe, religion, nationality, gender, sexual orientation or disability.
violence: graphic gore, torture, threats, glorifying or inciting violence or terrorism.
self_harm: encouraging or instructing suicide, self-harm or eating disorders.
illegal: instructions for weapons, explosives, hard drugs, hacking, fraud or scams.
harassment: bullying, threatening or sexualising a real private person.
SAFE: fitness, diet, health and sexual-health education in neutral terms, non-explicit romance and dating advice, news, history (including wars and genocide), religion, respectful politics, crime reported as news, mental-health support, business, marketing, comedy, motivation, casual swearing.
Reply with ONLY JSON: {"violation":true|false,"category":"sexual|hate|violence|self_harm|illegal|harassment|none"}`;

// Narrow on purpose - a false positive here has no second opinion. Words with innocent
// everyday uses ("sexy", "bikini", "breast") are left to the classifier.
const BLOCKLIST = new RegExp([
  '\\bporn\\w*', '\\bhentai\\b', '\\bxxx\\b', '\\bnsfw\\b', '\\bnudes?\\b', '\\bnudity\\b',
  '\\bnaked\\b(?!\\s+(?:eye|truth))', '\\bundress\\w*', '\\btopless\\b', '\\bblow ?jobs?\\b',
  '\\bmasturbat\\w*', '\\berotic\\w*', '\\bwith nothing on\\b', '\\bwithout (?:any )?clothes\\b',
  '\\bno clothes on\\b', '\\bsex tape\\b', '\\bonlyfans\\b',
].join('|'), 'i');

// A model declining, as opposed to a script that happens to start "I'm sorry". Matched in
// the first 300 characters only: a refusal leads with it, and a real script that mentions
// "can't help" later on is not one. "I can't help but smile" is a sentence, not a refusal.
const CANT = String.raw`\b(?:i|we)\s*(?:can(?:no|['\u2019])?t|cannot|won['\u2019]t|will not|am unable to|['\u2019]m unable to|am not able to|['\u2019]m not able to)\s+`;
const REFUSAL_RES = [
  // "I can't help with that", "I cannot assist you with this request"
  new RegExp(CANT + String.raw`(?:help|assist)\s+(?:you\s+)?with\s+(?:that|this|your|such|it)\b`, 'i'),
  // "I can't create that", "I cannot fulfill this request", "I can't comply with that"
  new RegExp(CANT + String.raw`(?:create|write|provide|produce|generate|fulfil+|comply with)\s+(?:that|this|such|your|it|content)\b`, 'i'),
  // "I'm sorry, I can't help." / "I can't comply."
  new RegExp(CANT + String.raw`(?:help|assist|comply)\s*[.!]`, 'i'),
  /\bas an ai(?: language model)?\b/i,
  /\b(?:against|violates?)\s+(?:my|the|our|openai['\u2019]?s?)\s+(?:content\s+|usage\s+)?(?:guidelines|polic(?:y|ies)|rules)\b/i,
];

export function isRefusal(text) {
  const head = String(text || '').trim().slice(0, 300);
  return !!head && REFUSAL_RES.some(re => re.test(head));
}

function blocklistHit(text) {
  return BLOCKLIST.test(String(text || ''));
}

const hash = (t) => crypto.createHash('sha256').update(String(t).trim().toLowerCase()).digest('hex');

export function createContentSafety({ groq, db = null, FieldValue = null }) {
  // hash -> { ok, category, at }. Bounded and aged: a verdict is about the text, not the
  // moment, but the policy may change and a restart should not be the only way to see it.
  const cache = new Map();
  const TTL_MS = 24 * 3600 * 1000;
  const MAX = 5000;
  const remember = (h, v) => {
    if (cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(h, { ...v, at: Date.now() });
  };
  const recall = (h) => {
    const v = cache.get(h);
    if (!v) return null;
    if (Date.now() - v.at > TTL_MS) { cache.delete(h); return null; }
    return v;
  };

  // One chunk through the model chain. Returns {ok, category} or null when nobody answered.
  async function classify(chunk) {
    for (const model of CLASSIFIER_MODELS) {
      try {
        const c = await groq.chat.completions.create({
          model,
          messages: [{ role: 'system', content: POLICY }, { role: 'user', content: chunk }],
          // Reasoning models: this budget is shared with their reasoning (see groqChat).
          // Measured 10-64 reasoning tokens per verdict at low effort.
          max_tokens: 400,
          temperature: 0,
          reasoning_effort: 'low',
        }, { timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
        const m = /\{[\s\S]*\}/.exec(c.choices?.[0]?.message?.content || '');
        if (!m) { console.warn(`[safety] ${model} gave no verdict`); continue; }
        const v = JSON.parse(m[0]);
        if (typeof v.violation !== 'boolean') continue;
        return { ok: !v.violation, category: v.violation ? String(v.category || 'other') : 'none', model };
      } catch (e) {
        console.warn(`[safety] ${model} unavailable: ${String(e?.status || '')} ${String(e?.message || '').slice(0, 100)}`);
      }
    }
    return null;
  }

  async function logBlock({ uid, route, category, text, source }) {
    console.warn(`[safety] blocked ${route} uid=${uid || '-'} category=${category} source=${source}: ${JSON.stringify(String(text).slice(0, 120))}`);
    if (!db || !uid) return;
    // So the owner can see who is trying what. Keyed by uid and purged with the account
    // (/api/account/delete), like everything else a user leaves behind.
    try {
      await db.collection('safetyBlocks').add({
        uid, route, category, source,
        excerpt: String(text).slice(0, 300),
        at: FieldValue ? FieldValue.serverTimestamp() : new Date(),
      });
    } catch (e) { console.warn('[safety] could not record block:', e.message); }
  }

  /**
   * Screen user-supplied (or user-influenced) text before it is voiced, captioned, filmed
   * or used as a prompt. Resolves {ok:true} or {ok:false, category, message}.
   */
  async function screen(text, { uid = null, route = '' } = {}) {
    const t = String(text || '').trim();
    if (!t) return { ok: true };
    const h = hash(t);
    const cached = recall(h);
    if (cached) return cached.ok ? { ok: true } : { ok: false, category: cached.category, message: BLOCKED_MESSAGE };

    if (blocklistHit(t)) {
      remember(h, { ok: false, category: 'sexual' });
      await logBlock({ uid, route, category: 'sexual', text: t, source: 'blocklist' });
      return { ok: false, category: 'sexual', message: BLOCKED_MESSAGE };
    }

    const chunks = [];
    for (let i = 0; i < t.length && chunks.length < MAX_CHUNKS; i += CHUNK_CHARS) chunks.push(t.slice(i, i + CHUNK_CHARS));
    if (t.length > CHUNK_CHARS * MAX_CHUNKS) console.warn(`[safety] ${route}: only the first ${CHUNK_CHARS * MAX_CHUNKS} of ${t.length} chars screened`);

    let unscreened = false;
    for (const chunk of chunks) {
      const v = await classify(chunk);
      if (!v) { unscreened = true; continue; }
      if (!v.ok) {
        remember(h, { ok: false, category: v.category });
        await logBlock({ uid, route, category: v.category, text: t, source: v.model });
        return { ok: false, category: v.category, message: BLOCKED_MESSAGE };
      }
    }
    // An unscreened pass is NOT cached as clean, so the next step tries again.
    if (unscreened) console.warn(`[safety] unscreened ${route} uid=${uid || '-'} (no classifier answered)`);
    else remember(h, { ok: true });
    return { ok: true };
  }

  /** Text this server wrote from an already-screened prompt: skip re-screening it later. */
  function markCleared(text) {
    const t = String(text || '').trim();
    if (t) remember(hash(t), { ok: true });
  }

  return { screen, markCleared, isRefusal };
}
