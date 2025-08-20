import React, { useState } from "react";
import ProgressModal from "../ProgressModal";

export default function Step1Prompt({ formData, setFormData, onNext }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  const minutes = Number(formData.duration) || 0;

  const handleNext = () => {
    // Open the modal and start progress
    setIsModalOpen(true);
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsModalOpen(false);      // close modal when done
          if (onNext) onNext();       // move to next step
          return 100;
        }
        return prev + 5;              // increment progress
      });
    }, 300);
  };

  return (
    <div>
      {/* Prompt */}
      <label className="block text-sm font-medium mb-2">Prompt</label>
      <textarea
        value={formData.prompt}
        onChange={(e) => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
        placeholder="Eg: Motivating video on the benefits of eating healthy diet and exercising"
        className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-0"
        rows={3}
      />

      {/* Duration slider */}
      <div className="mt-4 text-left">
        <label htmlFor="minutes-slider" className="block text-sm font-medium mb-1">
          Duration (minutes)
        </label>
        <input
          id="minutes-slider"
          type="range"
          min="1"
          max="120"
          step="1"
          value={minutes}
          onChange={(e) =>
            setFormData(prev => ({ ...prev, duration: e.target.value }))
          }
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-500"
        />
        <div className="mt-1 text-sm font-semibold">
          {minutes} minute{minutes !== 1 ? "s" : ""}
        </div>
      </div>

      {/* File upload */}
      <div className="mt-4 border-2 border-dashed border-gray-300 rounded-md p-4 text-center">
        <p className="text-sm text-gray-500 mb-2">Drag & drop files or click to browse</p>
        <p className="text-xs text-gray-400">
          Supported: .pdf, .txt, .jpeg, .jpg, .png (max 5MB each, up to 11 files)
        </p>
      </div>

      {/* Next Button */}
      <button
        onClick={handleNext}
        className="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        Next
      </button>

      {/* Progress Modal */}
      <ProgressModal
        isOpen={isModalOpen}
        progress={progress}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
