import React, { useState, useEffect } from "react";
import Step1Prompt from "../components/steps/Step1Prompt";
import Step2Template from "../components/steps/Step2Template";
import Step3Styles from "../components/steps/Step3Styles";
import Step4VoiceSelect from "../components/steps/Step4VoiceSelect";
import Step5Customization from "../components/steps/Step5Customization";

const IdeaToVideoModal = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [subtitlesUrl, setSubtitlesUrl] = useState(null);
  const [error, setError] = useState(null);

  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isFetchingVideos, setIsFetchingVideos] = useState(false);

  const [formData, setFormData] = useState({
    prompt: "",
    duration: "30",
    files: [],
    template: null,
    aspectRatio: "16:9",
    language: "English",
    tone: "Informative",
    purpose: "",
    audience: "",
    script: "",
    style: "",
    avatar: "",
    voiceover: "19STyYD15bswVz51nqLf", // Default voice
    brandKit: null,
    selectedVideo: null,
    audioUrl: null,
  });

  const backendBaseUrl = "http://localhost:5000";

  const steps = [
    { id: 1, title: "Prompt" },
    { id: 2, title: "Template" },
    { id: 3, title: "Styles" },
    { id: 4, title: "Voice" },
    { id: 5, title: "Customization" },
  ];

  // Reset modal state
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setVideoUrl(null);
      setSubtitlesUrl(null);
      setError(null);
      setProgress(0);
      setSelectedVideo(null);
      setAudioUrl(null);
      setFormData((prev) => ({
        ...prev,
        prompt: "",
        selectedVideo: null,
        audioUrl: null,
        voiceover: "19STyYD15bswVz51nqLf",
      }));
    }
  }, [isOpen]);

  // Fetch Pexels videos based on user's prompt
  useEffect(() => {
    const fetchVideosBasedOnPrompt = async () => {
      if (step === 2 && formData.prompt.trim() && !videos.length && !isFetchingVideos) {
        setIsFetchingVideos(true);
        try {
          let searchTerm = "nature"; // fallback

          if (formData.prompt.trim().length > 3) {
            const commonWords = new Set([
              "the",
              "a",
              "an",
              "and",
              "or",
              "but",
              "in",
              "on",
              "at",
              "to",
              "for",
              "of",
              "with",
              "by",
            ]);
            const words = formData.prompt
              .toLowerCase()
              .split(/\s+/)
              .filter(
                (word) =>
                  word.length > 3 && !commonWords.has(word) && /[a-z]/.test(word)
              );

            if (words.length > 0) {
              searchTerm = words.slice(0, 3).join(" ");
            }
          }

          const res = await fetch(`${backendBaseUrl}/api/search-pexels-videos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchTerm }),
          });

          if (!res.ok) throw new Error("Failed to fetch videos");
          const data = await res.json();
          setVideos((data.videos || []).slice(0, 4));
        } catch (err) {
          console.error("Error fetching videos:", err);
          setVideos([]);
        } finally {
          setIsFetchingVideos(false);
        }
      }
    };

    fetchVideosBasedOnPrompt();
  }, [step, formData.prompt, isFetchingVideos]);

  const canProceed = () => {
    if (step === 1) return formData.prompt.trim();
    if (step === 2) return selectedVideo;
    if (step === 4) return formData.voiceover && formData.voiceover.trim();
    return true;
  };

  const handleSelectVideo = (video) => {
    setSelectedVideo(video);
    setFormData((prev) => ({ ...prev, selectedVideo: video }));
  };

  // 🔹 Updated handleNext with script + audio generation
  const handleNext = async () => {
    if (step === 1) {
      try {
        setLoading(true);
        const res = await fetch(`${backendBaseUrl}/api/generate-script`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: formData.prompt }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to generate script");
        }

        const data = await res.json();
        setFormData((prev) => ({ ...prev, script: data.script }));
      } catch (err) {
        console.error("Script generation failed:", err);
        alert("Script generation failed: " + err.message);
        return;
      } finally {
        setLoading(false);
      }
    }

    if (step === 2) {
      if (!selectedVideo) {
        alert("Please select a video first!");
        return;
      }
      try {
        setLoading(true);
        const res = await fetch(`${backendBaseUrl}/api/generate-audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: formData.script || formData.prompt,
            voice: formData.voiceover || "19STyYD15bswVz51nqLf",
          }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to generate audio");
        }

        const data = await res.json();
        const audioResponse = await fetch(`${backendBaseUrl}${data.audioUrl}`);
        const blob = await audioResponse.blob();
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setFormData((prev) => ({ ...prev, audioUrl: data.audioUrl }));
      } catch (err) {
        console.error("Audio generation failed:", err);
        alert("Audio generation failed: " + err.message);
        return;
      } finally {
        setLoading(false);
      }
    }

    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1Prompt
            formData={formData}
            setFormData={setFormData}
            placeholder="Enter your story, idea, or message..."
          />
        );
      case 2:
        return (
          <>
            {/* 🔹 Show generated script preview */}
            {formData.script && (
              <div className="mb-6 p-4 border rounded-lg bg-gray-50">
                <h3 className="font-medium text-gray-800 mb-2">📝 Generated Script</h3>
                <p className="text-sm text-gray-700 whitespace-pre-line">
                  {formData.script}
                </p>
              </div>
            )}
            <Step2Template formData={formData} setFormData={setFormData} videos={videos} />
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">
                Suggested Videos based on your prompt
              </h3>
              {isFetchingVideos ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Finding relevant videos...</p>
                </div>
              ) : videos.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>
                    No videos found. Please try a different prompt or check your
                    connection.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {videos.map((video) => {
                    const mp4File =
                      video.video_files?.find((f) => f.file_type === "video/mp4") ||
                      video.video_files?.[0];
                    return (
                      <div
                        key={video.id}
                        className={`cursor-pointer rounded-lg overflow-hidden shadow-md border-2 transition-all ${
                          selectedVideo?.id === video.id
                            ? "border-green-500 ring-2 ring-green-200"
                            : "border-transparent hover:border-gray-300"
                        }`}
                        onClick={() => handleSelectVideo(video)}
                      >
                        {mp4File ? (
                          <video
                            src={mp4File.link}
                            className="w-full h-40 object-cover"
                            muted
                            loop
                            playsInline
                          />
                        ) : (
                          <div className="w-full h-40 bg-gray-200 flex items-center justify-center">
                            <span className="text-gray-500">No preview</span>
                          </div>
                        )}
                        <div className="p-3 bg-white">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {video.user?.name || "Unknown Creator"}
                          </p>
                          <p className="text-xs text-gray-500">
                            Duration: {Math.round(video.duration || 0)}s
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {selectedVideo && (
                    <div className="mt-4 p-4 border rounded-lg bg-gray-50">
                      <p className="font-medium text-green-600 mb-2">
                        ✅ Selected Video
                      </p>
                      <div className="aspect-video bg-black rounded-lg overflow-hidden">
                        <video
                          src={
                            selectedVideo.video_files?.find(
                              (f) => f.file_type === "video/mp4"
                            )?.link || selectedVideo.video_files?.[0]?.link
                          }
                          controls
                          className="w-full h-full object-contain"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        );
      case 3:
        return (
          <div>
            <Step3Styles formData={formData} setFormData={setFormData} />
            {audioUrl && (
              <div className="mt-4 p-4 border rounded-lg bg-gray-50">
                <p className="font-medium text-lg mb-2">🎵 Audio Preview</p>
                <p className="text-sm text-gray-600 mb-3">
                  Listen to your generated voiceover:
                </p>
                <audio controls src={audioUrl} className="w-full" />
                <p className="text-xs text-gray-500 mt-2">
                  If you're not satisfied, you can go back and regenerate with
                  different settings.
                </p>
              </div>
            )}
          </div>
        );
      case 4:
        return <Step4VoiceSelect formData={formData} setFormData={setFormData} />;
      case 5:
        return <Step5Customization formData={formData} setFormData={setFormData} />;
      default:
        return null;
    }
  };

  const handleSubmit = async () => {
    if (!formData.prompt.trim()) return;

    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 1000);

      const res = await fetch(`${backendBaseUrl}/api/idea-to-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: formData.prompt,
          script: formData.script,
          selectedVideo: formData.selectedVideo,
          audioUrl: formData.audioUrl,
          voiceover: formData.voiceover,
          duration: formData.duration,
          style: formData.style,
          aspectRatio: formData.aspectRatio,
        }),
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Server error ${res.status}`);
      }

      const json = await res.json();
      setProgress(100);
      setVideoUrl(json.videoUrl);
      setSubtitlesUrl(json.subtitlesUrl);
      setFormData((prev) => ({ ...prev, script: json.script || prev.script }));
    } catch (err) {
      console.error("Video generation failed:", err);
      setError(err.message || "Video generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setVideoUrl(null);
    setSubtitlesUrl(null);
    setError(null);
    setProgress(0);
    setSelectedVideo(null);
    setAudioUrl(null);
    setVideos([]);
    setFormData((prev) => ({
      ...prev,
      prompt: "",
      selectedVideo: null,
      audioUrl: null,
      voiceover: "19STyYD15bswVz51nqLf",
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
        >
          ✕
        </button>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {steps.map((s) => (
            <div
              key={s.id}
              className={`flex-1 min-w-[80px] text-center text-xs sm:text-sm font-medium py-2 rounded-full transition-colors ${
                step === s.id
                  ? "bg-green-500 text-white shadow-md"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {s.id}. {s.title}
            </div>
          ))}
        </div>

        {videoUrl ? (
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-2xl font-bold text-green-600">🎉 Video Ready!</h2>
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden shadow-lg">
              <video
                controls
                autoPlay
                className="w-full h-full object-contain"
                poster="/video-poster.jpg"
              >
                <source src={`${backendBaseUrl}${videoUrl}`} type="video/mp4" />
                {subtitlesUrl && (
                  <track
                    src={`${backendBaseUrl}${subtitlesUrl}`}
                    kind="subtitles"
                    srcLang="en"
                    label="English"
                    default
                  />
                )}
                Your browser does not support the video tag.
              </video>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 w-full">
              <button
                onClick={handleReset}
                className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex-1"
              >
                🎬 Create New Video
              </button>
              <a
                href={`${backendBaseUrl}${videoUrl}`}
                download={`video-${Date.now()}.mp4`}
                className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex-1 text-center"
              >
                📥 Download Video
              </a>
              {subtitlesUrl && (
                <a
                  href={`${backendBaseUrl}${subtitlesUrl}`}
                  download={`subtitles-${Date.now()}.srt`}
                  className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex-1 text-center"
                >
                  📝 Download Subtitles
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center">
                  <span className="text-red-500 text-lg mr-2">⚠️</span>
                  <p className="text-red-700 font-medium">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="mt-2 text-red-600 text-sm hover:text-red-800"
                >
                  Dismiss
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center py-12">
                <div className="w-full max-w-md bg-gray-100 rounded-full h-3 mb-6">
                  <div
                    className="bg-green-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-gray-700 text-lg font-medium mb-2">
                  {progress < 100
                    ? "Creating your masterpiece..."
                    : "Final touches..."}
                </p>
                <p className="text-gray-500 text-center">
                  {progress < 100
                    ? "This may take a few minutes. Your video is being generated with care!"
                    : "Almost there! Preparing your video for download."}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-blue-50 to-green-50 p-4 rounded-lg">
                  <h2 className="text-xl font-semibold text-gray-800 mb-2">
                    Step {step}: {steps.find((s) => s.id === step)?.title}
                  </h2>
                  <p className="text-gray-600 text-sm">
                    {step === 1 &&
                      "Start by telling us your story, idea, or message..."}
                    {step === 2 &&
                      "Choose a video that matches your content..."}
                    {step === 3 &&
                      "Customize the look and feel of your video..."}
                    {step === 4 &&
                      "Select a voice that brings your words to life..."}
                    {step === 5 &&
                      "Add final touches to make it uniquely yours..."}
                  </p>
                </div>
                {renderStep()}
              </div>
            )}
          </>
        )}

        {!videoUrl && !loading && (
          <div className="mt-8 flex justify-between items-center">
            <button
              onClick={handleBack}
              disabled={step === 1}
              className={`px-6 py-2 rounded-lg transition-colors ${
                step === 1
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              ← Back
            </button>

            <div className="flex items-center gap-3">
              {step < 5 ? (
                <button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                    canProceed()
                      ? "bg-green-500 text-white hover:bg-green-600 shadow-md"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  className="px-8 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 shadow-md transition-colors"
                >
                  🎬 Generate Video
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IdeaToVideoModal;
