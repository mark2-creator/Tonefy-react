import React from "react";

export default function Step4VoiceSelect({ formData, setFormData, onNext, onBack  }) {
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
              checked={formData.voiceover === voice} // update voiceover
              onChange={() => setFormData({ ...formData, voiceover: voice })} // update voiceover
            />
            <span>{voice}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
