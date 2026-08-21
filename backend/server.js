import express from "express";
import multer from "multer";
import crypto from 'crypto';
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { exec, execFile } from "child_process";
import { createTextRenderer } from "./textRender.js";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import Groq from "groq-sdk";
import { google } from "googleapis";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { checkRenderAllowed, deductCredits, voiceAllowed, captionStyleAllowed, getUserPlanData, tierConfig, isAdminUid, FREE_RESET_MS } from "./tiers.js";
import nodemailer from "nodemailer";

// Firebase Storage + Firestore (Admin) — initialized after initializeApp()
let bucket, adminDb;

// Save video locally and record metadata in Firestore (no Firebase Storage needed)
async function uploadVideoToFirebase(localPath, userId, metadata = {}) {
  try {
    const filename = path.basename(localPath);
    const localUrl = `/videos/${filename}`;
    const fullUrl = `${process.env.BASE_URL || ''}${localUrl}`;
    await adminDb.collection('userVideos').add({
      userId,
      filename,
      downloadUrl: fullUrl,
      localUrl,
      ...metadata,
      createdAt: new Date().toISOString(),
      size: (await fs.promises.stat(localPath)).size
    });
    console.log('✅ Video saved locally and recorded in Firestore:', filename);
    return fullUrl;
  } catch (err) {
    console.error('Video save error:', err.message);
    return null;
  }
}


import { readFileSync } from "fs";
const serviceAccount = JSON.parse(readFileSync(new URL("./serviceAccountKey.json", import.meta.url)));

// Firebase Admin init
initializeApp({ credential: cert(serviceAccount), storageBucket: "gen-lang-client-0229110424.firebasestorage.app" });
// Storage and Firestore initialized lazily
try {
  bucket = getStorage().bucket();  // uses storageBucket from initializeApp
  adminDb = getAdminFirestore();
  console.log('✅ Firebase Storage initialized:', process.env.FIREBASE_STORAGE_BUCKET);
} catch(e) {
  console.error('⚠️ Firebase Storage init failed:', e.message);
}

// Firebase's own verification/reset-password email templates turned out not to be
// editable via the Identity Platform admin API once CUSTOM_SMTP is configured for
// this project - PATCH calls against notification.sendEmail.verifyEmailTemplate.body
// return 200 but the body field silently never changes, confirmed by re-reading the
// config fresh after each attempt rather than trusting the write response. This sends
// a fully custom branded email instead, through the same Gmail account already
// configured as this project's SMTP sender.
const emailTransporter = (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
    })
  : null;
if (!emailTransporter) console.warn('[email] EMAIL_USER/EMAIL_APP_PASSWORD not set - verification emails will fail');

// Reuses the same service account as Firebase Admin above - Android
// Publisher API access is a separate grant from Firebase project
// membership (made in Play Console -> Setup -> API access, against this
// same service account's email), not a separate credential to manage.
const PACKAGE_NAME = "com.ahumuza21213.TonefyApp";
const androidPublisherAuth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const androidpublisher = google.androidpublisher({ version: "v3", auth: androidPublisherAuth });

// Maps a base plan id (e.g. "pro-yearly") to the internal plan key. Base
// plan ids are prefixed by tier on purpose (see SubscriptionScreen.js) so
// this stays a prefix check rather than an exhaustive list that drifts
// every time a new billing period or offer is added in Play Console.
function planFromBasePlanId(basePlanId) {
  if (!basePlanId) return null;
  if (basePlanId.startsWith("pro-")) return "pro";
  if (basePlanId.startsWith("creator-")) return "creator";
  return null;
}

const PLAN_CREDITS = { pro: 60, creator: 300 };

function verifyEmailHtml(displayName, link) {
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 28px;">
    <span style="font-size: 22px; font-weight: 700; color: #111111;">Tonefy <span style="color: #2ECC71;">AI</span></span>
  </div>
  <p style="font-size: 16px; color: #111111; line-height: 1.5; margin: 0 0 12px;">${greeting}</p>
  <p style="font-size: 16px; color: #333333; line-height: 1.5; margin: 0 0 28px;">Please verify your email address to finish setting up your Tonefy AI account.</p>
  <div style="text-align: center; margin: 0 0 28px;">
    <a href="${link}" style="display: inline-block; background-color: #2ECC71; color: #04211f; font-weight: 700; font-size: 16px; text-decoration: none; padding: 14px 36px; border-radius: 8px;">Verify Email</a>
  </div>
  <p style="font-size: 13px; color: #888888; line-height: 1.5; margin: 0 0 8px;">If the button above doesn't work, copy and paste this link into your browser:</p>
  <p style="font-size: 13px; color: #2ECC71; line-height: 1.5; word-break: break-all; margin: 0 0 28px;"><a href="${link}" style="color: #2ECC71;">${link}</a></p>
  <p style="font-size: 13px; color: #888888; line-height: 1.5; margin: 0 0 24px;">If you didn't ask to verify this address, you can safely ignore this email.</p>
  <p style="font-size: 14px; color: #333333; line-height: 1.5; margin: 0;">Thanks,<br>The Tonefy AI team</p>
</div>`;
}

// Auth middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split("Bearer ")[1];
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// Every limiter below shares this key. Two reasons it is not the default.
//
// 1. nginx in front of this app sets X-Real-IP but NOT X-Forwarded-For (see
//    /etc/nginx/sites-available/api.fitlifesolutions.site - it sets headers
//    inline and never includes proxy_params, unlike the other sites on this
//    box). Express derives req.ip from X-Forwarded-For, so with that header
//    absent req.ip is the socket address - 127.0.0.1 - for every request that
//    has ever hit this server. Every limit here was therefore one shared
//    bucket across all users at once: 500 requests per 15 minutes for the
//    entire world, and any one caller able to lock out everybody else. That is
//    also what `validate: { xForwardedForHeader: false }` was silencing.
// 2. This is an authenticated API. Keying by the account is strictly better
//    than keying by address anyway - it survives a phone moving between wifi
//    and mobile data, and it does not lump a whole NAT or campus behind one
//    counter.
//
// Falls back to X-Real-IP for the routes that run before verifyToken.
// ipKeyGenerator is required rather than optional: it collapses IPv6 to a /56,
// without which a single client can walk its own address space for a fresh
// bucket per request.
const limitKey = (req) => {
  if (req.user?.uid) return `u:${req.user.uid}`;
  const real = req.headers["x-real-ip"];
  return ipKeyGenerator(typeof real === "string" && real ? real : req.ip);
};

// Strict limit for video generation (expensive: Groq + ElevenLabs + FFmpeg)
const videoGenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Video generation limit reached. Max 20 per hour.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// Script/audio generation limit
const scriptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Max 20 per hour.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// Pexels search limit
const pexelsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many search requests. Max 30 per 15 minutes.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// The editor's own export path. Credits are the real limit on how much anyone
// can render - this is abuse protection sitting above that, for the case where
// something retries in a loop, so it is deliberately far looser than a
// plausible session of real work.
const renderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: { error: 'Too many exports in a short time. Please wait a few minutes.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// Uploads are not credit-gated at all, so this is the only ceiling on them.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: 'Too many uploads in a short time. Please wait a few minutes.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// ffmpeg and faster_whisper both shell out and are CPU-bound on a box that is
// also serving the website and other pm2 processes.
const mediaProcLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Too many media processing requests. Please wait a few minutes.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// Job polling runs every ~2-3s for the whole length of a render, so a single
// legitimate export is already hundreds of requests - which is why this was
// exempted from the global limit entirely. Exempt is not the same as
// unlimited though, so it gets a ceiling far above any real session instead of
// none at all.
const jobPollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  message: { error: 'Too many status checks. Please wait a moment.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// TikTok's routes are outside /api, so app.use("/api", verifyToken) does not reach
// them. The three that ACT on an account now carry verifyToken inline plus an ownership
// check; auth and callback stay open because they are the OAuth handshake and the
// callback arrives from TikTok, not from a logged-in client.
const tiktokLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Too many TikTok requests. Please wait a few minutes.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});

// Sends real mail through a Gmail account with its own daily cap. Burning that
// cap does not degrade one feature, it stops every new signup from being able
// to verify at all, so this is the tightest limit here.
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many verification emails requested. Please wait before trying again.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
});


const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Script cache — avoids duplicate Groq calls for same prompt
const scriptCache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

function getCached(key) {
  const entry = scriptCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { scriptCache.delete(key); return null; }
  return entry.value;
}
function setCache(key, value) {
  scriptCache.set(key, { value, ts: Date.now() });
  // Keep cache small
  if (scriptCache.size > 200) {
    const firstKey = scriptCache.keys().next().value;
    scriptCache.delete(firstKey);
  }
}

// Fallback LLM — tries Groq first, falls back to Together AI free tier
// Groq retires models without warning and the app finds out as a 404 in front of a
// user. On Aug 17 2026 BOTH models this file used disappeared on the same day -
// llama-3.1-8b-instant and llama-3.3-70b-versatile - taking script generation, keyword
// extraction and segment extraction with them, which is the whole Idea-to-Video flow.
//
// A list rather than a constant, tried in order. A retirement now costs the first
// candidate rather than the feature. Verified against the live API on the day:
//   openai/gpt-oss-120b  clean prose, valid JSON, ~950ms   <- first choice
//   groq/compound-mini   clean prose, valid JSON, ~1500ms  <- slower, same quality
// Two that were rejected, and why, so they are not tried again:
//   openai/gpt-oss-20b   returns EMPTY content for these prompts
//   qwen/qwen3.6-27b     emits <think> reasoning tags into the output
const GROQ_MODELS = ['openai/gpt-oss-120b', 'groq/compound-mini'];

// Only a missing/withdrawn model is worth trying the next candidate for. A bad request
// or an auth failure will fail identically on every model, and retrying it just makes
// the user wait longer for the same error.
function isModelGone(e) {
  const m = String(e?.message || '');
  return e?.status === 404 || m.includes('model_not_found') || m.includes('does not exist');
}

async function groqChat({ messages, max_tokens = 400, temperature = 0.8 }) {
  let lastError;
  for (const model of GROQ_MODELS) {
    try {
      const completion = await groq.chat.completions.create({ model, messages, max_tokens, temperature });
      const text = completion.choices?.[0]?.message?.content?.trim();
      if (text) return text;
      lastError = new Error(`${model} returned empty content`);
    } catch (e) {
      lastError = e;
      if (!isModelGone(e)) throw e;
      console.warn(`[groq] ${model} unavailable, trying next:`, e.message?.slice(0, 120));
    }
  }
  throw lastError || new Error('No Groq model available');
}

async function callLLM({ system, user, max_tokens = 400, temperature = 0.8 }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  // Try Groq first
  try {
    return await groqChat({ messages, max_tokens, temperature });
  } catch (e) {
    console.warn('Groq failed, trying fallback:', e.message);
  }

  // Fallback: Cloudflare Workers AI (free tier - 10k requests/day)
  try {
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`,
        },
        body: JSON.stringify({ messages, max_tokens, temperature }),
      }
    );
    const cfData = await cfRes.json();
    if (cfRes.ok) {
      // Cloudflare moved to an OpenAI-shaped reply: result.choices[0].message.content.
      // The old field was result.response, which is now undefined - so calling .trim()
      // on it THREW, and the throw was caught by the wrapper below and reported as
      // "Cloudflare AI fallback failed". The fallback has therefore been dead, silently,
      // and every AI feature in the app - scripts, translation, this - has had no cover
      // at all whenever Groq rate-limits. Both shapes are read, so a revert on their
      // side does not break it again.
      const text = (cfData.result?.choices?.[0]?.message?.content
        ?? cfData.result?.response
        ?? '')?.trim?.();
      if (text) {
        console.log('[FALLBACK] Used Cloudflare Workers AI');
        return text;
      }
    }
  } catch (e) {
    console.warn('Cloudflare AI fallback failed:', e.message);
  }

  throw new Error('All AI providers failed. Please try again later.');
}

// In-memory job store, persisted to disk so jobs survive server restarts
const jobs = new Map();
const JOBS_FILE = path.join(__dirname, "jobs.json");

// This used to be a synchronous whole-file write on *every* updateJob call,
// and updateJob is called once per overlay now that the export reports
// per-overlay progress - so a 391-overlay render performed 391 blocking
// rewrites of the entire job store, on the single thread that serves every
// HTTP request for every user. The cost is (number of jobs stored) x (progress
// ticks per render), which is fine at 37 jobs and is exactly the shape that
// stops being fine as the store grows.
//
// Coalesced instead: a write is scheduled rather than performed, at most one
// per SAVE_INTERVAL_MS however many updates arrive, and anything that must not
// be lost asks for a flush. Also written via a temp file and renamed, which
// the old version did not do - a crash partway through writeFileSync leaves a
// truncated jobs.json, and truncated JSON fails to parse, which loses every
// job rather than the one being written.
const SAVE_INTERVAL_MS = 1000;
let saveTimer = null;
let savePending = false;

function writeJobsNow() {
  try {
    const tmp = `${JOBS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(jobs)));
    fs.renameSync(tmp, JOBS_FILE);
  } catch (e) {
    console.error("Failed to save jobs.json:", e.message);
  }
}

// flush: for job creation and terminal states, where losing the write to a
// crash in the next second would strand a caller polling for a result that
// the store no longer admits exists.
function saveJobsToDisk({ flush = false } = {}) {
  if (flush) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    savePending = false;
    return writeJobsNow();
  }
  savePending = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (savePending) { savePending = false; writeJobsNow(); }
  }, SAVE_INTERVAL_MS);
}

// A coalesced write can still be in flight when the process is asked to stop.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { if (savePending) writeJobsNow(); process.exit(0); });
}

function loadJobsFromDisk() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const obj = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
      let staleCount = 0;
      for (const [id, data] of Object.entries(obj)) {
        // Any job still "pending" was interrupted by a restart — it can never finish, so fail it clearly
        if (data.status === "pending") {
          data.status = "failed";
          data.message = "Generation was interrupted by a server restart. Please try again.";
          staleCount++;
        }
        jobs.set(id, data);
      }
      console.log(`✅ Loaded ${jobs.size} job(s) from disk (${staleCount} marked failed due to interruption)`);
      if (staleCount > 0) saveJobsToDisk();
    }
  } catch (e) {
    console.error("Failed to load jobs.json:", e.message);
  }
}
loadJobsFromDisk();

function createJob(userId) {
  const jobId = uuidv4();
  jobs.set(jobId, { status: 'pending', progress: 0, message: 'Starting...', userId });
  saveJobsToDisk({ flush: true });
  return jobId;
}
function updateJob(jobId, data) {
  if (jobs.has(jobId)) {
    jobs.set(jobId, { ...jobs.get(jobId), ...data });
    // Progress ticks are coalesced; a finished or failed job is written at
    // once, since that is the state a caller is waiting on.
    const terminal = data.status === 'done' || data.status === 'failed' || data.status === 'error';
    saveJobsToDisk({ flush: terminal });
  }
}

// Concurrency limiter for FFmpeg-heavy video generation
let activeVideoJobs = 0;
const MAX_CONCURRENT_VIDEO_JOBS = 4;
const videoJobQueue = [];         // free/pro
const priorityVideoJobQueue = []; // creator - always drained first once a slot frees up

// priority=true (Creator tier) queues ahead of whatever's already waiting -
// it does NOT touch activeVideoJobs or preempt anything already occupying
// one of the 4 slots, only which waiter gets the NEXT one that frees up.
function acquireVideoSlot(priority = false) {
  return new Promise(resolve => {
    if (activeVideoJobs < MAX_CONCURRENT_VIDEO_JOBS) {
      activeVideoJobs++;
      resolve();
    } else if (priority) {
      priorityVideoJobQueue.push(resolve);
    } else {
      videoJobQueue.push(resolve);
    }
  });
}

function releaseVideoSlot() {
  activeVideoJobs--;
  const nextQueue = priorityVideoJobQueue.length > 0 ? priorityVideoJobQueue : videoJobQueue;
  if (nextQueue.length > 0) {
    activeVideoJobs++;
    nextQueue.shift()();
  }
}

const videosDir = path.join(__dirname, "public", "videos");
const audiosDir = path.join(__dirname, "public", "audios");
const uploadsDir = path.join(__dirname, "uploads");
// Resolves a stored URL (e.g. "/uploads/abc.jpg" or "/music/track.mp3") back
// to its real local file path. "/uploads/..." files live directly under
// uploadsDir (a sibling of "public"), while other static assets (music,
// videos, audios) are served from inside "public". Using a single "public"
// prefix for everything was the root cause of "No such file or directory"
// errors during export — uploaded clips/overlays/audio never actually
// lived under public/uploads.
// Callers pass URLs straight from request bodies, so this has to reject
// anything that isn't one of our own stored files. Two things it guards:
// a foreign URI scheme (a phone's "file:///data/user/0/..." path used to be
// glued onto public/ and then handed to ffmpeg, which only ever produced a
// confusing "No such file or directory"), and any path that escapes the media
// directories once resolved - these paths end up inside a shell command.
function resolveMediaPath(url) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Invalid media path");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    throw new Error("Not a stored media path: " + url.slice(0, 80));
  }
  const clean = url.replace(/^\//, "");
  // Every stored name we generate is uuid- or hash-based, so this is only ever
  // restrictive for hostile input - and these paths are interpolated into
  // ffmpeg command lines elsewhere in this file.
  if (!/^[A-Za-z0-9._/-]+$/.test(clean)) {
    throw new Error("Media path has unexpected characters");
  }
  const base = clean.startsWith("uploads/") ? __dirname : path.join(__dirname, "public");
  const resolved = path.resolve(base, clean);
  const allowedRoots = [uploadsDir, path.join(__dirname, "public")].map(r => path.resolve(r) + path.sep);
  if (!allowedRoots.some(root => resolved.startsWith(root))) {
    throw new Error("Media path outside the allowed directories");
  }
  return resolved;
}

const EDIT_XFADE_MAP = {
  fade:'fade', wipeleft:'wipeleft', wiperight:'wiperight', wipeup:'wipeup', wipedown:'wipedown',
  slideleft:'slideleft', slideright:'slideright', slideup:'slideup', slidedown:'slidedown',
  circlecrop:'circlecrop', rectcrop:'rectcrop', distance:'distance',
  fadeblack:'fadeblack', fadewhite:'fadewhite', radial:'radial',
  smoothleft:'smoothleft', smoothright:'smoothright', smoothup:'smoothup', smoothdown:'smoothdown',
  circleopen:'circleopen', circleclose:'circleclose',
  vertopen:'vertopen', vertclose:'vertclose', horzopen:'horzopen', horzclose:'horzclose',
  dissolve:'dissolve', pixelize:'pixelize',
  diagtl:'diagtl', diagtr:'diagtr', diagbl:'diagbl', diagbr:'diagbr',
  hlslice:'hlslice', hrslice:'hrslice', vuslice:'vuslice', vdslice:'vdslice',
  hblur:'hblur', fadegrays:'fadegrays',
  wipetl:'wipetl', wipetr:'wipetr', wipebl:'wipebl', wipebr:'wipebr',
  squeezeh:'squeezeh', squeezev:'squeezev', zoomin:'zoomin',
  fadefast:'fadefast', fadeslow:'fadeslow',
  hlwind:'hlwind', hrwind:'hrwind', vuwind:'vuwind', vdwind:'vdwind',
  coverleft:'coverleft', coverright:'coverright', coverup:'coverup', coverdown:'coverdown',
  revealleft:'revealleft', revealright:'revealright', revealup:'revealup', revealdown:'revealdown',
  slide:'slideleft', zoom:'zoomin', wipe:'wipeleft', blur:'fadeblack',
  flashwhite:'fadewhite', glitch:'hblur', zoomdrive:'zoomin',
  swipeleft:'coverleft', filmburn:'fadegrays', pixelate:'pixelize',
};

[videosDir, audiosDir, uploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// maxAge was missing here while stickers/filters/transitions below already had it -
// every filename here is unique per render (uniqueName() bakes in a timestamp and a
// UUID), so a URL's content can never change under the app - this is exactly the
// "safe to cache forever" case those already covered. Without it, the device had no
// reason to believe a repeat request for the SAME clip or voiceover - restoring a
// draft, reopening the editor, even just re-selecting a track already played once
// this session - could be served from its own cache, so every one of those was a
// full re-download from zero. 30d matches the existing convention rather than
// picking a new number; the files themselves are far more durably immutable than
// that, but this is a client-side cache, not a data-integrity promise, so matching
// what's already proven safe elsewhere in this file is enough.
app.use("/videos", express.static(videosDir, { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); res.setHeader("Accept-Ranges", "bytes"); } }));
app.use("/audios", express.static(audiosDir, { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
// Transition previews, one animated webp per catalogue entry, rendered by
// scripts/gen-transition-previews.mjs in the app repo. Immutable once written -
// a preview only changes when its recipe does, and then it gets a new render.
// Sticker artwork. Served to the picker, and read straight off this disk when a
// sticker is burned in - a sticker is the one overlay that never needs uploading,
// because the file the export composites is the file the app was already showing.
app.use("/stickers", express.static(path.join(__dirname, "public", "stickers"), { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
app.use("/filters", express.static(path.join(__dirname, "public", "filters"), { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
app.use("/transitions", express.static(path.join(__dirname, "public", "transitions"), { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
// Animated WebP tiles for the two catalogues that cannot be shown as a still. Same
// treatment as the transitions above: immutable content at a versioned URL, so a long
// max-age costs one download per tile ever.
app.use("/motions", express.static(path.join(__dirname, "public", "motions"), { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
app.use("/effects", express.static(path.join(__dirname, "public", "effects"), { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
app.use("/music", express.static(path.join(__dirname, "public", "music"), { maxAge: "30d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
// Voice previews, generated once by scripts/generate-voice-previews.py and then never
// again. Each is a fixed line in a fixed voice, so the file for a given voice can never
// change - a year is safe, and the point is that tapping play is instant instead of
// waiting on a TTS round trip.
//
// Static and outside /api on purpose, so it needs no token and no plan check: hearing a
// locked voice is how someone decides an upgrade is worth it, and a static mp3 is not a
// generation to be metered. It also keeps 325 previews off the render slots entirely.
//
// Not swept: cleanupOldFiles only walks videosDir and audiosDir. These are assets.
app.use("/previews", express.static(path.join(__dirname, "public", "previews"), { maxAge: "365d", setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));

function trackIdToDisplayName(id) {
  return id
    .replace(/^mixkit-/, "")
    .replace(/-\d+$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Mood, tempo, BPM and length per track, from scripts/analyse-music.py in the app repo.
// Read once at boot rather than per request: it is a small file that only changes when
// the library does.
//
// Without it a track is a filename, and 68 filenames in one alphabetical column is why
// the library felt like a folder rather than a music library. BPM is measured from the
// audio by onset autocorrelation; mood comes from the track's own title where it says
// something, and from the measured tempo where it does not.
let MUSIC_META = {};
try {
  MUSIC_META = JSON.parse(fs.readFileSync(path.join(__dirname, "music-meta.json"), "utf8"));
  console.log(`[music] metadata for ${Object.keys(MUSIC_META).length} tracks`);
} catch (e) {
  console.warn("[music] no music-meta.json - tracks will carry names only:", e.message);
}

app.get("/api/music-tracks", mediaProcLimiter, (req, res) => {
  try {
    const musicDir = path.join(__dirname, "public", "music");
    const files = fs.readdirSync(musicDir).filter(f => f.endsWith(".mp3"));
    const tracks = files.map(f => {
      const id = f.replace(/\.mp3$/, "");
      const m = MUSIC_META[id] || {};
      return {
        id,
        name: m.name || trackIdToDisplayName(id),
        previewUrl: `/music/${f}`,
        mood: m.mood || null,
        tempo: m.tempo || null,
        bpm: m.bpm || null,
        seconds: m.seconds || null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ tracks });
  } catch (err) {
    console.error("music-tracks error:", err.message);
    res.status(500).json({ error: "Failed to list tracks" });
  }
});
app.use("/uploads", express.static(uploadsDir, { maxAge: "30d" }));
app.use("/auth", express.static(path.join(__dirname, "public", "auth")));

exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("FFmpeg missing");
  else console.log("FFmpeg found:", stdout.split("\n")[0]);
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

app.post("/api/audio-waveform", verifyToken, mediaProcLimiter, async (req, res) => {
  const { url, samples = 80 } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  // Declared outside the try so the finally block below can clean them up
  // regardless of whether extraction succeeds or the ffmpeg call throws -
  // previously a failed extraction left wavesrc/wavepcm on disk forever.
  let srcPath, pcmPath, ownSrcPath = false;
  try {
    if (url.startsWith('http')) {
      srcPath = path.join(uploadsDir, uniqueName("wavesrc", "mp3"));
      ownSrcPath = true;
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
    } else {
      srcPath = resolveMediaPath(url);
    }

    pcmPath = path.join(uploadsDir, uniqueName("wavepcm", "raw"));
    // execFile, not exec: srcPath comes from the request body and this endpoint
    // is unauthenticated, so it must never reach a shell.
    await new Promise((resolve, reject) => {
      execFile("ffmpeg", ["-y", "-i", srcPath, "-ac", "1", "-ar", "8000", "-f", "s16le", "-acodec", "pcm_s16le", pcmPath],
        { timeout: 30000 }, (err, stdout, stderr) => {
          if (err) { console.error("Waveform ffmpeg error:", stderr?.slice(-300)); return reject(new Error("Waveform extraction failed")); }
          resolve();
        });
    });

    const buffer = fs.readFileSync(pcmPath);
    const totalSamples = buffer.length / 2;
    const blockSize = Math.max(1, Math.floor(totalSamples / samples));
    const peaks = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let sumSquares = 0;
      let count = 0;
      let peakAbs = 0;
      for (let j = 0; j < blockSize && (start + j) < totalSamples; j++) {
        const sampleVal = buffer.readInt16LE((start + j) * 2);
        sumSquares += sampleVal * sampleVal;
        const absVal = Math.abs(sampleVal);
        if (absVal > peakAbs) peakAbs = absVal;
        count++;
      }
      // Pure peak amplitude (no RMS averaging) so transients read as sharp,
      // distinct spikes matching native waveform renderers like CapCut/TikTok.
      const normalized = Math.min(1, peakAbs / 32768);
      peaks.push(Math.round(normalized * 100) / 100);
    }

    res.json({ peaks });
  } catch (e) {
    console.error("audio-waveform error:", e.message);
    const badInput = /Invalid media path|Not a stored media path|outside the allowed|unexpected characters/.test(e.message);
    res.status(badInput ? 400 : 500).json({ error: e.message });
  } finally {
    if (pcmPath) { try { fs.unlinkSync(pcmPath); } catch (e) {} }
    // Only ours to delete if we downloaded it ourselves - resolveMediaPath's
    // branch points at real stored media that must survive this request.
    if (ownSrcPath && srcPath) { try { fs.unlinkSync(srcPath); } catch (e) {} }
  }
});

app.post("/api/transcribe-voiceover", verifyToken, mediaProcLimiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    let srcPath;
    if (url.startsWith('http')) {
      srcPath = path.join(uploadsDir, uniqueName("transcribesrc", "mp3"));
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
    } else {
      srcPath = resolveMediaPath(url);
    }

    console.log('TRANSCRIBE_DEBUG srcPath=', srcPath, 'exists=', fs.existsSync(srcPath));
    const wordTimestamps = await new Promise((resolve) => {
      execFile('python3', ['/home/ahumuza/Tonefy-react/backend/whisper_align.py', srcPath],
        { timeout: 300000 }, (err, stdout, stderr) => {
          if (err) { console.error('TRANSCRIBE_DEBUG execFile error:', err.message, 'killed:', err.killed, 'signal:', err.signal, 'code:', err.code, 'stderr:', stderr?.slice(-800)); return resolve(null); }
          if (!stdout.trim()) { console.error('TRANSCRIBE_DEBUG empty stdout, stderr:', stderr?.slice(-500)); return resolve(null); }
          if (stderr) { console.log('TRANSCRIBE_DEBUG success stderr:', stderr.slice(-500)); }
          try { resolve(JSON.parse(stdout.trim())); } catch (e) { console.error('TRANSCRIBE_DEBUG JSON parse error:', e.message, 'stdout was:', stdout.slice(0,300)); resolve(null); }
        });
    });

    if (url.startsWith('http')) { try { fs.unlinkSync(srcPath); } catch (e) {} }

    if (!wordTimestamps || wordTimestamps.length === 0) {
      return res.status(422).json({ error: "No speech detected in voiceover" });
    }

    res.json({ words: wordTimestamps });
  } catch (e) {
    console.error("transcribe-voiceover error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Video Translator. Every stage of this already runs on this box and costs
// nothing: faster_whisper transcribes, Groq translates, edge-tts speaks. The
// only new thing is the wiring.
//
// Voice names are not guessed - each was taken from edge_tts.list_voices() on
// this machine, so none of them can fail at runtime as an unknown voice. Female
// voices throughout only because picking one per language keeps this a language
// choice rather than a language-and-voice choice; a voice picker is a later
// question.
const TRANSLATE_LANGS = {
  en: { label: "English",    voice: "en-US-AvaNeural" },
  es: { label: "Spanish",    voice: "es-ES-XimenaNeural" },
  fr: { label: "French",     voice: "fr-FR-VivienneMultilingualNeural" },
  de: { label: "German",     voice: "de-DE-SeraphinaMultilingualNeural" },
  pt: { label: "Portuguese", voice: "pt-BR-ThalitaMultilingualNeural" },
  it: { label: "Italian",    voice: "it-IT-ElsaNeural" },
  hi: { label: "Hindi",      voice: "hi-IN-SwaraNeural" },
  ar: { label: "Arabic",     voice: "ar-EG-SalmaNeural" },
  sw: { label: "Swahili",    voice: "sw-KE-ZuriNeural" },
  zh: { label: "Chinese",    voice: "zh-CN-XiaoxiaoNeural" },
  ja: { label: "Japanese",   voice: "ja-JP-NanamiNeural" },
  ko: { label: "Korean",     voice: "ko-KR-SunHiNeural" },
  ru: { label: "Russian",    voice: "ru-RU-SvetlanaNeural" },
  tr: { label: "Turkish",    voice: "tr-TR-EmelNeural" },
};

// Whisper is the slow stage and scales with length, and this endpoint answers
// synchronously rather than handing back a jobId, so the input has to be bounded
// or a long clip holds the request open until something upstream gives up.
const TRANSLATE_MAX_SECONDS = 300;

// --- Admin ---------------------------------------------------------------------
//
// This app had no concept of an admin until now, so the gate matters more than the
// numbers behind it. Membership comes from ADMIN_UIDS in .env - server-side, gitignored -
// and is checked against req.user.uid, which comes from the VERIFIED Firebase token.
// Never against an email or a uid in the request body: that is the exact bug that let
// media-to-video attribute renders to any uid a caller claimed (1a1084de).
//
// A non-admin gets 404 rather than 403. 403 confirms the endpoint exists and that
// someone is worth attacking; 404 says nothing at all.
const ADMIN_UIDS = String(process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
function requireAdmin(req, res, next) {
  if (!ADMIN_UIDS.length || !ADMIN_UIDS.includes(req.user?.uid)) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

// verifyToken INLINE, not inherited. app.use("/api", verifyToken) is registered further
// down the file than this route, and registration order decides which middleware a route
// gets - not its path. Without this, req.user is undefined here and requireAdmin refuses
// everyone including the admin, which is how this was caught. It failed closed, which is
// the right direction to fail, but an admin endpoint should never be one edit away from
// failing open.
app.get("/api/admin/stats", verifyToken, requireAdmin, mediaProcLimiter, async (req, res) => {
  try {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const since7 = now - 7 * DAY;
    const since30 = now - 30 * DAY;

    // Auth is the source of truth for "how many people", not the users collection:
    // a Firestore doc can be missing for an account that predates it, and one can be
    // left behind by a deleted account. Both have happened here.
    const authUsers = [];
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      authUsers.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken);

    const signups7 = authUsers.filter(u => Date.parse(u.metadata.creationTime) > since7).length;
    const signups30 = authUsers.filter(u => Date.parse(u.metadata.creationTime) > since30).length;
    const verified = authUsers.filter(u => u.emailVerified).length;
    const signedIn7 = authUsers.filter(u => u.metadata.lastSignInTime && Date.parse(u.metadata.lastSignInTime) > since7).length;

    const usersSnap = await adminDb.collection("users").get();
    const plans = { free: 0, pro: 0, creator: 0 };
    const countries = {};
    usersSnap.forEach(d => {
      const v = d.data();
      const plan = v.plan || "free";
      if (plans[plan] === undefined) plans[plan] = 0;
      plans[plan] += 1;
      if (v.country) countries[v.country] = (countries[v.country] || 0) + 1;
    });

    const videosSnap = await adminDb.collection("userVideos").get();
    let bytes = 0, videos7 = 0, videos30 = 0;
    const creators = new Set();
    videosSnap.forEach(d => {
      const v = d.data();
      bytes += Number(v.size) || 0;
      const t = Date.parse(v.createdAt || "");
      if (t > since7) videos7 += 1;
      if (t > since30) videos30 += 1;
      if (v.userId) creators.add(v.userId);
    });

    // --- Revenue --------------------------------------------------------------
    //
    // Deliberately built to be able to report ZERO. Counting anyone on a paid plan as
    // revenue would have shown "$21.98/mo" today, when in fact one subscription is a
    // licence TEST purchase - no money changed hands - and the other was set by hand in
    // the Firestore console with no purchase behind it at all. A dashboard that flatters
    // is worse than no dashboard.
    //
    // Each subscriber's stored purchaseToken is checked against Play, which is the only
    // thing that knows whether a payment was real, still active, or a test. Capped,
    // because this is one API call per subscriber on every load.
    const MONTHLY_USD = { 'pro-monthly': 6.99, 'pro-yearly': 69.99 / 12, 'creator-monthly': 14.99, 'creator-yearly': 149.99 / 12 };
    const paidDocs = usersSnap.docs.filter(d => ['pro', 'creator'].includes(d.data().plan));
    let paying = 0, testing = 0, manual = 0, lapsed = 0, mrr = 0;
    for (const d of paidDocs.slice(0, 100)) {
      const x = d.data();
      if (!x.subscriptionPurchaseToken) { manual += 1; continue; }
      try {
        const { data: sub } = await androidpublisher.purchases.subscriptionsv2.get({
          packageName: PACKAGE_NAME, token: x.subscriptionPurchaseToken,
        });
        const active = sub.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE'
          || sub.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
        if (!active) { lapsed += 1; continue; }
        if (sub.testPurchase) { testing += 1; continue; }
        paying += 1;
        mrr += MONTHLY_USD[x.subscriptionBasePlanId] || 0;
      } catch (e) {
        // A token Play will not answer for is not evidence of revenue.
        manual += 1;
      }
    }

    res.json({
      revenue: {
        paying,
        mrrUsd: Math.round(mrr * 100) / 100,
        testing,
        manual,
        // Still marked paid in Firestore but no longer active at Play - nothing revokes
        // these today, so they are worth seeing rather than quietly counting as paid.
        lapsed,
      },
      users: {
        total: authUsers.length,
        verified,
        signups7,
        signups30,
        signedIn7,
        plans,
        countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 10),
      },
      videos: {
        total: videosSnap.size,
        last7: videos7,
        last30: videos30,
        // People who have actually MADE something, which is the number that says whether
        // the app is being used rather than merely installed.
        creators: creators.size,
        storageMB: Math.round(bytes / 1024 / 1024),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("admin/stats error:", e.message);
    res.status(500).json({ error: "Could not load stats." });
  }
});

app.get("/api/translate-languages", mediaProcLimiter, (req, res) => {
  res.json({ languages: Object.entries(TRANSLATE_LANGS).map(([code, v]) => ({ code, label: v.label })) });
});

// Answers with a jobId rather than the result. Whisper is slower than realtime on
// this box - 74s of audio did not finish inside two minutes - so a five-minute clip
// is ten-plus minutes of work, which would sit past nginx's 600s proxy_read_timeout
// and past any patience the caller has. The app already polls /api/job/:jobId for
// renders, so this reuses that rather than inventing a second waiting mechanism.
// A thumbnail: one frame of a video, with a headline burned into it.
//
// The text goes through createTextRenderer - the SAME code that burns captions into an
// export - so a thumbnail's stroke, glow, shadow, box and tracking are the app's caption
// styles rather than a second interpretation of them. That was the whole reason the
// renderer was extracted; a lookalike here would drift from the export the first time
// either got a fix.
//
// Synchronous. One frame extract plus one overlay render is a couple of seconds, well
// inside nginx's 600s window, so no job and no render slot.
const THUMB_SIZES = {
  '16:9':  { w: 1280, h: 720 },   // YouTube
  '9:16':  { w: 720,  h: 1280 },  // Shorts / TikTok / Reels
  '1:1':   { w: 1080, h: 1080 },  // feed
};

app.post("/api/thumbnail", verifyToken, mediaProcLimiter, async (req, res) => {
  const { url, atSeconds = 0, aspectRatio = '16:9', textOverlays = [], previewWidth } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  const size = THUMB_SIZES[aspectRatio] || THUMB_SIZES['16:9'];

  const scratch = [];
  try {
    let srcPath;
    if (url.startsWith("http")) {
      if (!isOwnMediaUrl(url)) {
        return res.status(400).json({ error: "That media is not on this server." });
      }
      srcPath = path.join(uploadsDir, uniqueName("thumbsrc", "mp4"));
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
      scratch.push(srcPath);
    } else {
      srcPath = resolveMediaPath(url);
    }
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: "That media could not be found on the server." });
    }

    // The frame, scaled and cropped to fill the thumbnail rather than letterboxed - a
    // thumbnail with black bars down the side is not one anybody would publish.
    // -ss before -i so ffmpeg seeks rather than decoding up to the timestamp; a
    // thumbnail from four minutes in should not cost four minutes of decoding.
    const at = Math.max(0, num(atSeconds, 0));
    const framePng = path.join(uploadsDir, uniqueName("thumbframe", "png"));
    scratch.push(framePng);
    // -ss is omitted entirely at 0, which is what makes a STILL IMAGE work as a source.
    // A photo has exactly one frame, and `-ss 0` before `-i` seeks past it: ffmpeg exits
    // 0 having written nothing, so the only symptom is a missing file. For a video,
    // seeking to 0 and not seeking are the same thing, so nothing changes there.
    const seek = at > 0 ? ["-ss", String(at)] : [];
    await run("ffmpeg", ["-y", ...seek, "-i", srcPath, "-frames:v", "1",
      "-vf", `scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h}`,
      framePng], { timeout: 120000 });
    if (!fs.existsSync(framePng)) {
      // Seeking past the end of the file produces no frame and no error.
      return res.status(400).json({ error: "There is no frame at that moment in this video." });
    }

    let composed = framePng;
    if (Array.isArray(textOverlays) && textOverlays.length > 0) {
      const renderer = createTextRenderer({
        W: size.w, H: size.h,
        exportScale: size.w / (previewWidth || 360),
        uploadsDir,
        fontsDir: path.join(__dirname, 'fonts'),
        fontFileMap: loadFontFileMap(),
        run, uniqueName, mapWithConcurrency, num, safeColor,
      });
      const rendered = await renderer.render(textOverlays);
      // One composite per overlay. The export builds an ffmpeg filtergraph instead
      // because it is placing these onto a moving picture with timing; a still needs
      // neither, and `composite` is the cheaper tool for it.
      for (const { outPng, placeX, placeY } of rendered) {
        const next = path.join(uploadsDir, uniqueName("thumbcomp", "png"));
        await run("composite", ["-geometry", `+${placeX}+${placeY}`, outPng, composed, next],
          { timeout: 60000 });
        if (composed !== framePng) { try { fs.unlinkSync(composed); } catch (e) {} }
        try { fs.unlinkSync(outPng); } catch (e) {}
        composed = next;
        scratch.push(next);
      }
    }

    // JPEG, not PNG: a thumbnail is a photograph with text on it, and every platform
    // that takes one re-encodes it anyway. quality 92 is visually lossless here and
    // roughly a tenth of the PNG.
    const outName = uniqueName("thumbnail", "jpg");
    const outPath = path.join(videosDir, outName);
    await run("convert", [composed, "-quality", "92", outPath], { timeout: 60000 });

    // The source's length goes back with it, because the app cannot rely on having it:
    // only two of the three userVideos writers store durationSeconds, and the one that
    // does not is Idea-to-Video - which is where most of these videos come from. Without
    // this the frame slider has no range to offer and every thumbnail is frame zero.
    const durationSeconds = await probeDurationSeconds(srcPath).catch(() => 0);
    res.json({ thumbnailUrl: `/videos/${outName}`, width: size.w, height: size.h, durationSeconds });
  } catch (e) {
    console.error("[thumbnail]", e.message);
    res.status(500).json({ error: "Could not make a thumbnail from this video." });
  } finally {
    for (const f of scratch) { try { fs.unlinkSync(f); } catch (e) {} }
  }
});

// Beat times for an audio track, so cuts can land on the beat instead of near it.
//
// Returns a GRID, not raw onsets. A grid is what a musician means by "the beat" and what
// a cut wants to land on; raw onsets include every snare flam and vocal consonant, and
// cutting to those looks nervous rather than rhythmic.
//
// `strength` is how periodic the audio actually turned out to be. It is reported rather
// than used as a gate here, because the honest answer for spoken word is "there is no
// beat in this" and the caller is better placed to say so than a 400 is.
//
// Synchronous: 5-7 seconds for a full track, measured on this box, against nginx's 600s
// proxy_read_timeout. No credits and no plan gate - it produces no video and spends
// almost nothing.
app.post("/api/detect-beats", verifyToken, mediaProcLimiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });

  const scratch = [];
  try {
    let srcPath;
    if (url.startsWith("http")) {
      if (!isOwnMediaUrl(url)) {
        return res.status(400).json({ error: "That media is not on this server." });
      }
      srcPath = path.join(uploadsDir, uniqueName("beatsrc", "mp3"));
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
      scratch.push(srcPath);
    } else {
      srcPath = resolveMediaPath(url);
    }
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: "That track could not be found on the server." });
    }

    const out = await new Promise((resolve) => {
      execFile("python3", [path.join(__dirname, "detect_beats.py"), srcPath],
        { timeout: 180000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
          if (err || !String(stdout).trim()) return resolve(null);
          try { resolve(JSON.parse(String(stdout).trim())); } catch (e) { resolve(null); }
        });
    });
    if (!out) return res.status(500).json({ error: "Could not analyse this track." });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    console.error("[detect-beats]", e.message);
    res.status(500).json({ error: "Could not analyse this track." });
  } finally {
    for (const f of scratch) { try { fs.unlinkSync(f); } catch (e) {} }
  }
});

// Pull a clip's sound out into a file of its own, so it can live on the timeline as an
// audio track - draggable, trimmable, fadeable, and able to outlive the clip it came from.
//
// Synchronous, unlike /api/translate-video which this otherwise mirrors. That one returns
// a jobId because whisper runs SLOWER THAN REALTIME (measured: 74s of audio did not finish
// inside two minutes), so a five-minute clip would sail past nginx's 600s proxy_read_timeout.
// This is a straight demux-and-encode with no model in it - a few seconds for a long clip -
// so a job, a poller and a render slot would all be machinery around nothing.
//
// No credit charge and no plan gate: this spends almost nothing and produces no video.
// It is the kind of thing that being metered would make people avoid using.
app.post("/api/extract-audio", verifyToken, mediaProcLimiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });

  const scratch = [];
  try {
    let srcPath;
    if (url.startsWith("http")) {
      if (!isOwnMediaUrl(url)) {
        // Fetching an arbitrary caller-supplied URL server-side is an SSRF, and this
        // server sits on a VPS with other services on localhost.
        return res.status(400).json({ error: "That media is not on this server." });
      }
      srcPath = path.join(uploadsDir, uniqueName("extractsrc", "mp4"));
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
      scratch.push(srcPath);
    } else {
      srcPath = resolveMediaPath(url);
    }
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: "That clip could not be found on the server." });
    }

    // Probe for an audio stream FIRST. Without this, a silent clip returns a valid but
    // empty mp3 and the user gets a track on the timeline that plays nothing, with no
    // explanation - a worse outcome than being told the clip has no sound.
    const streams = await run("ffprobe", ["-v", "error", "-select_streams", "a",
      "-show_entries", "stream=codec_type", "-of", "csv=p=0", srcPath], { timeout: 30000 })
      .catch(() => "");
    if (!String(streams).includes("audio")) {
      return res.status(400).json({ error: "This clip has no sound to extract." });
    }

    const outName = uniqueName("extracted", "mp3");
    const outPath = path.join(audiosDir, outName);
    // 192k stereo: this becomes a real track the user may keep after deleting the clip,
    // so it should not be the last generation at which quality still mattered.
    await run("ffmpeg", ["-y", "-i", srcPath, "-vn", "-c:a", "libmp3lame",
      "-b:a", "192k", "-ar", "44100", outPath], { timeout: 180000 });

    const durationSeconds = await probeDurationSeconds(outPath).catch(() => 0);
    res.json({ audioUrl: `/audios/${outName}`, durationSeconds });
  } catch (e) {
    console.error("[extract-audio]", e.message);
    res.status(500).json({ error: "Could not extract the audio from this clip." });
  } finally {
    // The txtrender-*.png leak (aaa0f043) is the precedent: a scratch file with no
    // unlink grows without bound and nobody notices until the disk does.
    for (const f of scratch) { try { fs.unlinkSync(f); } catch (e) {} }
  }
});

app.post("/api/translate-video", verifyToken, mediaProcLimiter, async (req, res) => {
  const { url, targetLang } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  const lang = TRANSLATE_LANGS[targetLang];
  if (!lang) return res.status(400).json({ error: "Unsupported language." });

  // A paid feature, checked here and not only in the app - the toolbar entry is
  // premium: true, and the app's gate is a convenience, not the enforcement.
  const { plan } = await getUserPlanData(adminDb, req.user?.uid);
  if (plan === "free") {
    return res.status(403).json({ error: "Translating a video is available on the Pro and Creator plans." });
  }

  const jobId = createJob(req.user.uid);
  res.json({ jobId });

  // Whisper is as CPU-hungry as a render and would otherwise compete with them
  // unbounded, so it queues in the same 4 slots. Released in a finally for the same
  // reason the render paths are - a leaked slot never comes back.
  updateJob(jobId, { message: "Waiting for a free slot..." });
  await acquireVideoSlot(tierConfig(plan).queuePriority > 0);

  const scratch = [];
  try {
    updateJob(jobId, { progress: 5, message: "Loading clip..." });
    let srcPath;
    if (url.startsWith("http")) {
      srcPath = path.join(uploadsDir, uniqueName("translatesrc", "mp4"));
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
      scratch.push(srcPath);
    } else {
      srcPath = resolveMediaPath(url);
    }
    if (!fs.existsSync(srcPath)) throw new Error("That clip could not be found on the server.");

    const durationSeconds = await probeDurationSeconds(srcPath).catch(() => 0);
    if (durationSeconds > TRANSLATE_MAX_SECONDS) {
      throw new Error(`Translation works on clips up to ${Math.round(TRANSLATE_MAX_SECONDS / 60)} minutes. This one is about ${Math.max(1, Math.round(durationSeconds / 60))}.`);
    }

    // 16kHz mono is what whisper resamples to anyway, so handing it that directly is
    // less work for it and a far smaller file than the source.
    updateJob(jobId, { progress: 15, message: "Extracting audio..." });
    const audioPath = path.join(uploadsDir, uniqueName("translateaud", "mp3"));
    scratch.push(audioPath);
    await run("ffmpeg", ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", audioPath], { timeout: 120000 });

    updateJob(jobId, { progress: 30, message: "Listening to the speech..." });
    const words = await new Promise((resolve) => {
      execFile("python3", ["/home/ahumuza/Tonefy-react/backend/whisper_align.py", audioPath],
        { timeout: 900000 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null);
          try { resolve(JSON.parse(stdout.trim())); } catch (e) { resolve(null); }
        });
    });
    if (!words || !words.length) throw new Error("No speech was found in this clip.");

    const sourceText = words.map(w => w.word ?? w.text ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (!sourceText) throw new Error("No speech was found in this clip.");

    updateJob(jobId, { progress: 60, message: `Translating to ${lang.label}...` });
    const translated = (await callLLM({
      system: `You are a translator. Translate the user's text into ${lang.label}. Reply with ONLY the translation - no preamble, no notes, no quotation marks, no explanation. Preserve the tone and keep it natural to speak aloud.`,
      user: sourceText,
      // Translations run longer than the 400-token default this helper assumes, and a
      // truncated one would be read aloud as though it were the whole script. Some
      // languages also tokenize far less efficiently than English.
      max_tokens: 2000,
      // Near-zero: this is a translation, not a piece of writing. The helper's 0.8
      // default is tuned for generating scripts.
      temperature: 0.2,
    }) || "").trim();
    if (!translated) throw new Error("The translation service did not respond. Please try again.");

    updateJob(jobId, { progress: 80, message: `Speaking ${lang.label}...` });
    const outName = uniqueName("translated", "mp3");
    const outPath = path.join(audiosDir, outName);
    await run("python3", ["/home/ahumuza/Tonefy-react/backend/edge_tts_generate.py", translated, outPath, lang.voice], { timeout: 300000 });

    const spokenSeconds = await probeDurationSeconds(outPath).catch(() => 0);
    updateJob(jobId, {
      status: "done", progress: 100, message: "Translation ready!",
      audioUrl: `/audios/${outName}`,
      language: targetLang,
      languageLabel: lang.label,
      sourceText,
      translatedText: translated,
      durationSeconds: spokenSeconds,
    });
  } catch (e) {
    console.error("translate-video error:", e.message);
    updateJob(jobId, { status: "error", error: e.message });
  } finally {
    for (const f of scratch) { try { fs.unlinkSync(f); } catch (er) {} }
    releaseVideoSlot();
  }
});

app.use(express.urlencoded({ extended: true }));
// The mobile app never sends an Origin header at all (CORS is a browser
// mechanism; native fetch doesn't set one), so this only ever matters for
// tonefy-ai.fitlifesolutions.site, the one real browser-based caller -
// confirmed by grepping the live site's own JS for its API base URL and
// checking for a www/bare-domain variant, neither of which exist. Bearer-
// token auth (no cookies) already meant a wildcard origin couldn't be used
// to ride a victim's session, but restricting it is still real hardening
// for anything unauthenticated a malicious page could otherwise read
// cross-origin via a visitor's browser.
app.use(cors({ origin: "https://tonefy-ai.fitlifesolutions.site", methods: ["GET", "POST", "OPTIONS"] }));
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });
// Global rate limit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: limitKey,
  validate: { xForwardedForHeader: false }
}));

// Protect all /api/* routes — TikTok OAuth routes stay public
app.use("/api", verifyToken);

// Replaces the app's own sendEmailVerification() call - see verifyEmailHtml's
// comment for why. uid/email come from the verified token, never the request
// body, the same lesson the media-to-video/edit-video userId bug already
// taught this file (1a1084de/975e73a3) - a client-supplied email here would
// let anyone request a verification link for an address that isn't theirs.
app.post("/api/send-verification-email", emailLimiter, async (req, res) => {
  if (!emailTransporter) return res.status(503).json({ error: "Email is not configured" });
  try {
    const userRecord = await getAuth().getUser(req.user.uid);
    if (!userRecord.email) return res.status(400).json({ error: "Account has no email" });
    const link = await getAuth().generateEmailVerificationLink(userRecord.email);
    await emailTransporter.sendMail({
      from: `"Tonefy AI" <${process.env.EMAIL_USER}>`,
      to: userRecord.email,
      subject: "Verify your email for Tonefy AI",
      html: verifyEmailHtml(userRecord.displayName, link),
    });
    res.json({ success: true });
  } catch (e) {
    console.error("send-verification-email error:", e.message);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});

// Verifies a Play Billing subscription purchase server-side before trusting
// it - a client-reported "I paid" is exactly what a client shouldn't be
// trusted to self-report, the same lesson item 13's userId bug already
// taught this file. uid comes from the verified token, never the request
// body. subscriptionsv2.get is the current (non-deprecated) status API;
// acknowledge is still a v3-only call, kept separate below.
app.post("/api/verify-purchase", mediaProcLimiter, async (req, res) => {
  const { purchaseToken, productId } = req.body || {};
  const uid = req.user.uid;
  if (!purchaseToken || !productId) {
    return res.status(400).json({ ok: false, error: "Missing purchaseToken or productId" });
  }

  try {
    const { data: sub } = await androidpublisher.purchases.subscriptionsv2.get({
      packageName: PACKAGE_NAME,
      token: purchaseToken,
    });

    const state = sub.subscriptionState;
    if (state !== "SUBSCRIPTION_STATE_ACTIVE" && state !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
      return res.status(400).json({ ok: false, error: `Subscription is not active (${state}).` });
    }

    const basePlanId = sub.lineItems?.[0]?.offerDetails?.basePlanId || sub.lineItems?.[0]?.autoRenewingPlan?.basePlanId;
    const plan = planFromBasePlanId(basePlanId);
    if (!plan) {
      return res.status(400).json({ ok: false, error: "Could not determine plan from this purchase." });
    }

    // subscriptionsv2.get keeps returning ACTIVE for the entire billing
    // period, not just once - without this, replaying the same still-valid
    // purchaseToken (the client's own retry logic, or a direct API call)
    // would reset creditsRemaining back to full every time, indefinitely,
    // from a single real payment. .create() on a doc keyed by a hash of the
    // token is an atomic claim: it fails if this exact token was already
    // processed for this user, so a genuine double-call (e.g. a network
    // retry before the first response landed) is a safe no-op rather than
    // a second free grant.
    const purchaseId = crypto.createHash('sha256').update(purchaseToken).digest('hex');
    const purchaseRef = adminDb.collection("users").doc(uid).collection("processedPurchases").doc(purchaseId);
    try {
      await purchaseRef.create({ processedAt: new Date().toISOString(), productId, basePlanId, plan });
    } catch (claimErr) {
      if (claimErr.code === 6 /* ALREADY_EXISTS */) {
        return res.json({ ok: true, plan });
      }
      throw claimErr;
    }

    const creditsResetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await adminDb.collection("users").doc(uid).set({
      plan,
      creditsRemaining: PLAN_CREDITS[plan],
      creditsResetAt,
      subscriptionProductId: productId,
      subscriptionPurchaseToken: purchaseToken,
      subscriptionBasePlanId: basePlanId,
    }, { merge: true });

    // Google auto-refunds an unacknowledged purchase after 3 days - the
    // client also calls finishTransaction, this is belt-and-suspenders in
    // case that call never lands (app killed, network drop mid-purchase).
    try {
      await androidpublisher.purchases.subscriptions.acknowledge({
        packageName: PACKAGE_NAME,
        subscriptionId: productId,
        token: purchaseToken,
        requestBody: {},
      });
    } catch (ackErr) {
      // Already acknowledged is the expected case on the client's own
      // finishTransaction beating this call - not a real failure.
      console.log("[verify-purchase] acknowledge:", ackErr.message);
    }

    res.json({ ok: true, plan });
  } catch (e) {
    console.error("[verify-purchase] error:", e.message);
    res.status(500).json({ ok: false, error: "Could not verify this purchase." });
  }
});

function uniqueName(prefix, ext) { return `${prefix}-${Date.now()}-${uuidv4()}.${ext}`; }

// Anything built from a request must not reach a shell. run() spawns the binary
// directly with an argument vector, so a quote, a semicolon or a $(...) in a
// caption or a filename is just a character in an argument.
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args.map(String), { timeout: 30000, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}

// N workers pulling from a shared index, rather than one item at a time - for
// a highlight-style caption's one-still-per-word rendering, where a normal-
// length voiceover means hundreds of items, each paying real `convert`
// process-spawn overhead (several invocations per item) on top of whatever
// actual image work each one does. Every item still runs to completion and
// results land at their own index regardless of finishing order, so this
// changes nothing about correctness or output - only how much of that spawn
// overhead overlaps instead of stacking up sequentially.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ImageMagick colour arguments: hex or a plain colour name, nothing else.
function safeColor(value, fallback = '#ffffff') {
  const v = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{1,20}$/.test(v) ? v : fallback;
}
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// ASS wants &HAABBGGRR: the channels run backwards from CSS, and so does alpha -
// 00 is fully opaque there and FF is invisible, the opposite of an #RRGGBBAA.
function assColour(hex, fallback = '&H00FFFFFF') {
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(String(hex ?? '').trim());
  if (!m) return fallback;
  const rgb = m[1];
  const alpha = m[2] ? (255 - parseInt(m[2], 16)) : 0;
  return ('&H' + alpha.toString(16).padStart(2, '0')
    + rgb.slice(4, 6) + rgb.slice(2, 4) + rgb.slice(0, 2)).toUpperCase();
}

// libass resolves Fontname through fontconfig, which does not know the families
// this app ships. Without the directory every custom face silently becomes
// DejaVu Sans - it renders, it just renders in the wrong typeface.
const ASS_FONTS_DIR = path.join(__dirname, 'fonts');
function assFilter(assPath) {
  return `ass='${assPath.replace(/'/g, "\\'")}':fontsdir='${ASS_FONTS_DIR.replace(/'/g, "\\'")}'`;
}

// The burn-in path gets the same style spec the app previews and the ImageMagick
// export honours, so all three agree. ASS has native outline, box, shadow and
// tracking, which covers everything a spec carries except a gradient fill - that
// falls back to the first stop, since per-glyph colour tags cannot coexist with
// the karaoke timing tags this file already emits.
function assStyleFromSpec(meta) {
  const fontsize = Math.max(8, Math.round(num(meta.size, 26) * 1.6));
  const scale = fontsize / 18;
  const spec = meta.spec || {};
  const hasBox = !!spec.box;
  return {
    fontname: meta.font || 'Arial',
    fontsize,
    bold: 0,
    italic: 0,
    primary: assColour(meta.color, '&H00FFFFFF'),
    // BorderStyle 3 repurposes the outline colour as the box fill, so a style
    // cannot have both a chip and a ring; the chip wins, as it does in the app
    // where the ring would be hidden behind it anyway.
    outline: hasBox ? assColour(spec.box.color, '&H80000000')
      : (spec.stroke ? assColour(spec.stroke.color, '&H00000000') : '&H00000000'),
    back: hasBox ? assColour(spec.box.color, '&H80000000') : '&H80000000',
    outline_w: hasBox ? Math.max(2, Math.round(num(spec.box.padX, 8) * scale * 0.5))
      : (spec.stroke ? Math.max(1, Math.round(num(spec.stroke.width) * scale)) : 0),
    shadow: spec.shadow ? Math.max(0, Math.round(Math.max(num(spec.shadow.dx), num(spec.shadow.dy)) * scale)) : 0,
    alignment: 2,
    marginV: 80,
    spacing: spec.spacing ? Number((num(spec.spacing) * scale).toFixed(1)) : 0,
    borderStyle: hasBox ? 3 : 1,
    transform: meta.upper ? (t => t.toUpperCase()) : (t => t),
  };
}

async function downloadToFile(url, outPath, headers = {}) {
  const res = await fetch(url, { headers, timeout: 60000 });
  if (!res.ok) throw new Error(`Download failed ${url}: ${res.status}`);
  const fileStream = fs.createWriteStream(outPath);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
  return outPath;
}

function pickBestMp4(videoObj) {
  if (!videoObj?.video_files) return null;
  const mp4s = videoObj.video_files.filter(f => f.file_type === "video/mp4" && f.link);
  if (!mp4s.length) return null;
  return (mp4s.find(f => f.quality === "hd") || mp4s.find(f => f.quality === "sd") || mp4s[0]).link;
}

function isHttpUrl(s) { return typeof s === "string" && /^https?:\/\//i.test(s); }

// Retention promise: free users keep 72h, paid users (any plan other than
// "free") keep 30 days. Both live on this VPS's disk - there's no permanent
// tier yet. Upgrading that promise later (e.g. to real cloud storage) is
// easy; downgrading one already made to a paying user is not, which is why
// free stays exactly what it's always been rather than shrinking to make
// room for the paid tier.
const FREE_RETENTION_MS = 72 * 60 * 60 * 1000;
const PAID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A video file's owning user's plan, via userVideos.userId -> users/{uid}.plan.
// Always resolves to a plan string - 'free' when there's genuinely no owner to
// protect (no matching record, no userId, no user doc, no plan field) - and
// throws only when the lookup itself failed (a real Firestore error), which
// callers must treat as paid, not as free: deleting someone's video because
// Firestore blipped is a far worse failure than holding a file one extra
// 10-minute cycle.
//
// This is also where a future subscription-lapse grace period hooks in: once
// billing exists and a plan can lapse, that check belongs here, as another
// reason (alongside "lookup failed") to keep treating someone as paid for a
// while rather than reclassifying them as free the instant a payment fails.
async function getOwnerPlan(filename) {
  const snap = await adminDb.collection('userVideos').where('filename', '==', filename).get();
  if (snap.empty) return 'free';
  const userId = snap.docs[0].data().userId;
  if (!userId) return 'free';
  const userDoc = await adminDb.collection('users').doc(userId).get();
  if (!userDoc.exists) return 'free';
  return userDoc.data().plan || 'free';
}

async function cleanupOldFiles(dir, maxAgeMs = FREE_RETENTION_MS) {
  fs.readdir(dir, async (err, files) => {
    if (err) return;
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stats = await fs.promises.stat(filePath);
        const ageMs = now - stats.mtimeMs;
        // Not even old enough for the free tier - never worth a Firestore
        // lookup, and this keeps every sweep cheap for the common case.
        if (ageMs <= maxAgeMs) continue;

        let effectiveMaxAgeMs = maxAgeMs;
        const isVideoFile = dir === videosDir && (file.endsWith('.mp4') || file.endsWith('.ass'));
        if (isVideoFile) {
          try {
            const plan = await getOwnerPlan(file);
            effectiveMaxAgeMs = plan === 'free' ? FREE_RETENTION_MS : PAID_RETENTION_MS;
          } catch (e) {
            console.error(`[Cleanup] Plan lookup failed for ${file}, holding this cycle:`, e.message);
            continue;
          }
        }
        if (ageMs <= effectiveMaxAgeMs) continue;

        await fs.promises.unlink(filePath);
        // If it's a video file, delete matching Firestore record
        if (isVideoFile) {
          try {
            const snap = await adminDb.collection('userVideos').where('filename', '==', file).get();
            for (const doc of snap.docs) {
              await doc.ref.delete();
              console.log(`[Cleanup] Deleted Firestore record for ${file}`);
            }
          } catch (e) {
            console.error(`[Cleanup] Firestore delete failed for ${file}:`, e.message);
          }
        }
      } catch (e) {}
    }
  });
}

// Scratch files created mid-render (waveform extraction sources, transcription
// copies, composited text-overlay PNGs) - see the request handlers that build
// each prefix for why it exists. Every one of these is meant to be unlinked
// right after the request that made it finishes; this sweep is a backstop for
// the error paths that skip their own cleanup, not the primary mechanism.
// 48h rather than the video tiers below: nothing legitimate ever references
// one of these past a single request's lifetime.
const SCRATCH_PREFIXES = ['wavesrc-', 'wavepcm-', 'transcribesrc-', 'captionsrc-', 'txtrender-'];
const SCRATCH_RETENTION_MS = 48 * 60 * 60 * 1000;

// Genuine user uploads (/api/upload-media) back an in-progress editor draft,
// and the app's own draft storage (utils/draft.js) has no expiry of its own -
// a draft can be offered for restore regardless of age. 30 days is
// deliberately generous and NOT tied to the video retention tiers above:
// unlike finished videos, uploads have no per-file owner record the way
// userVideos does, so this can't be made plan-aware without adding that
// bookkeeping first. Erring generous - breaking someone's in-progress draft
// is worse than the disk cost of holding an upload longer than it turns out
// to be needed.
const UPLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function cleanupUploads() {
  fs.readdir(uploadsDir, async (err, files) => {
    if (err) return;
    const now = Date.now();
    for (const file of files) {
      const isScratch = SCRATCH_PREFIXES.some(p => file.startsWith(p));
      const maxAgeMs = isScratch ? SCRATCH_RETENTION_MS : UPLOAD_RETENTION_MS;
      const filePath = path.join(uploadsDir, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
        }
      } catch (e) {}
    }
  });
}

// Monthly credit reset - resets creditsRemaining to the account's own tier
// allocation once creditsResetAt has passed.
//
// Interim behaviour, applies to EVERY plan for now, not just free: there is
// no other mechanism driving a paid account's reset yet. The original design
// (proposed when Stripe was the assumed provider) was free-only-via-cron,
// paid-driven-by-webhooks-on-the-real-renewal-date - correct once Play
// Billing (Phase 2, not built) exists, since a generic sweep drifting out
// of sync with an actual billing period is exactly the mismatch subscribers
// notice. Until then, a paid-only-via-webhook design would mean paid
// accounts (including hand-set test ones) never reset via ANY mechanism at
// all. When Phase 2 lands, narrow this query to plan == 'free' and let Play's
// RTDN/purchase-verification flow own paid resets - this sweep should stop
// touching paid accounts at that point, not keep double-driving them.
async function creditResetSweep() {
  const nowIso = new Date().toISOString();
  const snap = await adminDb.collection('users').where('creditsResetAt', '<=', nowIso).get();
  for (const doc of snap.docs) {
    const plan = doc.data().plan || 'free';
    const creditsRemaining = tierConfig(plan).creditsPerCycle;
    const creditsResetAt = new Date(Date.now() + FREE_RESET_MS).toISOString();
    try {
      await doc.ref.set({ creditsRemaining, creditsResetAt }, { merge: true });
      console.log(`[CreditReset] ${doc.id} (${plan}) -> ${creditsRemaining} credits, next reset ${creditsResetAt}`);
    } catch (e) {
      console.error(`[CreditReset] Failed for ${doc.id}:`, e.message);
    }
  }
}

// Take a paid plan away once Play says it has ended.
//
// Nothing did this. A subscription that expired stayed `plan: pro` in Firestore for
// ever, with Pro credits, Pro export length and no watermark - because the plan field
// was only ever WRITTEN at purchase and never checked again. Found in real data: the
// owner's own Pro subscription expired on 15 Aug 2026 and the account was still Pro
// three days later. Harmless while the only subscriber is the owner on a test purchase;
// the moment someone pays and cancels, they keep everything for nothing, and nobody
// finds out.
//
// Entitlement, per Play's own model rather than by feel:
//   ACTIVE, IN_GRACE_PERIOD              -> entitled
//   CANCELED with an expiry still ahead  -> entitled. Cancelling turns auto-renew off;
//                                           the subscription runs to the date paid for,
//                                           and taking it away early is theft.
//   EXPIRED, ON_HOLD, PAUSED, PENDING    -> ended, downgrade
//   anything else, including a state Play
//   has not invented yet                 -> left alone
//
// Fail-safe direction is deliberate and matches checkRenderAllowed: if the Play lookup
// THROWS, nothing is revoked. A transient API error or an expired credential must never
// strip a paying customer of what they bought. The cost of being wrong in that
// direction is a few days of free service; the other direction is a refund and a review.
const SUBSCRIPTION_SWEEP_MS = 6 * 60 * 60 * 1000;

// States that positively mean "this has ended". Anything NOT on this list is left
// alone, including a state Play has not invented yet - the opposite default would let a
// future addition to their enum silently strip every paying subscriber, which is the one
// failure here that cannot be undone by waiting.
const ENDED_STATES = new Set([
  'SUBSCRIPTION_STATE_EXPIRED',
  'SUBSCRIPTION_STATE_ON_HOLD',            // payment failed and the retries ran out
  'SUBSCRIPTION_STATE_PAUSED',             // user-initiated pause
  'SUBSCRIPTION_STATE_PENDING',            // never completed - was never entitlement
  'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED',
]);

function playSaysEnded(sub) {
  const state = sub?.subscriptionState;
  // Cancelled is not ended. Cancelling turns auto-renew off; the subscription runs to
  // the date already paid for, and taking it away early is theft.
  if (state === 'SUBSCRIPTION_STATE_CANCELED') {
    const expiry = Date.parse(sub?.lineItems?.[0]?.expiryTime || '');
    return Number.isFinite(expiry) && expiry <= Date.now();
  }
  return ENDED_STATES.has(state);
}

async function subscriptionSweep() {
  let snap;
  try {
    snap = await adminDb.collection('users').where('plan', 'in', ['pro', 'creator']).get();
  } catch (e) {
    console.error('[SubSweep] could not read paid accounts:', e.message);
    return;
  }

  for (const doc of snap.docs) {
    const v = doc.data();
    // No token means nobody bought it - a comp account, or one set by hand in the
    // console. Those are deliberate and are not Play's to expire.
    if (!v.subscriptionPurchaseToken) continue;

    // An admin's Creator comes from being an admin, not from a purchase. The owner
    // does hold a real expired token, so without this the sweep would keep taking the
    // plan back every six hours and testing any gated feature would mean re-granting
    // it by hand first.
    if (isAdminUid(doc.id)) continue;

    let sub;
    try {
      const { data } = await androidpublisher.purchases.subscriptionsv2.get({
        packageName: PACKAGE_NAME, token: v.subscriptionPurchaseToken,
      });
      sub = data;
    } catch (e) {
      console.warn(`[SubSweep] ${doc.id}: Play lookup failed, leaving plan alone -`, e.message?.slice(0, 90));
      continue;
    }

    if (!playSaysEnded(sub)) continue;

    // Credits are clamped rather than zeroed. Someone who paid for this cycle may have
    // credits left from it, and taking those away as well would be punishing them for
    // the subscription ending rather than simply ending it.
    const freeCredits = tierConfig('free').creditsPerCycle;
    const kept = Math.min(Number(v.creditsRemaining) || 0, freeCredits);
    try {
      await doc.ref.set({
        plan: 'free',
        creditsRemaining: kept,
        subscriptionStatus: 'expired',
        subscriptionEndedAt: new Date().toISOString(),
        // Kept, not deleted: it is the evidence of what happened, and re-subscribing
        // writes a new one anyway.
        subscriptionLastState: sub.subscriptionState || 'unknown',
      }, { merge: true });
      console.log(`[SubSweep] ${doc.id}: ${v.plan} -> free (${sub.subscriptionState}), credits ${v.creditsRemaining} -> ${kept}`);
    } catch (e) {
      console.error(`[SubSweep] ${doc.id}: could not downgrade -`, e.message);
    }
  }
}

setInterval(() => {
  cleanupOldFiles(videosDir);
  cleanupOldFiles(audiosDir);
  cleanupUploads();
  creditResetSweep();
}, 10 * 60 * 1000);

// Its own timer, six-hourly rather than ten-minutely: this one costs a Play API call per
// subscriber, and a subscription that ended does not need catching within ten minutes.
setInterval(subscriptionSweep, SUBSCRIPTION_SWEEP_MS);
// Once at startup too, so a deploy picks up anything that lapsed while it was down.
subscriptionSweep();

function buildCaptionFilter(script, audioDuration) {
  // Split script into short chunks of ~5 words each
  const words = script.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const chunkSize = 5;
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  if (chunks.length === 0) return '';
  const timePerChunk = audioDuration / chunks.length;
  const filters = chunks.map((chunk, i) => {
    const start = (i * timePerChunk).toFixed(2);
    const end = ((i + 1) * timePerChunk).toFixed(2);
    // Escape special chars for FFmpeg drawtext
    const safe = chunk.replace(/'/g, "’").replace(/:/g, "\:").replace(/\\/g, '\\\\');
    return `drawtext=text='${safe}':fontsize=20:fontcolor=white:bordercolor=black:borderw=2:x=(w-text_w)/2:y=h-th-40:enable='between(t,${start},${end})'`;
  });
  return filters.join(',');
}
function buildAssFile(script, audioDuration, assPath, captionStyle, wordTimestamps = null, captionMeta = null, videoWidth = 720, videoHeight = 1280) {
  const words = script.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Use whisper word timestamps if available, otherwise estimate
  // chunkWordTimings mirrors chunks/chunkTimings one level deeper - the
  // {word,start,end} of every word inside that chunk - so a highlight style
  // (see below) knows when to switch which word is coloured without
  // re-deriving timing from scratch.
  let chunks, chunkTimings, chunkWordTimings;
  if (wordTimestamps && wordTimestamps.length > 0) {
    // Animated styles: one word per line with exact timing
    const ANIMATED = ['highlight','sticker','shadow3d','tiktok','neon','fire','bold','purple'];
    const perWord = captionMeta && captionMeta.words
      ? captionMeta.words === 1
      : ANIMATED.includes(captionStyle);
    if (perWord) {
      chunks = wordTimestamps.map(w => w.word);
      chunkTimings = wordTimestamps.map(w => ({ start: w.start, end: w.end }));
      chunkWordTimings = wordTimestamps.map(w => [w]);
    } else {
      // Group into the style's own chunk size using whisper timing
      const per = Math.max(1, (captionMeta && captionMeta.words) || 3);
      chunks = [];
      chunkTimings = [];
      chunkWordTimings = [];
      for (let i = 0; i < wordTimestamps.length; i += per) {
        const group = wordTimestamps.slice(i, i + per);
        chunks.push(group.map(w => w.word).join(' '));
        chunkTimings.push({ start: group[0].start, end: group[group.length-1].end });
        chunkWordTimings.push(group);
      }
    }
  } else {
    // Fallback: estimate timing
    const chunkSize = Math.max(1, (captionMeta && captionMeta.words) || (captionStyle === 'word' ? 1 : 3));
    chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    const timePerChunk = audioDuration / chunks.length;
    chunkTimings = chunks.map((_, i) => ({ start: i * timePerChunk, end: Math.min((i+1) * timePerChunk, audioDuration) }));
    // No real per-word timing to fall back on - split each chunk's own
    // window evenly across its word count, the same estimate the chunk
    // boundaries above already rely on.
    chunkWordTimings = chunks.map((chunk, i) => {
      const chunkWords = chunk.split(/\s+/).filter(Boolean);
      const { start, end } = chunkTimings[i];
      const per = (end - start) / Math.max(1, chunkWords.length);
      return chunkWords.map((w, wi) => ({ word: w, start: start + wi * per, end: start + (wi + 1) * per }));
    });
  }

  const toAssTime = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(1, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    const cs = Math.round((s % 1) * 100).toString().padStart(2, '0');
    return `${h}:${m}:${sec}.${cs}`;
  };

  // Advanced caption styles
  const STYLES = {
    "classic": {
      fontname:"Arial", fontsize:26, bold:1,
      primary:"&H00FFFFFF", outline:"&H00000000", back:"&H80000000",
      outline_w:3, shadow:1.5, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "tiktok": {
      fontname:"Arial", fontsize:30, bold:1,
      primary:"&H0000FFFF", outline:"&H00000000", back:"&H90000000",
      outline_w:4, shadow:2, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "neon": {
      fontname:"Arial", fontsize:26, bold:1,
      primary:"&H007FFF00", outline:"&H00003300", back:"&H00000000",
      outline_w:3, shadow:0, alignment:2, marginV:80, spacing:1,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "fire": {
      fontname:"Arial", fontsize:28, bold:1,
      primary:"&H000045FF", outline:"&H00000099", back:"&H00000000",
      outline_w:3, shadow:1, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "sticker": {
      fontname:"Arial", fontsize:26, bold:1,
      primary:"&H00000000", outline:"&H00FFFFFF", back:"&H00FFFFFF",
      outline_w:8, shadow:0, alignment:2, marginV:80, spacing:0,
      borderStyle:3, italic:0,
      transform: t => t.toUpperCase(),
    },
    "shadow3d": {
      fontname:"Arial", fontsize:28, bold:1,
      primary:"&H00FFFFFF", outline:"&H00000000", back:"&HAA333333",
      outline_w:2, shadow:4, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "highlight": {
      fontname:"Arial", fontsize:26, bold:1,
      primary:"&H0000FFFF", outline:"&H00000000", back:"&H00000000",
      outline_w:3, shadow:1, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: (t, i) => i % 2 === 0 ? t.toUpperCase() : t.toLowerCase(),
    },
    "outline": {
      fontname:"Arial", fontsize:28, bold:1,
      primary:"&H00000000", outline:"&H00FFFFFF", back:"&H00000000",
      outline_w:3, shadow:0, alignment:2, marginV:80, spacing:1,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "cinematic": {
      fontname:"Arial", fontsize:22, bold:0,
      primary:"&H00FFFFFF", outline:"&H00000000", back:"&H80000000",
      outline_w:1, shadow:2, alignment:2, marginV:120, spacing:3,
      borderStyle:1, italic:1,
      transform: t => t.toUpperCase(),
    },
    "minimal": {
      fontname:"Arial", fontsize:20, bold:0,
      primary:"&H00FFFFFF", outline:"&H00000000", back:"&H00000000",
      outline_w:1, shadow:0, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t,
    },
    "bold": {
      fontname:"Arial", fontsize:32, bold:1,
      primary:"&H00FFFFFF", outline:"&H00000000", back:"&H00000000",
      outline_w:5, shadow:3, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
    "purple": {
      fontname:"Arial", fontsize:28, bold:1,
      primary:"&H00FF00FF", outline:"&H00000000", back:"&H00000000",
      outline_w:3, shadow:2, alignment:2, marginV:80, spacing:0,
      borderStyle:1, italic:0,
      transform: t => t.toUpperCase(),
    },
  };

  // A spec from the app wins over the twelve ids this file happens to know: the
  // catalogue has a hundred and thirty, and an id lookup would quietly render the
  // other hundred and eighteen as "classic".
  const s = (captionMeta && captionMeta.spec)
    ? assStyleFromSpec(captionMeta)
    : (STYLES[captionStyle] || STYLES["classic"]);

  // Matching the real output frame, not a fixed 9:16 guess - libass maps this
  // virtual canvas onto the actual encoded resolution, stretching it
  // non-uniformly if the two disagree. A mismatch here is what let a caption
  // sit closer to (or past) an edge than its MarginL/MarginR promised on any
  // source that wasn't 720x1280 to begin with.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${Math.round(videoWidth) || 720}
PlayResY: ${Math.round(videoHeight) || 1280}
Collisions: Normal
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontname},${s.fontsize},${s.primary},&H000000FF,${s.outline},${s.back},${s.bold},${s.italic},0,0,100,100,${s.spacing},0,${s.borderStyle},${s.outline_w},${s.shadow},${s.alignment},20,20,${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const ANIMATED_STYLES = ['highlight','sticker','shadow3d','tiktok','neon','fire','bold','purple'];
  // Word-by-word is what the pop animation is for; a style that holds a whole
  // phrase on screen should not jump every time the phrase changes.
  const wantsAnimation = captionMeta && captionMeta.words
    ? captionMeta.words === 1
    : ANIMATED_STYLES.includes(captionStyle);
  const isAnimated = wantsAnimation && wordTimestamps?.length > 0;

  // Position variation — alternate center/bottom every 5 words
  const getMarginV = (i) => {
    const positions = [80, 80, 80, 80, 80, 80, 80, 80, 80, 80];
    return positions[i % positions.length];
  };

  // Inline colour override (\1c&HBBGGRR&) rather than the Style-level
  // &HAABBGGRR assColour() returns elsewhere - a run inside one Dialogue
  // line's Text field takes no alpha component.
  const toInlineColour = (hex, fallback) => '&H' + assColour(hex, fallback).slice(4) + '&';
  // A highlight spec (the "chip follows the voice" styles) has no chip in
  // this renderer - a chip's position needs the same glyph-offset
  // measurement the ImageMagick path gets from ImageMagick's own `identify`,
  // which this string-only ASS builder has no equivalent of. What it can do
  // without measuring anything is recolour the word ASS is already about to
  // lay out, using tags inline in the same Text field - no drawing, no
  // position math, so it can't drift from where ASS itself places the word.
  const hl = captionMeta && captionMeta.spec && captionMeta.spec.highlight;
  const hlBaseColour = hl ? toInlineColour(captionMeta.color, '&HFFFFFF&') : null;
  const hlActiveColour = hl ? toInlineColour(hl.textColor, hlBaseColour) : null;

  const makeLines = (chunk, i) => {
    const start = chunkTimings[i].start;
    const end = chunkTimings[i].end;
    const dur = end - start;
    const popEnd = start + Math.min(0.15, dur * 0.35); // 150ms pop
    const text = (s.transform ? s.transform(chunk, i) : chunk).replace(/[}{]/g, '');
    const mv = getMarginV(i); // position variation
    const pos = ''; // position override tag (empty = use style default)

    if (!isAnimated && hl && chunkWordTimings[i] && chunkWordTimings[i].length > 1) {
      // One event per word in the chunk, each holding the full phrase but
      // re-colouring a different word - the chip's absence aside, this is
      // the "follow the voice" behaviour the style promises rather than a
      // static phrase indistinguishable from a plain stroke style.
      const chunkWords = chunk.split(/\s+/).filter(Boolean);
      const transformedWords = chunkWords.map((w, wi) => (s.transform ? s.transform(w, wi) : w).replace(/[}{]/g, ''));
      return chunkWordTimings[i].map((wt, wi) => {
        const runs = transformedWords.map((w, ti) =>
          ti === wi ? `{\\1c${hlActiveColour}}${w}{\\1c${hlBaseColour}}` : w
        ).join(' ');
        return `Dialogue: 0,${toAssTime(wt.start)},${toAssTime(wt.end)},Default,,0,0,${mv},,${pos}${runs}`;
      });
    }

    if (!isAnimated) {
      return [`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Default,,0,0,${mv},,${pos}${text}`];
    }

    switch(captionStyle) {
      case 'tiktok':
      case 'highlight':
        // 160% pop → cyan, settle to yellow
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,${pos}{\\fscx160\\fscy160\\1c&H00FFFF&\\3c&H000000&\\bord3}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,${pos}{\\fscx100\\fscy100\\1c&H00FFFF&\\3c&H000000&\\bord4}${text}`,
        ];
      case 'neon':
        // 160% pop → bright green glow
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,${pos}{\\fscx160\\fscy160\\1c&H007FFF00&\\3c&H00003300&\\blur4\\bord3}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,${pos}{\\fscx100\\fscy100\\1c&H007FFF00&\\3c&H00003300&\\blur2\\bord3}${text}`,
        ];
      case 'fire':
        // 160% pop → orange/red
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,${pos}{\\fscx160\\fscy160\\1c&H000045FF&\\3c&H00000099&\\bord4}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,${pos}{\\fscx100\\fscy100\\1c&H000045FF&\\3c&H00000099&\\bord3}${text}`,
        ];
      case 'bold':
        // 160% white pop with heavy border
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,${pos}{\\fscx160\\fscy160\\1c&H00FFFFFF&\\3c&H00000000&\\bord6\\shad4}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,${pos}{\\fscx100\\fscy100\\1c&H00FFFFFF&\\3c&H00000000&\\bord5\\shad3}${text}`,
        ];
      case 'sticker': {
        // Colored box: use BorderStyle 3 + OutlineColour for box, white text
        const boxColors = [
          {box:'&H0033CCFF&', txt:'&H00FFFFFF&'}, // orange
          {box:'&H00FF0090&', txt:'&H00FFFFFF&'}, // pink
          {box:'&H0000CC00&', txt:'&H00FFFFFF&'}, // green
          {box:'&H00FFCC00&', txt:'&H00000000&'}, // yellow, black text
          {box:'&H00CC0000&', txt:'&H00FFFFFF&'}, // blue
          {box:'&H00990099&', txt:'&H00FFFFFF&'}, // purple
        ];
        const bc = boxColors[i % boxColors.length];
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,{\\fscx160\\fscy160\\1c${bc.txt}\\3c${bc.box}\\bord14\\shad0\\BorderStyle3}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,{\\fscx100\\fscy100\\1c${bc.txt}\\3c${bc.box}\\bord12\\shad0\\BorderStyle3}${text}`,
        ];
      }
      case 'shadow3d':
        // Deep 3D shadow pop
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,${pos}{\\fscx160\\fscy160\\1c&H00FFFFFF&\\shad10\\3c&H00333333&\\bord2}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,${pos}{\\fscx100\\fscy100\\1c&H00FFFFFF&\\shad6\\3c&H00333333&\\bord2}${text}`,
        ];
      case 'purple':
        // Purple glow pop
        return [
          `Dialogue: 0,${toAssTime(start)},${toAssTime(popEnd)},Default,,0,0,${mv},,${pos}{\\fscx160\\fscy160\\1c&H00FF00FF&\\3c&H00330033&\\blur3\\bord3}${text}`,
          `Dialogue: 0,${toAssTime(popEnd)},${toAssTime(end)},Default,,0,0,${mv},,${pos}{\\fscx100\\fscy100\\1c&H00FF00FF&\\3c&H00330033&\\blur1\\bord3}${text}`,
        ];
      default:
        return [`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Default,,0,0,${mv},,${pos}${text}`];
    }
  };

  const events = chunks.flatMap((chunk, i) => makeLines(chunk, i));

  fs.writeFileSync(assPath, header + events.join('\n') + '\n', 'utf8');
  return true;
}

app.post("/api/extract-url", scriptLimiter, verifyToken, async (req, res) => {
  const { url } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: "URL required" });

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Invalid protocol');
  } catch (e) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });

    if (!response.ok) return res.status(400).json({ error: `Failed to fetch URL: ${response.status}` });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, footer, header, iframe, noscript, aside, .ad, .ads, .advertisement, .cookie, .popup, .modal').remove();

    // Try to get main content
    let text = '';
    const mainSelectors = ['article', 'main', '.content', '.post-content', '.entry-content', '.article-body', '#content', '.story-body'];
    for (const sel of mainSelectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 200) {
        text = el.text();
        break;
      }
    }

    // Fallback to body
    if (!text || text.length < 200) {
      text = $('body').text();
    }

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();

    // Limit to ~3000 chars for Groq
    if (text.length > 3000) text = text.substring(0, 3000);

    if (text.length < 100) return res.status(400).json({ error: "Could not extract enough content from this URL" });

    // Get page title
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'Article';

    // Use Groq to summarize into a video script
    const script = await groqChat({
      messages: [{
        role: "user",
        content: `Convert this article/webpage content into a short, engaging video script (60-90 seconds when spoken). Write it as natural spoken narration, no headers or bullet points. Keep it informative and engaging.

Title: ${title}

Content: ${text}

Video script:`
      }],
      max_tokens: 400,
      temperature: 0.7,
    });

    if (!script) return res.status(500).json({ error: "Failed to generate script from URL" });

    res.json({ script, title, url });
  } catch (err) {
    console.error("extract-url error:", err.message);
    res.status(500).json({ error: "Failed to process URL: " + err.message });
  }
});

app.post("/api/generate-script", scriptLimiter, async (req, res) => {
  const { prompt, targetSeconds: requestedSeconds } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });
  try {
    // Ask for a script that will actually fit the plan's export limit. Raising the
    // free cap alone is not enough: a script written to no particular length can
    // always overshoot, and the failure lands at the very end of the flow, after
    // the voiceover has been generated and the user has spent the wait.
    //
    // 60% of the cap, capped at 90 seconds. The margin is because spoken length is
    // an estimate at ~150 wpm and delivery varies; 90 seconds because past that a
    // social-media script stops being a short-form script whatever the plan allows.
    const { plan: scriptPlan } = await getUserPlanData(adminDb, req.user?.uid);
    const capSeconds = tierConfig(scriptPlan).maxExportSeconds;
    // Idea-to-Audio asks for a length, because for an audio product the length IS the
    // product - a 30-second clip and a 5-minute one are different things a user chose
    // between. Video callers send nothing and keep the behaviour above unchanged.
    //
    // Still clamped to the plan's own export cap rather than a number invented here:
    // that is the length limit this app already decided on and already shows in the
    // pricing, so a longer audio being a paid feature needs no new policy.
    const targetSeconds = Number(requestedSeconds) > 0
      ? Math.max(15, Math.min(Math.round(Number(requestedSeconds)), capSeconds))
      : Math.min(90, Math.round(capSeconds * 0.6));

    // The target belongs in the cache key. Without it the first caller's plan
    // decides the length everyone else gets - a Pro-length script served from
    // cache to a free user is exactly the failure this change exists to remove.
    const cacheKey = `script:${targetSeconds}:${prompt.toLowerCase().trim()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('[CACHE HIT] generate-script:', prompt.substring(0, 40));
      return res.json({ script: cached, cached: true });
    }
    const script = await callLLM({
      // A range with a floor, not a ceiling. "Do not exceed N words" alone made the
      // model treat N as a limit to stay safely under: a 30-second ask came back at
      // 36 words against a 75-word target - half the length the user picked - while
      // 90s and 300s landed almost exactly. Naming a minimum is what fixes the short
      // end, and the ceiling still has to be there or a long script overshoots the
      // plan's export cap.
      //
      // 1.8-2.0 words per second, MEASURED by rendering real scripts and ffprobing
      // them, not the 150wpm (2.5/s) this used to assume - at which a 30s ask came
      // back as 20s of audio and a 120s ask as 153s.
      //
      // Erring slightly SHORT is deliberate. The cap above is the plan's export
      // limit, so a script that overruns its target does not merely misjudge the
      // chip the user tapped - it can put the resulting video past the length that
      // account is allowed to export, and that failure lands at the very end, after
      // the voiceover has been made and the wait has been spent.
      //
      // Worth not re-deriving: a fixed paragraph read by these same voices clocks
      // 2.5 (gtts) to 2.8 (edge) words per second, so the engine is NOT the slow
      // part. Generated scripts are slower because they are written in short
      // sentences and every sentence end is a pause. Timing a passage of prose to
      // pick this number gives the wrong answer by about 25%.
      system: `You are a professional video script writer. Write an engaging social media video script that takes about ${targetSeconds} seconds to read aloud at a natural pace. It must be between ${Math.round(targetSeconds * 1.8)} and ${Math.round(targetSeconds * 2.0)} words - do not go under the minimum or over the maximum. Write ONLY spoken narration - no stage directions, no Narrator:, no timestamps, no scene descriptions. Just pure spoken words.`,
      user: `Create a short video script about: ${prompt}`,
      // Scaled with the target, or a long request comes back quietly truncated: the
      // old flat 400 is about two minutes of speech, so a five-minute script would
      // have stopped mid-sentence and looked like the model losing its thread rather
      // than a budget being hit.
      max_tokens: Math.min(2000, Math.max(400, Math.round(targetSeconds * 2.5 * 1.5))),
      temperature: 0.8,
    });
    setCache(cacheKey, script);
    res.json({ script });
  } catch (err) {
    console.error("Script error:", err.message);
    res.status(500).json({ error: "Failed to generate script" });
  }
});

// Turn "make the colours warmer and add film grain" into real catalogue choices.
//
// The screen offered a text box, a send button and three prompt chips, and none of them
// did anything. This is the one part of that section that can be built for nothing:
// Groq is already wired for scripts and translation, so a request costs what every other
// LLM call here costs.
//
// The model PICKS FROM A LIST rather than describing a look. Asked to invent, it returns
// plausible ids that do not exist and the app silently applies nothing - so the reply is
// constrained to ids the client sent, and anything not on that list is dropped here
// rather than failing quietly on the device.
app.post("/api/suggest-look", scriptLimiter, async (req, res) => {
  const { prompt, filters = [], effects = [], motions = [], speeds = [] } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: "Describe what you want." });

  // Bounded: this goes into a prompt, and a caller could otherwise paste a catalogue of
  // any size and turn one request into a very expensive one.
  const list = (a) => a.filter(x => typeof x === 'string').slice(0, 200).join(', ');
  try {
    const reply = await callLLM({
      system:
        'You choose video edit settings. Reply with ONLY a JSON object, no prose, no code fence.\n' +
        'Keys: filter, effect, motion, speed. Each value must be EXACTLY one id from the lists given, ' +
        'or null if nothing fits. Never invent an id. Prefer null over a poor match.\n' +
        `filters: ${list(filters)}\n` +
        `effects: ${list(effects)}\n` +
        `motions: ${list(motions)}\n` +
        // Slow motion is a speed, not a look. Without this list the model answered a
        // request for slow-mo with a saturated filter and a strobe - a valid id from
        // the lists it was given, and not remotely what was asked for. The options a
        // model is offered decide what it can possibly be right about.
        `speeds (playback rate, 1 is normal): ${list(speeds)}`,
      user: prompt.slice(0, 400),
      max_tokens: 120,
      // Near zero: this is a lookup, not a piece of writing.
      temperature: 0.1,
    });

    let parsed = null;
    try {
      // Models wrap JSON in prose or a fence however firmly asked not to, so the object
      // is extracted rather than the whole reply being parsed.
      const m = /\{[\s\S]*\}/.exec(reply || '');
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) { parsed = null; }
    if (!parsed) return res.status(502).json({ error: "Could not understand that. Try describing the look differently." });

    // Only ids the caller actually offered. A hallucinated one would apply nothing and
    // look like the feature ignoring the request.
    const pick = (v, allowed) => (typeof v === 'string' && allowed.includes(v) ? v : null);
    res.json({
      filter: pick(parsed.filter, filters),
      effect: pick(parsed.effect, effects),
      motion: pick(parsed.motion, motions),
      speed: pick(String(parsed.speed ?? ''), speeds),
    });
  } catch (err) {
    console.error("suggest-look error:", err.message);
    res.status(500).json({ error: "Could not work that out. Please try again." });
  }
});

app.post("/api/extract-keywords", scriptLimiter, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text required" });
  try {
    const cacheKey = `kw:${text.substring(0, 100)}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json({ keywords: cached });
    const result = await callLLM({
      system: 'Extract 3 short visual search keywords from this text. Return ONLY a JSON array like: ["keyword1", "keyword2", "keyword3"]',
      user: text,
      max_tokens: 80,
      temperature: 0.3,
    });
    try {
      const keywords = JSON.parse(result);
      setCache(cacheKey, keywords);
      res.json({ keywords });
    } catch (e) {
      res.json({ keywords: [text.split(" ").slice(0, 3).join(" ")] });
    }
  } catch (err) {
    res.json({ keywords: [text.split(" ").slice(0, 3).join(" ")] });
  }
});

app.post("/api/search-pexels-videos", pexelsLimiter, async (req, res) => {
  const { query, keywords } = req.body;
  if (!query && !keywords) return res.status(400).json({ error: "Query required" });
  try {
    const term = keywords?.[0] || query;
    const response = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(term)}&per_page=3`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    if (!response.ok) return res.status(500).json({ error: "Pexels API error" });
    const data = await response.json();
    res.json({ videos: (data.videos || []).filter(v => v.video_files?.length > 0).slice(0, 3) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

// Voice definitions
// Read from voices.json rather than written here. That file is generated by
// scripts/generate-voices.py in the app repo, straight out of edge-tts's own
// list_voices() - 325 voices across 76 languages, where this table had eight. A voice
// name typed from memory that edge-tts does not recognise fails at generation time, in
// front of the user, which is what generating it avoids.
//
// The old eight ids are gone, and the three gtts- ones are deliberately kept identical
// so anything holding a saved voiceId still resolves. The five edge- ids that changed
// shape (edge-guy -> edge-en-US-GuyNeural) are remapped below rather than dropped.
let VOICES = {};
try {
  VOICES = JSON.parse(readFileSync(new URL("./voices.json", import.meta.url), "utf8"));
  console.log(`[voices] ${Object.keys(VOICES).length} voices loaded`);
} catch (e) {
  console.warn("[voices] voices.json unreadable, falling back to gTTS only:", e.message);
  VOICES = {
    "gtts-us": { engine: "gtts", tld: "com",    label: "Sarah" },
    "gtts-uk": { engine: "gtts", tld: "co.uk",  label: "Emma" },
    "gtts-au": { engine: "gtts", tld: "com.au", label: "Olivia" },
  };
}

// Saved projects and drafts can still hold the ids this table used before it was
// generated. Mapped rather than left to fall back to gtts-us, which would silently
// change the voice of an existing project.
const LEGACY_VOICE_IDS = {
  "edge-guy":   "edge-en-US-GuyNeural",
  "edge-ryan":  "edge-en-GB-RyanNeural",
  "edge-brian": "edge-en-US-BrianNeural",
  "edge-aria":  "edge-en-US-AriaNeural",
  "edge-sonia": "edge-en-GB-SoniaNeural",
};
function resolveVoiceId(id) {
  if (VOICES[id]) return id;
  const mapped = LEGACY_VOICE_IDS[id];
  return mapped && VOICES[mapped] ? mapped : "gtts-us";
}

// ASS style definitions — each returns full ASS Style line values
const CAPTION_STYLES = {
  // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  "classic":    "Arial,26,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1.5,2,20,20,80,1",
  "tiktok":     "Arial,30,&H0000FFFF,&H000000FF,&H00000000,&H90000000,1,0,0,0,100,100,0,0,1,4,2,2,20,20,80,1",
  "neon":       "Arial,26,&H007FFF00,&H000000FF,&H00003300,&H00000000,1,0,0,0,100,100,1,0,1,3,0,2,20,20,80,1",
  "fire":       "Arial,28,&H000045FF,&H000000FF,&H00000099,&H00000000,1,0,0,0,100,100,0,0,1,3,1,2,20,20,80,1",
  "sticker":    "Arial,26,&H00000000,&H000000FF,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,8,0,2,20,20,80,1",
  "shadow3d":   "Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&HAA333333,1,0,0,0,100,100,0,0,1,2,4,2,20,20,80,1",
  "highlight":  "Arial,26,&H0000FFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,1,2,20,20,80,1",
  "outline":    "Arial,28,&H00000000,&H000000FF,&H00FFFFFF,&H00000000,1,0,0,0,100,100,1,0,1,3,0,2,20,20,80,1",
  "cinematic":  "Arial,22,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,1,0,0,100,100,3,0,1,1,2,2,20,20,120,1",
  "minimal":    "Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,20,20,80,1",
  "bold":       "Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,3,2,20,20,80,1",
  "purple":     "Arial,28,&H00FF00FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,2,2,20,20,80,1",
};

// Pace and pitch, applied AFTER synthesis with one ffmpeg pass rather than through
// each engine's own knobs.
//
// edge-tts has rate/pitch options and gTTS has none at all, so doing it per-engine
// would mean the three gTTS voices silently ignored both sliders - and those are the
// free voices, so the people most likely to meet a dead control would be the ones who
// have not paid yet. One post-process gives every voice on both engines the same
// behaviour and one code path to be correct.
//
// rubberband rather than asetrate/atempo arithmetic: it takes tempo and pitch as
// independent factors, so changing the speed does not also raise the voice, and there
// is no source-sample-rate term to get wrong (gTTS and edge do not agree on it).
function shapeFilter(rate, semitones) {
  const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
  const st = Math.min(12, Math.max(-12, Math.round(Number(semitones) || 0)));
  if (r === 1 && st === 0) return null;   // nothing asked for: skip the pass entirely
  const pitchFactor = Math.pow(2, st / 12);
  return `rubberband=tempo=${r.toFixed(3)}:pitch=${pitchFactor.toFixed(4)}`;
}

app.post("/api/generate-audio", scriptLimiter, async (req, res) => {
  const { text, voiceId = "gtts-us", rate = 1, pitch = 0 } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "Text is required" });
  try {
    // Voice restriction lives here, not on idea-to-video-v2: that endpoint
    // only ever consumes audio this one already generated, so it never sees
    // a voiceId to gate on. This is generation, not export, so it isn't a
    // credit/duration check - just which voices this plan can pick from.
    const { plan } = await getUserPlanData(adminDb, req.user?.uid);
    if (!voiceAllowed(plan, voiceId)) {
      return res.status(403).json({ error: `The "${voiceId}" voice is available on the Pro and Creator plans.` });
    }
    const voice = VOICES[resolveVoiceId(voiceId)] || VOICES["gtts-us"];
    const audioFilename = uniqueName("gtts", "mp3");
    const audioPath = path.join(audiosDir, audioFilename);
    await new Promise((resolve, reject) => {
      let cmd;
      if (voice.engine === "gtts") {
        cmd = `python3 /home/ahumuza/Tonefy-react/backend/gtts_generate.py ${JSON.stringify(text)} ${JSON.stringify(audioPath)} ${JSON.stringify(voice.tld)}`;
      } else {
        cmd = `python3 /home/ahumuza/Tonefy-react/backend/edge_tts_generate.py ${JSON.stringify(text)} ${JSON.stringify(audioPath)} ${JSON.stringify(voice.name)}`;
      }
      exec(cmd, (err) => err ? reject(err) : resolve());
    });

    const filter = shapeFilter(rate, pitch);
    if (filter) {
      // Into a sibling file then renamed over the original: ffmpeg cannot read and
      // write the same path, and a caller that already has the URL must never find a
      // half-written file there.
      const shapedPath = audioPath.replace(/\.mp3$/, "-shaped.mp3");
      try {
        await new Promise((resolve, reject) => {
          execFile("ffmpeg", ["-y", "-i", audioPath, "-filter:a", filter, "-c:a", "libmp3lame", "-q:a", "4", shapedPath],
            { timeout: 120000 }, (err, stdout, stderr) => {
              if (err) { console.error("Audio shaping failed:", stderr?.slice(-300)); return reject(err); }
              resolve();
            });
        });
        fs.renameSync(shapedPath, audioPath);
      } catch (e) {
        // The unshaped audio is still correct audio. Losing the whole request over a
        // pace adjustment would be a worse outcome than the voice being at 1.0x.
        try { fs.unlinkSync(shapedPath); } catch (e2) {}
        console.warn("Serving unshaped audio for", audioFilename);
      }
    }

    res.json({ audioUrl: `/audios/${audioFilename}` });
  } catch (err) {
    console.error("Audio error:", err.message);
    res.status(500).json({ error: "Failed to synthesize audio" });
  }
});

app.post("/api/tts", scriptLimiter, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "text required" });
  try {
    const audioFilename = uniqueName("gtts", "mp3");
    const audioPath = path.join(audiosDir, audioFilename);
    await new Promise((resolve, reject) => {
      execFile('python3', ['/home/ahumuza/Tonefy-react/backend/gtts_generate.py', text, audioPath],
        (err) => err ? reject(err) : resolve());
    });
    res.json({ audioUrl: `/audios/${audioFilename}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to synthesize audio" });
  }
});

app.get("/api/job/:jobId", jobPollLimiter, (req, res) => {
  const job = jobs.get(req.params.jobId);
  // Same 404 for "doesn't exist" and "exists but isn't yours" - a distinct
  // 403 would let a caller confirm which UUIDs are real jobs belonging to
  // someone else. Jobs created before this ownership check shipped have no
  // userId and so 404 for everyone, including their original creator - an
  // acceptable one-time gap for whatever was still in flight at deploy,
  // not an ongoing one.
  if (!job || job.userId !== req.user.uid) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.post("/api/idea-to-video", videoGenLimiter, async (req, res) => {
  const { voiceover = "", selectedVideo, selectedVideos, audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", captionMeta = null, musicTrack = "mixkit-deep-meditation-109", videoSpeed = 1.0, transition = "fade" } = req.body || {};
  const jobId = createJob(req.user.uid);
  res.json({ jobId }); // Return immediately
  try {
    const videoList = selectedVideos || (selectedVideo ? [selectedVideo] : []);
    if (videoList.length === 0) return res.status(400).json({ error: "selectedVideo required" });

    const firstVideo = videoList[0];
    const videoUrl = typeof firstVideo === "object" ? pickBestMp4(firstVideo) : isHttpUrl(firstVideo) ? firstVideo : null;
    if (!videoUrl) return res.status(400).json({ error: "No valid video URL" });

    // Audio
    let audioPathLocal, audioPublicUrl;
    if (providedAudioUrl && /^\/?audios\//i.test(providedAudioUrl)) {
      const fileName = providedAudioUrl.replace(/^\/?audios\//, "");
      audioPathLocal = path.join(audiosDir, fileName);
      audioPublicUrl = `/audios/${fileName}`;
    } else if (providedAudioUrl && isHttpUrl(providedAudioUrl)) {
      const ap = path.join(audiosDir, uniqueName("voice", "mp3"));
      await downloadToFile(providedAudioUrl, ap);
      audioPathLocal = ap;
      audioPublicUrl = `/audios/${path.basename(ap)}`;
    } else if (voiceover.trim()) {
      const audioFilename = uniqueName("gtts", "mp3");
      const ap = path.join(audiosDir, audioFilename);
      await new Promise((resolve, reject) => {
        execFile('python3', ['/home/ahumuza/Tonefy-react/backend/gtts_generate.py', voiceover, ap],
          (err) => err ? reject(err) : resolve());
      });
      audioPathLocal = ap;
      audioPublicUrl = `/audios/${audioFilename}`;
    } else {
      return res.status(400).json({ error: "Missing audio" });
    }

    // Download clip
    const videoPath = path.join(videosDir, uniqueName("src", "mp4"));
    await downloadToFile(videoUrl, videoPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });

    // Get audio duration
    const audioDuration = await new Promise((resolve) => {
      exec(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPathLocal}"`, (err, stdout) => {
        resolve(parseFloat(stdout?.trim()) || 60);
      });
    });

    console.log(`Audio: ${audioDuration}s | Aspect: ${aspectRatio} | Video: ${videoUrl}`);
    updateJob(jobId, { progress: 10, message: 'Downloading video clip...' });

    const outputVideo = path.join(videosDir, uniqueName("final", "mp4"));

    // Let FFmpeg download directly — avoids Pexels CDN 403 on server downloads
    const availableTracks = fs.readdirSync(path.join(__dirname, "public", "music")).filter(f => f.endsWith(".mp3")).map(f => f.replace(/\.mp3$/, ""));
    const safeTrack = availableTracks.includes(musicTrack) ? musicTrack : (availableTracks.includes("mixkit-deep-meditation-109") ? "mixkit-deep-meditation-109" : availableTracks[0]);
    const musicPath = path.join(__dirname, "public", "music", safeTrack + ".mp3");
    const hasBgMusic = fs.existsSync(musicPath);
    const watermark = "drawtext=text='Tonefy AI':fontsize=18:fontcolor=white@0.5:x=(w-text_w)/2:y=h-th-20";

    let scaleFilter, outW, outH;
    if (aspectRatio === "9:16") { scaleFilter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"; outW = 720; outH = 1280; }
    else if (aspectRatio === "1:1") { scaleFilter = "scale=720:720:force_original_aspect_ratio=increase,crop=720:720"; outW = 720; outH = 720; }
    else { scaleFilter = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720"; outW = 1280; outH = 720; }

    const assPath = outputVideo.replace('.mp4', '.ass');
    const hasCaptions = buildAssFile(voiceover || "", audioDuration, assPath, captionStyle, null, captionMeta, outW, outH);
    // subtitles filter burns SRT into video — handles any length efficiently
    const subsFilter = hasCaptions ? ',' + assFilter(assPath) : '';
    const vf = `${scaleFilter},setsar=1${subsFilter},${watermark}`;

    let ffmpegCmd;
    if (hasBgMusic) {
      ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPathLocal}" -stream_loop -1 -i "${musicPath}" -t ${audioDuration} -filter_complex "[1:a]volume=1.0,asplit=2[voice1][voice2];[2:a]volume=0.3[music_pre];[music_pre][voice1]sidechaincompress=threshold=0.03:ratio=8:attack=120:release=600:makeup=1[music_duck];[voice2][music_duck]amix=inputs=2:duration=first:normalize=0[aout]" -vf "${vf}" -map 0:v:0 -map "[aout]" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -shortest "${outputVideo}"`;
    } else {
      ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPathLocal}" -t ${audioDuration} -vf "${vf}" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest "${outputVideo}"`;
    }

    updateJob(jobId, { progress: 40, message: "Merging video & audio..." });
    console.log("FFmpeg:", ffmpegCmd);
    await new Promise((resolve, reject) => {
      exec(ffmpegCmd, { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) { console.error("FFmpeg error:", stderr?.slice(-500)); return reject(new Error("FFmpeg failed")); }
        resolve();
      });
    });

    fs.unlink(videoPath, () => {});
    if (hasCaptions) fs.unlink(assPath, () => {});
    console.log("Done:", outputVideo);
    updateJob(jobId, { progress: 95, message: "Finalizing..." });
    // Upload to Firebase Storage if user is authenticated
    const videoFilename = path.basename(outputVideo);
    const userId = req.user?.uid;
    if (userId) {
      uploadVideoToFirebase(outputVideo, userId, { prompt: voiceover?.slice(0,100), aspectRatio, captionStyle }).catch(console.error);
    }
    updateJob(jobId, { status: "done", progress: 100, message: "Video ready!", videoUrl: `/videos/${videoFilename}`, audioUrl: audioPublicUrl });
  } catch (err) {
    console.error("idea-to-video error:", err.message);
    updateJob(jobId, { status: "failed", message: err.message });
  }
});


// ===== Segment-based Idea-to-Video (improved visual matching) =====

app.post("/api/extract-segments", scriptLimiter, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text required" });
  try {
    const raw = await groqChat({
      messages: [
        { role: "system", content: `Split this video script into 3-5 short segments (each 1-2 sentences, in original order, covering ALL the text).

For each segment, write a "keywords" field describing a STOCK FOOTAGE SCENE that visually represents the segment's meaning. The keywords must be 2-4 concrete English words describing people, objects, or places (e.g. "person typing laptop", "sunrise mountain hike", "brain puzzle pieces", "students writing exam"). NEVER copy words directly from the script text. NEVER use abstract words like "motivation", "challenge", "test" alone - always describe a visible scene or action.

Example input: "Are you ready for a challenge? Take our quiz now."
Example output: [{"text":"Are you ready for a challenge? Take our quiz now.","keywords":"person solving puzzle excited"}]

Return ONLY a JSON array, no other text: [{"text":"...","keywords":"..."}]` },
        { role: "user", content: text }
      ],
      max_tokens: 500, temperature: 0.4,
    });
    let segments;
    try {
      // Models sometimes wrap JSON in a ```json fence despite being told not to;
      // stripping it is cheaper than losing the whole response to the sentence-split
      // fallback below, which produces far worse stock-footage keywords.
      segments = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());
    } catch (e) {
      // Fallback: split by sentences into chunks
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const chunkSize = Math.max(1, Math.ceil(sentences.length / 4));
      segments = [];
      for (let i = 0; i < sentences.length; i += chunkSize) {
        const chunk = sentences.slice(i, i + chunkSize).join(' ');
        segments.push({ text: chunk, keywords: chunk.split(' ').slice(0, 3).join(' ') });
      }
    }
    res.json({ segments });
  } catch (err) {
    console.error("extract-segments error:", err.message);
    res.status(500).json({ error: "Failed to extract segments" });
  }
});

app.post("/api/search-pexels-segment", pexelsLimiter, async (req, res) => {
  const { keywords } = req.body;
  if (!keywords) return res.status(400).json({ error: "Keywords required" });
  try {
    const response = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords)}&per_page=3&orientation=portrait`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    if (!response.ok) return res.status(500).json({ error: "Pexels API error" });
    const data = await response.json();
    const videos = (data.videos || []).filter(v => v.video_files?.length > 0);
    res.json({ video: videos[0] || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch video" });
  }
});

app.post("/api/idea-to-video-v2", videoGenLimiter, async (req, res) => {
  const { voiceover = "", segments = [], audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", captionMeta = null, transition = "fade", transitionSpec = null, musicTrack = "mixkit-deep-meditation-109", videoSpeed = 1.0 } = req.body || {};
  const userId = req.user?.uid;

  // No voiceId param here - this endpoint consumes audio that was already
  // generated by a prior /api/generate-audio call, so voice gating belongs
  // there, not here (confirmed by reading this endpoint's actual params
  // rather than assuming it needed the same check as generate-audio).
  //
  // Real duration isn't known until the voiceover audio exists - a rough
  // word-count estimate (~150 words/minute) catches the obviously-oversized
  // requests before spending anything on TTS or Pexels; the PRECISE check
  // against the real generated audio duration happens further down, before
  // the expensive per-segment clip work starts.
  const roughEstimateSeconds = Math.ceil(
    (voiceover || '').trim().split(/\s+/).filter(Boolean).length / 150 * 60
  );
  const allowed = await checkRenderAllowed(adminDb, userId, { requestedDurationSeconds: roughEstimateSeconds });
  if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });
  if (!captionStyleAllowed(allowed.plan, captionStyle)) {
    return res.status(403).json({ error: `The "${captionStyle}" caption style is available on the Pro and Creator plans.` });
  }

  const jobId = createJob(req.user.uid);
  res.json({ jobId });

  await acquireVideoSlot(allowed.tier.queuePriority > 0);
  try {
    if (!segments.length) { updateJob(jobId, { status: "failed", message: "No segments provided" }); return; }

    // 1. Prepare full audio
    let audioPathLocal, audioPublicUrl;
    if (providedAudioUrl && /^\/?audios\//i.test(providedAudioUrl)) {
      const fileName = providedAudioUrl.replace(/^\/?audios\//, "");
      audioPathLocal = path.join(audiosDir, fileName);
      audioPublicUrl = `/audios/${fileName}`;
    } else if (providedAudioUrl && isHttpUrl(providedAudioUrl)) {
      const ap = path.join(audiosDir, uniqueName("voice", "mp3"));
      await downloadToFile(providedAudioUrl, ap);
      audioPathLocal = ap;
      audioPublicUrl = `/audios/${path.basename(ap)}`;
    } else if (voiceover.trim()) {
      const audioFilename = uniqueName("gtts", "mp3");
      const ap = path.join(audiosDir, audioFilename);
      await new Promise((resolve, reject) => {
        execFile('python3', ['/home/ahumuza/Tonefy-react/backend/gtts_generate.py', voiceover, ap],
          (err) => err ? reject(err) : resolve());
      });
      audioPathLocal = ap;
      audioPublicUrl = `/audios/${audioFilename}`;
    } else {
      updateJob(jobId, { status: "failed", message: "Missing audio" });
      return;
    }

    const totalAudioDuration = await new Promise((resolve) => {
      exec(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPathLocal}"`, (err, stdout) => {
        resolve(parseFloat(stdout?.trim()) || 60);
      });
    });

    // The precise cap check - the rough word-count estimate before the audio
    // existed was only ever a cheap early filter. This is the real gate:
    // known now, before the expensive per-segment Pexels/ffmpeg work starts,
    // so an over-cap request wastes only the TTS call, not the whole render.
    // Past the point where a job was already created and returned, so this
    // fails the JOB rather than the HTTP request - the client still finds
    // out clearly, just via the job status instead of the initial response.
    if (totalAudioDuration > allowed.tier.maxExportSeconds) {
      const maxMin = Math.round(allowed.tier.maxExportSeconds / 60);
      updateJob(jobId, { status: "failed", message: `This script runs a little longer than your plan's ${maxMin} minute${maxMin === 1 ? '' : 's'} export limit. Try shortening it, or upgrade for longer exports.` });
      return;
    }

    updateJob(jobId, { progress: 10, message: `Finding clips for ${segments.length} scenes...` });

    // 2. Compute per-segment duration proportional to its text length
    const totalChars = segments.reduce((s, seg) => s + (seg.text || '').length, 0) || 1;
    const segDurations = segments.map(seg => Math.max(1.5, (seg.text || '').length / totalChars * totalAudioDuration));

    // 3. Search + download a clip per segment
    const [scaleW, scaleH] = frameSize(allowed.tier.maxResolution, aspectRatio);
    const scaleFilter = `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH}`;

    const clipPaths = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      updateJob(jobId, { progress: 10 + Math.round((i / segments.length) * 30), message: `Fetching clip ${i + 1}/${segments.length}...` });

      let videoUrl = null;
      try {
        const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(seg.keywords || 'background')}&per_page=1&orientation=${aspectRatio === '9:16' ? 'portrait' : aspectRatio === '1:1' ? 'square' : 'landscape'}`,
          { headers: { Authorization: PEXELS_API_KEY } });
        const d = await r.json();
        const vid = (d.videos || []).find(v => v.video_files?.length > 0);
        if (vid) videoUrl = pickBestMp4(vid);
      } catch (e) { console.error("segment search error:", e.message); }

      const rawPath = path.join(videosDir, uniqueName("seg-raw", "mp4"));
      const trimmedPath = path.join(videosDir, uniqueName("seg", "mp4"));

      if (videoUrl) {
        try {
          await downloadToFile(videoUrl, rawPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
        } catch (e) {
          console.error("segment download failed:", e.message);
        }
      }

      const dur = segDurations[i];
      if (fs.existsSync(rawPath)) {
        // Trim/loop clip to exact segment duration, scale+crop, no audio
        await new Promise((resolve, reject) => {
          const cmd = `ffmpeg -y -stream_loop -1 -i "${rawPath}" -t ${dur} -vf "${scaleFilter},setsar=1,fps=30" -an -c:v libx264 -preset ultrafast -crf 28 -video_track_timescale 30000 "${trimmedPath}"`;
          exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
            if (err) { console.error("segment ffmpeg error:", stderr?.slice(-300)); return reject(new Error("segment ffmpeg failed")); }
            resolve();
          });
        }).catch(() => {});
        fs.unlink(rawPath, () => {});
      }

      if (!fs.existsSync(trimmedPath)) {
        // Fallback: black clip of correct duration
        await new Promise((resolve) => {
          const cmd = `ffmpeg -y -f lavfi -i color=c=black:s=${aspectRatio === '9:16' ? '720x1280' : aspectRatio === '1:1' ? '720x720' : '1280x720'}:d=${dur}:r=30 -vf "setsar=1" -c:v libx264 -preset ultrafast -crf 28 -video_track_timescale 30000 "${trimmedPath}"`;
          exec(cmd, { timeout: 30000 }, () => resolve());
        });
      }
      clipPaths.push(trimmedPath);
    }

    // 4. Concatenate all segment clips
    updateJob(jobId, { progress: 45, message: "Combining scenes with transitions..." });
    const concatPath = path.join(videosDir, uniqueName("concat", "mp4"));

    if (clipPaths.length === 1) {
      // Single clip - just copy
      fs.copyFileSync(clipPaths[0], concatPath);
    } else {
      // Build transitions between clips
      const XFADE_MAP = {
        fade:'fade', wipeleft:'wipeleft', wiperight:'wiperight', wipeup:'wipeup', wipedown:'wipedown',
        slideleft:'slideleft', slideright:'slideright', slideup:'slideup', slidedown:'slidedown',
        circlecrop:'circlecrop', rectcrop:'rectcrop', distance:'distance',
        fadeblack:'fadeblack', fadewhite:'fadewhite', radial:'radial',
        smoothleft:'smoothleft', smoothright:'smoothright', smoothup:'smoothup', smoothdown:'smoothdown',
        circleopen:'circleopen', circleclose:'circleclose',
        vertopen:'vertopen', vertclose:'vertclose', horzopen:'horzopen', horzclose:'horzclose',
        dissolve:'dissolve', pixelize:'pixelize',
        diagtl:'diagtl', diagtr:'diagtr', diagbl:'diagbl', diagbr:'diagbr',
        hlslice:'hlslice', hrslice:'hrslice', vuslice:'vuslice', vdslice:'vdslice',
        hblur:'hblur', fadegrays:'fadegrays',
        wipetl:'wipetl', wipetr:'wipetr', wipebl:'wipebl', wipebr:'wipebr',
        squeezeh:'squeezeh', squeezev:'squeezev', zoomin:'zoomin',
        fadefast:'fadefast', fadeslow:'fadeslow',
        hlwind:'hlwind', hrwind:'hrwind', vuwind:'vuwind', vdwind:'vdwind',
        coverleft:'coverleft', coverright:'coverright', coverup:'coverup', coverdown:'coverdown',
        revealleft:'revealleft', revealright:'revealright', revealup:'revealup', revealdown:'revealdown',
        // friendly aliases
        slide:'slideleft', zoom:'zoomin', wipe:'wipeleft', blur:'fadeblack',
        flashwhite:'fadewhite', glitch:'hblur', zoomdrive:'zoomin',
        swipeleft:'coverleft', filmburn:'fadegrays', pixelate:'pixelize',
      };
      const CUSTOM_TRANSITIONS = ['flashwhite','glitch','zoomdrive','swipeleft','filmburn','pixelate'];
      const isCustom = CUSTOM_TRANSITIONS.includes(transition);
      const isNone = transition === 'none';
      const XDUR = 0.5;
      let filterComplex, mapArg;
      let finalClipPaths = [...clipPaths]; // may be replaced for custom transitions

      if (isNone || clipPaths.length < 2) {
        // Hard cut — simple concat
        const inputs2 = clipPaths.map(p => `-i "${p}"`).join(' ');
        const filterInputs = clipPaths.map((_, i) => `[${i}:v]`).join('');
        filterComplex = `${filterInputs}concat=n=${clipPaths.length}:v=1:a=0[vout]`;
        mapArg = '[vout]';
        const cmd2 = `ffmpeg -y ${inputs2} -filter_complex "${filterComplex}" -map "${mapArg}" -c:v libx264 -preset ultrafast -crf 28 "${concatPath}"`;
        await new Promise((resolve, reject) => {
          exec(cmd2, { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) { console.error("concat error:", stderr?.slice(-500)); return reject(new Error("concat failed")); }
            resolve();
          });
        });

      } else if (isCustom) {
        // Two-pass: render each transition pair separately, then simple-concat all pieces
        const getCustomFilter = (w, h) => {
          switch(transition) {
            case 'flashwhite':
              return `[0:v][1:v]xfade=transition=fade:duration=${XDUR}:offset=0[xf];[xf]curves=all='0/0 0.3/1 0.5/1 0.7/1 1/0'[vout]`;
            case 'glitch':
              return `[0:v][1:v]xfade=transition=slideleft:duration=${XDUR}:offset=0[vout]`;
            case 'zoomdrive':
              return `[0:v]scale=${Math.round(w*1.15)}:${Math.round(h*1.15)},crop=${w}:${h}[zoomed];[zoomed][1:v]xfade=transition=fade:duration=${XDUR}:offset=0[vout]`;
            case 'swipeleft':
              return `[0:v][1:v]xfade=transition=slideleft:duration=${XDUR}:offset=0[vout]`;
            case 'filmburn':
              return `[0:v]curves=red='0/0 0.5/1 1/1':green='0/0 0.4/0.7 1/1':blue='0/0 0.2/0.2 1/0.5'[burned];[burned][1:v]xfade=transition=fadeblack:duration=${XDUR}:offset=0[vout]`;
            case 'pixelate':
              return `[0:v]scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor[pA];[1:v]scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor[pB];[pA][pB]xfade=transition=fade:duration=${XDUR}:offset=0[vout]`;
            default:
              return `[0:v][1:v]xfade=transition=fade:duration=${XDUR}:offset=0[vout]`;
          }
        };

        const dims = aspectRatio === '9:16' ? {w:720,h:1280} : aspectRatio === '1:1' ? {w:720,h:720} : {w:1280,h:720};
        const minDur = Math.min(...segDurations);
        const safeXDUR = Math.min(XDUR, minDur * 0.4);
        const transClips = [];

        for (let i = 0; i < clipPaths.length - 1; i++) {
          // Main body of clip A (without last safeXDUR seconds)
          const bodyDur = Math.max(0.1, segDurations[i] - safeXDUR);
          const bodyPath = path.join(videosDir, uniqueName("body", "mp4"));
          await new Promise((resolve) => {
            exec(`ffmpeg -y -i "${clipPaths[i]}" -t ${bodyDur} -c:v libx264 -preset ultrafast -crf 28 "${bodyPath}"`, {timeout:60000}, () => resolve());
          });
          transClips.push(bodyPath);

          // Transition clip: last safeXDUR of A blended with first safeXDUR of B
          const tailPath = path.join(videosDir, uniqueName("tail", "mp4"));
          const headPath = path.join(videosDir, uniqueName("head", "mp4"));
          const transPath = path.join(videosDir, uniqueName("trans", "mp4"));
          await new Promise((resolve) => {
            exec(`ffmpeg -y -sseof -${safeXDUR} -i "${clipPaths[i]}" -c:v libx264 -preset ultrafast -crf 28 "${tailPath}"`, {timeout:30000}, () => resolve());
          });
          await new Promise((resolve) => {
            exec(`ffmpeg -y -i "${clipPaths[i+1]}" -t ${safeXDUR} -c:v libx264 -preset ultrafast -crf 28 "${headPath}"`, {timeout:30000}, () => resolve());
          });
          const tFilter = getCustomFilter(dims.w, dims.h);
          await new Promise((resolve) => {
            exec(`ffmpeg -y -i "${tailPath}" -i "${headPath}" -filter_complex "${tFilter}" -map "[vout]" -c:v libx264 -preset ultrafast -crf 28 "${transPath}"`, {timeout:60000}, (err,s,se) => {
              if(err) console.error("trans pair error:", se?.slice(-300));
              resolve();
            });
          });
          fs.unlink(tailPath, ()=>{});
          fs.unlink(headPath, ()=>{});
          if (fs.existsSync(transPath)) transClips.push(transPath);
        }
        // Add last clip body
        const lastBodyPath = path.join(videosDir, uniqueName("body", "mp4"));
        const lastIdx = clipPaths.length - 1;
        await new Promise((resolve) => {
          exec(`ffmpeg -y -i "${clipPaths[lastIdx]}" -c copy "${lastBodyPath}"`, {timeout:60000}, () => resolve());
        });
        transClips.push(lastBodyPath);

        // Simple concat all pieces
        const concatList = path.join(videosDir, uniqueName("list", "txt"));
        fs.writeFileSync(concatList, transClips.map(p => `file '${p}'`).join('\n'));
        await new Promise((resolve, reject) => {
          exec(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c:v libx264 -preset ultrafast -crf 28 "${concatPath}"`, {timeout:180000}, (err,s,se) => {
            if(err) { console.error("concat error:", se?.slice(-500)); return reject(new Error("concat failed")); }
            resolve();
          });
        });
        fs.unlink(concatList, ()=>{});
        transClips.forEach(p => fs.unlink(p, ()=>{}));

      } else {
        // Standard xfade transitions — single pass.
        //
        // A transitionSpec is the same {base, fx} recipe the editor's own export
        // consumes, so the three generation screens can offer the whole catalogue
        // instead of the twenty names XFADE_MAP happens to know. One transition for
        // the whole video here, rather than one per join, because that is what these
        // screens ask for - so the spec is read once outside the loop.
        //
        // Older clients send only an id and XFADE_MAP still answers for those.
        const specT = safeTransitionSpec(transitionSpec);
        const xft = specT ? specT.base : (XFADE_MAP[transition] || 'fade');
        const specFx = specT ? specT.fx : [];
        const minClipDur = Math.min(...segDurations);
        const safeXDUR = Math.min(XDUR, minClipDur * 0.4);
        const inputs3 = clipPaths.map(p => `-i "${p}"`).join(' ');
        let parts = [], timeline = 0, prevLabel = '0:v';
        for (let i = 1; i < clipPaths.length; i++) {
          timeline += Math.max(safeXDUR + 0.01, segDurations[i-1] - safeXDUR);
          const offset = parseFloat(timeline.toFixed(2));
          const outLabel = i === clipPaths.length - 1 ? 'vout' : `v${i}`;
          if (specFx.length) {
            // The xfade writes to a private label and the fx chain carries it on to the
            // one the next boundary expects, so adding character never changes the
            // shape of the chain around it. Identical to the editor's export path.
            const xfLabel = `xf${i}`;
            parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${safeXDUR}:offset=${offset}[${xfLabel}]`);
            let cur = xfLabel;
            const from = offset.toFixed(3);
            const to = (offset + safeXDUR).toFixed(3);
            specFx.forEach((f, k) => {
              const dst = k === specFx.length - 1 ? outLabel : `gfx${i}_${k}`;
              // enable confines the effect to the join, or a blur meant for half a
              // second sits over the whole finished video.
              const sep = String(f).includes('=') ? ':' : '=';
              parts.push(`[${cur}]${f}${sep}enable='between(t,${from},${to})'[${dst}]`);
              cur = dst;
            });
          } else {
            parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${safeXDUR}:offset=${offset}[${outLabel}]`);
          }
          prevLabel = outLabel;
        }
        filterComplex = parts.join(';');
        mapArg = '[vout]';
        const cmd3 = `ffmpeg -y ${inputs3} -filter_complex "${filterComplex}" -map "${mapArg}" -c:v libx264 -preset ultrafast -crf 28 "${concatPath}"`;
        await new Promise((resolve, reject) => {
          exec(cmd3, { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) { console.error("concat error:", stderr?.slice(-500)); return reject(new Error("concat failed")); }
            resolve();
          });
        });
      }
// transition exec handled per-branch above
    }
    clipPaths.forEach(p => fs.unlink(p, () => {}));

    // 5. Overlay audio + captions + watermark
    updateJob(jobId, { progress: 60, message: "Adding voiceover & captions..." });
    const outputVideo = path.join(videosDir, uniqueName("final", "mp4"));
    const availableTracks = fs.readdirSync(path.join(__dirname, "public", "music")).filter(f => f.endsWith(".mp3")).map(f => f.replace(/\.mp3$/, ""));
    const safeTrack = availableTracks.includes(musicTrack) ? musicTrack : (availableTracks.includes("mixkit-deep-meditation-109") ? "mixkit-deep-meditation-109" : availableTracks[0]);
    const musicPath = path.join(__dirname, "public", "music", safeTrack + ".mp3");
    const hasBgMusic = fs.existsSync(musicPath);
    // Free tier only now - this used to burn in unconditionally for everyone.
    const watermark = allowed.watermark ? "drawtext=text='Tonefy AI':fontsize=18:fontcolor=white@0.5:x=(w-text_w)/2:y=h-th-20" : null;
    const assPath = outputVideo.replace('.mp4', '.ass');
    // Run whisper for word-level timestamps
    let wordTimestamps = null;
    try {
      const whisperResult = await new Promise((resolve) => {
        execFile('python3', ['/home/ahumuza/Tonefy-react/backend/whisper_align.py', audioPathLocal],
          { timeout: 60000 }, (err, stdout) => {
          if (!err && stdout.trim()) {
            try { resolve(JSON.parse(stdout.trim())); } catch(e) { resolve(null); }
          } else { resolve(null); }
        });
      });
      wordTimestamps = whisperResult;
      if (wordTimestamps) console.log(`Whisper: ${wordTimestamps.length} words aligned`);
    } catch(e) { console.warn('Whisper failed, using estimated timing'); }
    console.log("ASS path:", assPath, "voiceover len:", (voiceover||"").length);
    const hasCaptions = buildAssFile(voiceover || "", totalAudioDuration, assPath, captionStyle, wordTimestamps, captionMeta, scaleW, scaleH);
    console.log("hasCaptions:", hasCaptions, "file exists:", fs.existsSync(assPath));
    const subsFilter = hasCaptions ? ',' + assFilter(assPath) : '';
    const speedPts = videoSpeed && videoSpeed !== 1.0 ? `setpts=${(1/videoSpeed).toFixed(4)}*PTS,` : '';
    const audioTempo = videoSpeed && videoSpeed !== 1.0 ? `atempo=${videoSpeed},` : '';
    const adjustedDuration = videoSpeed && videoSpeed !== 1.0 ? (totalAudioDuration / videoSpeed).toFixed(2) : totalAudioDuration;
    const vf = `${speedPts}setsar=1${subsFilter}${watermark ? ',' + watermark : ''}`;

    let ffmpegCmd;
    if (hasBgMusic) {
      const voiceFilter = audioTempo ? `[1:a]${audioTempo}volume=1.0,asplit=2[voice1][voice2]` : `[1:a]volume=1.0,asplit=2[voice1][voice2]`;
      ffmpegCmd = `ffmpeg -y -i "${concatPath}" -i "${audioPathLocal}" -stream_loop -1 -i "${musicPath}" -t ${adjustedDuration} -filter_complex "${voiceFilter};[2:a]volume=0.3[music_pre];[music_pre][voice1]sidechaincompress=threshold=0.03:ratio=8:attack=120:release=600:makeup=1[music_duck];[voice2][music_duck]amix=inputs=2:duration=first:normalize=0[aout]" -vf "${vf}" -map 0:v:0 -map "[aout]" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -shortest "${outputVideo}"`;
    } else {
      const audioFilter = audioTempo ? `-af "${audioTempo}aresample=44100"` : "";
      ffmpegCmd = `ffmpeg -y -i "${concatPath}" -i "${audioPathLocal}" -t ${adjustedDuration} -vf "${vf}" ${audioFilter} -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest "${outputVideo}"`;
    }
    await new Promise((resolve, reject) => {
      exec(ffmpegCmd, { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) { console.error("final ffmpeg error:", stderr?.slice(-500)); return reject(new Error("final merge failed")); }
        resolve();
      });
    });

    fs.unlink(concatPath, () => {});
    

    // Upload to Firebase Storage
    const videoFilename2 = path.basename(outputVideo);
    const userId2 = req.user?.uid;
    if (userId2) {
      uploadVideoToFirebase(outputVideo, userId2, { prompt: voiceover?.slice(0,100), aspectRatio, captionStyle }).catch(console.error);
      // Real output duration, never totalAudioDuration (close, but ffprobe on
      // the actual finished file is exact and this is what gets billed).
      // Non-fatal on its own: the video is already done and saved by this
      // point, so a Firestore hiccup here must not turn a successful render
      // into a failed job - it logs for manual reconciliation instead.
      probeDurationSeconds(outputVideo)
        .then(secs => deductCredits(adminDb, userId2, secs))
        .catch(e => console.error('Credit deduction failed:', e.message));
    }
    updateJob(jobId, { status: "done", progress: 100, message: "Video ready!", videoUrl: `/videos/${videoFilename2}`, audioUrl: audioPublicUrl });
  } catch (err) {
    console.error("idea-to-video-v2 error:", err.message);
    updateJob(jobId, { status: "failed", message: err.message });
  } finally {
    releaseVideoSlot();
  }
});


// ===== TikTok OAuth & Content Posting =====

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_SANDBOX_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_SANDBOX_CLIENT_SECRET;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI;

// In-memory token store (replace with DB later)
// PKCE state lives here only for the length of one OAuth handshake, which is fine in
// memory. Access tokens do not.
const tiktokTokens = {};

// TikTok access tokens, in Firestore rather than in that object.
//
// They were in it, and it is a plain `{}` - so every pm2 restart disconnected every
// account. Nothing said so: the "Connected" badge reads connectedAccounts, which the
// client writes and which survives, while the token the server actually needs did not.
// The account looked linked and posting answered "TikTok not connected".
//
// Its own collection, not connectedAccounts/{uid}, because that document is readable by
// its owner and these are bearer credentials. No security rule mentions this path, and
// Firestore denies by default where no rule matches, so it is Admin-SDK-only by
// construction rather than by a rule someone has to remember to keep.
const TIKTOK_TOKENS = 'tiktokTokens';

async function saveTikTokToken(openId, data) {
  try {
    await adminDb.collection(TIKTOK_TOKENS).doc(openId).set({
      ...data,
      // When the access token stops working, so a refresh can be attempted rather than
      // the connection simply failing.
      expiresAt: Date.now() + (Number(data.expires_in) || 86400) * 1000,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[tiktok] could not persist token:', e.message);
  }
}

async function getTikTokToken(openId) {
  if (!openId) return null;
  const cached = tiktokTokens[openId];
  if (cached?.access_token) return cached;
  try {
    const snap = await adminDb.collection(TIKTOK_TOKENS).doc(openId).get();
    if (!snap.exists) return null;
    const t = snap.data();
    tiktokTokens[openId] = t;      // cache, so a burst of calls hits Firestore once
    return t;
  } catch (e) {
    console.error('[tiktok] token lookup failed:', e.message);
    return null;
  }
}

// Step 1: Generate TikTok OAuth URL
app.get('/tiktok/auth', tiktokLimiter, (req, res) => {
  const csrfState = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('hex');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  // Store verifier temporarily (in production use Redis/DB)
  tiktokTokens[csrfState] = { codeVerifier, createdAt: Date.now() };

  let url = 'https://www.tiktok.com/v2/auth/authorize/';
  url += `?client_key=${TIKTOK_CLIENT_KEY}`;
  url += `&scope=user.info.basic,video.publish,video.upload`;
  url += `&response_type=code`;
  url += `&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}`;
  url += `&state=${csrfState}`;
  url += `&code_challenge=${codeChallenge}`;
  url += `&code_challenge_method=S256`;

  res.redirect(url);
});

// Step 2: Handle TikTok OAuth callback
app.get('/tiktok/callback', tiktokLimiter, async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`https://tonefy-ai.fitlifesolutions.site?tiktok_error=${error}`);
  }

  const stored = tiktokTokens[state];
  if (!stored) {
    return res.status(400).json({ error: 'Invalid state' });
  }

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
        code_verifier: stored.codeVerifier,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return res.redirect(`https://tonefy-ai.fitlifesolutions.site?tiktok_error=${tokenData.error}`);
    }

    const { access_token, open_id, refresh_token, expires_in } = tokenData;

    // Store token, in memory AND on disk. The in-memory copy is only a cache now.
    tiktokTokens[open_id] = { access_token, refresh_token, expires_in, open_id };
    await saveTikTokToken(open_id, { access_token, refresh_token, expires_in, open_id });
    delete tiktokTokens[state];

    // Get user info
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url,open_id', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userData = await userRes.json();
    const user = userData.data?.user || {};

    // Redirect back to app with token info
    res.redirect(`https://tonefy-ai.fitlifesolutions.site/tiktok-success.html?open_id=${open_id}&display_name=${encodeURIComponent(user.display_name || '')}&avatar=${encodeURIComponent(user.avatar_url || '')}`);
  } catch (err) {
    console.error('TikTok callback error:', err.message);
    res.redirect(`https://tonefy-ai.fitlifesolutions.site?tiktok_error=server_error`);
  }
});

// Step 3: Get stored TikTok user info
app.get('/tiktok/user/:openId', tiktokLimiter, verifyToken, async (req, res) => {
  if (!(await tiktokOwnedBy(req.user?.uid, req.params.openId))) {
    return res.status(403).json({ error: 'Not your account.' });
  }
  const token = await getTikTokToken(req.params.openId);
  if (!token) return res.status(404).json({ error: 'Not connected' });
  res.json({ open_id: token.open_id, connected: true });
});

// Step 4: Post video to TikTok
// Does this openId belong to the caller?
//
// tiktokTokens is keyed by openId alone, so knowing someone's openId was enough to act
// as them - post to their account, read their profile, poll their uploads. An openId is
// not a secret: it travels to both clients and is stored in Firestore.
//
// connectedAccounts/{uid}.tiktok.openId is written when the account is linked, so it is
// the record of who owns what. Checked against the VERIFIED uid from the token, never
// anything in the body.
async function tiktokOwnedBy(uid, openId) {
  if (!uid || !openId) return false;
  try {
    const snap = await adminDb.collection('connectedAccounts').doc(uid).get();
    return snap.exists && snap.data()?.tiktok?.openId === openId;
  } catch (e) {
    // A lookup failure must not become an authorisation. Unlike the plan checks, where
    // failing open costs a subscriber nothing, failing open here posts to a stranger's
    // TikTok.
    console.error('tiktokOwnedBy lookup failed:', e.message);
    return false;
  }
}

// The video must live on THIS server.
//
// The handler downloads whatever URL it is given, and the route was unauthenticated, so
// anyone on the internet could make this box fetch any address - including the other
// pm2 services on localhost and the cloud metadata endpoint. That is a server-side
// request forgery, and rate limiting bounds it without preventing it.
//
// Both clients already send `${BACKEND}${videoPath}`, so nothing legitimate is refused.
function isOwnMediaUrl(u) {
  try {
    const parsed = new URL(String(u));
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'api.fitlifesolutions.site') return false;
    return /^\/(videos|uploads)\//.test(parsed.pathname);
  } catch (e) {
    return false;
  }
}

// Publishing, as a function rather than only as a route, so the queue sweep below runs
// exactly the same path a Post Now does. Two implementations of "send this to TikTok"
// would drift the first time one of them got a fix.
//
// Returns { ok, publishId } or { ok: false, error }. It never throws: the sweep records
// the reason on the post rather than failing a whole pass over one bad item.
async function publishToTikTok({ openId, videoUrl, title, privacyLevel = 'SELF_ONLY' }) {
  const token = await getTikTokToken(openId);
  if (!token) return { ok: false, error: 'TikTok not connected' };
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) return { ok: false, error: `Could not read the video (${videoRes.status})` };
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoSize = videoBuffer.length;

    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: title || 'Created with Tonefy AI',
          privacy_level: privacyLevel,
          disable_duet: false, disable_comment: false, disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'FILE_UPLOAD', video_size: videoSize,
          chunk_size: videoSize, total_chunk_count: 1,
        },
      }),
    });
    const initData = await initRes.json();
    if (initData.error?.code !== 'ok') {
      return { ok: false, error: initData.error?.message || 'Failed to init post' };
    }
    const uploadUrl = initData.data?.upload_url;
    const publishId = initData.data?.publish_id;
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
        'Content-Type': 'video/mp4',
      },
      body: videoBuffer,
    });
    return { ok: true, publishId };
  } catch (e) {
    return { ok: false, error: e.message || 'Upload failed' };
  }
}

// The queue actually publishes now.
//
// "Add to queue" wrote a scheduledPosts document with status 'queued' and told the user
// "Added to queue!" - and nothing anywhere read that collection. The post never
// happened, and the Calendar screen listed it as though it would. A promise the app
// could not keep.
//
// Every 5 minutes: anything queued and due, published through the same function Post Now
// uses, then marked posted or failed with the reason on the document so the Calendar can
// say what went wrong rather than showing it as pending for ever.
//
// Ownership is re-checked at publish time, not trusted from the queued document. A post
// sitting in a queue for a week outlives the connection that created it, and by then the
// account may have been disconnected or linked to someone else.
const QUEUE_SWEEP_MS = 5 * 60 * 1000;
async function scheduledPostSweep() {
  let snap;
  try {
    snap = await adminDb.collection('scheduledPosts').where('status', '==', 'queued').get();
  } catch (e) {
    console.error('[queue] could not read scheduled posts:', e.message);
    return;
  }
  const now = Date.now();
  for (const doc of snap.docs) {
    const p = doc.data();
    const due = Date.parse(p.scheduledFor || '');
    if (Number.isFinite(due) && due > now) continue;          // not yet
    if (!Array.isArray(p.platforms) || !p.platforms.includes('tiktok')) continue;

    const fail = async (error) => {
      await doc.ref.set({ status: 'failed', error, attemptedAt: new Date().toISOString() }, { merge: true });
      console.warn(`[queue] ${doc.id}: ${error}`);
    };

    let openId = null;
    try {
      const acc = await adminDb.collection('connectedAccounts').doc(p.userId).get();
      openId = acc.exists ? acc.data()?.tiktok?.openId : null;
    } catch (e) {
      // Could not establish ownership. Leave it queued and try next pass rather than
      // marking a good post failed over a transient Firestore error.
      console.warn(`[queue] ${doc.id}: ownership lookup failed, leaving queued`);
      continue;
    }
    if (!openId) { await fail('TikTok is no longer connected to this account.'); continue; }
    if (!isOwnMediaUrl(p.videoUrl)) { await fail('That video is no longer available.'); continue; }

    const r = await publishToTikTok({ openId, videoUrl: p.videoUrl, title: p.caption });
    if (r.ok) {
      await doc.ref.set({ status: 'posted', publishId: r.publishId || null,
        postedAt: new Date().toISOString(), error: null }, { merge: true });
      console.log(`[queue] posted ${doc.id}`);
    } else {
      await fail(r.error);
    }
  }
}
setInterval(scheduledPostSweep, QUEUE_SWEEP_MS);
scheduledPostSweep();

app.post('/tiktok/post-video', tiktokLimiter, verifyToken, async (req, res) => {
  const { openId, videoUrl, title, privacyLevel = 'SELF_ONLY' } = req.body;

  if (!(await tiktokOwnedBy(req.user?.uid, openId))) {
    return res.status(403).json({ error: 'That TikTok account is not connected to this login.' });
  }
  if (!isOwnMediaUrl(videoUrl)) {
    return res.status(400).json({ error: 'Only a video created in Tonefy can be posted.' });
  }

  const token = await getTikTokToken(openId);
  if (!token) return res.status(401).json({ error: 'TikTok not connected' });

  try {
    // Download video to buffer
    const videoRes = await fetch(videoUrl);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoSize = videoBuffer.length;

    // Initialize upload
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: title || 'Created with Tonefy AI',
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }),
    });

    const initData = await initRes.json();
    console.log('TikTok init response:', JSON.stringify(initData));
    if (initData.error?.code !== 'ok') {
      return res.status(400).json({ error: initData.error?.message || 'Failed to init post', details: initData });
    }

    const uploadUrl = initData.data?.upload_url;
    const publishId = initData.data?.publish_id;

    await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
        'Content-Length': String(videoSize),
      },
      body: videoBuffer,
    });

    res.json({
      success: true,
      publish_id: publishId,
      message: 'Video uploaded to TikTok successfully'
    });
  } catch (err) {
    console.error('TikTok post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Step 5: Check post status
app.get('/tiktok/post-status/:openId/:publishId', tiktokLimiter, verifyToken, async (req, res) => {
  if (!(await tiktokOwnedBy(req.user?.uid, req.params.openId))) {
    return res.status(403).json({ error: 'Not your account.' });
  }
  const { openId, publishId } = req.params;
  const token = await getTikTokToken(openId);
  if (!token) return res.status(401).json({ error: 'Not connected' });

  try {
    const statusRes = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const data = await statusRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



const PORT = process.env.PORT || 5000;

app.post('/api/edit-video', renderLimiter, async (req, res) => {
  // captionMeta is the app's style spec - font, size, colour, cadence and the
  // stroke/glow/shadow/box parts. captionStyle stays for older clients that send
  // an id and nothing else.
  const { videoUrl, script = "", captionStyle = "classic", captionMeta = null, voiceoverUrl } = req.body || {};
  // Same fix as media-to-video: the uid a render is attributed to (and
  // billed against) must come from the verified token, not a body field.
  const userId = req.user?.uid;
  if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

  // Unlike idea-to-video-v2, the real duration is cheaply knowable up front
  // here - this endpoint burns captions onto a video that already exists,
  // it doesn't generate one from scratch - so the full check (credits,
  // duration cap, caption style) can happen synchronously, before a job
  // is ever created, same as media-to-video. No resolution cap: this
  // endpoint doesn't scale or re-encode to a chosen resolution, it burns
  // captions onto the input at whatever resolution it already is - there's
  // nothing here to clamp without adding a re-encode step that isn't
  // otherwise part of this endpoint's job.
  const srcPath = videoUrl.startsWith('http')
    ? path.join(videosDir, uniqueName("editsrc", "mp4"))
    : path.join(videosDir, path.basename(videoUrl));
  if (videoUrl.startsWith('http')) {
    await downloadToFile(videoUrl, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
  }
  const duration = await probeDurationSeconds(srcPath);
  const { width: srcWidth, height: srcHeight } = await probeVideoDimensions(srcPath);

  const allowed = await checkRenderAllowed(adminDb, userId, { requestedDurationSeconds: duration });
  if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });
  if (!captionStyleAllowed(allowed.plan, captionStyle)) {
    return res.status(403).json({ error: `The "${captionStyle}" caption style is available on the Pro and Creator plans.` });
  }

  const jobId = createJob(req.user.uid);
  res.json({ jobId });

  // Queue behind the same 4-slot limiter idea-to-video-v2 has always used. Until
  // now this path had none: ten simultaneous exports all started at once, each
  // spawning ffmpeg plus up to 6 parallel ImageMagick processes on a 6-core box,
  // so every one of them ran roughly ten times slower. That is a worse failure
  // than queuing - a single slow export has already been mistaken for a hang here
  // and triggered an Android ANR - and it degrades every user at once rather than
  // making the last arrival wait.
  //
  // Acquired after res.json so the caller already holds its jobId and polls
  // normally while queued, and released in a finally: an early return or a throw
  // that skipped it would leak a slot permanently, and four leaked slots stop
  // every render on the server for good.
  updateJob(jobId, { message: 'Waiting for a free render slot...' });
  await acquireVideoSlot(allowed.tier.queuePriority > 0);

  try {
    updateJob(jobId, { progress: 5, message: "Loading video..." });

    // If a voiceover track was supplied, transcribe it for real word-synced captions
    // (TikTok-style auto captions) instead of relying on a manually-typed script.
    let effectiveScript = script;
    let wordTimestamps = null;
    if (voiceoverUrl) {
      updateJob(jobId, { progress: 15, message: "Transcribing voice..." });
      let audioLocalPath;
      try {
        if (voiceoverUrl.startsWith('http')) {
          audioLocalPath = path.join(uploadsDir, uniqueName("captionsrc", "mp3"));
          await downloadToFile(voiceoverUrl, audioLocalPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
        } else {
          audioLocalPath = resolveMediaPath(voiceoverUrl);
        }
        const whisperResult = await new Promise((resolve) => {
          execFile('python3', ['/home/ahumuza/Tonefy-react/backend/whisper_align.py', audioLocalPath],
            { timeout: 60000 }, (err, stdout) => {
              if (!err && stdout.trim()) {
                try { resolve(JSON.parse(stdout.trim())); } catch (e) { resolve(null); }
              } else { resolve(null); }
            });
        });
        wordTimestamps = whisperResult;
        if (wordTimestamps && wordTimestamps.length > 0) {
          effectiveScript = wordTimestamps.map(w => w.word).join(' ');
          console.log(`Auto-caption transcription: ${wordTimestamps.length} words`);
        }
      } catch (e) { console.warn('Voiceover transcription failed:', e.message); }
    }

    updateJob(jobId, { progress: 30, message: "Generating subtitles..." });

    const outputVideo = path.join(videosDir, uniqueName("edit", "mp4"));
    const assPath = outputVideo.replace('.mp4', '.ass');
    const hasCaptions = buildAssFile(effectiveScript, duration, assPath, captionStyle, wordTimestamps, captionMeta, srcWidth, srcHeight);
    const subsFilter = hasCaptions ? assFilter(assPath) : null;
    // Free tier only. Folded into the same filter chain as captions rather
    // than a separate pass - efficient when both apply, and means a
    // watermark-only export (no captions) still gets a real encode instead
    // of the stream-copy fast path, since -c copy can't add a filter at all.
    const watermark = allowed.watermark ? "drawtext=text='Tonefy AI':fontsize=18:fontcolor=white@0.5:x=(w-text_w)/2:y=h-th-20" : null;
    const vf = [subsFilter, watermark].filter(Boolean).join(',') || null;

    const ffmpegCmd = vf
      ? `ffmpeg -y -i "${srcPath}" -vf "${vf}" -c:a copy -pix_fmt yuv420p "${outputVideo}"`
      : `ffmpeg -y -i "${srcPath}" -c copy "${outputVideo}"`;

    updateJob(jobId, { progress: 60, message: "Burning subtitles..." });
    console.log("FFmpeg:", ffmpegCmd);

    await new Promise((resolve, reject) => {
      exec(ffmpegCmd, { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) { console.error("FFmpeg error:", stderr?.slice(-500)); return reject(new Error("FFmpeg failed")); }
        resolve();
      });
    });

    const filename = path.basename(outputVideo);
    const localUrl = `/videos/${filename}`;
    const actualDurationSeconds = await probeDurationSeconds(outputVideo);

    if (userId) {
      await adminDb.collection('userVideos').add({
        userId, filename, localUrl,
        downloadUrl: `${process.env.BASE_URL || 'https://api.fitlifesolutions.site'}${localUrl}`,
        prompt: script.slice(0, 100), aspectRatio: 'original', captionStyle,
        createdAt: new Date().toISOString(),
        size: fs.statSync(outputVideo).size,
        durationSeconds: actualDurationSeconds,
      });
      try { await deductCredits(adminDb, userId, actualDurationSeconds); }
      catch (e) { console.error('Credit deduction failed:', e.message); }
    }

    updateJob(jobId, { status: 'done', progress: 100, videoUrl: localUrl, message: "Done!" });
  } catch (e) {
    console.error("Edit video error:", e.message);
    updateJob(jobId, { status: 'error', error: e.message });
  } finally {
    releaseVideoSlot();
  }
});



// No limits/fileFilter previously - any client could upload files of
// unbounded size (disk-exhaustion DoS) or of any type at all (the app only
// ever sends image/video/audio, so anything else has no legitimate use
// here). 500MB is generous for real phone-recorded footage while still
// being a real ceiling, not a nominal one.
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image|video|audio)\//.test(file.mimetype);
    cb(ok ? null : new Error('Unsupported file type'), ok);
  },
});

// 60, not 20. A project accumulates clips over a whole editing session - split,
// replace, add again - and easily passes what one picker selection (selectionLimit:
// 20 in the app) allows in a single pick. The old cap threw multer's own
// LIMIT_UNEXPECTED_FILE for the 21st file, whose default .message is literally
// "Unexpected field" - so a real project's export failed with an error that read
// like a client bug rather than a limit being hit.
// multer signals every one of its limits by calling next(err) *before* the
// handler runs, so the route's own try/catch below never sees them and they
// fall through to Express's default error handler - an HTML 500 for what is
// really a 413 or a 400. apiFetch/readJson on the app side read .error off a
// JSON body, so the user got no explanation at all, just a failed export.
// Each case is named here instead, with the size stated rather than implied.
const uploadFiles = (req, res, next) => {
  upload.array('files', 60)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'That file is too large. Each file has to be under 500MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Too many files in one upload. Add them in smaller batches.' });
    }
    if (err.message === 'Unsupported file type') {
      return res.status(400).json({ error: 'Only image, video and audio files can be uploaded.' });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  });
};

app.post('/api/upload-media', uploadLimiter, uploadFiles, async (req, res) => {
  try {
    const urls = (req.files || []).map(f => {
      const ext = (path.extname(f.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
      const finalName = `${f.filename}${ext}`;
      fs.renameSync(f.path, path.join(uploadsDir, finalName));
      const type = f.mimetype.startsWith('image') ? 'image' : 'video';
      return { url: `/uploads/${finalName}`, type };
    });
    res.json({ items: urls });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function escDrawtext(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

// Resolution is the SHORT edge. It used to be a fixed [w,h] pair, which hardcoded
// every export to 9:16 - the app's resolution picker chose between three portrait
// sizes and there was no way to render anything else.
const SHORT_EDGE = { '720p': 720, '1080p': 1080, '4K': 2160 };
const ASPECTS = {
  '9:16': [9, 16], '4:5': [4, 5], '1:1': [1, 1],
  '16:9': [16, 9], '3:4': [3, 4], '2:3': [2, 3],
};

// libx264 needs even dimensions and rejects odd ones outright, so both are rounded
// to an even number rather than left to chance on a ratio like 2:3.
const even = n => Math.max(2, Math.round(n / 2) * 2);

function frameSize(resolution, aspectRatio) {
  const short = SHORT_EDGE[resolution] || SHORT_EDGE['1080p'];
  const [aw, ah] = ASPECTS[aspectRatio] || ASPECTS['9:16'];
  // The short edge keeps the chosen resolution whichever way round the frame is, so
  // switching a 1080p project from portrait to landscape does not halve its height.
  return aw <= ah
    ? [even(short), even((short * ah) / aw)]
    : [even((short * aw) / ah), even(short)];
}

// The same "ffprobe a file's duration" line already appears inline three
// times elsewhere in this file (audio duration checks) - not touched, since
// those are unrelated to credits and re-plumbing working code for the sake
// of sharing three lines isn't worth the churn. This is for the new credit-
// deduction call sites, which all need the same thing: the REAL duration of
// a finished export, never an estimate.
function probeDurationSeconds(filePath) {
  return new Promise((resolve) => {
    exec(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`, (err, stdout) => {
      resolve(parseFloat(stdout?.trim()) || 0);
    });
  });
}

// /api/edit-video burns captions onto the source clip's own resolution -
// there's no scale step whose target dimensions buildAssFile could borrow,
// unlike the two callers above that already know their output frame size
// from frameSize()/scaleFilter. Falls back to the 720x1280 default (matches
// buildAssFile's own default) if ffprobe can't read the stream - better to
// assume the common case than to leave the caption canvas unset.
function probeVideoDimensions(filePath) {
  return new Promise((resolve) => {
    exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`, (err, stdout) => {
      const m = /^(\d+)x(\d+)$/.exec(String(stdout || '').trim());
      resolve(m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : { width: 720, height: 1280 });
    });
  });
}

// The app ships the same TTFs and picks from the same list of family names, so the
// name -> file mapping is a manifest kept next to the fonts rather than a literal
// here that has to be edited in step with the app. Read once and cached: it is
// static for the life of the process, and this sits in the render loop.
//
// The fallback is the twenty-one families that were hardcoded before the manifest
// existed. It only matters if fonts/manifest.json goes missing, in which case an
// overlay in a family outside that set renders in ImageMagick's default face -
// the same thing that happened to every unmapped font before.
let FONT_FILE_MAP_CACHE = null;
function loadFontFileMap() {
  if (FONT_FILE_MAP_CACHE) return FONT_FILE_MAP_CACHE;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'fonts', 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
      FONT_FILE_MAP_CACHE = parsed;
      return FONT_FILE_MAP_CACHE;
    }
    console.warn('[fonts] manifest.json is empty, using built-in map');
  } catch (e) {
    console.warn('[fonts] manifest.json unreadable, using built-in map:', e.message);
  }
  FONT_FILE_MAP_CACHE = {
    'Montserrat': 'Montserrat-Bold.ttf',
    'Poppins': 'Poppins-Bold.ttf',
    'Bebas Neue': 'BebasNeue-Regular.ttf',
    'Anton': 'Anton-Regular.ttf',
    'Playfair Display': 'PlayfairDisplay-Bold.ttf',
    'Oswald': 'Oswald-Bold.ttf',
    'Caveat': 'Caveat-Bold.ttf',
    'Pacifico': 'Pacifico-Regular.ttf',
    'Lobster': 'Lobster-Regular.ttf',
    'Roboto Mono': 'RobotoMono-Bold.ttf',
    'Raleway': 'Raleway-Bold.ttf',
    'Inter': 'Inter-Bold.ttf',
    'Merriweather': 'Merriweather-Bold.ttf',
    'Lora': 'Lora-Bold.ttf',
    'Dancing Script': 'DancingScript-Bold.ttf',
    'Great Vibes': 'GreatVibes-Regular.ttf',
    'Space Mono': 'SpaceMono-Bold.ttf',
    'Archivo Black': 'ArchivoBlack-Regular.ttf',
    'Alfa Slab One': 'AlfaSlabOne-Regular.ttf',
    'Fredoka': 'Fredoka-Bold.ttf',
    'Bungee Inline': 'BungeeInline-Regular.ttf',
  };
  return FONT_FILE_MAP_CACHE;
}

// The graded and mirrored part of a clip's video filter chain, appended after the
// scale and crop so it works on the framed picture rather than on the source.
// Returns '' for a clip that asks for nothing, so the chain is unchanged for it.
// atempo only accepts 0.5..2.0 in one pass, so a rate outside that is reached by
// multiplying stages together - 3x is 2.0 then 1.5, 0.3x is 0.5 then 0.6. Without
// this the filter is rejected outright and the whole clip prep fails, which is worse
// than the audio simply not keeping up.
function atempoChain(speed) {
  const parts = [];
  let remaining = speed;
  while (remaining > 2.0) { parts.push('atempo=2.0'); remaining /= 2.0; }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 0.001) parts.push(`atempo=${remaining.toFixed(6)}`);
  return parts;
}

// Only these may appear in a client-sent grade. The chain is interpolated into an
// ffmpeg -vf argument, so an unrestricted string would let a crafted request add
// arbitrary filters - and the app only ever sends the handful below.
const ALLOWED_FILTER_OPS = new Set([
  'eq', 'colorbalance', 'curves', 'hue', 'colorchannelmixer',
  'vignette', 'noise', 'unsharp',
]);

// A motion is one ffmpeg filter string rather than a list, because zoompan and crop
// carry expressions full of commas and splitting on those would break them apart.
//
// Validated by character class instead of by op name for the same reason: the whole
// point of a motion is the expression, and an allowlist of ops says nothing about what
// is inside the parentheses. What matters is that it cannot escape its own filter -
// `;` would start a new filtergraph chain, `[` and `]` would name new pads, and the
// shell metacharacters would escape the double quotes the command is built with.
// Everything an expression legitimately needs is permitted.
//
// The catalogue lives in the app (constants/motions.js), so a motion added there
// renders without a deploy here - same arrangement as filters and transitions.
const MOTION_ALLOWED = /^[A-Za-z0-9_=:.,+\-*/()'<>?%\s]+$/;

function safeMotionChain(spec, w, h, fps) {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  if (spec.length > 600) return null;
  // Substituted BEFORE validating, and the order is the whole point. The placeholders
  // are written {W}/{H}/{FPS}, and braces are not - and must not be - in the allowed
  // set, so validating first rejects every motion in the catalogue. It fails silently
  // too: the clip renders perfectly, just without moving, which is indistinguishable
  // from a motion nobody selected. Caught by rendering one end to end and measuring
  // the frames rather than by reading this function.
  //
  // Validating the substituted string is also the stricter reading: what is checked is
  // exactly what reaches ffmpeg, rather than a template that still has to be edited.
  //
  // The size comes from the plan's resolution cap rather than the client, or a caller
  // could name its own and ask for an arbitrarily large intermediate.
  const filled = spec
    .replaceAll('{W}', String(w))
    .replaceAll('{H}', String(h))
    .replaceAll('{FPS}', String(fps));
  return MOTION_ALLOWED.test(filled) ? filled : null;
}

// A transition recipe from the client: an xfade base plus fx fragments gated to the
// join. Same shape the editor's export already sends, validated the same way its
// filter chains are - a known op name and no way out of the filter it belongs to.
// The filter ops a TRANSITION's fx may use. A superset of ALLOWED_FILTER_OPS, because
// a transition adds movement and damage where a grade only adds colour - a whip is
// gblur, a glitch is rgbashift, a VHS join is chromashift. Validating transition fx
// against the grade list silently strips exactly the fragments that make each
// transition distinct, leaving a plain xfade wearing its name.
const ALLOWED_TRANSITION_FX_OPS = new Set([
  ...ALLOWED_FILTER_OPS, 'gblur', 'rgbashift', 'chromashift',
]);

// The voice chain, in the order it has to run: clean it, then shape it, then level it.
// Used by a clip's own audio and by an audio track, from here, because two copies of a
// seven-filter chain drift the first time one of them is tuned.
//
//   highpass       rumble, handling noise and room tone - none of it speech. 85Hz is
//                  below a bass voice's fundamental.
//   afftdn         steady broadband noise: fans, hiss, traffic
//   deesser        sibilance, taken out BEFORE the presence boost that would worsen it
//   equalizer      +3dB around 3kHz, where intelligibility lives
//   acompressor    evens a delivery that moves toward and away from the mic
//   loudnorm       to -16 LUFS, which is where this app's music library already sits,
//                  so a voice and a bed mix without either being ducked into the other
//
// No model anywhere in it. arnndn is on this box and would want a .rnnn file; afftdn
// gets close enough on speech without one.
//
// The first version ended with speechnorm=e=6.25 + alimiter and measured -6.8 LUFS at a
// -0.3dB peak - twice the streaming standard with no headroom, which is crushed rather
// than clear. Targeting a loudness instead of maximising one is the whole difference.
const VOICE_CHAIN = [
  'highpass=f=85',
  'afftdn=nr=12:nf=-25',
  'deesser=i=0.4',
  'equalizer=f=3000:width_type=o:width=1.2:g=3',
  'acompressor=threshold=0.089:ratio=3:attack=20:release=250:makeup=2',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
];

// Audio effects, applied to a clip's own sound or to an audio track.
//
// The app sends an ID and nothing else. It does NOT send a filter string, unlike the
// video effect/motion/transition paths which take a chain and validate it - and that
// asymmetry is deliberate. Those exist because their catalogues are large, live in the
// app, and change without a deploy. This one is small enough that the safer shape is
// affordable: an unknown id renders nothing rather than being rejected-or-injected, and
// there is no filtergraph-injection surface here at all because no caller-supplied text
// ever reaches the command line.
//
// Every chain below was rendered against real speech and MEASURED, not eyeballed, with
// an instrument chosen per class - because the wrong instrument reports a working effect
// as dead, which is exactly what happened on the first pass here:
//
//   reverbs   autocorrelation at the delay lag. A whole-file FFT magnitude spectrum is
//             nearly blind to an echo (a delay moves phase, not magnitude), and reported
//             all five as no-ops. Measured properly they lift the lag peak from ~0.00 to
//             +0.27 (room) .. +0.60 (stadium).
//   pitch     median spectral-peak ratio across voiced frames. Autocorrelation f0 octave-
//             errored and reported `deep` as unchanged; by peak ratio it is exactly 0.700.
//   tone      energy share in the band the filter targets, not overall distance.
//   loudness  level, not spectrum. loudnorm is SUPPOSED to leave tone alone; judged on a
//             spectral measure it looks like a no-op while working perfectly (x1.40 level).
//
// bassBoost was retuned because of this pass rather than in spite of it: at
// `g=8:f=110` it measured x1.10 on speech - technically applied, inaudible in practice,
// since voice carries almost nothing below 110Hz. At `g=12:f=180` it measures x2.06.
const AUDIO_FX = {
  // Space
  room:        'aecho=0.8:0.85:40:0.25',
  hall:        'aecho=0.8:0.9:60|120:0.4|0.25',
  cathedral:   'aecho=0.8:0.9:150|300|450:0.5|0.35|0.2',
  stadium:     'aecho=0.8:0.9:250|500|750:0.5|0.35|0.2,bass=g=3:f=110',
  slapback:    'aecho=0.8:0.88:120:0.5',
  // Tone
  bassboost:   'bass=g=12:f=180:w=0.4',
  trebleboost: 'treble=g=6:f=4000',
  warm:        'bass=g=4:f=120,treble=g=-3:f=6000',
  bright:      'treble=g=7:f=5000,equalizer=f=2500:t=q:w=1.2:g=3',
  deess:       'deesser=i=0.5',
  loudness:    'loudnorm=I=-16:TP=-1.5:LRA=11',
  // Voice
  chipmunk:    'rubberband=pitch=1.5',
  deep:        'rubberband=pitch=0.7',
  uptone:      'rubberband=pitch=1.122',
  downtone:    'rubberband=pitch=0.891',
  robot:       "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  // Character
  telephone:   'highpass=f=400,lowpass=f=3200,acompressor=ratio=4',
  radio:       'highpass=f=200,lowpass=f=5000,acompressor=threshold=0.1:ratio=6:attack=5:release=50,volume=1.3',
  podcast:     'highpass=f=80,equalizer=f=200:t=q:w=1:g=-3,equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=0.08:ratio=3:attack=10:release=120',
  underwater:  'lowpass=f=700,aecho=0.8:0.9:60:0.4',
  megaphone:   'highpass=f=500,lowpass=f=4000,acrusher=bits=8:mode=log,volume=1.2',
  vinyl:       'highpass=f=100,lowpass=f=7000,aecho=0.9:0.9:12:0.15,volume=1.1',
  bitcrush:    'acrusher=bits=6:samples=4:mode=log',
};

// Returns the filters for an id, or [] for anything unknown - including undefined, which
// is the ordinary case for every clip and track nobody has put an effect on.
function audioFxChain(id) {
  const chain = AUDIO_FX[typeof id === 'string' ? id : ''];
  return chain ? [chain] : [];
}

function safeTransitionSpec(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const base = String(spec.base || '').trim();
  // xfade transition names are plain identifiers. Anything else is not one.
  if (!/^[a-z0-9]+$/.test(base)) return null;
  const fx = Array.isArray(spec.fx) ? spec.fx.filter(part => {
    const str = String(part);
    if (/[;"'`$\\\n\[\]]/.test(str)) return false;
    return ALLOWED_TRANSITION_FX_OPS.has(str.split('=')[0].trim());
  }) : [];
  return { base, fx };
}

function safeFilterChain(chain) {
  if (!Array.isArray(chain)) return null;
  const ok = chain.filter(part => {
    const str = String(part);
    // No shell metacharacters, no chaining out of the op, and a known op name.
    if (/[;"'`$\\\n]/.test(str)) return false;
    const op = str.split('=')[0].trim();
    return ALLOWED_FILTER_OPS.has(op);
  });
  return ok.length ? ok : null;
}

// How the footage meets the frame.
//
// Fill is the original behaviour and is emitted byte-identically, so a project that
// says nothing about a background renders exactly as it did.
//
// Fit scales the whole shot inside the frame and fills what is left. Colour is a pad;
// blur splits the input, uses a cropped-and-blurred copy as the backdrop and lays the
// contained copy over it - which is the only one of the two that needs a graph rather
// than a chain, because the same frame has to be used twice.
// The user's crop, applied to the SOURCE before it meets the frame.
//
// Stored as fractions rather than pixels so one rectangle is correct for the phone's
// preview and for a 4K master. Expressed with iw/ih for the same reason - ffmpeg
// resolves them against whatever the real frame turns out to be, so nothing here has
// to know the source's dimensions.
function sourceCropFilter(crop) {
  if (!crop) return null;
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const x = Math.min(Math.max(n(crop.x, 0), 0), 1);
  const y = Math.min(Math.max(n(crop.y, 0), 0), 1);
  const w = Math.min(Math.max(n(crop.w, 1), 0.01), 1 - x);
  const h = Math.min(Math.max(n(crop.h, 1), 0.01), 1 - y);
  // A full-frame crop is not a crop, and emitting one would change nothing while
  // costing a filter pass on every clip in every project.
  if (x === 0 && y === 0 && w === 1 && h === 1) return null;
  // Even dimensions: libx264 rejects odd ones, and a fractional crop of an arbitrary
  // source will produce them.
  return `crop=floor(iw*${w.toFixed(5)}/2)*2:floor(ih*${h.toFixed(5)}/2)*2`
    + `:floor(iw*${x.toFixed(5)}):floor(ih*${y.toFixed(5)})`;
}

function frameFitFilter(W, H, bg) {
  const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  if (!bg || bg.fit !== 'fit') return fill;

  const contain = `scale=${W}:${H}:force_original_aspect_ratio=decrease`;
  if (bg.type === 'colour') {
    // pad centres the scaled frame and paints the remainder in one filter.
    return `${contain},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${safeColor(bg.colour, '#000000')}`;
  }
  const sigma = Math.max(0, Math.min(60, Number(bg.blur) || 0)).toFixed(1);
  return `split[bgsrc][fgsrc];`
    + `[bgsrc]${fill},gblur=sigma=${sigma}[bgblur];`
    + `[fgsrc]${contain}[fgfit];`
    + `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2`;
}

// Green screen. Keys the backdrop out and puts the project's own canvas background
// behind the subject - a colour, or a blurred copy of the clip, which is the same
// choice frameFitFilter already offers.
//
// Keying alone is not a feature: it makes the backdrop transparent, and transparent
// renders black. What makes it useful is having something to composite onto, and this
// app already had that.
//
// despill is not optional. Chromakey removes the green pixels; the green LIGHT bounced
// onto the subject's edges and hair stays, and reads as a lime fringe against whatever
// is now behind them. Every convincing key has a despill after it.
//
// similarity too low leaves the backdrop, too high eats the subject - 0.30 with 0.10
// blend is the usual starting point for evenly lit footage, and both are adjustable
// from the app.
function chromaKeyFilter(W, H, item, bg) {
  const ck = item.chromaKey;
  if (!ck) return null;
  const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const colour = safeColor(ck.colour, '#00b140').replace('#', '0x');
  const similarity = Math.max(0.01, Math.min(0.9, Number(ck.similarity) || 0.30)).toFixed(2);
  const blend = Math.max(0, Math.min(0.5, Number(ck.blend) || 0.10)).toFixed(2);
  // Which green to despill is decided by the key colour, not assumed: a blue screen
  // needs the blue variant, and despilling the wrong channel does nothing at all.
  const spill = /^0x[0-9a-f]{2}[0-9a-f]{2}([0-9a-f]{2})$/i.test(colour)
    && parseInt(colour.slice(6, 8), 16) > parseInt(colour.slice(4, 6), 16) ? 'blue' : 'green';

  const backdrop = (bg && bg.type === 'colour')
    ? `${fill},drawbox=c=${safeColor(bg.colour, '#000000')}@1:t=fill`
    : `${fill},gblur=sigma=${Math.max(0, Math.min(60, Number(bg?.blur) || 20)).toFixed(1)}`;

  return `split[ckbg][ckfg];`
    + `[ckbg]${backdrop}[ckbgout];`
    + `[ckfg]chromakey=${colour}:${similarity}:${blend},despill=type=${spill},${fill}[ckfgout];`
    + `[ckbgout][ckfgout]overlay=(W-w)/2:(H-h)/2`;
}

// Quarter-turn rotation. It has to run BEFORE the fit-to-frame, because a transpose
// swaps width and height and the fit is what puts the result back into the output frame.
// Quarter turns only, deliberately: an arbitrary angle leaves empty corners that need a
// cover-zoom computed from the clip's real dimensions, and the case that actually comes
// up is footage shot sideways.
function clipRotateFilter(item = {}) {
  const deg = ((Math.round(num(item.rotate, 0) / 90) * 90) % 360 + 360) % 360;
  if (deg === 90) return 'transpose=1';
  if (deg === 270) return 'transpose=2';
  if (deg === 180) return 'hflip,vflip';
  return '';
}

// Zoom and pan inside the frame, and clip opacity. Both run after the fit, so the frame
// is already W x H and these cannot change its size.
//
// The crop expressions are deliberately dimension-agnostic: after `scale=iw*S:ih*S`, the
// crop filter's own `in_w` IS the scaled width, so `in_w/S` is exactly the original. No
// clip's real dimensions are needed at build time, which is what lets this sit in a
// shared helper rather than being computed per clip.
//
// Zoom is 1.0 and up only. Below 1 the crop would ask for more picture than exists and
// the filter fails - zooming out needs a pad and a decision about what fills the margin,
// which is what the Background setting already answers.
function clipTransformFilter(item = {}) {
  const t = item.transform;
  if (!t || typeof t !== 'object') return [];
  const z = Math.max(1, Math.min(3, num(t.zoom, 1)));
  const dx = Math.round(Math.max(-100, Math.min(100, num(t.x, 0))));
  const dy = Math.round(Math.max(-100, Math.min(100, num(t.y, 0))));
  if (z === 1 && dx === 0 && dy === 0) return [];
  const S = z.toFixed(4);
  // The offset is a percentage of the hidden margin, so the pan cannot run off the
  // picture at any zoom - at z=1 there is no margin and it correctly does nothing.
  const ox = `(in_w-in_w/${S})*${(0.5 + dx / 200).toFixed(4)}`;
  const oy = `(in_h-in_h/${S})*${(0.5 + dy / 200).toFixed(4)}`;
  return [`scale=iw*${S}:ih*${S}`, `crop=in_w/${S}:in_h/${S}:${ox}:${oy}`];
}

// Clip opacity, over black.
//
// It composites against a box it draws itself rather than relying on whatever is behind
// it, because in the default `fill` mode there IS nothing behind it: frameFitFilter only
// builds a background layer when fit is 'fit'. Setting alpha alone would have been
// discarded on the way to yuv420p and done nothing at all - visibly fine in `fit` mode
// and a silent no-op in the mode almost everyone uses.
// Shape masks.
//
// The mask is a grey PNG generated ONCE per (shape, size, feather) and multiplied into
// the picture. Three approaches were timed on a real 4-second 720x1280 clip against a
// 2.3s baseline re-encode:
//
//   geq per-pixel alpha        33.9s   - 8.5x realtime. A one-minute clip would take
//                                        over eight minutes, with four renders sharing
//                                        six cores. Not usable.
//   alphamerge + overlay        9.8s
//   blend=multiply              4.8s   - the mask costs ~2.5s. This one.
//
// It must multiply in **gbrp, not yuv420p**. Multiplying yuv multiplies the chroma
// planes too, and U/V are centred at 128, so the result is driven toward green - the
// shape comes out right and every colour is destroyed. That is not visible in a timing
// test and only shows up by looking at a frame or sampling a pixel: the same spot read
// srgb(119,255,0) in yuv against srgb(253,244,45) in gbrp, on a yellow bar.
//
// Loaded with `movie=` rather than a second -i, so this stays a single -vf string and
// the clip pipeline does not have to learn about extra inputs. Verified equivalent to
// the two-input form: RMSE 0.37%, which is encoder noise, against 37% for a real
// difference.
const MASK_SHAPES = ['ellipse', 'circle', 'rect', 'rounded'];

async function ensureMaskImage(shape, W, H, feather) {
  const f = Math.max(0, Math.min(100, Math.round(feather)));
  const name = `maskshape-${shape}-${W}x${H}-f${f}.png`;
  const out = path.join(uploadsDir, name);
  // Deterministic name, so the second clip using the same mask pays nothing. Cheap to
  // regenerate if the uploads sweep ever takes it.
  if (fs.existsSync(out)) return out;

  const cx = Math.round(W / 2), cy = Math.round(H / 2);
  const rx = Math.round(W * 0.455), ry = Math.round(H * 0.455);
  const r = Math.min(rx, ry);
  let draw;
  if (shape === 'circle') draw = `ellipse ${cx},${cy} ${r},${r} 0,360`;
  else if (shape === 'rect') draw = `rectangle ${cx - rx},${cy - ry} ${cx + rx},${cy + ry}`;
  else if (shape === 'rounded') draw = `roundrectangle ${cx - rx},${cy - ry} ${cx + rx},${cy + ry} ${Math.round(r * 0.22)},${Math.round(r * 0.22)}`;
  else draw = `ellipse ${cx},${cy} ${rx},${ry} 0,360`;

  // Blur sigma scaled to the frame, so the same feather setting looks the same at 720p
  // and 1080p rather than softening by a fixed number of pixels.
  const sigma = Math.max(0, Math.round((f / 100) * Math.min(W, H) * 0.12));
  const args = ['-size', `${W}x${H}`, 'xc:black', '-fill', 'white', '-draw', draw];
  if (sigma > 0) args.push('-blur', `0x${sigma}`);
  args.push(out);
  await run('convert', args, { timeout: 60000 });
  return out;
}

function clipMaskFilter(maskPath, W, H) {
  if (!maskPath) return '';
  return `format=gbrp[mksrc];movie=${maskPath},format=gbrp,scale=${W}:${H}[mkimg];`
    + `[mksrc][mkimg]blend=all_mode=multiply,format=yuv420p`;
}

function clipOpacityFilter(item = {}) {
  const o = num(item.opacity, 1);
  if (!(o >= 0 && o < 1)) return '';
  const a = o.toFixed(3);
  return `split[opa][opb];[opa]drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill[opbg];`
    + `[opb]format=rgba,colorchannelmixer=aa=${a}[opfg];[opbg][opfg]overlay=0:0`;
}

function clipLookFilter(item = {}) {
  const parts = [];
  // Mirroring is about the framing, so it comes before the grade.
  if (item.flipH) parts.push('hflip');
  if (item.flipV) parts.push('vflip');
  // Framing before grading: a zoom changes what is in shot, not how it is coloured.
  parts.push(...clipTransformFilter(item));

  // The app sends the grade as a chain, so the catalogue lives in one place and a
  // filter added there renders without a deploy here. Older clients send only a name
  // and fall through to the seven below.
  const spec = safeFilterChain(item.filterSpec);
  if (spec) {
    parts.push(...spec);
    return parts.length ? ',' + parts.join(',') : '';
  }

  switch (item.filter) {
    case 'Bright': parts.push('eq=brightness=0.10'); break;
    case 'Contrast': parts.push('eq=contrast=1.30'); break;
    // Warm and Cool move the red and blue gammas apart rather than shifting every
    // channel's brightness, which would wash the picture out instead of tinting it.
    case 'Warm': parts.push('eq=gamma_r=1.12:gamma_b=0.92'); break;
    case 'Cool': parts.push('eq=gamma_r=0.92:gamma_b=1.12'); break;
    case 'Fade': parts.push('eq=contrast=0.85:brightness=0.06:saturation=0.80'); break;
    case 'B&W': parts.push('hue=s=0'); break;
    default: break;
  }
  return parts.length ? ',' + parts.join(',') : '';
}

// A pre-flight estimate only - gates the per-video duration cap before any
// rendering starts. The real credit deduction after success uses ffprobe on
// the actual output, never this. Mirrors the same per-item duration logic
// the clip-prep loop below actually renders with: a still runs for its
// duration field (3s default, matching that loop), a video clip runs for
// (trimEnd - trimStart) adjusted by speed - a 10s trimmed span at 2x speed
// renders out to 5s, matching the setpts filter applied below.
function estimateMediaItemsDurationSeconds(mediaItems) {
  return mediaItems.reduce((total, item) => {
    if (item.type === 'image') {
      return total + (Number(item.duration) > 0 ? Number(item.duration) : 3);
    }
    const ss = Number(item.trimStart) > 0 ? Number(item.trimStart) : 0;
    const te = Number(item.trimEnd) > ss ? Number(item.trimEnd) : ss + (Number(item.duration) > 0 ? Number(item.duration) : 5);
    const rawSpeed = Number(item.speed);
    const spd = Number.isFinite(rawSpeed) && rawSpeed > 0 ? Math.max(0.1, Math.min(10, rawSpeed)) : 1;
    return total + (te - ss) / spd;
  }, 0);
}

app.post('/api/media-to-video', renderLimiter, async (req, res) => {
  const { mediaItems = [], resolution = '1080p', aspectRatio = '9:16', background = null, textOverlays = [], overlays = [], audioTracks = [], previewWidth } = req.body || {};
  // The uid this render (and, once credits exist, its cost) is attributed to
  // must come from the verified token, never the request body - a body field
  // is just a value the client typed, and trusting it let anyone render
  // against, or misattribute a record to, any other account.
  const userId = req.user?.uid;
  if (!mediaItems.length) return res.status(400).json({ error: "mediaItems required" });

  // Credits and caps are checked BEFORE a job is created - a rejected
  // request must not get a jobId back, or the client has no way to tell
  // "this was declined" from "this is queued."
  const estimatedSeconds = estimateMediaItemsDurationSeconds(mediaItems);
  const allowed = await checkRenderAllowed(adminDb, userId, {
    requestedDurationSeconds: estimatedSeconds,
    requestedResolution: resolution,
  });
  if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

  const jobId = createJob(req.user.uid);
  res.json({ jobId });

  // Queue behind the same 4-slot limiter idea-to-video-v2 has always used. Until
  // now this path had none: ten simultaneous exports all started at once, each
  // spawning ffmpeg plus up to 6 parallel ImageMagick processes on a 6-core box,
  // so every one of them ran roughly ten times slower. That is a worse failure
  // than queuing - a single slow export has already been mistaken for a hang here
  // and triggered an Android ANR - and it degrades every user at once rather than
  // making the last arrival wait.
  //
  // Acquired after res.json so the caller already holds its jobId and polls
  // normally while queued, and released in a finally: an early return or a throw
  // that skipped it would leak a slot permanently, and four leaked slots stop
  // every render on the server for good.
  updateJob(jobId, { message: 'Waiting for a free render slot...' });
  await acquireVideoSlot(allowed.tier.queuePriority > 0);

  try {
    updateJob(jobId, { progress: 5, message: "Preparing clips..." });
    const [W, H] = frameSize(allowed.resolution, aspectRatio);

    const tempClips = [];
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const srcPath = resolveMediaPath(item.url);
      console.log('CLIPDEBUG url=', item.url, 'resolved=', srcPath, 'exists=', fs.existsSync(srcPath));
      const clipOut = path.join(videosDir, uniqueName("clip", "mp4"));

      // Everything the clip carries beyond its pixels: where it starts and stops, how
      // long a still is held, which way round it is and what it has been graded to.
      // All of it used to be dropped here - the app sent trimStart, trimEnd, duration
      // and filter on every clip and this read none of them, so a trim you could see
      // on the timeline came back untrimmed in the file you exported.
      const look = clipLookFilter(item);
      // Crop the source first, then fit what is left into the frame. The other order
      // would crop the FRAME - taking a corner out of the finished video rather than
      // choosing which part of the shot is used.
      const srcCrop = sourceCropFilter(item.crop);
      // Kept as head and tail rather than one string so stabilisation can be spliced
      // between them. It has to run on source-resolution frames, before the fit into
      // the output frame - vidstabtransform shifts and rotates the picture, and doing
      // that after the pad would move the padding around with it.
      // Rotation belongs with the source crop, ahead of the fit: a transpose swaps
      // width and height, and the fit is what puts the turned picture back into the
      // output frame. After the fit it would leave the frame the wrong shape.
      const rotate = clipRotateFilter(item);
      const vfHead = [srcCrop, rotate].filter(Boolean).join(',') + ((srcCrop || rotate) ? ',' : '');
      // Motion runs LAST, on frames already fitted to the output size. Running it
      // earlier would reframe the source and then let the fit undo it - a zoompan
      // followed by a pad puts the padding back around the zoomed picture, so the zoom
      // stops reaching the edges of the video and reads as a shrinking photograph.
      // Replaces the fit rather than following it: both decide how the frame is filled,
      // and running the ordinary fit first would crop the picture the key is about to
      // composite, leaving the backdrop and the subject scaled differently.
      // item.type checked inline rather than via isVideo, which is a const declared
      // forty lines BELOW this point - reading it here is a temporal dead zone error
      // that node --check cannot see and that would throw on the first render.
      const chroma = item.type !== 'image' ? chromaKeyFilter(W, H, item, background) : null;
      const motion = safeMotionChain(item.motionSpec, W, H, 30);
      // Effect after motion, deliberately. The effect should act on the framing the
      // motion chose - a glitch tear across a picture that is then zoomed would have
      // its own tear scaled up along with the picture, which is not what either of them
      // was asked to do. Same validator: both are single filter strings carrying
      // expressions, and both must be unable to escape into the wider filtergraph.
      const effect = safeMotionChain(item.effectSpec, W, H, 30);
      // Mask after the fit, so the shape is measured against the OUTPUT frame rather
      // than the source - a mask sized to a landscape clip inside a 9:16 project would
      // otherwise be cropped along with the picture and come out an off-centre sliver.
      const maskShape = item.mask && MASK_SHAPES.includes(item.mask.shape) ? item.mask.shape : null;
      const maskPath = maskShape
        ? await ensureMaskImage(maskShape, W, H, num(item.mask.feather, 40))
        : null;
      const mask = clipMaskFilter(maskPath, W, H);

      // Opacity is last because it composites the finished picture - the grade, the
      // motion, the effect and the mask all have to have happened before it fades.
      const opacity = clipOpacityFilter(item);
      const vfTail = `${chroma || frameFitFilter(W, H, background)},setsar=1${look}`
        + `${motion ? ',' + motion : ''}${effect ? ',' + effect : ''}`
        + `${mask ? ',' + mask : ''}`
        + `${opacity ? ',' + opacity : ''}`;
      const vf = `${vfHead}${vfTail}`;

      // Every prepared clip carries an audio stream, even when that stream is
      // silence. Clips used to be prepped with -an, so the original sound was thrown
      // away here and an export had nothing in it but the voiceover and music the
      // user added - a project of plain camera clips came out silent. Giving even
      // stills and muted clips a real silent track keeps the concat below uniform:
      // one branch that always has [n:a] to work with, rather than a chain that has
      // to know which clips happen to have sound.
      const SILENCE_IN = '-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100';
      const clipVol = Number.isFinite(Number(item.volume))
        ? Math.max(0, Math.min(4, Number(item.volume)))
        : 1;
      // Muting is the clip's own switch; volume 0 is the same outcome by another
      // route, and either way there is no point decoding audio to silence it.
      const wantsSound = !item.muted && clipVol > 0;
      // Speed was sent on every clip and read by nothing here, so a clip set to 2x on
      // the timeline exported at 1x - and ran for twice as long as the timeline said,
      // pushing everything after it out of sync.
      const rawSpeed = Number(item.speed);
      const spd = Number.isFinite(rawSpeed) && rawSpeed > 0 ? Math.max(0.1, Math.min(10, rawSpeed)) : 1;
      const speedVf = spd !== 1 ? `,setpts=${(1 / spd).toFixed(6)}*PTS` : '';

      // --- Free, ffmpeg-native clip tools -------------------------------------
      // Each is a plain filter this build already ships (verified with
      // `ffmpeg -filters`), so they cost CPU and nothing else - no model, no API,
      // no per-use fee. Stills are excluded: there is nothing in a single frame to
      // reverse, denoise or blur across time.
      const isVideo = item.type !== "image";
      const wantsReverse = isVideo && item.reverse === true;
      const wantsDenoise = isVideo && item.denoise === true;
      const wantsMotionBlur = isVideo && item.motionBlur === true;
      const wantsStabilize = isVideo && item.stabilize === true;
      // Hold the last frame. The outro move - a clip that stops dead is abrupt, and a
      // held final frame is where a caption or a logo goes.
      //
      // Clamped rather than trusted: this is duration the client asks the server to
      // invent, and it is also duration the credit check upstream did not count, so an
      // unbounded value would render time nobody was charged for.
      const freezeEnd = isVideo
        ? Math.max(0, Math.min(5, Number(item.freezeEnd) || 0))
        : 0;

      // reverse is the one that cannot simply be switched on: it holds every
      // decoded frame of the clip in memory at once, because the last frame has to
      // be written first. At the 720x1280 this chain has already scaled to, that is
      // ~1.4MB a frame, so 15s at 30fps is roughly 620MB - for one clip, and up to
      // four renders now run concurrently. Refused past the cap rather than left to
      // find the OOM killer, and the message says the number so it is actionable.
      const REVERSE_MAX_SECONDS = 15;
      if (wantsReverse) {
        const ss0 = Number(item.trimStart) > 0 ? Number(item.trimStart) : 0;
        const te0 = Number(item.trimEnd) > ss0 ? Number(item.trimEnd) : null;
        const span0 = te0 !== null ? te0 - ss0 : Number(item.duration) || 0;
        if (span0 > REVERSE_MAX_SECONDS) {
          throw new Error(`Reverse works on clips up to ${REVERSE_MAX_SECONDS} seconds. Trim this clip shorter and try again.`);
        }
      }

      // Order matters. reverse before setpts, so speed applies to the reversed clip
      // rather than the other way round; motion blur last, so it blends the frames
      // that will actually be shown.
      const extraVf =
        (wantsReverse ? ',reverse' : '') +
        (wantsMotionBlur ? ',tmix=frames=3' : '') +
        // LAST in the chain, deliberately. tpad clones the final frame, so it has to
        // see the frame every other filter has already finished with - put before
        // reverse it would hold the frame the clip no longer ends on.
        (freezeEnd > 0 ? `,tpad=stop_mode=clone:stop_duration=${freezeEnd}` : '');
      // afftdn is a spectral denoiser - it lifts hiss and room tone off a phone
      // voiceover, which is the case this exists for. areverse mirrors the video.
      // A clip can carry the voice chain too - a talking head recorded in camera has
      // its speech in the clip's own audio, not on a separate track. Same fragments as
      // the audio-track path below, from one definition, so the two cannot drift.
      const wantsVoice = isVideo && item.enhanceVoice === true;
      const extraAfPre = (wantsReverse ? ['areverse'] : [])
        .concat(wantsDenoise ? ['afftdn'] : [])
        .concat(wantsVoice ? VOICE_CHAIN : []);

      // reverse decodes the whole clip and tmix blends every frame, so both are far
      // slower than the plain copy this timeout was sized for.
      // Stabilisation is two full decodes of the clip, so it gets the most room.
      const clipTimeoutMs = wantsStabilize ? 300000
        : (wantsReverse || wantsMotionBlur) ? 180000
        : 60000;

      // Declared out here so the finally below removes it whether the transform
      // succeeded, threw, or was never reached.
      let stabTrf = null;

      let cmd;
      if (item.type === "image") {
        // A still is held for as long as the timeline holds it. Three seconds was
        // the app's default, not its answer.
        const stillDur = Number(item.duration) > 0 ? Number(item.duration) : 3;
        cmd = `ffmpeg -y -loop 1 -i "${srcPath}" ${SILENCE_IN} -t ${stillDur.toFixed(3)} -vf "${vf}" -pix_fmt yuv420p -r 30 -c:a aac -shortest "${clipOut}"`;
      } else {
        // trimStart/trimEnd are absolute offsets into the source, so the clip runs for
        // the difference. -ss before -i so the seek does not decode everything ahead
        // of the in point; ffmpeg has seeked accurately from that position for years.
        const ss = Number(item.trimStart) > 0 ? Number(item.trimStart) : 0;
        const te = Number(item.trimEnd) > ss ? Number(item.trimEnd) : null;
        const seek = ss > 0 ? `-ss ${ss.toFixed(3)} ` : '';
        // -t goes before -i, so it bounds how much of the SOURCE is read rather than
        // how long the output runs. As an output option it would fight the speed
        // filter: a clip slowed to 0.5x runs twice the span, and -t would cut it in
        // half again - the trim would silently shorten as soon as speed was applied.
        const span = te !== null ? `-t ${(te - ss).toFixed(3)} ` : '';
        const inSpec = `${seek}${span}-i "${srcPath}"`;
        // A source with no audio track of its own - a screen recording, a GIF turned
        // mp4 - would leave the map unsatisfied, so ask first rather than let the
        // whole clip prep fail on it.
        const srcHasAudio = wantsSound ? await hasAudioStream(srcPath) : false;

        // Stabilisation is two passes. The first measures the camera's motion and
        // writes it to a .trf; the second applies the correction. The measurements
        // are indexed by frame number, so the detect pass MUST read exactly the same
        // frames the transform pass will - same inSpec, so the same -ss/-t window,
        // and the same crop ahead of it. Give it a different window and the
        // corrections land on the wrong frames, which does not fail, it just shakes
        // the clip differently.
        let vfForClip = vf;
        if (wantsStabilize) {
          stabTrf = path.join(videosDir, uniqueName("vidstab", "trf"));
          const detectCmd = `ffmpeg -y ${inSpec} -vf "${vfHead}vidstabdetect=shakiness=5:accuracy=15:result=${stabTrf}" -f null -`;
          await new Promise((resolve, reject) => {
            exec(detectCmd, { timeout: clipTimeoutMs }, (err, stdout, stderr) => {
              if (err) { console.error("Stabilise detect error:", stderr?.slice(-300)); return reject(new Error("Stabilise failed")); }
              resolve();
            });
          });
          // unsharp after the transform is ffmpeg's own recommendation for this
          // filter: correcting shake resamples every frame, which softens it, and a
          // light sharpen puts back roughly what the interpolation took out.
          vfForClip = `${vfHead}vidstabtransform=input=${stabTrf}:smoothing=30:crop=black,unsharp=5:5:0.8:3:3:0.4,${vfTail}`;
        }
        if (srcHasAudio) {
          // atempo changes tempo and leaves pitch alone, so a sped-up voice stays the
          // same voice. The preview is told to correct pitch too (shouldCorrectPitch),
          // because the two have to agree - expo-av left to its default shifts pitch
          // with rate, and the export would then not sound like what was auditioned.
          // apad matches the audio to the held frame. Without it the stream ends where
        // the sound did and the frozen tail has nothing under it, which ffmpeg resolves
        // by ending the clip early - so the freeze silently would not happen at all.
        const af = ['volume=' + clipVol].concat(audioFxChain(item.audioFx)).concat(extraAfPre)
          .concat(spd !== 1 ? atempoChain(spd) : [])
          .concat(freezeEnd > 0 ? [`apad=pad_dur=${freezeEnd}`] : []).join(',');
          cmd = `ffmpeg -y ${inSpec} -vf "${vfForClip}${extraVf}${speedVf}" -af "${af}" -pix_fmt yuv420p -r 30 -c:a aac "${clipOut}"`;
        } else {
          cmd = `ffmpeg -y ${inSpec} ${SILENCE_IN} -vf "${vfForClip}${extraVf}${speedVf}" -pix_fmt yuv420p -r 30 -map 0:v:0 -map 1:a:0 -c:a aac -shortest "${clipOut}"`;
        }
      }
      try {
        await new Promise((resolve, reject) => {
          exec(cmd, { timeout: clipTimeoutMs }, (err, stdout, stderr) => {
            if (err) { console.error("Clip prep error:", stderr?.slice(-300)); return reject(new Error("Clip prep failed")); }
            resolve();
          });
        });
      } finally {
        // One per stabilised clip, and they are pure scratch - nothing reads a .trf
        // after its transform pass. Left behind they would accumulate exactly like
        // the txtrender-*.png leak did (aaa0f043).
        if (stabTrf) { try { fs.unlinkSync(stabTrf); } catch (e) {} }
      }
      tempClips.push(clipOut);
      updateJob(jobId, { progress: 5 + Math.round((i + 1) / mediaItems.length * 40), message: `Processing clip ${i + 1}/${mediaItems.length}...` });
    }

    // Concat via xfade chain (per-boundary transitions from mediaItems[i].transition)
    async function hasAudioStream(filePath) {
      return new Promise((resolve) => {
        exec(`ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${filePath}"`,
          (err, stdout) => resolve(!!(stdout && stdout.trim())));
      });
    }

    async function getClipDurationSecs(filePath) {
      return new Promise((resolve) => {
        exec(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`, (err, stdout) => {
          resolve(parseFloat(stdout?.trim()) || 3);
        });
      });
    }

    let outputVideo = path.join(videosDir, uniqueName("media", "mp4"));
    updateJob(jobId, { progress: 50, message: "Combining clips..." });

    if (tempClips.length === 1) {
      fs.copyFileSync(tempClips[0], outputVideo);
    } else {
      const clipDurations = [];
      for (const c of tempClips) clipDurations.push(await getClipDurationSecs(c));

      const XDUR = 0.5;
      const inputsX = tempClips.map(p => `-i "${p}"`).join(' ');
      let parts = [], timeline = 0, prevLabel = '0:v';
      // The audio is joined with acrossfade at the same durations the video is
      // xfaded at, so the two stay the same length and a transition sounds like it
      // looks. Both shorten the result by the fade duration at each join, which is
      // what keeps them in step.
      let aParts = [], prevALabel = '0:a';
      for (let i = 1; i < tempClips.length; i++) {
        const boundaryTransition = mediaItems[i - 1]?.transition;
        // The app sends the recipe - an xfade base plus an fx chain gated to the join -
        // so the catalogue lives in one place and a transition added there needs no
        // deploy here. An older client sends only an id, and EDIT_XFADE_MAP still
        // answers for those.
        // Validated, not trusted. This used to read spec.base and spec.fx straight off
        // the request body and splice them into the filtergraph, so a crafted fx
        // fragment could have carried `[labels]` or a `;` and written its own chain.
        // Same check the generation endpoint uses, so neither can drift from the other.
        const spec = safeTransitionSpec(mediaItems[i - 1]?.transitionSpec);
        const hasTransition = spec
          ? !!spec.base
          : (boundaryTransition && boundaryTransition !== 'none');
        const xft = hasTransition
          ? (spec ? spec.base : (EDIT_XFADE_MAP[boundaryTransition] || 'fade'))
          : 'fade';
        const prevDur = clipDurations[i - 1];
        const safeXDUR = hasTransition ? Math.min(XDUR, prevDur * 0.4) : Math.min(0.05, prevDur * 0.4);
        timeline += Math.max(safeXDUR + 0.01, prevDur - safeXDUR);
        const offset = parseFloat(timeline.toFixed(2));
        const outLabel = i === tempClips.length - 1 ? 'vout' : `v${i}`;
        const fx = (hasTransition && spec && Array.isArray(spec.fx)) ? spec.fx : [];
        if (fx.length) {
          // The xfade writes to a private label and the fx chain carries it to the one
          // the next boundary expects, so adding character never changes the shape of
          // the chain around it.
          const xfLabel = `xf${i}`;
          parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${safeXDUR}:offset=${offset}[${xfLabel}]`);
          let cur = xfLabel;
          const from = offset.toFixed(3);
          const to = (offset + safeXDUR).toFixed(3);
          fx.forEach((f, k) => {
            const dst = k === fx.length - 1 ? outLabel : `fx${i}_${k}`;
            // enable confines the effect to the join. Without it a grade or a blur
            // meant for half a second would sit over the whole finished video.
            const sep = String(f).includes('=') ? ':' : '=';
            parts.push(`[${cur}]${f}${sep}enable='between(t,${from},${to})'[${dst}]`);
            cur = dst;
          });
        } else {
          parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${safeXDUR}:offset=${offset}[${outLabel}]`);
        }
        prevLabel = outLabel;
        const outALabel = i === tempClips.length - 1 ? 'aout' : `a${i}`;
        aParts.push(`[${prevALabel}][${i}:a]acrossfade=d=${safeXDUR}:c1=tri:c2=tri[${outALabel}]`);
        prevALabel = outALabel;
      }
      const filterComplex = parts.concat(aParts).join(';');
      const xfadeCmd = `ffmpeg -y ${inputsX} -filter_complex "${filterComplex}" -map "[vout]" -map "[aout]" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -c:a aac "${outputVideo}"`;

      await new Promise((resolve, reject) => {
        exec(xfadeCmd, { timeout: 180000 }, (err, stdout, stderr) => {
          if (err) { console.error("Xfade concat error:", stderr?.slice(-500)); return reject(new Error("Concat failed")); }
          resolve();
        });
      });
    }

    tempClips.forEach(c => { try { fs.unlinkSync(c); } catch (e) {} });

    // Burn in text overlays + image/video overlays
    if (textOverlays.length > 0 || overlays.length > 0) {
      updateJob(jobId, { progress: 60, message: "Adding text & overlays..." });
      const withOverlaysOut = path.join(videosDir, uniqueName("withoverlays", "mp4"));

      let filterParts = [];
      let inputs = [`-i "${outputVideo}"`];
      let lastLabel = '0:v';

      overlays.forEach((ov, idx) => {
        const ovPath = resolveMediaPath(ov.url);
        inputs.push(`-i "${ovPath}"`);
        const inIdx = idx + 1;
        const newLabel = `ov${idx}`;

        // A client that sends no geometry gets what it has always got: centred, at
        // the source's own size, for the whole video.
        if (ov.widthPercent == null && ov.x == null && ov.y == null) {
          filterParts.push(`[${lastLabel}][${inIdx}:v]overlay=(W-w)/2:(H-h)/2[${newLabel}]`);
          lastLabel = newLabel;
          return;
        }

        const prepped = `ovp${idx}`;
        const wPct = Math.max(1, Math.min(400, Number(ov.widthPercent) || 40));
        // -2 rather than -1: the height has to stay even for libx264, and an odd one
        // fails the encode rather than rounding itself.
        const targetW = Math.max(2, Math.round((W * wPct) / 100));
        let chain = `[${inIdx}:v]scale=${targetW}:-2`;

        const rot = Number(ov.rotation) || 0;
        if (Math.abs(rot) > 0.01) {
          // Turning a frame leaves triangular gaps at the corners. Without an alpha
          // channel to put them in they fill black, which reads as a rectangle behind
          // the overlay rather than as the overlay being rotated - so format=rgba
          // comes first, and c=none keeps the new corners transparent. ow/oh grow the
          // canvas to fit the turned frame instead of cropping it back to its old box.
          const rad = ((rot * Math.PI) / 180).toFixed(6);
          chain += `,format=rgba,rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`;
        }
        filterParts.push(chain + `[${prepped}]`);

        // x and y are the overlay's CENTRE as a fraction of the frame - the anchor the
        // canvas positions by, and the same one text overlays already use. ffmpeg
        // places a top-left corner, so half the overlay's own scaled (and rotated)
        // size comes back off; w and h here are the prepared input's, not the source's.
        const xFrac = ((ov.x == null ? 50 : Number(ov.x)) / 100).toFixed(6);
        const yFrac = ((ov.y == null ? 50 : Number(ov.y)) / 100).toFixed(6);
        filterParts.push(`[${lastLabel}][${prepped}]overlay=x=(W*${xFrac}-w/2):y=(H*${yFrac}-h/2)[${newLabel}]`);
        lastLabel = newLabel;
      });

      // The renderer lives in textRender.js so a thumbnail can burn text through the
      // very same code that burns it into an export. It returns each overlay as a PNG
      // plus where it goes; the compositing below is the export's own business.
      const textRenderer = createTextRenderer({
        W, H,
        exportScale: W / (previewWidth || 360),
        uploadsDir,
        fontsDir: path.join(__dirname, 'fonts'),
        fontFileMap: loadFontFileMap(),
        run, uniqueName, mapWithConcurrency, num, safeColor,
        onOverlayRendered: (done, total) => updateJob(jobId, {
          progress: 60 + Math.round(20 * (done / total)),
          message: `Adding text & overlays... (${done}/${total})`,
        }),
      });
      const renderedTextPngs = await textRenderer.render(textOverlays);

      renderedTextPngs.forEach(({ t, outPng, placeX, placeY }, idx) => {
        inputs.push(`-i "${outPng}"`);
        const inIdx = inputs.length - 1;
        const newLabel = `txt${idx}`;
        const hasTiming = typeof t.startTime === 'number' && typeof t.endTime === 'number';
        const enableArg = hasTiming ? `:enable='between(t\,${t.startTime}\,${t.endTime})'` : '';
        filterParts.push(`[${lastLabel}][${inIdx}:v]overlay=x=${placeX}:y=${placeY}${enableArg}[${newLabel}]`);
        lastLabel = newLabel;
      });

      const filterComplex = filterParts.join(';');
      const overlayCmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map "[${lastLabel}]" -map 0:a? -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -c:a copy "${withOverlaysOut}"`;

      // Each renderedTextPngs entry's outPng was only ever an input to this one
      // ffmpeg call - once it's composited into withOverlaysOut (or the call
      // fails outright) nothing references it again, so it must go either way.
      // Left unhandled before, these accumulated in uploads/ forever: one
      // txtrender-*.png per text overlay per export, never unlinked.
      try {
        await new Promise((resolve, reject) => {
          exec(overlayCmd, { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) { console.error("Overlay/text burn error:", stderr?.slice(-500)); return reject(new Error("Overlay burn failed")); }
            resolve();
          });
        });
        try { fs.unlinkSync(outputVideo); } catch (e) {}
        outputVideo = withOverlaysOut;
      } finally {
        for (const { outPng } of renderedTextPngs) { try { fs.unlinkSync(outPng); } catch (e) {} }
      }
    }

    // Mix in audio tracks (voiceover + music)
    if (audioTracks.length > 0) {
      updateJob(jobId, { progress: 80, message: "Mixing audio..." });
      const withAudioOut = path.join(videosDir, uniqueName("withaudio", "mp4"));

      let inputs = [`-i "${outputVideo}"`];
      audioTracks.forEach(track => {
        if (track.url.startsWith('http')) {
          inputs.push(`-i "${track.url}"`);
        } else {
          const trackPath = resolveMediaPath(track.url);
          inputs.push(`-i "${trackPath}"`);
        }
      });

      // Each track carries its own placement from the editor timeline:
      //   atrim/asetpts  - the trimmed region of the source file
      //   adelay         - where that region starts in the finished video
      //   volume         - the track's own level (already scaled by master)
      // Without these every track started at 0:00 and ran its full length,
      // so the export never matched what the timeline preview played.
      const sec = (v) => Math.max(0, Math.round(Number(v) * 1000) / 1000);
      const audioLabels = audioTracks.map((t, i) => {
        const chain = [];
        // Voice enhancement, before anything positional. A broadcast chain in the order
        // it has to run: clean it, then shape it, then level it, then protect it.
        //
        //   highpass       rumble, handling noise and the room's low end, none of which
        //                  is speech - 85Hz is below a bass voice's fundamental
        //   afftdn         steady broadband noise (fans, hiss, traffic)
        //   deesser        the sibilance a presence boost is about to make worse, taken
        //                  out BEFORE the boost rather than after
        //   equalizer      +3dB around 3kHz, where intelligibility lives
        //   acompressor    evens out a delivery that moves toward and away from the mic
        //   speechnorm     brings the quiet parts up to meet the loud ones
        //   alimiter       a ceiling, because everything above this added gain
        //
        // No model anywhere in it. arnndn exists on this box and would need a .rnnn
        // file; afftdn gets close enough on speech without one.
        if (t.enhanceVoice === true) chain.push(...VOICE_CHAIN);
        // Before atrim, so the effect applies to the audio itself rather than to a
        // window of it - and before adelay for the same reason a fade is: the effect
        // belongs to the sound, not to where the sound sits in the finished video.
        chain.push(...audioFxChain(t.audioFx));
        const trimStart = Number(t.trimStart) > 0 ? sec(t.trimStart) : 0;
        const trimEnd = Number(t.trimEnd) > trimStart ? sec(t.trimEnd) : null;
        if (trimStart > 0 || trimEnd !== null) {
          const args = [];
          if (trimStart > 0) args.push(`start=${trimStart}`);
          if (trimEnd !== null) args.push(`end=${trimEnd}`);
          chain.push(`atrim=${args.join(':')}`, 'asetpts=PTS-STARTPTS');
        }
        // Fades belong to the audio, not to where the audio sits, so they go on
        // before adelay: st is then measured from the start of the trimmed region
        // rather than from the start of the finished video.
        const runLen = trimEnd !== null ? Math.max(0, trimEnd - trimStart) : null;
        const fadeIn = Math.max(0, Number(t.fadeIn) || 0);
        const fadeOut = Math.max(0, Number(t.fadeOut) || 0);
        if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${sec(fadeIn)}`);
        // A fade out has to know where the end is. Without a trimEnd the length is
        // whatever the file turns out to be, and a guessed st would ramp down in the
        // wrong place - better to leave it alone than to fade the middle.
        if (fadeOut > 0 && runLen !== null && runLen > 0) {
          const st = Math.max(0, runLen - fadeOut);
          chain.push(`afade=t=out:st=${sec(st)}:d=${sec(Math.min(fadeOut, runLen))}`);
        }

        const startOffset = Number(t.startOffset) > 0 ? sec(t.startOffset) : 0;
        if (startOffset > 0) chain.push(`adelay=${Math.round(startOffset * 1000)}:all=1`);
        const volume = Number.isFinite(Number(t.volume)) ? Math.max(0, Math.min(4, Number(t.volume))) : 1;
        chain.push(`volume=${volume}`);
        return `[${i + 1}:a]${chain.join(',')}[a${i}]`;
      }).join(';');
      // The video's own sound is now one of the things being mixed. It used to be
      // left out entirely: the mix took only the uploaded tracks and mapped the video
      // for its picture alone, so adding any voiceover silenced whatever the clips
      // themselves were saying.
      const mixInputs = `[0:a]` + audioTracks.map((t, i) => `[a${i}]`).join('');
      // duration=longest so a delayed track isn't cut off by an earlier one
      // ending, normalize=0 so amix doesn't silently divide every level by the
      // track count, and apad so the mix always outlasts the video - with
      // -shortest that pins the export to the video length. Previously
      // duration=first + -shortest truncated the whole video to the length of
      // the first audio track (a 6s voiceover cut a 12s video down to 6s).
      const filterComplex = `${audioLabels};${mixInputs}amix=inputs=${audioTracks.length + 1}:duration=longest:dropout_transition=2:normalize=0[amixed];[amixed]apad[aout]`;

      const audioCmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${withAudioOut}"`;

      await new Promise((resolve, reject) => {
        exec(audioCmd, { timeout: 180000 }, (err, stdout, stderr) => {
          if (err) { console.error("Audio mix error:", stderr?.slice(-500)); return reject(new Error("Audio mix failed")); }
          resolve();
        });
      });
      try { fs.unlinkSync(outputVideo); } catch (e) {}
      outputVideo = withAudioOut;
    }

    // Free tier only - matches the same watermark text/placement already
    // burned in unconditionally by idea-to-video/idea-to-video-v2, so a
    // watermarked export looks the same regardless of which path made it.
    // media-to-video (the timeline editor's own export) had no watermark at
    // all before this - leaving it out here would have made "no watermark"
    // a Pro benefit only for AI-generated videos, not the editor most
    // projects actually go through.
    if (allowed.watermark) {
      const watermarked = path.join(videosDir, uniqueName("wm", "mp4"));
      const watermark = "drawtext=text='Tonefy AI':fontsize=18:fontcolor=white@0.5:x=(w-text_w)/2:y=h-th-20";
      await new Promise((resolve, reject) => {
        exec(`ffmpeg -y -i "${outputVideo}" -vf "${watermark}" -c:a copy "${watermarked}"`, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) { console.error("Watermark burn error:", stderr?.slice(-500)); return reject(new Error("Watermark burn failed")); }
          resolve();
        });
      });
      try { fs.unlinkSync(outputVideo); } catch (e) {}
      outputVideo = watermarked;
    }

    const filename = path.basename(outputVideo);
    const localUrl = `/videos/${filename}`;
    const actualDurationSeconds = await probeDurationSeconds(outputVideo);

    if (userId) {
      await adminDb.collection('userVideos').add({
        userId, filename, localUrl,
        downloadUrl: `${process.env.BASE_URL || 'https://api.fitlifesolutions.site'}${localUrl}`,
        prompt: "Uploaded media video", aspectRatio: "9:16",
        createdAt: new Date().toISOString(),
        size: fs.statSync(outputVideo).size,
        durationSeconds: actualDurationSeconds,
      });
      // Deducted from the REAL output, never the pre-flight estimate, and
      // only after the render actually succeeded - a failed render must not
      // cost anything.
      await deductCredits(adminDb, userId, actualDurationSeconds);
    }

    updateJob(jobId, { status: 'done', progress: 100, videoUrl: localUrl, message: "Done!" });
  } catch (e) {
    console.error("Media-to-video error:", e.message);
    updateJob(jobId, { status: 'error', error: e.message });
  } finally {
    releaseVideoSlot();
  }
});


app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Nothing in this file caught an error that reached here - not multer's, not a
// synchronous throw in any route. Both fell through to EXPRESS'S OWN error page: an
// HTML stack trace. The app calls res.json() on every response it gets back, so that
// page reached res.json() and failed as an opaque "Unexpected character: <" instead
// of showing whatever the real problem was. This is that real message, as JSON,
// for anything that ends up here - the multer file-count limit above included.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err?.message || err);
  if (err?.name === 'MulterError') {
    const known = {
      LIMIT_FILE_SIZE: 'One of those files is too large.',
      LIMIT_UNEXPECTED_FILE: 'Too many files in one upload.',
    };
    return res.status(400).json({ error: known[err.code] || err.message });
  }
  res.status(500).json({ error: err?.message || 'Server error' });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
