import express from "express";
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
  const authHeader = req.headers.authorization;
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

exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("FFmpeg missing");
  else console.log("FFmpeg found:", stdout.split("\n")[0]);
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });
// Global rate limit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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

function cleanupOldFiles(dir, maxAgeMs = 24 * 60 * 60 * 1000) {
  fs.readdir(dir, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(dir, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && now - stats.mtimeMs > maxAgeMs) fs.unlink(filePath, () => {});
      });
    });
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
function buildAssFile(script, audioDuration, assPath, captionStyle, wordTimestamps = null) {
  const words = script.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Use whisper word timestamps if available, otherwise estimate
  let chunks, chunkTimings;
  if (wordTimestamps && wordTimestamps.length > 0) {
    // Animated styles: one word per line with exact timing
    const ANIMATED = ['highlight','sticker','shadow3d','tiktok','neon','fire','bold','purple'];
    if (ANIMATED.includes(captionStyle)) {
      chunks = wordTimestamps.map(w => w.word);
      chunkTimings = wordTimestamps.map(w => ({ start: w.start, end: w.end }));
    } else {
      // Group into 3-word chunks using whisper timing
      chunks = [];
      chunkTimings = [];
      for (let i = 0; i < wordTimestamps.length; i += 3) {
        const group = wordTimestamps.slice(i, i + 3);
        chunks.push(group.map(w => w.word).join(' '));
        chunkTimings.push({ start: group[0].start, end: group[group.length-1].end });
      }
    }
  } else {
    // Fallback: estimate timing
    const chunkSize = captionStyle === 'word' ? 1 : 3;
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

  const s = STYLES[captionStyle] || STYLES["classic"];

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
  const isAnimated = ANIMATED_STYLES.includes(captionStyle) && wordTimestamps?.length > 0;

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
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a professional video script writer. Create engaging 30-60 second video scripts for social media. Write ONLY spoken narration - no stage directions, no Narrator:, no timestamps, no scene descriptions. Just pure spoken words." },
        { role: "user", content: `Create a short video script about: ${prompt}` }
      ],
      model: "llama-3.1-8b-instant", max_tokens: 400, temperature: 0.8,
    });
    res.json({ script: completion.choices[0].message.content.trim() });
  } catch (err) {
    console.error("Script error:", err.message);
    res.status(500).json({ error: "Failed to generate script" });
  }
});

app.post("/api/extract-keywords", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Text required" });
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: 'Extract 3 short visual search keywords from this text. Return ONLY a JSON array like: ["keyword1", "keyword2", "keyword3"]' },
        { role: "user", content: text }
      ],
      model: "llama-3.1-8b-instant", max_tokens: 80, temperature: 0.3,
    });
    try {
      res.json({ keywords: JSON.parse(completion.choices[0].message.content.trim()) });
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
  const { voiceover = "", selectedVideo, selectedVideos, audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", musicTrack = "mixkit-deep-meditation-109", videoSpeed = 1.0, transition = "fade" } = req.body || {};
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
    const hasCaptions = buildAssFile(voiceover || "", audioDuration, assPath, captionStyle);
    // subtitles filter burns SRT into video — handles any length efficiently
    const subsFilter = hasCaptions ? `,ass='${assPath.replace(/'/g, "\\'")}'` : '';
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
  const { voiceover = "", segments = [], audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", transition = "fade", musicTrack = "mixkit-deep-meditation-109", videoSpeed = 1.0 } = req.body || {};
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
    const hasCaptions = buildAssFile(voiceover || "", totalAudioDuration, assPath, captionStyle, wordTimestamps);
    console.log("hasCaptions:", hasCaptions, "file exists:", fs.existsSync(assPath));
    const subsFilter = hasCaptions ? `,ass='${assPath.replace(/'/g, "\\'")}'` : '';
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


app.use((req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
