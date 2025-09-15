// scripts/make-voice-previews.js
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const voices = [
  { label: "Voice A (Male)", id: "8Ln42OXYupYsag45MAUy", filename: "jay.mp3" },
  { label: "Voice B (Female)", id: "wJqPPQ618aTW29mptyoc", filename: "anita.mp3" },
  { label: "Voice C (Neutral)", id: "wBXNqKUATyqu0RtYt25i", filename: "adam.mp3" }
];

const API_KEY = process.env.ELEVENLABS_API_KEY;

const generatePreviews = async () => {
  for (const voice of voices) {
    console.log(`Generating preview for ${voice.label}...`);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": API_KEY
      },
      body: JSON.stringify({ text: "This is a voice preview.", model_id: "eleven_multilingual_v1" })
    });

    if (!response.ok) {
      console.error(`Failed for ${voice.label}: ${response.statusText}`);
      continue;
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(`./public/samples/${voice.filename}`, Buffer.from(buffer));
    console.log(`Saved preview: ${voice.filename}`);
  }
};

generatePreviews();
