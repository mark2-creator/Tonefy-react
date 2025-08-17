import React from "react";

export default function Step4VoiceSelect({ formData, setFormData, onNext, onBack }) {
  const voices = ["Voice A (Male)", "Voice B (Female)", "Voice C (Neutral)"];

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 4: Choose Voice</h2>
      <div className="space-y-2">
        {voices.map((voice) => (
          <label key={voice} className="flex items-center space-x-2">
            <input
              type="radio"
              name="voice"
              checked={formData.voice === voice}
              onChange={() => setFormData({ ...formData, voice })}
            />
            <span>{voice}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 border rounded">Back</button>
        <button onClick={onNext} className="px-4 py-2 bg-green-500 text-white rounded">Next</button>
      </div>
    </div>
  );
}
