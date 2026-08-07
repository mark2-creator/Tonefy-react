import express from "express";
import multer from "multer";
import crypto from 'crypto';
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { exec, execFile } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import Groq from "groq-sdk";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

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
async function callLLM({ system, user, max_tokens = 400, temperature = 0.8 }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  // Try Groq first
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages,
      max_tokens,
      temperature,
    });
    return completion.choices[0].message.content.trim();
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
      const text = cfData.result?.response?.trim();
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

function saveJobsToDisk() {
  try {
    const obj = Object.fromEntries(jobs);
    fs.writeFileSync(JOBS_FILE, JSON.stringify(obj));
  } catch (e) {
    console.error("Failed to save jobs.json:", e.message);
  }
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

function createJob() {
  const jobId = uuidv4();
  jobs.set(jobId, { status: 'pending', progress: 0, message: 'Starting...' });
  saveJobsToDisk();
  return jobId;
}
function updateJob(jobId, data) {
  if (jobs.has(jobId)) {
    jobs.set(jobId, { ...jobs.get(jobId), ...data });
    saveJobsToDisk();
  }
}

// Concurrency limiter for FFmpeg-heavy video generation
let activeVideoJobs = 0;
const MAX_CONCURRENT_VIDEO_JOBS = 4;
const videoJobQueue = [];

function acquireVideoSlot() {
  return new Promise(resolve => {
    if (activeVideoJobs < MAX_CONCURRENT_VIDEO_JOBS) {
      activeVideoJobs++;
      resolve();
    } else {
      videoJobQueue.push(resolve);
    }
  });
}

function releaseVideoSlot() {
  activeVideoJobs--;
  if (videoJobQueue.length > 0) {
    activeVideoJobs++;
    videoJobQueue.shift()();
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

app.use("/videos", express.static(videosDir, { setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); res.setHeader("Accept-Ranges", "bytes"); } }));
app.use("/audios", express.static(audiosDir, { setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
app.use("/music", express.static(path.join(__dirname, "public", "music"), { setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));

function trackIdToDisplayName(id) {
  return id
    .replace(/^mixkit-/, "")
    .replace(/-\d+$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

app.get("/api/music-tracks", (req, res) => {
  try {
    const musicDir = path.join(__dirname, "public", "music");
    const files = fs.readdirSync(musicDir).filter(f => f.endsWith(".mp3"));
    const tracks = files.map(f => {
      const id = f.replace(/\.mp3$/, "");
      return { id, name: trackIdToDisplayName(id), previewUrl: `/music/${f}` };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ tracks });
  } catch (err) {
    console.error("music-tracks error:", err.message);
    res.status(500).json({ error: "Failed to list tracks" });
  }
});
app.use("/uploads", express.static(uploadsDir));
app.use("/auth", express.static(path.join(__dirname, "public", "auth")));

exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("FFmpeg missing");
  else console.log("FFmpeg found:", stdout.split("\n")[0]);
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

app.post("/api/audio-waveform", verifyToken, async (req, res) => {
  const { url, samples = 80 } = req.body || {};
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    let srcPath;
    if (url.startsWith('http')) {
      srcPath = path.join(uploadsDir, uniqueName("wavesrc", "mp3"));
      await downloadToFile(url, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
    } else {
      srcPath = resolveMediaPath(url);
    }

    const pcmPath = path.join(uploadsDir, uniqueName("wavepcm", "raw"));
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

    try { fs.unlinkSync(pcmPath); } catch (e) {}
    if (url.startsWith('http')) { try { fs.unlinkSync(srcPath); } catch (e) {} }

    res.json({ peaks });
  } catch (e) {
    console.error("audio-waveform error:", e.message);
    const badInput = /Invalid media path|Not a stored media path|outside the allowed|unexpected characters/.test(e.message);
    res.status(badInput ? 400 : 500).json({ error: e.message });
  }
});

app.post("/api/transcribe-voiceover", verifyToken, async (req, res) => {
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

app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });
// Global rate limit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.startsWith('/api/job/'),
  validate: { xForwardedForHeader: false }
}));

// Strict limit for video generation (expensive: Groq + ElevenLabs + FFmpeg)
const videoGenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Video generation limit reached. Max 20 per hour.' },
  validate: { xForwardedForHeader: false }
});

// Script/audio generation limit
const scriptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Max 20 per hour.' },
  validate: { xForwardedForHeader: false }
});

// Pexels search limit
const pexelsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many search requests. Max 30 per 15 minutes.' },
  validate: { xForwardedForHeader: false }
});

// Protect all /api/* routes — TikTok OAuth routes stay public
app.use("/api", verifyToken);

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

async function cleanupOldFiles(dir, maxAgeMs = 72 * 60 * 60 * 1000) {
  fs.readdir(dir, async (err, files) => {
    if (err) return;
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
          // If it's a video file, delete matching Firestore record
          if (dir === videosDir && (file.endsWith('.mp4') || file.endsWith('.ass'))) {
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
        }
      } catch (e) {}
    }
  });
}
setInterval(() => { cleanupOldFiles(videosDir); cleanupOldFiles(audiosDir); }, 10 * 60 * 1000);

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
function buildAssFile(script, audioDuration, assPath, captionStyle, wordTimestamps = null, captionMeta = null) {
  const words = script.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Use whisper word timestamps if available, otherwise estimate
  let chunks, chunkTimings;
  if (wordTimestamps && wordTimestamps.length > 0) {
    // Animated styles: one word per line with exact timing
    const ANIMATED = ['highlight','sticker','shadow3d','tiktok','neon','fire','bold','purple'];
    const perWord = captionMeta && captionMeta.words
      ? captionMeta.words === 1
      : ANIMATED.includes(captionStyle);
    if (perWord) {
      chunks = wordTimestamps.map(w => w.word);
      chunkTimings = wordTimestamps.map(w => ({ start: w.start, end: w.end }));
    } else {
      // Group into the style's own chunk size using whisper timing
      const per = Math.max(1, (captionMeta && captionMeta.words) || 3);
      chunks = [];
      chunkTimings = [];
      for (let i = 0; i < wordTimestamps.length; i += per) {
        const group = wordTimestamps.slice(i, i + per);
        chunks.push(group.map(w => w.word).join(' '));
        chunkTimings.push({ start: group[0].start, end: group[group.length-1].end });
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

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
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

  const makeLines = (chunk, i) => {
    const start = chunkTimings[i].start;
    const end = chunkTimings[i].end;
    const dur = end - start;
    const popEnd = start + Math.min(0.15, dur * 0.35); // 150ms pop
    const text = (s.transform ? s.transform(chunk, i) : chunk).replace(/[}{]/g, '');
    const mv = getMarginV(i); // position variation
    const pos = ''; // position override tag (empty = use style default)

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
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
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

    const script = completion.choices[0]?.message?.content?.trim();
    if (!script) return res.status(500).json({ error: "Failed to generate script from URL" });

    res.json({ script, title, url });
  } catch (err) {
    console.error("extract-url error:", err.message);
    res.status(500).json({ error: "Failed to process URL: " + err.message });
  }
});

app.post("/api/generate-script", scriptLimiter, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });
  try {
    const cacheKey = `script:${prompt.toLowerCase().trim()}`;
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('[CACHE HIT] generate-script:', prompt.substring(0, 40));
      return res.json({ script: cached, cached: true });
    }
    const script = await callLLM({
      system: "You are a professional video script writer. Create engaging 30-60 second video scripts for social media. Write ONLY spoken narration - no stage directions, no Narrator:, no timestamps, no scene descriptions. Just pure spoken words.",
      user: `Create a short video script about: ${prompt}`,
      max_tokens: 400,
      temperature: 0.8,
    });
    setCache(cacheKey, script);
    res.json({ script });
  } catch (err) {
    console.error("Script error:", err.message);
    res.status(500).json({ error: "Failed to generate script" });
  }
});

app.post("/api/extract-keywords", async (req, res) => {
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
const VOICES = {
  "gtts-us":    { engine: "gtts",     tld: "com",   label: "US Female" },
  "gtts-uk":    { engine: "gtts",     tld: "co.uk", label: "UK Female" },
  "gtts-au":    { engine: "gtts",     tld: "com.au",label: "AU Female" },
  "edge-guy":   { engine: "edge",     name: "en-US-GuyNeural",       label: "US Male" },
  "edge-ryan":  { engine: "edge",     name: "en-GB-RyanNeural",      label: "UK Male" },
  "edge-brian": { engine: "edge",     name: "en-US-BrianNeural",     label: "Deep Male" },
  "edge-aria":  { engine: "edge",     name: "en-US-AriaNeural",      label: "US Female 2" },
  "edge-sonia": { engine: "edge",     name: "en-GB-SoniaNeural",     label: "UK Female 2" },
};

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

app.post("/api/generate-audio", scriptLimiter, async (req, res) => {
  const { text, voiceId = "gtts-us" } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "Text is required" });
  try {
    const voice = VOICES[voiceId] || VOICES["gtts-us"];
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

app.get("/api/job/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.post("/api/idea-to-video", videoGenLimiter, async (req, res) => {
  const { voiceover = "", selectedVideo, selectedVideos, audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", captionMeta = null, musicTrack = "mixkit-deep-meditation-109", videoSpeed = 1.0, transition = "fade" } = req.body || {};
  const jobId = createJob();
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

    let scaleFilter;
    if (aspectRatio === "9:16") scaleFilter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
    else if (aspectRatio === "1:1") scaleFilter = "scale=720:720:force_original_aspect_ratio=increase,crop=720:720";
    else scaleFilter = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";

    const assPath = outputVideo.replace('.mp4', '.ass');
    const hasCaptions = buildAssFile(voiceover || "", audioDuration, assPath, captionStyle, null, captionMeta);
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

app.post("/api/extract-segments", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text required" });
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: `Split this video script into 3-5 short segments (each 1-2 sentences, in original order, covering ALL the text).

For each segment, write a "keywords" field describing a STOCK FOOTAGE SCENE that visually represents the segment's meaning. The keywords must be 2-4 concrete English words describing people, objects, or places (e.g. "person typing laptop", "sunrise mountain hike", "brain puzzle pieces", "students writing exam"). NEVER copy words directly from the script text. NEVER use abstract words like "motivation", "challenge", "test" alone - always describe a visible scene or action.

Example input: "Are you ready for a challenge? Take our quiz now."
Example output: [{"text":"Are you ready for a challenge? Take our quiz now.","keywords":"person solving puzzle excited"}]

Return ONLY a JSON array, no other text: [{"text":"...","keywords":"..."}]` },
        { role: "user", content: text }
      ],
      model: "llama-3.1-8b-instant", max_tokens: 500, temperature: 0.4,
    });
    let segments;
    try {
      segments = JSON.parse(completion.choices[0].message.content.trim());
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
  const { voiceover = "", segments = [], audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", captionMeta = null, transition = "fade", musicTrack = "mixkit-deep-meditation-109", videoSpeed = 1.0 } = req.body || {};
  const jobId = createJob();
  res.json({ jobId });

  await acquireVideoSlot();
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

    updateJob(jobId, { progress: 10, message: `Finding clips for ${segments.length} scenes...` });

    // 2. Compute per-segment duration proportional to its text length
    const totalChars = segments.reduce((s, seg) => s + (seg.text || '').length, 0) || 1;
    const segDurations = segments.map(seg => Math.max(1.5, (seg.text || '').length / totalChars * totalAudioDuration));

    // 3. Search + download a clip per segment
    let scaleFilter;
    if (aspectRatio === "9:16") scaleFilter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
    else if (aspectRatio === "1:1") scaleFilter = "scale=720:720:force_original_aspect_ratio=increase,crop=720:720";
    else scaleFilter = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";

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
        // Standard xfade transitions — single pass
        const xft = XFADE_MAP[transition] || 'fade';
        const minClipDur = Math.min(...segDurations);
        const safeXDUR = Math.min(XDUR, minClipDur * 0.4);
        const inputs3 = clipPaths.map(p => `-i "${p}"`).join(' ');
        let parts = [], timeline = 0, prevLabel = '0:v';
        for (let i = 1; i < clipPaths.length; i++) {
          timeline += Math.max(safeXDUR + 0.01, segDurations[i-1] - safeXDUR);
          const offset = parseFloat(timeline.toFixed(2));
          const outLabel = i === clipPaths.length - 1 ? 'vout' : `v${i}`;
          parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${safeXDUR}:offset=${offset}[${outLabel}]`);
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
    const watermark = "drawtext=text='Tonefy AI':fontsize=18:fontcolor=white@0.5:x=(w-text_w)/2:y=h-th-20";
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
    const hasCaptions = buildAssFile(voiceover || "", totalAudioDuration, assPath, captionStyle, wordTimestamps, captionMeta);
    console.log("hasCaptions:", hasCaptions, "file exists:", fs.existsSync(assPath));
    const subsFilter = hasCaptions ? ',' + assFilter(assPath) : '';
    const speedPts = videoSpeed && videoSpeed !== 1.0 ? `setpts=${(1/videoSpeed).toFixed(4)}*PTS,` : '';
    const audioTempo = videoSpeed && videoSpeed !== 1.0 ? `atempo=${videoSpeed},` : '';
    const adjustedDuration = videoSpeed && videoSpeed !== 1.0 ? (totalAudioDuration / videoSpeed).toFixed(2) : totalAudioDuration;
    const vf = `${speedPts}setsar=1${subsFilter},${watermark}`;

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
const tiktokTokens = {};

// Step 1: Generate TikTok OAuth URL
app.get('/tiktok/auth', (req, res) => {
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
app.get('/tiktok/callback', async (req, res) => {
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

    // Store token
    tiktokTokens[open_id] = { access_token, refresh_token, expires_in, open_id };
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
app.get('/tiktok/user/:openId', (req, res) => {
  const token = tiktokTokens[req.params.openId];
  if (!token) return res.status(404).json({ error: 'Not connected' });
  res.json({ open_id: token.open_id, connected: true });
});

// Step 4: Post video to TikTok
app.post('/tiktok/post-video', async (req, res) => {
  const { openId, videoUrl, title, privacyLevel = 'SELF_ONLY' } = req.body;

  const token = tiktokTokens[openId];
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
app.get('/tiktok/post-status/:openId/:publishId', async (req, res) => {
  const { openId, publishId } = req.params;
  const token = tiktokTokens[openId];
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

app.post('/api/edit-video', async (req, res) => {
  // captionMeta is the app's style spec - font, size, colour, cadence and the
  // stroke/glow/shadow/box parts. captionStyle stays for older clients that send
  // an id and nothing else.
  const { videoUrl, script = "", captionStyle = "classic", captionMeta = null, userId, voiceoverUrl } = req.body || {};
  if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

  const jobId = createJob();
  res.json({ jobId });

  try {
    updateJob(jobId, { progress: 5, message: "Loading video..." });

    const srcPath = videoUrl.startsWith('http')
      ? path.join(videosDir, uniqueName("editsrc", "mp4"))
      : path.join(videosDir, path.basename(videoUrl));

    if (videoUrl.startsWith('http')) {
      await downloadToFile(videoUrl, srcPath, { "User-Agent": "Mozilla/5.0 (compatible; Tonefy/1.0)" });
    }

    const duration = await new Promise((resolve) => {
      exec(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${srcPath}"`, (err, stdout) => {
        resolve(parseFloat(stdout?.trim()) || 60);
      });
    });

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
    const hasCaptions = buildAssFile(effectiveScript, duration, assPath, captionStyle, wordTimestamps, captionMeta);
    const subsFilter = hasCaptions ? assFilter(assPath) : null;

    const ffmpegCmd = subsFilter
      ? `ffmpeg -y -i "${srcPath}" -vf "${subsFilter}" -c:a copy -pix_fmt yuv420p "${outputVideo}"`
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

    if (userId) {
      await adminDb.collection('userVideos').add({
        userId, filename, localUrl,
        downloadUrl: `${process.env.BASE_URL || 'https://api.fitlifesolutions.site'}${localUrl}`,
        prompt: script.slice(0, 100), aspectRatio: 'original', captionStyle,
        createdAt: new Date().toISOString(),
        size: fs.statSync(outputVideo).size,
      });
    }

    updateJob(jobId, { status: 'done', progress: 100, videoUrl: localUrl, message: "Done!" });
  } catch (e) {
    console.error("Edit video error:", e.message);
    updateJob(jobId, { status: 'error', error: e.message });
  }
});



const upload = multer({ dest: uploadsDir });

app.post('/api/upload-media', upload.array('files', 20), async (req, res) => {
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

const RES_MAP = { '720p': [720, 1280], '1080p': [1080, 1920], '4K': [2160, 3840] };

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

app.post('/api/media-to-video', async (req, res) => {
  const { mediaItems = [], userId, resolution = '1080p', textOverlays = [], overlays = [], audioTracks = [], previewWidth } = req.body || {};
  if (!mediaItems.length) return res.status(400).json({ error: "mediaItems required" });

  const jobId = createJob();
  res.json({ jobId });

  try {
    updateJob(jobId, { progress: 5, message: "Preparing clips..." });
    const [W, H] = RES_MAP[resolution] || RES_MAP['1080p'];

    const tempClips = [];
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const srcPath = resolveMediaPath(item.url);
      console.log('CLIPDEBUG url=', item.url, 'resolved=', srcPath, 'exists=', fs.existsSync(srcPath));
      const clipOut = path.join(videosDir, uniqueName("clip", "mp4"));

      let cmd;
      if (item.type === "image") {
        cmd = `ffmpeg -y -loop 1 -i "${srcPath}" -t 3 -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1" -pix_fmt yuv420p -r 30 "${clipOut}"`;
      } else {
        cmd = `ffmpeg -y -i "${srcPath}" -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1" -pix_fmt yuv420p -r 30 -an "${clipOut}"`;
      }
      await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) { console.error("Clip prep error:", stderr?.slice(-300)); return reject(new Error("Clip prep failed")); }
          resolve();
        });
      });
      tempClips.push(clipOut);
      updateJob(jobId, { progress: 5 + Math.round((i + 1) / mediaItems.length * 40), message: `Processing clip ${i + 1}/${mediaItems.length}...` });
    }

    // Concat via xfade chain (per-boundary transitions from mediaItems[i].transition)
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
      for (let i = 1; i < tempClips.length; i++) {
        const boundaryTransition = mediaItems[i - 1]?.transition;
        const hasTransition = boundaryTransition && boundaryTransition !== 'none';
        const xft = hasTransition ? (EDIT_XFADE_MAP[boundaryTransition] || 'fade') : 'fade';
        const prevDur = clipDurations[i - 1];
        const safeXDUR = hasTransition ? Math.min(XDUR, prevDur * 0.4) : Math.min(0.05, prevDur * 0.4);
        timeline += Math.max(safeXDUR + 0.01, prevDur - safeXDUR);
        const offset = parseFloat(timeline.toFixed(2));
        const outLabel = i === tempClips.length - 1 ? 'vout' : `v${i}`;
        parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${safeXDUR}:offset=${offset}[${outLabel}]`);
        prevLabel = outLabel;
      }
      const filterComplex = parts.join(';');
      const xfadeCmd = `ffmpeg -y ${inputsX} -filter_complex "${filterComplex}" -map "[vout]" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p "${outputVideo}"`;

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
        filterParts.push(`[${lastLabel}][${inIdx}:v]overlay=(W-w)/2:(H-h)/2[${newLabel}]`);
        lastLabel = newLabel;
      });

      const FONT_FILE_MAP = loadFontFileMap();
      const FONTS_DIR = path.join(__dirname, 'fonts');

      function wrapTextLinesServer(text, maxWordsPerLine = 4) {
        const words = (text || '').split(/\s+/).filter(Boolean);
        const lines = [];
        let current = [];
        for (const word of words) {
          current.push(word);
          if (current.length >= maxWordsPerLine) {
            lines.push(current.join(' '));
            current = [];
          }
        }
        if (current.length > 0) lines.push(current.join(' '));
        return lines.length > 0 ? lines : [''];
      }

      // Where a single word sits inside a rendered `label:`. The chip that follows
      // the voice has to be drawn behind one word of a phrase, and ImageMagick will
      // not report where a word landed - but it will measure any string, and a
      // label's internal padding is constant for a given font and size, so it
      // cancels in a difference:
      //
      //   x of word = W(prefix) - pad        width = W(prefix + word) - W(prefix)
      //
      // Checked against a render rather than reasoned about: the last word's right
      // edge lands exactly on the measured width of the whole phrase.
      const labelPadCache = new Map();

      const labelWidth = async (fontPath, pointsize, kerning, text) => {
        const out = await run('convert', [
          '-background', 'none', '-fill', 'white',
          ...(fontPath ? ['-font', fontPath] : []),
          '-pointsize', pointsize,
          ...(kerning != null ? ['-kerning', kerning] : []),
          `label:${text}`, '-format', '%w', 'info:',
        ], { timeout: 15000 });
        return parseInt(String(out).trim(), 10) || 0;
      };

      // pad = 2*W(c) - W(cc), for any c. Cached: it depends only on the font, the
      // size and the tracking, and a caption measures several words at each of them.
      const labelPad = async (fontPath, pointsize, kerning) => {
        const key = `${fontPath}|${pointsize}|${kerning}`;
        if (labelPadCache.has(key)) return labelPadCache.get(key);
        const one = await labelWidth(fontPath, pointsize, kerning, 'M');
        const two = await labelWidth(fontPath, pointsize, kerning, 'MM');
        const pad = Math.max(0, one * 2 - two);
        labelPadCache.set(key, pad);
        return pad;
      };

      const wordBoxInLabel = async ({ fontPath, pointsize, kerning, lines, wordIndex, Wt, Ht }) => {
        let remaining = wordIndex;
        let lineIndex = -1;
        let inLine = -1;
        for (let i = 0; i < lines.length; i++) {
          const n = lines[i].split(/\s+/).filter(Boolean).length;
          if (remaining < n) { lineIndex = i; inLine = remaining; break; }
          remaining -= n;
        }
        if (lineIndex < 0) return null;

        const words = lines[lineIndex].split(/\s+/).filter(Boolean);
        const pad = await labelPad(fontPath, pointsize, kerning);
        const lineW = (await labelWidth(fontPath, pointsize, kerning, lines[lineIndex])) - pad;
        const prefixW = inLine === 0
          ? 0
          : (await labelWidth(fontPath, pointsize, kerning, words.slice(0, inLine).join(' ') + ' ')) - pad;
        const uptoW = (await labelWidth(fontPath, pointsize, kerning, words.slice(0, inLine + 1).join(' '))) - pad;

        // Lines are centred within the label, so a short line starts inset by half
        // the difference rather than at zero.
        const lineH = Ht / lines.length;
        return {
          x: (Wt - lineW) / 2 + prefixW,
          y: lineIndex * lineH,
          w: Math.max(1, uptoW - prefixW),
          h: lineH,
        };
      };

      const EXPORT_SCALE = W / (previewWidth || 360);
      const renderedTextPngs = [];

      for (const t of textOverlays) {
        const isGradient = Array.isArray(t.gradient) && t.gradient.length >= 2;
        const fontFileName = FONT_FILE_MAP[t.font];
        const fontPath = fontFileName ? path.join(FONTS_DIR, fontFileName) : null;
        const fontArg = fontPath ? `-font "${fontPath}"` : '';
        const fontSizePx = Math.round((t.size || 18) * EXPORT_SCALE);
        // A caption style arrives as a spec of typographic parts - stroke, glow,
        // shadow, box, tracking - rather than an id this file has to recognise, so
        // a style added to the app's catalogue renders here without a deploy on
        // this side. Overlays made before the catalogue existed carry no spec and
        // fall through to the old id-keyed behaviour below.
        const spec = (t.captionSpec && typeof t.captionSpec === 'object') ? t.captionSpec : null;
        // Every length in a spec is points at the app's 18pt caption base.
        const sscale = fontSizePx / 18;
        const lines = wrapTextLinesServer(t.text, 4);
        const multilineText = lines.join('\n');
        // Only the backslash needs removing (ImageMagick escape syntax). Quotes
        // used to be rewritten to apostrophes to survive the shell; with execFile
        // they render as the user typed them.
        const safeText = multilineText.replace(/\\/g, '');

        const base = path.join(uploadsDir, uniqueName('txtrender', 'png'));
        const maskPng = base.replace('.png', '_mask.png');
        const alphaPng = base.replace('.png', '_alpha.png');
        const fillPng = base.replace('.png', '_fill.png');
        const coloredPng = base.replace('.png', '_colored.png');
        const outPng = base;

        // Overlays the editor can rotate and scale carry their CENTRE as x/y, since
        // a top-left corner is not a position you can turn something about - spin an
        // element and the corner describes a circle while the thing being aimed
        // stays put. Older clients send a top-left and are placed the old way.
        const centreAnchored = t.anchor === 'center';
        const gravityArg = (centreAnchored || t.isAutoCaption) ? 'Center' : 'West';
        await run('convert', [
          '-background', 'none', '-fill', 'white',
          ...(fontPath ? ['-font', fontPath] : []),
          '-pointsize', Math.max(1, Math.round(fontSizePx)),
          // Tracking has to go on here rather than at composite time - it changes
          // the glyph positions, and every layer below is cut from this one mask.
          ...(spec && spec.spacing ? ['-kerning', (num(spec.spacing) * sscale).toFixed(2)] : []),
          '-gravity', gravityArg,
          `label:${safeText}`,
          maskPng,
        ]).catch(e => { console.error('Text mask render error:', e.stderr?.slice(-500) || e.message); throw new Error('Text mask render failed'); });

        await run('convert', [maskPng, '-alpha', 'extract', alphaPng])
          .catch(e => { console.error('Alpha extract error:', e.stderr?.slice(-500) || e.message); throw new Error('Alpha extract failed'); });

        const { Wt, Ht } = await run('identify', ['-format', '%w %h', maskPng], { timeout: 15000 })
          .then(out => { const p = out.trim().split(' ').map(Number); return { Wt: p[0], Ht: p[1] }; })
          .catch(() => { throw new Error('identify failed'); });

        // Which word this overlay is showing as spoken. The client sends one overlay
        // per word for a highlight style - the phrase is on screen throughout, but
        // which word is chipped changes within it, and an overlay is one still.
        const hlCfg = spec && spec.highlight ? spec.highlight : null;
        const hlIndex = Number.isInteger(t.activeWord) ? t.activeWord : -1;
        const hlKerning = spec && spec.spacing ? (num(spec.spacing) * sscale).toFixed(2) : null;
        let wordBox = null;
        if (hlCfg && hlIndex >= 0) {
          // A phrase that cannot be measured still has to render. Losing the chip
          // is a worse caption; losing the caption is a broken video.
          wordBox = await wordBoxInLabel({
            fontPath, pointsize: Math.max(1, Math.round(fontSizePx)), kerning: hlKerning,
            lines, wordIndex: hlIndex, Wt, Ht,
          }).catch(e => {
            console.error('Word box measure failed, drawing caption without chip:', e.message);
            return null;
          });
        }

        if (isGradient) {
          const g0 = safeColor(t.gradient[0]);
          const g1 = safeColor(t.gradient[1]);
          await run('convert', ['-size', `${Wt}x${Ht}`, '-define', 'gradient:direction=East', `gradient:${g0}-${g1}`, fillPng])
            .catch(e => { console.error('Gradient fill error:', e.stderr?.slice(-500) || e.message); throw new Error('Gradient fill failed'); });
        } else {
          const fillArgs = ['-size', `${Wt}x${Ht}`, `xc:${safeColor(t.color)}`];
          // The spoken word is recoloured by painting its box into the fill before
          // the glyph alpha is applied, so only the letters take the new colour -
          // the rectangle itself never survives the CopyOpacity below.
          if (wordBox && hlCfg.textColor) {
            fillArgs.push(
              '-fill', safeColor(hlCfg.textColor, '#000000'),
              '-draw', `rectangle ${Math.round(wordBox.x)},${Math.round(wordBox.y)} `
                + `${Math.round(wordBox.x + wordBox.w)},${Math.round(wordBox.y + wordBox.h)}`,
            );
          }
          fillArgs.push(fillPng);
          await run('convert', fillArgs)
            .catch(e => { console.error('Flat fill error:', e.stderr?.slice(-500) || e.message); throw new Error('Flat fill failed'); });
        }

        await run('convert', [fillPng, alphaPng, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', coloredPng])
          .catch(e => { console.error('CopyOpacity composite error:', e.stderr?.slice(-500) || e.message); throw new Error('Composite failed'); });

        let effWt = Wt, effHt = Ht;

        // Overlays with no spec: the two id-keyed looks this file used to know,
        // plus the plain drop shadow everything else got.
        const LEGACY_SHADOW = {
          shadow3d: { color: '#555555', dx: 6, dy: 6, radius: 0 },
          neon: { color: safeColor(t.color, '#7FFF00'), dx: 0, dy: 0, radius: 6 },
        };
        const legacyWantsShadow = t.isAutoCaption && t.captionShadow !== false
          && !LEGACY_SHADOW[t.captionStyleId] && t.captionStyleId !== 'sticker' && t.captionStyleId !== 'outline';
        const shadowCfg = spec
          ? (spec.shadow ? {
              color: spec.shadow.color,
              dx: num(spec.shadow.dx) * sscale,
              dy: num(spec.shadow.dy) * sscale,
              radius: num(spec.shadow.radius) * sscale,
            } : null)
          : (LEGACY_SHADOW[t.captionStyleId] || (legacyWantsShadow ? { color: '#000000', dx: 2, dy: 2, radius: 2 } : null));
        const glowCfg = spec && spec.glow
          ? { color: spec.glow.color, radius: Math.max(1, num(spec.glow.radius, 8) * sscale) }
          : null;
        // The ring reaches `width` beyond the glyph edge - the same measure the app
        // gets from eight copies offset around the fill, so the two agree.
        const strokeR = spec && spec.stroke ? Math.max(0.5, num(spec.stroke.width) * sscale) : 0;

        // A chip enters the layered path even with nothing else to stack, because it
        // needs the same margin: drawn on a canvas cropped to the glyphs, its own
        // padding would be clipped off at the edges of the first and last word.
        const hlPadX = wordBox ? num(hlCfg.padX) * sscale : 0;
        const hlPadY = wordBox ? num(hlCfg.padY) * sscale : 0;

        if (shadowCfg || glowCfg || strokeR > 0 || wordBox) {
          const pad = Math.max(
            Math.ceil(Math.max(hlPadX, hlPadY)) + 2,
            Math.ceil(
              strokeR
              + (glowCfg ? glowCfg.radius * 3 : 0)
              + (shadowCfg ? shadowCfg.radius * 3 + Math.max(Math.abs(shadowCfg.dx), Math.abs(shadowCfg.dy)) : 0)
              + 6
            )
          );
          const paddedW = Wt + pad * 2;
          const paddedH = Ht + pad * 2;
          const combinedPng = base.replace('.png', '_combined.png');
          const alphaPadPng = base.replace('.png', '_alphapad.png');
          const scratch = [alphaPadPng];

          // The pad goes on before the dilate, not after: dilating an alpha cropped
          // to the glyphs squares the ring off at the text's bounding box, which
          // reads as a black slab behind the word rather than an outline round it.
          await run('convert', [alphaPng, '-bordercolor', 'black', '-border', pad, alphaPadPng])
            .catch(e => { console.error('Alpha pad error:', e.stderr?.slice(-500) || e.message); throw new Error('Alpha pad failed'); });

          let ringPng = alphaPadPng;
          if (strokeR > 0) {
            ringPng = base.replace('.png', '_ring.png');
            scratch.push(ringPng);
            await run('convert', [alphaPadPng, '-morphology', 'Dilate', 'Disk:' + strokeR.toFixed(2), ringPng])
              .catch(e => { console.error('Stroke dilate error:', e.stderr?.slice(-500) || e.message); throw new Error('Stroke dilate failed'); });
          }

          // A flat colour cut to a silhouette by the given mask, optionally blurred.
          const tint = async (colour, maskPath, outPath, blur) => {
            const src = outPath.replace('.png', '_src.png');
            await run('convert', ['-size', `${paddedW}x${paddedH}`, `xc:${safeColor(colour, '#000000')}`, src]);
            await run('convert', [src, maskPath, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', outPath]);
            if (blur > 0) await run('convert', [outPath, '-blur', `0x${blur.toFixed(2)}`, outPath]);
            try { fs.unlinkSync(src); } catch (e) {}
          };
          // ImageMagick reads "+-3+0" as malformed rather than as a negative offset.
          const geo = (x, y) => `${x >= 0 ? '+' : ''}${Math.round(x)}${y >= 0 ? '+' : ''}${Math.round(y)}`;

          const args = ['-size', `${paddedW}x${paddedH}`, 'xc:none'];

          // First, so it sits under everything - as it does in the app. Painted over
          // the stroke instead, the chip would swallow the outline of the very word
          // it is meant to sit behind.
          if (wordBox) {
            const chipPng = base.replace('.png', '_chip.png');
            scratch.push(chipPng);
            const x0 = Math.round(pad + wordBox.x - hlPadX);
            const y0 = Math.round(pad + wordBox.y - hlPadY);
            const x1 = Math.round(pad + wordBox.x + wordBox.w + hlPadX);
            const y1 = Math.round(pad + wordBox.y + wordBox.h + hlPadY);
            const radius = Math.max(0, Math.min(
              Math.round(num(hlCfg.radius, 0) * sscale),
              Math.floor(Math.min(x1 - x0, y1 - y0) / 2)
            ));
            // A roundrectangle of radius 0 draws nothing at all - not a
            // square-cornered box, nothing - so a hard-edged chip asks for a
            // rectangle by name. The app's chip is square, so this is the usual case.
            const draw = radius >= 1
              ? `roundrectangle ${x0},${y0} ${x1},${y1} ${radius},${radius}`
              : `rectangle ${x0},${y0} ${x1},${y1}`;
            await run('convert', [
              '-size', `${paddedW}x${paddedH}`, 'xc:none',
              '-fill', safeColor(hlCfg.color, '#FFE24A'),
              '-draw', draw,
              chipPng,
            ]).catch(e => { console.error('Chip draw error:', e.stderr?.slice(-500) || e.message); throw new Error('Chip draw failed'); });
            args.push(chipPng, '-geometry', '+0+0', '-composite');
          }

          if (shadowCfg) {
            const shadowPng = base.replace('.png', '_shadow.png');
            scratch.push(shadowPng);
            await tint(shadowCfg.color, ringPng, shadowPng, shadowCfg.radius)
              .catch(e => { console.error('Shadow layer error:', e.stderr?.slice(-500) || e.message); throw new Error('Shadow layer failed'); });
            args.push(shadowPng, '-geometry', geo(shadowCfg.dx, shadowCfg.dy), '-composite');
          }

          if (glowCfg) {
            const glowPng = base.replace('.png', '_glow.png');
            scratch.push(glowPng);
            await tint(glowCfg.color, ringPng, glowPng, glowCfg.radius)
              .catch(e => { console.error('Glow layer error:', e.stderr?.slice(-500) || e.message); throw new Error('Glow layer failed'); });
            // Laid down twice, as the app does: stacking the same halo reads brighter,
            // where one pass at a wider radius only spreads the same ink thinner.
            args.push(glowPng, '-geometry', '+0+0', '-composite');
            args.push(glowPng, '-geometry', '+0+0', '-composite');
          }

          if (strokeR > 0) {
            const strokePng = base.replace('.png', '_stroke.png');
            scratch.push(strokePng);
            await tint(spec.stroke.color, ringPng, strokePng, 0)
              .catch(e => { console.error('Stroke layer error:', e.stderr?.slice(-500) || e.message); throw new Error('Stroke layer failed'); });
            args.push(strokePng, '-geometry', '+0+0', '-composite');
          }

          args.push(coloredPng, '-geometry', `+${pad}+${pad}`, '-composite', combinedPng);
          await run('convert', args)
            .catch(e => { console.error('Layer combine error:', e.stderr?.slice(-500) || e.message); throw new Error('Layer combine failed'); });

          try { fs.unlinkSync(coloredPng); } catch (e) {}
          fs.copyFileSync(combinedPng, coloredPng);
          try { fs.unlinkSync(combinedPng); } catch (e) {}
          scratch.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
          effWt = paddedW;
          effHt = paddedH;
        }

        // The chip is drawn last so it sits behind the finished stack, and hugs it
        // rather than the caption's full column width.
        if (spec && spec.box) {
          const padX = Math.round(num(spec.box.padX) * sscale);
          const padY = Math.round(num(spec.box.padY) * sscale);
          const boxW = effWt + padX * 2;
          const boxH = effHt + padY * 2;
          // A pill is written as a radius larger than the chip; clamp it to what a
          // rounded rectangle can actually be before ImageMagick draws nothing.
          const radius = Math.max(0, Math.min(
            Math.round(num(spec.box.radius) * sscale),
            Math.floor(Math.min(boxW, boxH) / 2)
          ));
          const boxPng = base.replace('.png', '_box.png');
          const boxedPng = base.replace('.png', '_boxed.png');
          // A roundrectangle of radius 0 draws nothing at all - not a square-cornered
          // box, nothing - so a hard-edged chip has to ask for a rectangle by name.
          const boxDraw = radius >= 1
            ? `roundrectangle 0,0 ${boxW - 1},${boxH - 1} ${radius},${radius}`
            : `rectangle 0,0 ${boxW - 1},${boxH - 1}`;
          await run('convert', [
            '-size', `${boxW}x${boxH}`, 'xc:none',
            '-fill', safeColor(spec.box.color, '#000000'),
            '-draw', boxDraw,
            boxPng,
          ]).catch(e => { console.error('Box draw error:', e.stderr?.slice(-500) || e.message); throw new Error('Box draw failed'); });
          await run('convert', [boxPng, coloredPng, '-geometry', `+${padX}+${padY}`, '-composite', boxedPng])
            .catch(e => { console.error('Box composite error:', e.stderr?.slice(-500) || e.message); throw new Error('Box composite failed'); });
          try { fs.unlinkSync(coloredPng); } catch (e) {}
          fs.copyFileSync(boxedPng, coloredPng);
          try { fs.unlinkSync(boxedPng); } catch (e) {}
          try { fs.unlinkSync(boxPng); } catch (e) {}
          effWt = boxW;
          effHt = boxH;
        }

        const rotationDeg = num(t.rotation, 0);
        let WR = effWt, HR = effHt;
        if (Math.abs(rotationDeg) > 0.01) {
          await run('convert', [coloredPng, '-background', 'none', '-rotate', rotationDeg, outPng])
            .catch(e => { console.error('Rotate error:', e.stderr?.slice(-500) || e.message); throw new Error('Rotate failed'); });
          const rotDim = await run('identify', ['-format', '%w %h', outPng], { timeout: 15000 })
            .then(out => { const p = out.trim().split(' ').map(Number); return { w: p[0], h: p[1] }; })
            .catch(() => { throw new Error('identify rotated failed'); });
          WR = rotDim.w; HR = rotDim.h;
          try { fs.unlinkSync(coloredPng); } catch (e) {}
        } else {
          fs.copyFileSync(coloredPng, outPng);
          try { fs.unlinkSync(coloredPng); } catch (e) {}
        }

        const centerX = centreAnchored
          ? ((t.x ?? 50) / 100) * W
          : (t.isAutoCaption ? (W / 2) : (((t.x ?? 50) / 100) * W + Wt / 2));
        const centerY = centreAnchored
          ? ((t.y ?? 80) / 100) * H
          : (((t.y ?? 80) / 100) * H + effHt / 2);
        const placeX = Math.round(centerX - WR / 2);
        const placeY = Math.round(centerY - HR / 2);

        renderedTextPngs.push({ t, outPng, placeX, placeY });

        try { fs.unlinkSync(maskPng); } catch (e) {}
        try { fs.unlinkSync(alphaPng); } catch (e) {}
        try { fs.unlinkSync(fillPng); } catch (e) {}
      }

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

      await new Promise((resolve, reject) => {
        exec(overlayCmd, { timeout: 180000 }, (err, stdout, stderr) => {
          if (err) { console.error("Overlay/text burn error:", stderr?.slice(-500)); return reject(new Error("Overlay burn failed")); }
          resolve();
        });
      });
      try { fs.unlinkSync(outputVideo); } catch (e) {}
      outputVideo = withOverlaysOut;
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
        const trimStart = Number(t.trimStart) > 0 ? sec(t.trimStart) : 0;
        const trimEnd = Number(t.trimEnd) > trimStart ? sec(t.trimEnd) : null;
        if (trimStart > 0 || trimEnd !== null) {
          const args = [];
          if (trimStart > 0) args.push(`start=${trimStart}`);
          if (trimEnd !== null) args.push(`end=${trimEnd}`);
          chain.push(`atrim=${args.join(':')}`, 'asetpts=PTS-STARTPTS');
        }
        const startOffset = Number(t.startOffset) > 0 ? sec(t.startOffset) : 0;
        if (startOffset > 0) chain.push(`adelay=${Math.round(startOffset * 1000)}:all=1`);
        const volume = Number.isFinite(Number(t.volume)) ? Math.max(0, Math.min(4, Number(t.volume))) : 1;
        chain.push(`volume=${volume}`);
        return `[${i + 1}:a]${chain.join(',')}[a${i}]`;
      }).join(';');
      const mixInputs = audioTracks.map((t, i) => `[a${i}]`).join('');
      // duration=longest so a delayed track isn't cut off by an earlier one
      // ending, normalize=0 so amix doesn't silently divide every level by the
      // track count, and apad so the mix always outlasts the video - with
      // -shortest that pins the export to the video length. Previously
      // duration=first + -shortest truncated the whole video to the length of
      // the first audio track (a 6s voiceover cut a 12s video down to 6s).
      const filterComplex = `${audioLabels};${mixInputs}amix=inputs=${audioTracks.length}:duration=longest:dropout_transition=2:normalize=0[amixed];[amixed]apad[aout]`;

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

    const filename = path.basename(outputVideo);
    const localUrl = `/videos/${filename}`;

    if (userId) {
      await adminDb.collection('userVideos').add({
        userId, filename, localUrl,
        downloadUrl: `${process.env.BASE_URL || 'https://api.fitlifesolutions.site'}${localUrl}`,
        prompt: "Uploaded media video", aspectRatio: "9:16",
        createdAt: new Date().toISOString(),
        size: fs.statSync(outputVideo).size,
      });
    }

    updateJob(jobId, { status: 'done', progress: 100, videoUrl: localUrl, message: "Done!" });
  } catch (e) {
    console.error("Media-to-video error:", e.message);
    updateJob(jobId, { status: 'error', error: e.message });
  }
});


app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
