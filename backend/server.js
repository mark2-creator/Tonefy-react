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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// =======================
// Ensure videos folder exists
// =======================
const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir);
}

// =======================
// Serve static video files
// =======================
app.use("/videos", express.static(videosDir, {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader('Accept-Ranges', 'bytes');
  }
}));

// =======================
// API Keys & Checks
// =======================
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!PEXELS_API_KEY || !ELEVENLABS_API_KEY || !DEEPSEEK_API_KEY) {
  console.error('Missing required API keys in environment variables');
  process.exit(1);
}

// =======================
// FFmpeg check
// =======================
exec("ffmpeg -version", (err, stdout) => {
  if (err) console.error("❌ FFmpeg not installed or PATH missing");
  else console.log("✅ FFmpeg found: " + stdout.split("\n")[0]);
});

// =======================
// Security + CORS
// =======================
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  'http://localhost:5175', 'http://localhost:5173', 'http://localhost:5174'
];
app.use(cors({
  origin: (origin, callback) => (!origin || allowedOrigins.includes(origin)) ? callback(null,true) : callback(new Error('CORS blocked')),
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));

app.use((req,res,next)=>{console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next();});

// =======================
// Rate limiter
// =======================
app.use(rateLimit({
  windowMs: 15*60*1000,
  max: 100,
  message: "Too many requests from this IP, try later"
}));

// =======================
// Helper: download file
// =======================
async function downloadFile(url, dest){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Download failed ${url}: ${res.statusText}`);
  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve,reject)=>{
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

// =======================
// ElevenLabs TTS
// =======================
async function getElevenLabsAudio(prompt){
  const voiceId = "EXAVITQu4vr4xnSDxMaL";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url,{
    method: "POST",
    headers: {"xi-api-key": ELEVENLABS_API_KEY,"Content-Type":"application/json"},
    body: JSON.stringify({text: prompt, voice_settings:{stability:0.5, similarity_boost:0.75}})
  });
  if(!res.ok) throw new Error(`ElevenLabs error: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const audioPath = path.join(videosDir, `input-audio-${Date.now()}.mp3`);
  fs.writeFileSync(audioPath, buffer);
  return audioPath;
}

// =======================
// Pexels Video
// =======================
async function getPexelsVideo(prompt){
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(prompt)}&per_page=1`,
    {headers:{Authorization:PEXELS_API_KEY}});
  const data = await res.json();
  if(!data.videos || !data.videos.length) throw new Error("No Pexels video found");
  return data.videos[0].video_files[0].link;
}

// =======================
// DeepSeek Enhancement
// =======================
async function processWithDeepSeek(videoPath){
  const res = await fetch("https://api.deepseek.com/v1/process", {
    method:"POST",
    headers:{
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({ video_path: videoPath })
  });
  if(!res.ok) throw new Error(`DeepSeek error: ${res.statusText}`);
  const data = await res.json();
  return data.processed_video_url; // URL to processed video
}

// =======================
// Idea-to-video route
// =======================
app.post("/api/idea-to-video", async (req,res)=>{
  try{
    const {prompt} = req.body;
    if(!prompt) return res.status(400).json({error:"Prompt is required"});

    const timestamp = Date.now();
    const videoPath = path.join(videosDir, `input-video-${timestamp}.mp4`);
    const tempProcessedPath = path.join(videosDir, `processed-video-${timestamp}.mp4`);
    const outputPath = path.join(videosDir, `final-video-${timestamp}.mp4`);

    // 1️⃣ Pexels video
    const pexelsUrl = await getPexelsVideo(prompt);
    await downloadFile(pexelsUrl, videoPath);

    // 2️⃣ ElevenLabs TTS
    const audioPath = await getElevenLabsAudio(prompt);

    // Log file sizes
    console.log("Video size:", fs.statSync(videoPath).size);
    console.log("Audio size:", fs.statSync(audioPath).size);

    // 3️⃣ DeepSeek processing
    try {
      const processedVideoUrl = await processWithDeepSeek(videoPath);
      await downloadFile(processedVideoUrl, tempProcessedPath);
      // Only overwrite original video after successful DeepSeek download
      fs.renameSync(tempProcessedPath, videoPath);
    } catch(e) {
      console.error("DeepSeek processing failed, continuing with original video:", e);
    }

    // 4️⃣ Merge video + audio
    const ffmpegCommand = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac "${outputPath}"`;
    exec(ffmpegCommand, (err)=>{
      try{ fs.unlinkSync(videoPath); } catch(e){}
      try{ fs.unlinkSync(audioPath); } catch(e){}
      if(err) return res.status(500).json({error:"FFmpeg merge failed"});
      res.json({
        message:"Video created",
        videoUrl:`/videos/${path.basename(outputPath)}`,
        script:`Generated for: ${prompt}`
      });
    });

  }catch(err){
    console.error("Idea-to-video error:", err);
    res.status(500).json({error:err.message});
  }
});

// =======================
// 404
// =======================
app.use((req,res)=>res.status(404).json({error:"Endpoint not found"}));

// =======================
// Start server
// =======================
const PORT = process.env.PORT||5000;
app.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));
