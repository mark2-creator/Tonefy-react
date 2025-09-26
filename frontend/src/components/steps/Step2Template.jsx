import React, { useEffect, useState } from "react";

export default function Step2Template({ formData, setFormData, videos, onVideoSelect }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState(null);

  useEffect(() => {
    if (videos && videos.length > 0) {
      console.log("📹 New videos arrived in Step2Template:", videos);
    }
  }, [videos]);

  // 🎤 Generate audio when script changes
  useEffect(() => {
    const generateAudio = async () => {
      if (!formData.script) return;
      try {
        setLoadingAudio(true);
        setAudioError(null);
        console.log("Generating audio for script:", formData.script.substring(0, 100) + "...");
        console.log("Using voice ID:", formData.voiceover);
        const response = await fetch("http://localhost:5000/api/generate-audio", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: formData.script,
            voice: formData.voiceover,
          }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Failed: ${response.status} ${errorData.error || "Unknown error"}`);
        }
        const data = await response.json();
        const newAudioUrl = `http://localhost:5000${data.audioUrl}`;
        setAudioUrl(newAudioUrl);
        setFormData((prev) => ({ ...prev, audioUrl: newAudioUrl }));
      } catch (err) {
        console.error("❌ Audio generation failed:", err);
        setAudioError("Failed to generate audio: " + err.message);
      } finally {
        setLoadingAudio(false);
      }
    };
    generateAudio();

    // Cleanup: Revoke URL on unmount or script change
    return () => {
      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [formData.script, formData.voiceover]); // Added formData.voiceover to deps

  const styles = ["Cinematic", "Casual", "Professional", "Animated"];
  const aspectRatios = [
    { id: "9:16", label: "Portrait" },
    { id: "1:1", label: "Square" },
    { id: "16:9", label: "Landscape" },
  ];

  const getFilteredVideos = () => {
    return (videos || []).filter((video) => video.url).slice(0, 2);
  };

  const handleVideoSelect = (video) => {
    console.log("Selected video in Step2Template:", video);
    if (onVideoSelect) {
      onVideoSelect(video);
    }
    setFormData((prev) => ({ ...prev, selectedVideo: video }));
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 2: Choose Template</h2>
      {/* Display Generated Script */}
      {formData.script && (
        <div className="mb-6 p-4 border rounded-lg bg-gray-50">
          <h3 className="font-medium text-gray-800 mb-2">📝 Generated Script</h3>
          <p className="text-sm text-gray-700 whitespace-pre-line">{formData.script}</p>
          {/* 🎤 Audio Preview */}
          <div className="mt-4">
            {loadingAudio && <p className="text-sm text-blue-500">Generating audio...</p>}
            {audioError && <p className="text-sm text-red-500">{audioError}</p>}
            {audioUrl && (
              <audio controls src={audioUrl} className="w-full mt-2" />
            )}
          </div>
        </div>
      )}
      {/* Style Selection */}
      <h3 className="text-lg font-semibold mb-2">Style</h3>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {styles.map((style) => (
          <button
            key={style}
            className={`p-3 border rounded ${
              formData.style === style
                ? "border-green-500 bg-green-100"
                : "border-gray-300"
            }`}
            onClick={() => setFormData((prev) => ({ ...prev, style }))}
          >
            {style}
          </button>
        ))}
      </div>
      {/* Aspect Ratio Selection */}
      <h3 className="text-lg font-semibold mb-2">Aspect Ratio</h3>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {aspectRatios.map(({ id, label }) => (
          <button
            key={id}
            className={`p-3 border rounded text-center ${
              formData.aspectRatio === id
                ? "border-green-500 bg-green-100"
                : "border-gray-300"
            }`}
            onClick={() => setFormData((prev) => ({ ...prev, aspectRatio: id }))}
          >
            <div className="font-medium">{id}</div>
            <div className="text-sm text-gray-600">{label}</div>
          </button>
        ))}
      </div>
      {/* Video Preview */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-2">
          Suggested Videos ({formData.aspectRatio || "Select One"})
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {getFilteredVideos().map((video) => (
            <div
              key={video.id}
              className={`cursor-pointer rounded-lg overflow-hidden shadow-md border-2 transition-all ${
                formData.selectedVideo?.id === video.id
                  ? "border-green-500 ring-2 ring-green-200"
                  : "border-transparent hover:border-gray-300"
              }`}
              onClick={() => handleVideoSelect(video)}
            >
              <video
                src={video.url}
                className="w-full h-40 object-cover"
                muted
                loop
                playsInline
              />
              <div className="p-3 bg-white">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {video.source === "pexels"
                    ? "Pexels Creator"
                    : video.source === "pixabay"
                    ? "Pixabay Creator"
                    : "Unknown Creator"}
                </p>
                <p className="text-xs text-gray-500">
                  Duration: {Math.round(video.duration || 0)}s
                </p>
                <p className="text-xs text-gray-500">
                  Source: {video.source}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}