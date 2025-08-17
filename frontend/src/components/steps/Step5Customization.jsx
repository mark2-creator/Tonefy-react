import React from "react";

export default function Step5Review({ formData, onBack, onSubmit }) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 5: Review & Confirm</h2>
      <div className="border p-4 rounded space-y-2">
        <p><strong>Prompt:</strong> {formData.prompt}</p>
        <p><strong>Style:</strong> {formData.style}</p>
        <p><strong>Media files:</strong> {formData.media?.length || 0}</p>
        <p><strong>Voice:</strong> {formData.voice}</p>
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 border rounded">Back</button>
        <button
          onClick={onSubmit}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Generate Video
        </button>
      </div>
    </div>
  );
}
