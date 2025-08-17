import React from "react";

export default function Step1Prompt({ formData, setFormData }) {
    const minutes = Number(formData.duration) || 0; // <-- define minutes here

  return (
    <div>
      <label className="block text-sm font-medium mb-2">Prompt</label>
      <textarea
        value={formData.prompt}
        onChange={(e) => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
        placeholder="Eg: Motivating video on the benefits of eating healthy diet and exercising"
        className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-0"
        rows={3}
      ></textarea>

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
        <p className="text-xs text-gray-400">Supported: .pdf, .txt, .jpeg, .jpg, .png (max 5MB each, up to 11 files)</p>
      </div>
    </div>
  );
}
