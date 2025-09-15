import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from 'axios';
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

// ✅ Debug: print API keys
console.log("PEXELS_API_KEY:", process.env.PEXELS_API_KEY);
console.log("ELEVENLABS_API_KEY:", process.env.ELEVENLABS_API_KEY);
console.log("DEEPSEEK_API_KEY:", process.env.DEEPSEEK_API_KEY);

// ✅ Extra debug for ElevenLabs key
const rawEleven = process.env.ELEVENLABS_API_KEY || "";
console.log("ElevenLabs key present:", Boolean(rawEleven));
console.log("ElevenLabs key JSON:", JSON.stringify(rawEleven));
console.log("ElevenLabs key length:", rawEleven.length);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

/* ------------------------- Paths & Static Serving ------------------------- */
const videosDir = path.join(__dirname, "public", "videos");
const audiosDir = path.join(__dirname, "public", "audios");
const uploadsDir = path.join(__dirname, "uploads");

// Create directories if they don't exist
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
if (!fs.existsSync(audiosDir)) fs.mkdirSync(audiosDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve static videos
app.use("/videos", express.static(videosDir, {
    setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Accept-Ranges", "bytes");
    },
}));

// Serve static audios
app.use("/audios", express.static(audiosDir, {
    setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
}));

// Serve static uploads
app.use("/uploads", express.static(uploadsDir));

/* ------------------------------ API KEYS --------------------------------- */
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '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';

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

async function getElevenLabsAudioFile(text, voiceId = "19STyYD15bswVz51nqLf") {
    console.log("Calling ElevenLabs TTS with key:", ELEVENLABS_API_KEY);
    console.log("Request body:", JSON.stringify({ text, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }));

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
    const audioPath = path.join(audiosDir, uniqueName("tts", "mp3"));
    fs.writeFileSync(audioPath, buffer);

    // ✅ Debug: log and inspect with FFmpeg
    console.log("Audio file path:", audioPath);
    exec(`ffmpeg -i "${audioPath}"`, (err, stdout, stderr) => {
        if (err) console.error("FFmpeg inspection error:", err);
        console.log("FFmpeg inspection output:\n", stderr);
    });

    return { audioPath, audioUrl: `/audios/${path.basename(audioPath)}` };
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

function cleanupOldFiles(dir, maxAgeMs = 60 * 60 * 1000) {
    fs.readdir(dir, (err, files) => {
        if (err) return console.error(`❌ Cleanup error for ${dir}:`, err);
        const now = Date.now();
        files.forEach((file) => {
            const filePath = path.join(dir, file);
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

setInterval(() => {
    cleanupOldFiles(videosDir);
    cleanupOldFiles(audiosDir);
    cleanupOldFiles(uploadsDir);
}, 10 * 60 * 1000);

/* ----------------------- DeepSeek Script Generation ----------------------- */
/* ----------------------- DeepSeek Script Generation ----------------------- */
app.post("/api/generate-script", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!DEEPSEEK_API_KEY) {
    console.error("❌ DeepSeek API key not configured");
    return res.status(500).json({ error: "AI service not configured. Please check your API key." });
  }

  try {
    console.log("Sending request to DeepSeek (chat) with prompt:", prompt.substring(0, 100) + "...");

    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions", // use .com
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a professional video script writer. Create engaging, concise video scripts (30-60 seconds) suitable for social media. Keep it natural and conversational. Format as plain text without markdown."
          },
          {
            role: "user",
            content: `Create a short video script about: ${prompt}`
          }
        ],
        max_tokens: 300,
        temperature: 0.8,
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error("No script returned from DeepSeek");
    }

    const script = response.data.choices[0].message.content.trim();
    console.log("Script generation successful");
    return res.json({ script });

  } catch (err) {
    console.error("❌ Script generation failed:", err.message);

    if (err.response) {
      // API returned an error
      const status = err.response.status;
      if (status === 401) return res.status(401).json({ error: "Invalid DeepSeek API key" });
      if (status === 429) return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
      return res.status(status).json({ error: err.response.data?.error || "DeepSeek API error" });
    }

    // Network or other errors
    return res.status(500).json({ error: "Script generation failed: " + err.message });
  }
});


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
        data.videos = (data.videos || []).slice(0, 4);
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

        const voice = voiceId || "19STyYD15bswVz51nqLf";
        const { audioUrl } = await getElevenLabsAudioFile(text, voice);
        res.json({ audioUrl });
    } catch (err) {
        console.error("❌ TTS error:", err);
        res.status(500).json({ error: "Failed to synthesize audio" });
    }
});

/* ----------------------- Generate Audio Endpoint -------------------------- */
app.post("/api/generate-audio", async (req, res) => {
    try {
        const { text, voice } = req.body;

        if (!text?.trim()) {
            return res.status(400).json({ error: "Text is required" });
        }

        const voiceId = voice || "19STyYD15bswVz51nqLf";
        const { audioPath, audioUrl } = await getElevenLabsAudioFile(text, voiceId);

        res.json({
            success: true,
            audioUrl,
            filename: path.basename(audioPath)
        });
    } catch (err) {
        console.error("❌ TTS error:", err);
        res.status(500).json({ error: "Failed to generate audio: " + err.message });
    }
});

/* ----------------------- NEW: Raw Audio Streaming Endpoint ---------------- */
app.post("/api/generate-audio-stream", async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    if (!voiceId) {
      return res.status(400).json({ error: "Missing voiceId" });
    }

    console.log("Calling ElevenLabs TTS with voice:", voiceId);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs error: ${err}`);
    }

    const audioBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type","audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (error) {
    console.error("❌ TTS error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/* ------------------------ Idea-to-Video (Merge) --------------------------- */
app.post("/api/idea-to-video", async (req, res) => {
    const { prompt = "", voiceover = "", selectedVideo, audioUrl: providedAudioUrl, voice } = req.body || {};
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
        } else if (providedAudioUrl && /^\/?audios\//i.test(providedAudioUrl)) {
            const fileName = providedAudioUrl.replace(/^\/?audios\//, "");
            audioPathLocal = path.join(audiosDir, fileName);
            audioPublicUrl = `/audios/${fileName}`;
        } else if (providedAudioUrl && isHttpUrl(providedAudioUrl)) {
            const audioPath = path.join(audiosDir, uniqueName("voice", "mp3"));
            await downloadToFile(providedAudioUrl, audioPath);
            audioPathLocal = audioPath;
            audioPublicUrl = `/audios/${path.basename(audioPath)}`;
        } else if (voiceover.trim()) {
            const voiceId = voice || "19STyYD15bswVz51nqLf";
            const { audioPath, audioUrl } = await getElevenLabsAudioFile(voiceover.trim(), voiceId);
            audioPathLocal = audioPath;
            audioPublicUrl = audioUrl;
        } else {
            return res.status(400).json({ error: "Missing audio (audioUrl or voiceover)" });
        }

        /* ------------------ NEW MERGE LOGIC ------------------ */
        const outputVideo = path.join(videosDir, uniqueName("final", "mp4"));

        // Download video to local file
        const videoPath = path.join(videosDir, uniqueName("src", "mp4"));
        await downloadToFile(videoSourceUrl, videoPath);

        // Run FFmpeg to merge
        await new Promise((resolve, reject) => {
            const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -i "${audioPathLocal}" -c:v copy -c:a aac -b:a 192k -shortest "${outputVideo}"`;
            exec(ffmpegCmd, (err, stdout, stderr) => {
                if (err) {
                    console.error("❌ FFmpeg merge error:", stderr);
                    return reject(new Error("Failed to merge video and audio"));
                }
                console.log("✅ FFmpeg merge success:", outputVideo);
                resolve();
            });
        });

        const finalVideoUrl = `/videos/${path.basename(outputVideo)}`;

        res.json({
            success: true,
            videoUrl: finalVideoUrl,
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