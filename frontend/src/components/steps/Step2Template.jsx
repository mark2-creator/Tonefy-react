import React, { useEffect } from "react";

export default function Step2Template({ formData, setFormData, videos }) {
  // ✅ Log only when videos change
  useEffect(() => {
    if (videos && videos.length > 0) {
      console.log("📹 New videos arrived in Step2Template:", videos);
    }
  }, [videos]);

  const styles = ["Cinematic", "Casual", "Professional", "Animated"];
  const aspectRatios = [
    { id: "9:16", label: "Portrait" },
    { id: "1:1", label: "Square" },
    { id: "16:9", label: "Landscape" },
  ];

  // Filter videos based on selected aspect ratio and limit to 2
  const getFilteredVideos = () => {
    const filtered = (videos || []).filter((video) => {
      const { width, height } = video.video_files[0];
      if (formData.aspectRatio === "9:16") return width / height <= 0.6; // Portrait
      if (formData.aspectRatio === "1:1") return Math.abs(width / height - 1) < 0.1; // Square
      if (formData.aspectRatio === "16:9") return width / height >= 1.7; // Landscape
      return true;
    });

    return filtered.slice(0, 2); // Limit to 2 videos
  };

  // ✅ Pick safest playable MP4 URL
  const getPlayableUrl = (video) => {
    const mp4s = video.video_files.filter((f) => f.link.endsWith(".mp4"));
    if (mp4s.length === 0) return video.video_files[0].link;
    // pick the smallest resolution (fastest to load)
    return mp4s.sort((a, b) => a.width - b.width)[0].link;
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 2: Choose Template</h2>

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
            onClick={() => setFormData({ ...formData, style })}
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
            onClick={() => setFormData({ ...formData, aspectRatio: id })}
          >
            <div className="font-medium">{id}</div>
            <div className="text-sm text-gray-600">{label}</div>
          </button>
        ))}
      </div>

      {/* Pexels Videos Preview */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-2">
          Pexels Videos ({formData.aspectRatio})
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {getFilteredVideos().map((video) => {
            const playableUrl = getPlayableUrl(video);

            return (
              <div
                key={video.id}
                className={`cursor-pointer rounded-lg overflow-hidden shadow-md border ${
                  formData.selectedVideo?.id === video.id
                    ? "border-green-500"
                    : "border-transparent"
                }`}
                onClick={() => setFormData({ ...formData, selectedVideo: video })}
              >
                <video
                  src={playableUrl}
                  controls
                  className="w-full h-auto"
                  onError={() =>
                    console.error("❌ Video failed to load:", playableUrl)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
