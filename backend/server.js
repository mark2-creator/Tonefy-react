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

const allowedOrigins = ["http://localhost:5175","http://localhost:5173","http://localhost:5174"];
app.use(cors({ origin: (origin, cb) => !origin || allowedOrigins.includes(origin) ? cb(null,true) : cb(new Error("CORS blocked")), methods:["GET","POST","OPTIONS"], allowedHeaders:["Content-Type","Authorization"], credentials:true }));

app.use((req,res,next)=>{ console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); next(); });

app.use(rateLimit({ windowMs: 15*60*1000, max: 100, message: "Too many requests" }));

async function downloadFile(url,dest){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Download failed ${url}: ${res.statusText}`);
  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve,reject)=>{ res.body.pipe(fileStream); res.body.on("error",reject); fileStream.on("finish",resolve); });
}

async function getElevenLabsAudio(text){
  const voiceId = "EXAVITQu4vr4xnSDxMaL";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url,{
    method:"POST",
    headers:{ "xi-api-key": ELEVENLABS_API_KEY, "Content-Type":"application/json" },
    body: JSON.stringify({ text, voice_settings:{ stability:0.5, similarity_boost:0.75 } })
  });
  if(!res.ok) throw new Error(`ElevenLabs error: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const audioPath = path.join(videosDir, `tts-${Date.now()}.mp3`);
  fs.writeFileSync(audioPath, buffer);
  return audioPath;
}

async function getPexelsVideo(query){
  try{
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1`;
    const res = await fetch(url,{ headers:{ Authorization: PEXELS_API_KEY } });
    const data = await res.json();
    if(!data.videos || data.videos.length===0) return null;
    const mp4s = data.videos[0].video_files.filter(f=>f.file_type==="video/mp4");
    if(mp4s.length===0) return null;
    const hd = mp4s.filter(f=>f.quality==="hd");
    return (hd.length? hd[0].link : mp4s[0].link);
  }catch(err){ console.error(err); return null; }
}

function splitPromptToChunks(prompt){
  return prompt.split(/(?<=\.|\?|!)/).map(p=>p.trim()).filter(Boolean);
}

async function applyFadeEffect(inputPath, outputPath){
  const fadeDuration = 1; // seconds
  const cmd = `ffmpeg -y -i "${inputPath}" -vf "fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}")-${fadeDuration}:d=${fadeDuration}" -c:a copy "${outputPath}"`;
  return new Promise((resolve,reject)=>{
    exec(cmd,(err,stdout,stderr)=> err? reject(stderr) : resolve(stdout));
  });
}

app.post("/api/idea-to-video", async (req,res)=>{
  const timestamp = Date.now();
  const { prompt } = req.body;
  if(!prompt) return res.status(400).json({ error:"Prompt required" });

  try{
    const chunks = splitPromptToChunks(prompt);
    console.log("Split into chunks:", chunks);

    const sceneFiles = [];

    for(let i=0;i<chunks.length;i++){
      const chunk = chunks[i];
      console.log("Processing chunk:", chunk);

      const audioPath = await getElevenLabsAudio(chunk);

      const tokenizer = new natural.WordTokenizer();
      const words = tokenizer.tokenize(chunk);
      const stopwords = ["the","is","a","an","and","or","of","to","in"];
      const keywords = words.filter(w=>!stopwords.includes(w.toLowerCase())).slice(0,5);
      const query = keywords.join(" ") || "nature";

      let videoUrl = await getPexelsVideo(query);
      let videoPath = path.join(videosDir, `scene-${timestamp}-${i}.mp4`);

      if(!videoUrl){
        const durationCmd = `ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`;
        const duration = await new Promise((resolve,reject)=>{
          exec(durationCmd,(err,stdout)=> err? reject(err) : resolve(parseFloat(stdout.trim())));
        });
        const blackScreenCmd = `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=${duration} -c:v libx264 "${videoPath}"`;
        await new Promise((resolve,reject)=> exec(blackScreenCmd,(err)=> err? reject(err) : resolve()));
      }else{
        await downloadFile(videoUrl,videoPath);
      }

      const mergedScene = path.join(videosDir, `scene-final-${timestamp}-${i}.mp4`);
      const mergeCmd = `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac "${mergedScene}"`;
      await new Promise((resolve,reject)=> exec(mergeCmd,(err)=> err? reject(err) : resolve()));

      // Optional: fade effect
      const fadedScene = path.join(videosDir, `scene-fade-${timestamp}-${i}.mp4`);
      const fadeCmd = `ffmpeg -y -i "${mergedScene}" -vf "fade=t=in:st=0:d=1,fade=t=out:st=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mergedScene}")-1:d=1" -c:a copy "${fadedScene}"`;
      await new Promise((resolve,reject)=> exec(fadeCmd,(err)=> err? reject(err) : resolve()));

      [videoPath, audioPath, mergedScene].forEach(f=>{ try{ fs.unlinkSync(f) }catch(_){} });

      sceneFiles.push(fadedScene);
    }

    const listFile = path.join(videosDir, `list-${timestamp}.txt`);
    fs.writeFileSync(listFile, sceneFiles.map(f=>`file '${f}'`).join("\n"));
    const finalOutput = path.join(videosDir, `final-video-${timestamp}.mp4`);
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${finalOutput}"`;
    await new Promise((resolve,reject)=> exec(concatCmd,(err)=> err? reject(err) : resolve()));
    fs.unlinkSync(listFile);
    sceneFiles.forEach(f=>{ try{ fs.unlinkSync(f) }catch(_){} });

    res.json({ message:"Video created with fades successfully", videoUrl:`http://localhost:${PORT}/videos/${path.basename(finalOutput)}`, script:`Generated for: ${prompt}` });

  }catch(err){
    console.error(err);
    res.status(500).json({ error:"Video generation failed", details:err.message });
  }
});

app.use((req,res)=>res.status(404).json({ error:"Endpoint not found" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT,()=> console.log(`Server running on http://localhost:${PORT}`));
