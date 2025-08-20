import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import natural from "natural";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

app.use("/videos", express.static(videosDir, {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Accept-Ranges", "bytes");
  },
}));

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!PEXELS_API_KEY || !ELEVENLABS_API_KEY) {
  console.error("Missing required API keys");
  process.exit(1);
}

exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("❌ FFmpeg missing");
  else console.log("✅ FFmpeg found: " + stdout.split("\n")[0]);
});

app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  "http://localhost:5175",
  "http://localhost:5173",
  "http://localhost:5174"
];
app.use(cors({
  origin: (origin, cb) =>
    !origin || allowedOrigins.includes(origin)
      ? cb(null, true)
      : cb(new Error("CORS blocked")),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: "Too many requests" }));

// ✅ NEW: Pexels search endpoint
app.post("/api/search-pexels-videos", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const response = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: process.env.PEXELS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Pexels API error: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Pexels API error:", error);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

// ------------------
// SRT Generation Function
// ------------------
function generateSRT(chunks, durations, outputPath) {
  let srtContent = "";
  let currentTime = 0;

  const formatTime = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    const ms = "000";
    return `${h}:${m}:${s},${ms}`;
  };

  chunks.forEach((text, i) => {
    const start = currentTime;
    const end = currentTime + durations[i];

    srtContent += `${i + 1}\n`;
    srtContent += `${formatTime(start)} --> ${formatTime(end)}\n`;
    srtContent += `${text.trim()}\n\n`;

    currentTime = end;
  });

  fs.writeFileSync(outputPath, srtContent, "utf-8");
  console.log(`✅ Subtitles saved: ${outputPath}`);
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${url}: ${res.statusText}`);
  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

async function getElevenLabsAudio(text) {
  const voiceId = "EXAVITQu4vr4xnSDxMaL";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
  });
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const audioPath = path.join(videosDir, `tts-${Date.now()}.mp3`);
  fs.writeFileSync(audioPath, buffer);
  return audioPath;
}

async function getPexelsVideo(query) {
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1`;
    const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
    const data = await res.json();
    if (!data.videos || data.videos.length === 0) return null;
    const mp4s = data.videos[0].video_files.filter(f => f.file_type === "video/mp4");
    if (mp4s.length === 0) return null;
    const hd = mp4s.filter(f => f.quality === "hd");
    return (hd.length ? hd[0].link : mp4s[0].link);
  } catch (err) { console.error(err); return null; }
}

function splitPromptToChunks(prompt) {
  return prompt.split(/(?<=\.|\?|!)/).map(p => p.trim()).filter(Boolean);
}

async function applyFadeEffect(inputPath, outputPath) {
  const duration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`).toString()
  );
  const fadeDuration = Math.min(1, duration / 2);
  const fadeOutStart = Math.max(0, duration - fadeDuration);
  const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vf "fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration}" -c:a copy "${outputPath}"`;
  return new Promise((resolve, reject) => {
    exec(ffmpegCmd, (err, stdout, stderr) => err ? reject(stderr) : resolve(stdout));
  });
}

// ------------------
// Idea-to-Video Route
// ------------------
app.post("/api/idea-to-video", async (req, res) => {
  // ... (your existing implementation unchanged)
});

// ------------------
app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
