import React from "react";

export default function Step3MediaUpload({ formData, setFormData, onNext, onBack }) {
  const handleFileChange = (e) => {
    setFormData({ ...formData, media: Array.from(e.target.files) });
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 3: Upload Media (optional)</h2>
      <input
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFileChange}
        className="border p-2 rounded w-full"
      />
      {formData.media?.length > 0 && (
        <p className="mt-2 text-sm text-gray-500">{formData.media.length} files selected</p>
      )}
      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 border rounded">Back</button>
        <button onClick={onNext} className="px-4 py-2 bg-green-500 text-white rounded">Next</button>
      </div>
    </div>
  );
}
