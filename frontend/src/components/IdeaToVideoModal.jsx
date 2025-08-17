import React, { useState } from "react";
import Step1Prompt from "../components/steps/Step1Prompt";
import Step2Template from "../components/steps/Step2Template";
import Step3Styles from "../components/steps/Step3Styles";
import Step4Script from "../components/steps/Step4Script";
import Step5Customization from "../components/steps/Step5Customization";

const IdeaToVideoModal = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
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
    { id: 4, title: "Script" },
    { id: 5, title: "Customization" },
  ];

  const canProceed = () => step !== 1 || formData.prompt.trim();

  const renderStep = () => {
    switch (step) {
      case 1: return <Step1Prompt formData={formData} setFormData={setFormData} />;
      case 2: return <Step2Template formData={formData} setFormData={setFormData} />;
      case 3: return <Step3Styles formData={formData} setFormData={setFormData} />;
      case 4: return <Step4Script formData={formData} setFormData={setFormData} />;
      case 5: return <Step5Customization formData={formData} setFormData={setFormData} />;
      default: return null;
    }
  };

  const handleSubmit = async () => {
    if (!formData.prompt.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/api/idea-to-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: formData.prompt }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();

      // Use full backend URL for video
      setVideoUrl(json.videoUrl ? `http://localhost:5000${json.videoUrl}` : null);
      setAudioUrl(json.audioUrl ? `http://localhost:5000${json.audioUrl}` : null);
      setFormData(prev => ({ ...prev, script: json.script }));
    } catch (err) {
      console.error("Submit failed:", err);
      alert("Submit failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl p-6 relative">
        <button
          onClick={() => {
            onClose();
            setVideoUrl(null);
            setAudioUrl(null);
          }}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800"
        >✕</button>

        <div className="flex items-center gap-3 mb-6">
          {steps.map((s) => (
            <div key={s.id} className={`flex-1 text-center text-sm font-medium py-1 rounded-full ${
              step === s.id ? "bg-[#2ecc71] text-white" : "bg-gray-200 text-gray-600"
            }`}>
              {s.id}. {s.title}
            </div>
          ))}
        </div>

        {/* Video player section */}
        {videoUrl ? (
          <div className="flex flex-col items-center gap-4">
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              className="w-full max-h-[500px] rounded-md"
            />
            {audioUrl && (
              <audio
                src={audioUrl}
                controls
                autoPlay
                className="w-full"
              />
            )}
          </div>
        ) : (
          renderStep()
        )}

        {/* Navigation / Submit buttons */}
        {!videoUrl && (
          <div className="mt-6 flex justify-between">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 border rounded-md"
              >Back</button>
            ) : <div />}

            {step < 5 ? (
              <button
                onClick={() => setStep(step + 1)}
                className={`px-4 py-2 rounded-md text-white ${canProceed() ? "bg-[#2ecc71]" : "bg-gray-400 cursor-not-allowed"}`}
                disabled={!canProceed()}
              >Next</button>
            ) : (
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-[#2ecc71] text-white rounded-md"
                disabled={loading}
              >
                {loading ? "Generating Video..." : "Submit"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IdeaToVideoModal;
