import express from "express";
import crypto from 'crypto';
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// In-memory job store
const jobs = new Map();
function createJob() {
  const jobId = uuidv4();
  jobs.set(jobId, { status: 'pending', progress: 0, message: 'Starting...' });
  return jobId;
}
function updateJob(jobId, data) { if (jobs.has(jobId)) jobs.set(jobId, { ...jobs.get(jobId), ...data }); }

const videosDir = path.join(__dirname, "public", "videos");
const audiosDir = path.join(__dirname, "public", "audios");
const uploadsDir = path.join(__dirname, "uploads");

[videosDir, audiosDir, uploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

app.use("/videos", express.static(videosDir, { setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); res.setHeader("Accept-Ranges", "bytes"); } }));
app.use("/audios", express.static(audiosDir, { setHeaders: (res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); } }));
app.use("/uploads", express.static(uploadsDir));

exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("FFmpeg missing");
  else console.log("FFmpeg found:", stdout.split("\n")[0]);
});

app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path.startsWith('/api/job/')
}));

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
function buildAssFile(script, audioDuration, assPath, captionStyle) {
  const words = script.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Premium: 2-3 words per chunk for dynamic feel
  const chunkSize = captionStyle === 'word' ? 1 : 3;
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  const timePerChunk = audioDuration / chunks.length;

  const toAssTime = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(1, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    const cs = Math.round((s % 1) * 100).toString().padStart(2, '0');
    return `${h}:${m}:${sec}.${cs}`;
  };

  // Premium styles
  const styles = {
    // Bold white text, thick black outline, drop shadow - CapCut style
    "classic": {
      fontname: "Arial",
      fontsize: 26,
      primary: "&H00FFFFFF",   // white text
      outline: "&H00000000",   // black outline
      back: "&H80000000",      // semi-transparent shadow
      bold: 1,
      outline_w: 3,
      shadow: 1.5,
      alignment: 2,            // center bottom
      marginV: 80
    },
    // Yellow highlighted text - TikTok style
    "tiktok": {
      fontname: "Arial",
      fontsize: 28,
      primary: "&H00FFFF00",   // yellow
      outline: "&H00000000",   // black outline
      back: "&H90000000",
      bold: 1,
      outline_w: 3,
      shadow: 1,
      alignment: 2,
      marginV: 80
    },
    // White bold text with green highlight outline
    "neon": {
      fontname: "Arial",
      fontsize: 26,
      primary: "&H00FFFFFF",
      outline: "&H0000FF00",   // green outline
      back: "&H90000000",
      bold: 1,
      outline_w: 3,
      shadow: 0,
      alignment: 2,
      marginV: 80
    },
    // Large bold white - Reels style
    "reels": {
      fontname: "Arial",
      fontsize: 30,
      primary: "&H00FFFFFF",
      outline: "&H00000000",
      back: "&HAA000000",
      bold: 1,
      outline_w: 4,
      shadow: 2,
      alignment: 2,
      marginV: 100
    }
  };

  const s = styles[captionStyle] || styles["classic"];

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
Collisions: Normal
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontname},${s.fontsize},${s.primary},&H000000FF,${s.outline},${s.back},${s.bold},0,0,0,100,100,0.5,0,1,${s.outline_w},${s.shadow},${s.alignment},20,20,${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = chunks.map((chunk, i) => {
    const start = i * timePerChunk;
    const end = Math.min((i + 1) * timePerChunk, audioDuration);
    // Clean and uppercase for premium look
    const safeChunk = chunk.replace(/[}{]/g, '').toUpperCase();
    return `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Default,,0,0,0,,${safeChunk}`;
  });

  fs.writeFileSync(assPath, header + events.join('\n') + '\n', 'utf8');
  return true;
}

app.post("/api/generate-script", async (req, res) => {
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

app.post("/api/search-pexels-videos", async (req, res) => {
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
  "classic": "Arial,18,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,40,1",
  "tiktok":  "Arial,22,&H00FFFF00,&H000000FF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,3,2,0,2,10,10,40,1",
  "bold":    "Arial,28,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,10,10,40,1",
  "neon":    "Arial,20,&H007FFF00,&H000000FF,&H00003300,&H00000000,1,0,0,0,100,100,1,0,1,3,1,2,10,10,40,1",
  "fire":    "Arial,22,&H000066FF,&H000000FF,&H00000099,&H00000000,1,0,0,0,100,100,0,0,1,3,1,2,10,10,40,1",
  "minimal": "Arial,15,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,30,1",
};

app.post("/api/generate-audio", async (req, res) => {
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

app.post("/api/tts", async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "text required" });
  try {
    const audioFilename = uniqueName("gtts", "mp3");
    const audioPath = path.join(audiosDir, audioFilename);
    await new Promise((resolve, reject) => {
      exec(`python3 /home/ahumuza/Tonefy-react/backend/gtts_generate.py ${JSON.stringify(text)} ${JSON.stringify(audioPath)}`,
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

app.post("/api/idea-to-video", async (req, res) => {
  const { voiceover = "", selectedVideo, selectedVideos, audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic" } = req.body || {};
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
        exec(`python3 /home/ahumuza/Tonefy-react/backend/gtts_generate.py ${JSON.stringify(voiceover)} ${JSON.stringify(ap)}`,
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
    const safeTrack = ["background","chill","upbeat","dramatic","lofi"].includes(musicTrack) ? musicTrack : "background";
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
      ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPathLocal}" -stream_loop -1 -i "${musicPath}" -t ${audioDuration} -filter_complex "[1:a]volume=1.0[voice];[2:a]volume=0.15[music];[voice][music]amix=inputs=2:duration=first[aout]" -vf "${vf}" -map 0:v:0 -map "[aout]" -c:v libx264 -preset fast -crf 26 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -shortest "${outputVideo}"`;
    } else {
      ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoPath}" -i "${audioPathLocal}" -t ${audioDuration} -vf "${vf}" -c:v libx264 -preset fast -crf 26 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest "${outputVideo}"`;
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

app.post("/api/search-pexels-segment", async (req, res) => {
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

app.post("/api/idea-to-video-v2", async (req, res) => {
  const { voiceover = "", segments = [], audioUrl: providedAudioUrl, aspectRatio = "9:16", captionStyle = "classic", transition = "fade", musicTrack = "background" } = req.body || {};
  const jobId = createJob();
  res.json({ jobId });

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
        exec(`python3 /home/ahumuza/Tonefy-react/backend/gtts_generate.py ${JSON.stringify(voiceover)} ${JSON.stringify(ap)}`,
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
          const cmd = `ffmpeg -y -stream_loop -1 -i "${rawPath}" -t ${dur} -vf "${scaleFilter},setsar=1,fps=30" -an -c:v libx264 -preset fast -crf 26 -video_track_timescale 30000 "${trimmedPath}"`;
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
          const cmd = `ffmpeg -y -f lavfi -i color=c=black:s=${aspectRatio === '9:16' ? '720x1280' : aspectRatio === '1:1' ? '720x720' : '1280x720'}:d=${dur}:r=30 -vf "setsar=1" -c:v libx264 -preset fast -crf 26 -video_track_timescale 30000 "${trimmedPath}"`;
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
      const TMAP = {fade:'fade',slide:'slideleft',slideup:'slideup',zoom:'zoom',wipe:'wipeleft',blur:'fadeblack',dissolve:'dissolve',none:'fade'};
      const xft = TMAP[transition] || 'fade';
      const XDUR = transition === 'none' ? 0.01 : 0.5;
      const inputs = clipPaths.map(p => `-i "${p}"`).join(' ');
      let filterComplex, mapArg;
      if (transition === 'none' || clipPaths.length < 2) {
        // Simple concat without transitions
        const filterInputs = clipPaths.map((_, i) => `[${i}:v]`).join('');
        filterComplex = `${filterInputs}concat=n=${clipPaths.length}:v=1:a=0[vout]`;
        mapArg = '[vout]';
      } else {
        // xfade transitions
        let parts = [], cumDur = 0, prevLabel = '0:v';
        for (let i = 1; i < clipPaths.length; i++) {
          cumDur += segDurations[i-1];
          const offset = Math.max(0, cumDur - XDUR * i);
          const outLabel = i === clipPaths.length - 1 ? 'vout' : `v${i}`;
          parts.push(`[${prevLabel}][${i}:v]xfade=transition=${xft}:duration=${XDUR}:offset=${offset.toFixed(2)}[${outLabel}]`);
          prevLabel = outLabel;
        }
        filterComplex = parts.join(';');
        mapArg = '[vout]';
      }
      const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "${mapArg}" -c:v libx264 -preset fast -crf 26 "${concatPath}"`;
      await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
          if (err) { console.error("concat error:", stderr?.slice(-500)); return reject(new Error("concat failed")); }
          resolve();
        });
      });
    }
    clipPaths.forEach(p => fs.unlink(p, () => {}));

    // 5. Overlay audio + captions + watermark
    updateJob(jobId, { progress: 60, message: "Adding voiceover & captions..." });
    const outputVideo = path.join(videosDir, uniqueName("final", "mp4"));
    const safeTrack = ["background","chill","upbeat","dramatic","lofi"].includes(musicTrack) ? musicTrack : "background";
    const musicPath = path.join(__dirname, "public", "music", safeTrack + ".mp3");
    const hasBgMusic = fs.existsSync(musicPath);
    const watermark = "drawtext=text='Tonefy AI':fontsize=18:fontcolor=white@0.5:x=(w-text_w)/2:y=h-th-20";
    const assPath = outputVideo.replace('.mp4', '.ass');
    const hasCaptions = buildAssFile(voiceover || "", totalAudioDuration, assPath, captionStyle);
    const subsFilter = hasCaptions ? `,ass='${assPath.replace(/'/g, "\\'")}'` : '';
    const vf = `setsar=1${subsFilter},${watermark}`;

    let ffmpegCmd;
    if (hasBgMusic) {
      ffmpegCmd = `ffmpeg -y -i "${concatPath}" -i "${audioPathLocal}" -stream_loop -1 -i "${musicPath}" -t ${totalAudioDuration} -filter_complex "[1:a]volume=1.0[voice];[2:a]volume=0.15[music];[voice][music]amix=inputs=2:duration=first[aout]" -vf "${vf}" -map 0:v:0 -map "[aout]" -c:v libx264 -preset fast -crf 26 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -shortest "${outputVideo}"`;
    } else {
      ffmpegCmd = `ffmpeg -y -i "${concatPath}" -i "${audioPathLocal}" -t ${totalAudioDuration} -vf "${vf}" -c:v libx264 -preset fast -crf 26 -pix_fmt yuv420p -tune fastdecode -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest "${outputVideo}"`;
    }
    await new Promise((resolve, reject) => {
      exec(ffmpegCmd, { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) { console.error("final ffmpeg error:", stderr?.slice(-500)); return reject(new Error("final merge failed")); }
        resolve();
      });
    });

    fs.unlink(concatPath, () => {});
    if (hasCaptions) fs.unlink(assPath, () => {});

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
