import React from "react";

export default function Step2Template({ formData, setFormData, onNext, onBack }) {
  console.log('formData in Step2Template:', formData);
  const styles = ["Cinematic", "Casual", "Professional", "Animated"];

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Step 2: Choose Template</h2>
      <div className="grid grid-cols-2 gap-3">
        {styles.map((style) => (
          <button
            key={style}
            className={`p-3 border rounded ${
              formData.style === style ? "border-green-500 bg-green-100" : "border-gray-300"
            }`}
            onClick={() => setFormData({ ...formData, style })}
          >
            {style}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-6">
        <button onClick={onBack} className="px-4 py-2 border rounded">Back</button>
        <button onClick={onNext} className="px-4 py-2 bg-green-500 text-white rounded">Next</button>
      </div>
    </div>
  );
}
