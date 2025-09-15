import React, { useState } from "react";

console.log(
  "ElevenLabs key loaded?",
  Boolean(import.meta.env.VITE_ELEVENLABS_API_KEY)
);

export default function Step4VoiceSelect({ formData, setFormData }) {
  const [playing, setPlaying] = useState(false);
  const [loadingVoice, setLoadingVoice] = useState(null);

  const VOICE_OPTIONS = [
    { id: "19STyYD15bswVz51nqLf", name: "Samara", gender: "Female" },
    { id: "wJqPPQ618aTW29mptyoc", name: "Ana Rita", gender: "Female" },
    { id: "wBXNqKUATyqu0RtYt25i", name: "Adam", gender: "Male" }
  ];

  const handlePreview = (objectUrl) => {
    const audio = new Audio(objectUrl);
    setPlaying(true);
    audio.play();
    audio.onended = () => {
      setPlaying(false);
      URL.revokeObjectURL(objectUrl);
    };
  };

  const handleGeneratePreview = async (voiceId) => {
    try {
      setLoadingVoice(voiceId);
      const res = await fetch("http://localhost:5000/api/generate-audio-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: formData.prompt || "This is a quick preview of my voice.",
          voiceId: voiceId,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`TTS failed: ${res.status} ${errText}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      handlePreview(url);
    } catch (err) {
      console.error("❌ Preview error:", err);
      alert(err.message || "Preview failed");
    } finally {
      setLoadingVoice(null);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Step 4: Select Voice</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {VOICE_OPTIONS.map((voice) => (
          <div
            key={voice.id}
            className={`p-4 border rounded-lg cursor-pointer transition-all ${
              formData.voiceover === voice.id
                ? "border-green-500 bg-green-50 ring-2 ring-green-200"
                : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
            }`}
            onClick={() => setFormData(prev => ({ ...prev, voiceover: voice.id }))}
          >
            <h3 className="font-semibold text-lg">{voice.name}</h3>
            <p className="text-sm text-gray-600">{voice.gender}</p>
            <button
              type="button"
              className="mt-3 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              onClick={(e) => {
                e.stopPropagation();
                handleGeneratePreview(voice.id);
              }}
            >
              {loadingVoice === voice.id ? "⏳ Generating..." : playing ? "▶ Playing..." : "▶ Preview"}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-sm text-gray-600">
          Selected voice: {VOICE_OPTIONS.find(v => v.id === formData.voiceover)?.name || "None"}
        </p>
      </div>
    </div>
  );
}