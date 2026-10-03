// AI-generated scenes for /api/idea-to-video-v2, through fal.ai.
//
// The shape is HYBRID on purpose: a video gets at most a few AI scenes (the
// opening hook first) and Pexels fills the rest. A whole video of generated
// footage would cost ten times as much for a result the viewer mostly judges
// by its first seconds.
//
// And AI is never load-bearing. Every failure here - no key, no allowance, a
// refused prompt, a timeout, a spend cap - returns null, and the caller falls
// straight through to the Pexels search it has always done. A user must never
// lose a video because a generation model had a bad minute.
//
// The model is one string (AI_SCENE_MODEL). Seedance 1 Pro Fast is the default
// because at 720p it measured both better and CHEAPER than the obvious "cheap"
// choice, Wan 2.2 (~$0.11 vs $0.40 per 5s clip, fal pricing Oct 2026), and it
// takes 9:16 natively. Hailuo 02's text-to-video endpoint has no aspect_ratio
// input at all, so it can only make landscape - unusable for a portrait-first
// app however good its motion is.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fal } from "@fal-ai/client";
import { FieldValue } from "firebase-admin/firestore";
import { isAdminUid } from "./tiers.js";

// Read lazily, like tiers.js's adminUids(): ES imports evaluate before
// server.js's dotenv call has populated process.env.
const env = (k, d) => process.env[k] ?? d;

export const AI_SCENE_DEFAULT_MODEL = "fal-ai/bytedance/seedance/v1/pro/fast/text-to-video";

// Per model: how to ask for a clip of N seconds, and what that costs. The
// cost is an ESTIMATE used only for the server-side daily cap below; fal's
// own dashboard spend limit is the real backstop. Adding a model = one entry.
const MODELS = {
  "fal-ai/bytedance/seedance/v1/pro/fast/text-to-video": {
    // duration accepts "2".."12"; priced in video tokens, $1 per million,
    // tokens = w*h*fps*seconds/1024 (fal's own formula, 24fps).
    input: (prompt, aspectRatio, secs) => ({
      prompt, aspect_ratio: aspectRatio, resolution: "720p",
      duration: String(secs), enable_safety_checker: true,
    }),
    usd: (secs) => (1280 * 720 * 24 * secs / 1024) / 1e6 * 1.0,
  },
  "fal-ai/bytedance/seedance/v1/lite/text-to-video": {
    input: (prompt, aspectRatio, secs) => ({
      prompt, aspect_ratio: aspectRatio, resolution: "720p",
      duration: String(secs), enable_safety_checker: true,
    }),
    usd: (secs) => (1280 * 720 * 24 * secs / 1024) / 1e6 * 1.8,
  },
  // Flat $0.04 a video, 121 frames at 24fps (~5s); duration is fixed.
  "fal-ai/ltx-video-13b-distilled": {
    input: (prompt, aspectRatio) => ({ prompt, aspect_ratio: aspectRatio, resolution: "720p" }),
    usd: () => 0.04,
  },
  "fal-ai/wan/v2.2-a14b/text-to-video": {
    // 81 frames at 16fps (~5s); $0.08 per video-second at 720p.
    input: (prompt, aspectRatio) => ({ prompt, aspect_ratio: aspectRatio, resolution: "720p" }),
    usd: () => 0.08 * 5,
  },
  // $1.40 per 5s, $0.28 per second after. Premium - only if a plan pays for it.
  "fal-ai/kling-video/v2.1/master/text-to-video": {
    input: (prompt, aspectRatio, secs) => ({ prompt, aspect_ratio: aspectRatio, duration: secs > 5 ? "10" : "5" }),
    usd: (secs) => (secs > 5 ? 2.80 : 1.40),
  },
};

// Allowance per plan, per credit cycle, and the most one video may use.
// Separate from minute-credits on purpose: a credit is cheap local compute, an
// AI scene is real money paid to someone else, and folding the two into one
// counter would let a user spend a month of ffmpeg on fal or vice versa.
// Free gets none - the free tier is Pexels, which is what keeps it free.
//
// Worst case at the 8s clip cap on the default model (~$0.17/scene):
// pro 10 -> ~$1.70 of a ~$7 net subscription, creator 40 -> ~$6.90 of ~$15.
export const AI_SCENE_PLANS = {
  free:    { perCycle: 0,  perVideo: 0 },
  pro:     { perCycle: 10, perVideo: 2 },
  creator: { perCycle: 40, perVideo: 4 },
};

// A paid plan with no purchase behind it - set by hand for a reviewer or a test
// account. Every one of those is real fal money for no revenue, so it gets a
// taste rather than the plan's full allowance. Not zero: a reviewer on Creator
// who finds the option locked would read it as broken. "Paid" means
// subscriptionPurchaseToken, which only verify-purchase writes - the same test
// the admin screen uses to label a plan 'purchase' vs 'manual'. Admins exempt.
const UNPURCHASED_LIMITS = { perCycle: 3, perVideo: 1 };

function limitsFor(uid, plan, userDoc) {
  const base = AI_SCENE_PLANS[plan] || AI_SCENE_PLANS.free;
  if (base.perCycle > 0 && !isAdminUid(uid) && !userDoc?.subscriptionPurchaseToken) return UNPURCHASED_LIMITS;
  return base;
}

// Clip length. A segment is often 10-15s of narration; generating all of it
// would double the cost for footage the viewer has stopped studying, so a
// clip is capped and the existing segment pipeline loops it past the end,
// exactly as it does a short Pexels clip.
const MIN_SECS = 3, MAX_SECS = 8;
const GEN_TIMEOUT_MS = 150_000;

export function aiScenesConfigured() {
  return !!env("FAL_KEY");
}

function modelId() {
  const id = env("AI_SCENE_MODEL", AI_SCENE_DEFAULT_MODEL);
  return MODELS[id] ? id : AI_SCENE_DEFAULT_MODEL;
}

let falConfiguredWith = null;
function ensureFal() {
  const key = env("FAL_KEY");
  if (key && falConfiguredWith !== key) { fal.config({ credentials: key }); falConfiguredWith = key; }
}

// ---- server-wide spend caps -------------------------------------------------
// The fal balance (no auto top-up) is the absolute ceiling. These exist so a bug -
// a retry loop, a broken allowance, a client hammering the endpoint - is stopped
// by THIS server within the hour, and the owner hears about it, rather than the
// balance quietly emptying.
//
// In Firestore, not memory: the bugs most likely to overspend are also the ones
// that crash the process, and pm2 restarts it - an in-memory counter would reset
// to zero on every lap of a crash loop. aiSpend/{UTC day} holds the day's total
// and a per-hour map. No security rule mentions aiSpend, so it is Admin-only.
//
// Reserved BEFORE calling fal, in a transaction, so parallel generations cannot
// both slip under the cap. Fails CLOSED: if the spend record cannot be read, no
// AI scene is generated - the user gets Pexels, which costs nothing.
const dayCap = () => Number(env("AI_SCENE_DAILY_USD_CAP", "3")) || 0;
const hourCap = () => Number(env("AI_SCENE_HOURLY_USD_CAP", "1")) || 0;

async function reserveSpend(db, usd) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const ref = db.collection("aiSpend").doc(day);
  const r = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() || {};
    const dayUsd = Number(d.usd) || 0;
    const hourUsd = Number(d.hours?.[hour]) || 0;
    if (dayUsd + usd > dayCap()) return { ok: false, which: "daily", cap: dayCap(), spent: dayUsd };
    if (hourUsd + usd > hourCap()) return { ok: false, which: "hourly", cap: hourCap(), spent: hourUsd };
    tx.set(ref, { usd: dayUsd + usd, hours: { [hour]: hourUsd + usd }, updatedAt: now.toISOString() }, { merge: true });
    return { ok: true };
  });
  return { ...r, day, hour, ref };
}

async function releaseSpend(resv, usd) {
  await resv.ref.set({
    usd: FieldValue.increment(-usd),
    hours: { [resv.hour]: FieldValue.increment(-usd) },
  }, { merge: true });
}

// One email per cap per day, however many requests hit it - the flag lives on the
// same day doc, so a restart does not resend it either.
async function alertCapOnce(db, resv, alert) {
  if (!alert) return;
  try {
    const first = await db.runTransaction(async (tx) => {
      const d = (await tx.get(resv.ref)).data() || {};
      if (d.alerted?.[resv.which]) return false;
      tx.set(resv.ref, { alerted: { [resv.which]: new Date().toISOString() } }, { merge: true });
      return true;
    });
    if (first) await alert(resv);
  } catch (e) { console.warn("[ai-scenes] cap alert failed:", e.message); }
}

// ---- per-user allowance ----------------------------------------------------
// Tied to the CREDIT cycle by remembering which creditsResetAt the count
// belongs to: every path that refills credits (signup, the reset sweep,
// verify-purchase, the subscription sweep) writes a new creditsResetAt, so a
// count stamped with an old one is simply last cycle's and reads as zero.
// That keeps this out of all four of those paths instead of adding to each.

export async function aiSceneStatus(db, uid, plan) {
  const snap = await db.collection("users").doc(uid).get();
  const d = snap.exists ? snap.data() : {};
  const limits = limitsFor(uid, plan, d);
  const used = d.aiScenesCycle === d.creditsResetAt ? (Number(d.aiScenesUsed) || 0) : 0;
  return {
    // available = the feature exists on this server at all; enabled = this
    // account may use it. The app hides the row for the first and offers an
    // upgrade for the second - two different things to tell a user.
    available: aiScenesConfigured(),
    enabled: aiScenesConfigured() && limits.perCycle > 0,
    perVideo: limits.perVideo,
    perCycle: limits.perCycle,
    remaining: Math.max(0, limits.perCycle - used),
  };
}

/** Atomically takes up to `want` scenes. Returns how many were granted. */
async function reserveScenes(db, uid, plan, want) {
  const ref = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const limits = limitsFor(uid, plan, d);
    const sameCycle = d.aiScenesCycle === d.creditsResetAt;
    const used = sameCycle ? (Number(d.aiScenesUsed) || 0) : 0;
    const grant = Math.max(0, Math.min(want, limits.perVideo, limits.perCycle - used));
    if (grant > 0) tx.set(ref, { aiScenesUsed: used + grant, aiScenesCycle: d.creditsResetAt ?? null }, { merge: true });
    return grant;
  });
}

/** Gives back scenes that were reserved but fell back to Pexels. */
async function refundScenes(db, uid, n) {
  if (n <= 0) return;
  await db.collection("users").doc(uid).set({ aiScenesUsed: FieldValue.increment(-n) }, { merge: true });
}

// ---- prompt ----------------------------------------------------------------
// A segment's `keywords` were written as a STOCK SEARCH ("person typing
// laptop") - three words make a poor generation prompt. One short LLM call
// per AI scene turns the narration into a shot description; if that fails
// the keywords still make a usable prompt, just a plainer one.
async function shotPrompt(llm, seg) {
  const base = (seg.keywords || "").trim() || "cinematic background scene";
  // Generated video draws garbled lettering whenever it is invited to, and the
  // captions are burned in on top later - text in the footage would fight them.
  const tail = "Cinematic, natural lighting, smooth camera motion, photorealistic. No text, no letters, no captions, no logos.";
  if (llm && seg.text) {
    try {
      const out = await llm({
        messages: [
          { role: "system", content: "You write prompts for a text-to-video model. Given one line of a video's narration, describe ONE concrete visual shot that illustrates it: subject, action, setting, camera movement. One sentence, under 40 words, no quotes, no on-screen text, no real people's names, no brands. Return only the sentence." },
          { role: "user", content: seg.text.slice(0, 600) },
        ],
        max_tokens: 160, temperature: 0.6,
      });
      const s = String(out || "").replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].trim();
      if (s.length > 15) return `${s.slice(0, 400)} ${tail}`;
    } catch (e) { console.warn("[ai-scenes] prompt LLM failed, using keywords:", e.message); }
  }
  return `${base}. ${tail}`;
}

// ---- cache -----------------------------------------------------------------
// A failed render retried is the realistic repeat, and it would otherwise pay
// for the identical clips twice. Keyed on everything that shapes the output.
// Its own directory: the videos sweep deletes at 72h by owner plan, and these
// have no owner record - they are swept here, by age, instead.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function cacheKey(model, prompt, aspectRatio, secs) {
  return crypto.createHash("sha256").update(JSON.stringify([model, prompt, aspectRatio, secs])).digest("hex").slice(0, 40);
}
export function sweepAiSceneCache(cacheDir) {
  try {
    for (const f of fs.readdirSync(cacheDir)) {
      const p = path.join(cacheDir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > CACHE_TTL_MS) fs.unlinkSync(p);
    }
  } catch { /* dir may not exist yet */ }
}

// ---- generation ------------------------------------------------------------
async function generateOne({ db, model, prompt, aspectRatio, secs, cacheDir, downloadToFile, tag, alert }) {
  const spec = MODELS[model];
  const file = path.join(cacheDir, `${cacheKey(model, prompt, aspectRatio, secs)}.mp4`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    console.log(`[ai-scenes] ${tag} cache hit`);
    return { file, cached: true, usd: 0 };
  }

  const usd = spec.usd(secs);
  let resv;
  try { resv = await reserveSpend(db, usd); }
  catch (e) { console.warn(`[ai-scenes] spend record unreadable, ${tag} uses Pexels:`, e.message); return null; }
  if (!resv.ok) {
    console.warn(`[ai-scenes] ${resv.which} cap $${resv.cap} reached ($${resv.spent.toFixed(2)} spent) - ${tag} uses Pexels`);
    await alertCapOnce(db, resv, alert);
    return null;
  }

  ensureFal();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
  let requestId = null;
  const t0 = Date.now();
  try {
    const result = await fal.subscribe(model, {
      input: spec.input(prompt, aspectRatio, secs),
      abortSignal: ctrl.signal,
      onEnqueue: (id) => { requestId = id; },
    });
    const url = result?.data?.video?.url;
    if (!url) throw new Error("no video url in response");
    const tmp = `${file}.part`;
    await downloadToFile(url, tmp);
    fs.renameSync(tmp, file);
    console.log(`[ai-scenes] ${tag} ${model.split("/").slice(-3).join("/")} ${secs}s ~$${usd.toFixed(3)} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return { file, cached: false, usd };
  } catch (e) {
    // Stopping our wait does not stop fal's GPU, or its bill - cancel the job.
    if (requestId && ctrl.signal.aborted) {
      fal.queue.cancel(model, { requestId }).catch(() => {});
    }
    // A job fal never ran costs nothing; anything that started may have.
    if (!requestId) await releaseSpend(resv, usd).catch(() => {});
    const why = ctrl.signal.aborted ? `timed out after ${GEN_TIMEOUT_MS / 1000}s` : (e?.body?.detail ? JSON.stringify(e.body.detail).slice(0, 300) : e.message);
    console.warn(`[ai-scenes] ${tag} failed, falling back to Pexels: ${why}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts AI generation for up to `requested` scenes, hook first, and returns
 * one promise per segment: a local mp4 path, or null meaning "use Pexels".
 * Never throws. Returns all-null immediately when AI is off for this call.
 *
 * Generations run concurrently and the caller awaits each in turn, so the
 * wait is the slowest clip rather than the sum of them.
 */
export async function startAiScenes({ db, uid, plan, segments, segDurations, aspectRatio, requested, cacheDir, downloadToFile, llm, alert }) {
  const none = segments.map(() => Promise.resolve(null));
  const want = Math.min(Math.max(0, Math.floor(Number(requested) || 0)), segments.length);
  if (!want || !aiScenesConfigured() || !(AI_SCENE_PLANS[plan]?.perCycle > 0)) {
    return { clips: none, granted: 0, done: Promise.resolve() };
  }

  let granted = 0;
  try { granted = await reserveScenes(db, uid, plan, want); }
  catch (e) { console.warn("[ai-scenes] reserve failed:", e.message); }
  if (!granted) return { clips: none, granted: 0, done: Promise.resolve() };

  fs.mkdirSync(cacheDir, { recursive: true });
  const model = modelId();
  const ar = ["9:16", "1:1", "16:9"].includes(aspectRatio) ? aspectRatio : "9:16";

  const clips = segments.map((seg, i) => {
    if (i >= granted) return Promise.resolve(null);
    const secs = Math.min(MAX_SECS, Math.max(MIN_SECS, Math.ceil(segDurations[i] || MIN_SECS)));
    return shotPrompt(llm, seg)
      .then(prompt => generateOne({ db, model, prompt, aspectRatio: ar, secs, cacheDir, downloadToFile, alert, tag: `${uid.slice(0, 6)} scene ${i + 1}` }))
      .catch(() => null);
  });

  // Refund what did not come from fal: failures, and cache hits (a reused clip
  // cost us nothing, so it should cost the user nothing either).
  const done = Promise.all(clips).then(async (rs) => {
    // Only the first `granted` were ever reserved; the rest are null by design.
    const unused = rs.slice(0, granted).filter(r => !r || r.cached).length;
    if (unused) await refundScenes(db, uid, unused).catch(e => console.warn("[ai-scenes] refund failed:", e.message));
  });

  return { clips: clips.map(p => p.then(r => r?.file || null)), granted, done };
}
