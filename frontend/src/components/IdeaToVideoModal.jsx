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
  const [videos, setVideos] = useState([]); // Pexels videos state
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
    voiceover: "",
    brandKit: null,
  });

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
    }
  }, [isOpen]);

  // Fetch Pexels videos via POST when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchPexelsVideos = async () => {
        try {
          const searchTerm = "nature"; // Default search term
          const res = await fetch("http://localhost:5000/api/search-pexels-videos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchTerm }),
          });
          const data = await res.json();
          console.log("Pexels videos:", data.videos);
          setVideos(data.videos || []);
        } catch (err) {
          console.error("Error fetching videos:", err);
        }
      };
      fetchPexelsVideos();
    }
  }, [isOpen]);

  const canProceed = () => {
    if (step === 1) return formData.prompt.trim();
    if (step === 4) return formData.voiceover && formData.voiceover.trim();
    return true;
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return <Step1Prompt formData={formData} setFormData={setFormData} />;
      case 2:
       return (
  <>
    <Step2Template formData={formData} setFormData={setFormData} videos={videos} />
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-2">Pexels Videos</h3>
      <div className="grid grid-cols-3 gap-4">
        {videos.map((video) => (
          <video
            key={video.id}
            src={video.video_files[0].link}
            controls
            className="rounded-lg shadow-md"
          />
        ))}
      </div>
    </div>
  </>
);

      case 3:
        return <Step3Styles formData={formData} setFormData={setFormData} />;
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

      const res = await fetch("http://localhost:5000/api/idea-to-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: formData.prompt,
          duration: formData.duration,
          voiceover: formData.voiceover,
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
      setError(err.message || "Video generation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setVideoUrl(null);
    setSubtitlesUrl(null);
    setError(null);
    setProgress(0);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-xl"
        >
          ✕
        </button>

        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {steps.map((s) => (
            <div
              key={s.id}
              className={`flex-1 min-w-[100px] text-center text-sm font-medium py-1 rounded-full ${
                step === s.id ? "bg-[#2ecc71] text-white" : "bg-gray-200 text-gray-600"
              }`}
            >
              {s.id}. {s.title}
            </div>
          ))}
        </div>

        {videoUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-full aspect-video bg-black rounded-md overflow-hidden">
              <video controls autoPlay className="w-full h-full object-contain">
                <source src={videoUrl} type="video/mp4" />
                {subtitlesUrl && (
                  <track src={subtitlesUrl} kind="subtitles" srcLang="en" label="English" default />
                )}
              </video>
            </div>

            <div className="flex gap-4 w-full">
              <button onClick={handleReset} className="px-4 py-2 border rounded-md flex-1">
                Create New Video
              </button>
              <a
                href={videoUrl}
                download={`video-${Date.now()}.mp4`}
                className="px-4 py-2 bg-[#2ecc71] text-white rounded-md flex-1 text-center"
              >
                Download Video
              </a>
              {subtitlesUrl && (
                <a
                  href={subtitlesUrl}
                  download={`subtitles-${Date.now()}.srt`}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md flex-1 text-center"
                >
                  Download Subtitles
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}

            {loading ? (
              <div className="flex flex-col items-center py-8">
                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                  <div className="bg-[#2ecc71] h-2.5 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-gray-600">
                  {progress < 100 ? "Generating your video..." : "Finalizing..."}
                </p>
                {progress < 100 && (
                  <p className="text-sm text-gray-500 mt-2">
                    This may take a few minutes depending on video length
                  </p>
                )}
              </div>
            ) : (
              renderStep()
            )}
          </>
        )}

        {!videoUrl && !loading && (
          <div className="mt-6 flex justify-between">
            {step > 1 ? (
              <button onClick={() => setStep(step - 1)} className="px-4 py-2 border rounded-md">
                Back
              </button>
            ) : (
              <div />
            )}

            {step < 5 ? (
              <button
                onClick={() => setStep(step + 1)}
                className={`px-4 py-2 rounded-md text-white ${
                  canProceed() ? "bg-[#2ecc71] hover:bg-[#27ae60]" : "bg-gray-400 cursor-not-allowed"
                }`}
                disabled={!canProceed()}
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-[#2ecc71] hover:bg-[#27ae60] text-white rounded-md"
                disabled={loading}
              >
                Generate Video
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IdeaToVideoModal;
