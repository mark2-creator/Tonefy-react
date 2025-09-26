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
  const [audioError, setAudioError] = useState(null);
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isFetchingVideos, setIsFetchingVideos] = useState(false);
  const [availableVoices, setAvailableVoices] = useState([]);
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
    voiceover: "qBDvhofpxp92JgXJxDjB",
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

  // Fetch available voices
  useEffect(() => {
    const fetchVoices = async () => {
      try {
        console.log("Fetching available voices from /api/voices");
        const res = await fetch(`${backendBaseUrl}/api/voices`);
        if (!res.ok) throw new Error("Failed to fetch voices");
        const data = await res.json();
        console.log("Available voices:", data.voices);
        setAvailableVoices(data.voices || []);
      } catch (err) {
        console.error("Failed to fetch voices:", err);
      }
    };
    fetchVoices();
  }, []);

  // Reset modal when closed
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setVideoUrl(null);
      setSubtitlesUrl(null);
      setError(null);
      setAudioError(null);
      setProgress(0);
      setSelectedVideo(null);
      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(null);
      setVideos([]);
      setFormData((prev) => ({
        ...prev,
        prompt: "",
        selectedVideo: null,
        audioUrl: null,
        voiceover: "qBDvhofpxp92JgXJxDjB",
      }));
    }
  }, [isOpen]);

  // Auto fetch videos based on prompt
  useEffect(() => {
    const fetchVideosBasedOnPrompt = async () => {
      if (step === 2 && formData.prompt.trim() && !videos.length && !isFetchingVideos) {
        setIsFetchingVideos(true);
        try {
          console.log("Fetching videos with search term:", formData.prompt);
          let searchTerm = "nature";
          if (formData.prompt.trim().length > 3) {
            const commonWords = new Set([
              "the", "a", "an", "and", "or", "but", "in", "on", "at",
              "to", "for", "of", "with", "by",
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
          console.log("Search term:", searchTerm);
          const res = await fetch(`${backendBaseUrl}/api/search-videos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchTerm }),
          });
          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || "Failed to fetch videos");
          }
          const data = await res.json();
          console.log("Fetched videos:", data.videos);
          console.log("Count:", data.count);
          setVideos((data.videos || []).slice(0, 4));
          if (data.videos && data.videos.length > 0) {
            console.log("Auto-selecting first video:", data.videos[0]);
            setSelectedVideo(data.videos[0]);
            setFormData((prev) => ({ ...prev, selectedVideo: data.videos[0] }));
          } else {
            console.warn("No videos returned for query:", searchTerm);
            setError("No videos found. Try a different prompt or check API keys.");
          }
        } catch (err) {
          console.error("Video fetch error:", err);
          setError("Failed to fetch videos: " + err.message);
          setVideos([]);
        } finally {
          setIsFetchingVideos(false);
        }
      }
    };
    fetchVideosBasedOnPrompt();
  }, [step, formData.prompt]);

  const canProceed = () => {
    if (step === 1) return formData.prompt.trim();
    if (step === 2) {
      console.log("Checking canProceed for Step 2, selectedVideo:", selectedVideo, "videos:", videos);
      return videos.length > 0 || isFetchingVideos;
    }
    if (step === 4) return formData.voiceover && formData.voiceover.trim();
    return true;
  };

  const handleSelectVideo = (video) => {
    console.log("Selected video:", video);
    setSelectedVideo(video);
    setFormData((prev) => ({ ...prev, selectedVideo: video }));
  };

  const handleNext = async () => {
    if (!canProceed()) {
      setError("Please complete the current step.");
      return;
    }
    setError(null);
    setAudioError(null);
    if (step === 1) {
      try {
        setLoading(true);
        setProgress(0);
        const interval = setInterval(() => {
          setProgress((prev) => Math.min(prev + 5, 90));
        }, 300);
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
        clearInterval(interval);
        setProgress(100);
        setStep(step + 1);
      } catch (err) {
        setError("Script generation failed: " + err.message);
        return;
      } finally {
        setLoading(false);
      }
    }
    if (step === 2) {
      if (videos.length === 0 && !isFetchingVideos) {
        setError("No videos available. Please try again.");
        return;
      }
      console.log("Step 2 handleNext, selectedVideo:", selectedVideo, "videos:", videos);
      try {
        setLoading(true);
        setProgress(0);
        const interval = setInterval(() => {
          setProgress((prev) => Math.min(prev + 5, 90));
        }, 300);
        const text = formData.script || formData.prompt;
        console.log("Text sent to /api/generate-audio:", text);
        console.log("Voice ID sent to /api/generate-audio:", formData.voiceover);
        if (!text.trim()) {
          throw new Error("No valid script or prompt for audio generation");
        }
        if (!formData.voiceover || !/^[a-zA-Z0-9]{20,}$/.test(formData.voiceover)) {
          console.warn("Invalid voice ID, falling back to default");
          setFormData((prev) => ({ ...prev, voiceover: "qBDvhofpxp92JgXJxDjB" }));
        }
        const res = await fetch(`${backendBaseUrl}/api/generate-audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: formData.voiceover,
          }),
        });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || "Failed to generate audio");
        }
        const data = await res.json();
        const newAudioUrl = data.audioUrl; // Use relative path: /audios/tts-...mp3
        console.log("Generated audio URL:", newAudioUrl);
        const audioResponse = await fetch(`${backendBaseUrl}${newAudioUrl}`, { method: "HEAD" });
        if (!audioResponse.ok) {
          throw new Error(`Audio file inaccessible: ${audioResponse.statusText}`);
        }
        setAudioUrl(newAudioUrl);
        setFormData((prev) => ({ ...prev, audioUrl: newAudioUrl }));
        clearInterval(interval);
        setProgress(100);
        setStep(step + 1);
      } catch (err) {
        console.error("Audio generation error:", err);
        setError("Audio generation failed: " + err.message);
        setAudioError("Failed to generate audio. Please try again.");
        return;
      } finally {
        setLoading(false);
      }
    }
    if (step > 2) {
      setStep(step + 1);
    }
  };

 const handleSubmit = async () => {
  if (!formData.prompt.trim()) return;
  setLoading(true);
  setError(null);
  setAudioError(null);
  setProgress(0);
  let progressInterval;
  try {
    progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 10, 90));
    }, 1000);
    console.log("Submitting to /api/idea-to-video with formData:", formData);
    const res = await fetch(`${backendBaseUrl}/api/idea-to-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    console.log("API response:", data); // Debug: Log the full response
    const fullVideoUrl = data.videoUrl.startsWith("http")
      ? data.videoUrl
      : `${backendBaseUrl}${data.videoUrl}`; // Prepend base URL if relative
    setVideoUrl(fullVideoUrl);
    setSubtitlesUrl(data.subtitlesUrl);
    setFormData((prev) => ({ ...prev, script: data.script || prev.script }));
    setProgress(100);
  } catch (err) {
    console.error("Video generation error:", err);
    setError(err.message || "Video generation failed. Please try again.");
  } finally {
    clearInterval(progressInterval);
    setLoading(false);
  }
};
  const handleReset = () => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setStep(1);
    setVideoUrl(null);
    setSubtitlesUrl(null);
    setError(null);
    setAudioError(null);
    setProgress(0);
    setSelectedVideo(null);
    setAudioUrl(null);
    setVideos([]);
    setFormData((prev) => ({
      ...prev,
      prompt: "",
      selectedVideo: null,
      audioUrl: null,
      voiceover: "qBDvhofpxp92JgXJxDjB",
    }));
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="float-right text-gray-500 hover:text-gray-700">
          ✕
        </button>
        <div className="flex justify-between mb-4">
          {steps.map((s) => (
            <div key={s.id} className={`p-2 ${s.id === step ? "font-bold" : ""}`}>
              {s.title}
            </div>
          ))}
        </div>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        {audioError && <p className="text-red-500 mb-4">{audioError}</p>}
        {loading && (
          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
            <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
          </div>
        )}
        {step === 1 && <Step1Prompt formData={formData} setFormData={setFormData} />}
        {step === 2 && (
          <Step2Template
            formData={formData}
            setFormData={setFormData}
            videos={videos}
            onVideoSelect={handleSelectVideo}
          />
        )}
        {step === 3 && <Step3Styles formData={formData} setFormData={setFormData} />}
        {step === 4 && <Step4VoiceSelect formData={formData} setFormData={setFormData} availableVoices={availableVoices} />}
        {step === 5 && <Step5Customization formData={formData} setFormData={setFormData} />}
        {audioUrl && step >= 3 && (
          <div className="mt-4">
            <p>Preview Audio:</p>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        )}
        <div className="flex justify-between mt-6">
          <button onClick={handleReset} className="px-4 py-2 bg-red-300 rounded">
            Reset
          </button>
          {step < 5 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed() || loading}
              className={`px-4 py-2 ${canProceed() && !loading ? "bg-blue-500 text-white" : "bg-gray-300 text-gray-500"} rounded`}
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className={`px-4 py-2 ${!loading ? "bg-green-500 text-white" : "bg-gray-300 text-gray-500"} rounded`}
            >
              Generate Video
            </button>
          )}
        </div>
        {videoUrl && (
  <div className="mt-4">
    <p>Generated Video: {videoUrl}</p> {/* Debug: Display the video URL */}
    <video
      controls
      src={videoUrl}
      className="w-full"
      onError={(e) => console.error("Video playback error:", e.target.error)}
    />
    {subtitlesUrl && <p>Subtitles: <a href={subtitlesUrl}>Download</a></p>}
  </div>
)}
      </div>
    </div>
  );
};

export default IdeaToVideoModal; 