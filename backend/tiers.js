// Subscription tier definitions and credit/cap enforcement, shared by every
// render endpoint (media-to-video, idea-to-video-v2, edit-video).
//
// New module rather than more of server.js (already ~2900 lines): this is a
// big enough, self-contained enough piece of logic that three endpoints
// duplicating the same checks inline would drift out of sync with each
// other the first time one of them got a fix the others didn't.
//
// Payment provider is Google Play Billing (Phase 2 - not built yet, blocked
// on Play Console identity verification). Nothing here assumes Stripe or
// knows Play exists. This module only cares about the plan/credit state
// already sitting in users/{uid} in Firestore; how that state gets set
// (manually today, Play purchase verification later) is a separate concern
// that writes to the same fields, not a different set of fields to reconcile
// later.
//
// Every function here takes the Firestore Admin instance as its first
// argument rather than importing/initializing one of its own - server.js
// initializes Firebase Admin at startup in an order this module shouldn't
// need to know about, and passing it in keeps that ordering server.js's
// problem, not this file's.

import { FieldValue } from "firebase-admin/firestore";

// 1 credit = 1 minute of exported video, rounded up - a 61s export costs 2
// credits, not 1.75, so partial minutes can't be used to dodge the model.
export const CREDIT_SECONDS = 60;

// Free-tier subsets. Both are defaults, not a marketing decision on record -
// picked as the most defensible lines available without guessing at one.
// The 12 legacy caption styles predate the 138-style catalogue (see
// CLAUDE.md: "restyled but not renamed") - an already-existing boundary in
// the app's own history, not one invented here. The 3 gTTS voices are the
// free, unofficial engine; the 5 edge-tts voices are Microsoft's
// higher-quality neural ones - a real quality split already implicit in
// which engine each voice uses. Both are one array to edit if the real
// answer turns out to be different.
export const FREE_CAPTION_STYLES = [
  'classic', 'tiktok', 'bold', 'neon', 'fire', 'purple',
  'sticker', 'outline', 'cinematic', 'minimal', 'shadow3d', 'highlight',
];
// Five of 325. The three gTTS voices plus two edge ones, so a free account has a male
// option and something that is not gTTS's flat delivery - enough to make a video with,
// little enough that the catalogue is a real reason to upgrade. Must match the `free`
// flag in voices.json, which scripts/generate-voices.py writes from this same list.
export const FREE_VOICES = [
  'gtts-us', 'gtts-uk', 'gtts-au',
  'edge-en-US-AvaNeural', 'edge-en-US-AndrewNeural',
];

export const TIERS = {
  free: {
    // 10, so that five 2-minute videos fit exactly. A credit is one *started
    // minute*, not one video, so "5 credits" bought two videos at the 2-minute
    // cap - which is not what a free tier promising five videos should do, and
    // not what the Profile screen's "0 of 5 this month" reads as either.
    // Deliberately expressed as the credits the per-minute model needs rather
    // than by making free a special case that counts videos: one accounting
    // model across all three tiers is worth more than a tidier number here.
    creditsPerCycle: 10,
    // 2 minutes, not 1. At 1 minute a free user could not export anything at all
    // from Idea-to-Video, the app's own headline flow: the script generator is
    // asked for "30-60 second" scripts, and 30-60 seconds of written narration
    // read aloud routinely runs past a minute. The app was generating content its
    // own free tier then refused to export.
    //
    // This gives away less than it looks. Credits are the real ceiling - one
    // credit per started minute, five a cycle - so this changes the shape of what
    // a free user can make, not how much. Two 2-minute videos instead of five
    // 1-minute ones, out of the same budget.
    maxExportSeconds: 2 * 60,
    maxResolution: '720p',
    watermark: true,
    queuePriority: 0,
    allVoices: false,
    allCaptionStyles: false,
  },
  pro: {
    creditsPerCycle: 60,
    maxExportSeconds: 15 * 60,
    maxResolution: '1080p',
    watermark: false,
    queuePriority: 0,
    allVoices: true,
    allCaptionStyles: true,
  },
  creator: {
    creditsPerCycle: 300,
    maxExportSeconds: 40 * 60,
    maxResolution: '1080p',
    watermark: false,
    queuePriority: 1, // jumps the render queue ahead of free/pro - see server.js's acquireVideoSlot
    allVoices: true,
    allCaptionStyles: true,
  },
};

// Free tier only. Paid resets are driven by Play's own billing-period
// notifications once Phase 2 lands (a subscription's real renewal date is
// the correct source of truth for when ITS credits reset - a generic
// 30-day sweep would drift out of sync with whatever day it actually
// renews on). Free has no billing period to anchor to, so a rolling
// 30-day window from the last reset is what server.js's sweep uses.
export const FREE_RESET_MS = 30 * 24 * 60 * 60 * 1000;

export function tierConfig(plan) {
  return TIERS[plan] || TIERS.free;
}

/**
 * A user's plan + credit state, lazily initializing creditsRemaining/
 * creditsResetAt the first time either is seen missing - every account that
 * existed before this feature, plus any created before signup started
 * seeding them. Only fills in a value that was never there; an account
 * that has already spent down its credits keeps that value, so this can't
 * be used to top up a balance by deleting the field.
 *
 * Dates are stored as ISO strings, matching every other date field server.js
 * already writes (createdAt on userVideos, jobs, etc.) rather than Firestore
 * Timestamp objects - one convention for "when" throughout this file.
 */
// Read lazily inside the call rather than at module load: this module is imported by
// server.js and ES imports evaluate before the importing module's body, so a top-level
// read could run before dotenv had populated process.env and would silently see none.
function adminUids() {
  return String(process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * An admin is permanently entitled to Creator.
 *
 * The owner has to be able to exercise every gated feature to test it, and the
 * alternative - editing Firestore by hand - does not hold: they also carry a real
 * expired purchase token, so the subscription sweep would find it ended and put them
 * back on free within six hours. Entitlement has to come from who they are, not from
 * a row someone remembered to set.
 *
 * Same list as the admin stats endpoint (ADMIN_UIDS in .env, gitignored). Deliberately
 * not a second list: two lists of who counts as staff drift, and the one that drifts is
 * always the one nobody is looking at.
 */
export function isAdminUid(uid) {
  return !!uid && adminUids().includes(uid);
}

export async function getUserPlanData(db, uid) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  const admin = isAdminUid(uid);
  const plan = admin ? 'creator' : (data.plan || 'free');

  // Written through rather than only returned. The app's usePlan() reads this document
  // straight from Firestore, so a server-only override would enforce Creator on every
  // endpoint while the UI still said Free Plan and greyed out the tools it was letting
  // through. Runs once - the next lookup sees creator and skips.
  if (admin && data.plan !== 'creator') {
    const patch = { plan: 'creator' };
    const owed = tierConfig('creator').creditsPerCycle;
    if ((Number(data.creditsRemaining) || 0) < owed) patch.creditsRemaining = owed;
    await ref.set(patch, { merge: true });
    return { plan, creditsRemaining: patch.creditsRemaining ?? data.creditsRemaining, creditsResetAt: data.creditsResetAt };
  }

  if (data.creditsRemaining === undefined || data.creditsResetAt === undefined) {
    const creditsRemaining = tierConfig(plan).creditsPerCycle;
    const creditsResetAt = new Date(Date.now() + FREE_RESET_MS).toISOString();
    await ref.set({ creditsRemaining, creditsResetAt }, { merge: true });
    return { plan, creditsRemaining, creditsResetAt };
  }

  return { plan, creditsRemaining: data.creditsRemaining, creditsResetAt: data.creditsResetAt };
}

const RESOLUTION_RANK = { '720p': 0, '1080p': 1, '4K': 2 };

/** Never returns above ceiling, whatever was requested (or nothing at all). */
function clampResolution(requested, ceiling) {
  const req = requested || ceiling;
  return (RESOLUTION_RANK[req] ?? 0) > (RESOLUTION_RANK[ceiling] ?? 0) ? ceiling : req;
}

/**
 * Everything a render endpoint needs to decide BEFORE creating a job: does
 * this account have any credits left, does the requested length fit the
 * tier's per-video cap, what resolution and watermark setting actually
 * apply. Returns { ok:false, status, error } to send straight back to the
 * client without ever creating a job - a rejected request must not get a
 * jobId back - or { ok:true, plan, tier, resolution, watermark } to proceed.
 *
 * requestedDurationSeconds is the caller's own best estimate (exact final
 * length isn't known until after render for the AI-generation paths) and
 * only gates the per-video cap, not the credit balance - the balance check
 * is just "greater than zero." Being pickier than that here would mean
 * turning away a render over an estimate; see deductCredits for why the
 * balance is allowed to run past zero afterward instead.
 */
export async function checkRenderAllowed(db, uid, { requestedDurationSeconds = 0, requestedResolution = null } = {}) {
  const { plan, creditsRemaining, creditsResetAt } = await getUserPlanData(db, uid);
  const tier = tierConfig(plan);

  if (creditsRemaining <= 0) {
    // "this cycle" said nothing about how long a cycle actually is - credits
    // reset on a rolling 30 days from whenever they were last set
    // (FREE_RESET_MS), not a calendar month, so "monthly" would have been a
    // real claim, not just a friendlier word. The exact date is already
    // computed and sitting on this same account record, so hand it over
    // directly instead of making someone open Profile to find out when
    // "later" actually is.
    const resetDate = creditsResetAt
      ? new Date(creditsResetAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      : null;
    return { ok: false, status: 402, error: resetDate
      ? `You've used all your credits. They refresh every 30 days - yours reset on ${resetDate} - or upgrade for more right away.`
      : "You've used all your credits. They refresh every 30 days, or upgrade for more right away." };
  }
  if (requestedDurationSeconds > tier.maxExportSeconds) {
    const maxMin = Math.round(tier.maxExportSeconds / 60);
    return { ok: false, status: 403, error: `This export is a little longer than your plan allows (up to ${maxMin} minute${maxMin === 1 ? '' : 's'}). Try trimming it down, or upgrade for longer exports.` };
  }

  return {
    ok: true,
    plan,
    tier,
    resolution: clampResolution(requestedResolution, tier.maxResolution),
    watermark: tier.watermark,
  };
}

export function voiceAllowed(plan, voiceId) {
  return tierConfig(plan).allVoices || FREE_VOICES.includes(voiceId);
}

export function captionStyleAllowed(plan, styleId) {
  return tierConfig(plan).allCaptionStyles || FREE_CAPTION_STYLES.includes(styleId);
}

/**
 * Deduct credits for a completed render, from its REAL duration - never the
 * estimate, and never called until after the render actually succeeds (a
 * failed render must not cost anything).
 *
 * Uses FieldValue.increment rather than a read-modify-write: two renders
 * for the same account finishing close together (both within the 4-slot
 * concurrency limit) doing "read balance, subtract, write" independently
 * can lose one of the two deductions to the other overwriting it. increment
 * is atomic against that.
 *
 * Deliberately allowed to go negative. A render that already finished, over
 * by a fraction of a credit, is real compute already spent - discarding
 * finished work to keep a counter non-negative wastes more than it
 * protects. The next render is still blocked by checkRenderAllowed's
 * creditsRemaining <= 0 check until the next reset; going negative only
 * ever costs the account the remainder of its own cycle.
 */
export async function deductCredits(db, uid, actualDurationSeconds) {
  const credits = Math.ceil(actualDurationSeconds / CREDIT_SECONDS);
  if (credits <= 0) return;
  await db.collection('users').doc(uid).set(
    { creditsRemaining: FieldValue.increment(-credits) },
    { merge: true }
  );
}
