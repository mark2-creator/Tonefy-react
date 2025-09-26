import React, { useState } from "react";

console.log(
  "ElevenLabs key loaded?",
  Boolean(import.meta.env.VITE_ELEVENLABS_API_KEY)
);

export default function Step4VoiceSelect({ formData, setFormData, availableVoices }) {
  const [playing, setPlaying] = useState(false);
  const [loadingVoice, setLoadingVoice] = useState(null);

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
        {availableVoices.length > 0 ? (
          availableVoices.map((voice) => (
            <div
              key={voice.voice_id}
              className={`p-4 border rounded-lg cursor-pointer transition-all ${
                formData.voiceover === voice.voice_id
                  ? "border-green-500 bg-green-50 ring-2 ring-green-200"
                  : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
              }`}
              onClick={() =>
                setFormData((prev) => ({ ...prev, voiceover: voice.voice_id }))
              }
            >
              <h3 className="font-semibold text-lg">{voice.name}</h3>
              <p className="text-sm text-gray-600">{voice.category || "Custom"}</p>
              <button
                type="button"
                className="mt-3 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                onClick={(e) => {
                  e.stopPropagation();
                  handleGeneratePreview(voice.voice_id);
                }}
              >
                {loadingVoice === voice.voice_id
                  ? "⏳ Generating..."
                  : playing && formData.voiceover === voice.voice_id
                  ? "▶ Playing..."
                  : "▶ Preview"}
              </button>
            </div>
          ))
        ) : (
          <div
            className={`p-4 border rounded-lg cursor-pointer transition-all ${
              formData.voiceover === "qBDvhofpxp92JgXJxDjB"
                ? "border-green-500 bg-green-50 ring-2 ring-green-200"
                : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
            }`}
            onClick={() =>
              setFormData((prev) => ({ ...prev, voiceover: "qBDvhofpxp92JgXJxDjB" }))
            }
          >
            <h3 className="font-semibold text-lg">Ana Rita</h3>
            <p className="text-sm text-gray-600">Custom</p>
            <button
              type="button"
              className="mt-3 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              onClick={(e) => {
                e.stopPropagation();
                handleGeneratePreview("qBDvhofpxp92JgXJxDjB");
              }}
            >
              {loadingVoice === "qBDvhofpxp92JgXJxDjB"
                ? "⏳ Generating..."
                : playing && formData.voiceover === "qBDvhofpxp92JgXJxDjB"
                ? "▶ Playing..."
                : "▶ Preview"}
            </button>
          </div>
        )}
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-sm text-gray-600">
          Selected voice:{" "}
          {availableVoices.find((v) => v.voice_id === formData.voiceover)?.name ||
            (formData.voiceover === "qBDvhofpxp92JgXJxDjB" ? "Ana Rita" : "None")}
        </p>
      </div>
    </div>
  );
}