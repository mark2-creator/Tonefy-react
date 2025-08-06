import React from "react";

function LanguagesSection() {
  return (
    <section className="py-16 px-6 max-w-6xl mx-auto">
      <div className="text-center max-w-3xl mx-auto mb-12">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          No more waiting for voiceover artists and translators
        </h2>
        <p className="text-lg text-gray-700">
          With Tonefy’s AI voiceover, choose from 2500+ ultra-realistic voices,
          translate into 80+ languages with one click, and even clone your own voice.
        </p>
      </div>

      <div className="flex justify-center mb-10">
        <div className="w-full md:w-3/4 lg:w-1/2 h-84 bg-gray-100 border rounded-lg flex items-center justify-center text-gray-500 font-semibold">
          Video Placeholder
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-10 text-center">
        <div className="bg-pink-100 text-pink-800 py-3 px-2 rounded font-medium">
          🇺🇸 <span>English</span>
        </div>
        <div className="bg-pink-100 text-pink-800 py-3 px-2 rounded font-medium">
          🇩🇪 <span>German</span>
        </div>
        <div className="bg-pink-100 text-pink-800 py-3 px-2 rounded font-medium">
          🇫🇷 <span>French</span>
        </div>
        <div className="bg-pink-100 text-pink-800 py-3 px-2 rounded font-medium">
          🇪🇸 <span>Spanish</span>
        </div>
        <div className="bg-pink-100 text-pink-800 py-3 px-2 rounded font-medium">
          🇧🇷 <span>Portuguese</span>
        </div>
        <div className="bg-pink-100 text-pink-800 py-3 px-2 rounded font-medium">
          🇦🇪 <span>Arabic</span>
        </div>
      </div>

      <div className="text-center">
        <button className="bg-[#2ecc71] hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-lg transition">
          Explore all voices
        </button>
      </div>
    </section>
  );
}

export default LanguagesSection;
