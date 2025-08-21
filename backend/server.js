import express from "express";
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

/* ------------------------- Paths & Static Serving ------------------------- */
const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

app.use(
  "/videos",
  express.static(videosDir, {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Accept-Ranges", "bytes");
    },
  })
);

app.use(express.static("uploads"));

/* ------------------------------ API KEYS --------------------------------- */
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!PEXELS_API_KEY || !ELEVENLABS_API_KEY) {
  console.error("❌ Missing API keys (PEXELS_API_KEY / ELEVENLABS_API_KEY)");
  process.exit(1);
}

/* ---------------------------- FFmpeg Check -------------------------------- */
exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("❌ FFmpeg missing");
  else console.log("✅ FFmpeg found:", stdout.split("\n")[0]);
});

/* ---------------------------- Middleware ---------------------------------- */
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
];
app.use(
  cors({
    origin: (origin, cb) =>
      !origin || allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS blocked")),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests",
  })
);

/* ------------------------------ Helpers ----------------------------------- */
function uniqueName(prefix, ext) {
  return `${prefix}-${Date.now()}-${uuidv4()}.${ext}`;
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${url}: ${res.status}`);
  const fileStream = fs.createWriteStream(outPath);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
  return outPath;
}

async function getElevenLabsAudioFile(text, voiceId = "EXAVITQu4vr4xnSDxMaL") {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs error: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const audioPath = path.join(videosDir, uniqueName("tts", "mp3"));
  fs.writeFileSync(audioPath, buffer);
  return { audioPath, audioUrl: `/videos/${path.basename(audioPath)}` };
}

function pickMp4FromPexelsVideo(videoObj) {
  if (!videoObj || !videoObj.video_files) return null;
  const mp4s = videoObj.video_files.filter((f) => f.file_type === "video/mp4");
  if (!mp4s.length) return null;
  return (mp4s.find((f) => f.quality === "sd") ||
    mp4s.find((f) => f.quality === "hd") ||
    mp4s[0]
  ).link;
}

function isHttpUrl(s) {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}

/* ------------------ Cleanup: Delete old files in /videos ------------------ */
function cleanupOldVideos(maxAgeMs = 60 * 60 * 1000) { // 1h
  fs.readdir(videosDir, (err, files) => {
    if (err) return console.error("❌ Cleanup error:", err);
    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(videosDir, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && now - stats.mtimeMs > maxAgeMs) {
          fs.unlink(filePath, (err) => {
            if (!err) console.log(`🧹 Deleted old file: ${file}`);
          });
        }
      });
    });
  });
}
// Run every 10 minutes
setInterval(() => cleanupOldVideos(), 10 * 60 * 1000);

/* ----------------------- Pexels Search Endpoint --------------------------- */
app.post("/api/search-pexels-videos", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query required" });

    const response = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    if (!response.ok) throw new Error("Pexels API error");

    const data = await response.json();
    data.videos = (data.videos || []).slice(0, 2);
    res.json(data);
  } catch (err) {
    console.error("❌ Pexels API error:", err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

/* -------------------------- ElevenLabs TTS API ---------------------------- */
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceId } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "text required" });

    const { audioUrl } = await getElevenLabsAudioFile(text, voiceId);
    res.json({ audioUrl });
  } catch (err) {
    console.error("❌ TTS error:", err);
    res.status(500).json({ error: "Failed to synthesize audio" });
  }
});

/* ----------------------- Generate Audio Endpoint -------------------------- */
app.post("/api/generate-audio", async (req, res) => {
  try {
    const { text, voice } = req.body; // from frontend

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_settings: { stability: 0.3, similarity_boost: 0.7 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).send(err);
    }

    // save audio file locally
    const buffer = await response.arrayBuffer();
    const filename = `audio_${Date.now()}.mp3`;
    const filepath = path.join("videos", filename);
    fs.writeFileSync(filepath, Buffer.from(buffer));

    res.json({ audioUrl: `http://localhost:5000/videos/${filename}` });
  } catch (err) {
    console.error("❌ Error generating audio:", err);
    res.status(500).json({ error: "Audio generation failed" });
  }
});

/* ------------------------ Idea-to-Video (Merge) --------------------------- */
app.post("/api/idea-to-video", async (req, res) => {
  const { prompt = "", voiceover = "", selectedVideo, audioUrl: providedAudioUrl } = req.body || {};
  try {
    // Video
    let videoSourceUrl = null;
    if (typeof selectedVideo === "object" && selectedVideo !== null) {
      videoSourceUrl = pickMp4FromPexelsVideo(selectedVideo);
    } else if (isHttpUrl(selectedVideo)) {
      videoSourceUrl = selectedVideo;
    }
    if (!videoSourceUrl) return res.status(400).json({ error: "selectedVideo required" });

    // Audio
    let audioPathLocal = null;
    let audioPublicUrl = null;
    if (providedAudioUrl && /^\/?videos\//i.test(providedAudioUrl)) {
      const fileName = providedAudioUrl.replace(/^\/?videos\//, "");
      audioPathLocal = path.join(videosDir, fileName);
      audioPublicUrl = `/videos/${fileName}`;
    } else if (providedAudioUrl && isHttpUrl(providedAudioUrl)) {
      const audioPath = path.join(videosDir, uniqueName("voice", "mp3"));
      await downloadToFile(providedAudioUrl, audioPath);
      audioPathLocal = audioPath;
      audioPublicUrl = `/videos/${path.basename(audioPath)}`;
    } else if (voiceover.trim()) {
      const { audioPath, audioUrl } = await getElevenLabsAudioFile(voiceover.trim());
      audioPathLocal = audioPath;
      audioPublicUrl = audioUrl;
    } else {
      return res.status(400).json({ error: "Missing audio (audioUrl or voiceover)" });
    }

    // Download video
    const videoPath = path.join(videosDir, uniqueName("src", "mp4"));
    await downloadToFile(videoSourceUrl, videoPath);

    // Merge
    const outPath = path.join(videosDir, uniqueName("final", "mp4"));
    const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -i "${audioPathLocal}" -c:v copy -c:a aac -b:a 192k -shortest "${outPath}"`;
    await new Promise((resolve, reject) => {
      exec(ffmpegCmd, (err, stdout, stderr) => {
        if (err) {
          console.error("❌ FFmpeg error:", stderr || err);
          reject(new Error("Merge failed"));
        } else resolve();
      });
    });

    res.json({
      success: true,
      videoUrl: `/videos/${path.basename(outPath)}`,
      audioUrl: audioPublicUrl,
      script: voiceover || prompt,
    });
  } catch (err) {
    console.error("❌ idea-to-video error:", err);
    res.status(500).json({ error: "Failed to generate video" });
  }
});

/* ------------------------------- 404 -------------------------------------- */
app.use((req, res) => res.status(404).json({ error: "Not found" }));

/* ------------------------------- Start ------------------------------------ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));