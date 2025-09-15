import React, { useEffect } from "react";

export default function Step2Template({ formData, setFormData, videos }) {
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
      if (formData.aspectRatio === "9:16") return width / height <= 0.6;
      if (formData.aspectRatio === "1:1") return Math.abs(width / height - 1) < 0.1;
      if (formData.aspectRatio === "16:9") return width / height >= 1.7;
      return true;
    });
    return filtered.slice(0, 2);
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 2: Choose Template</h2>

      {/* Display Generated Script */}
      {formData.script && (
        <div className="mb-6 p-4 border rounded-lg bg-gray-50">
          <h3 className="font-medium text-gray-800 mb-2">📝 Generated Script</h3>
          <p className="text-sm text-gray-700 whitespace-pre-line">{formData.script}</p>
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
            // Pick safest playable URL
            const playable = video.video_files.find((f) => f.quality === "sd")?.link 
              || video.video_files.find((f) => f.file_type === "video/mp4")?.link 
              || video.video_files[0].link;

            console.log("🎥 Using playable URL:", playable);

            return (
              <video
                key={video.id}
                src={playable}
                controls
                className="rounded-lg shadow-md w-full"
                playsInline
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}